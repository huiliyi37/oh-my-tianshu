# Agent Note: Bash model-output shaping

Status: implemented

English | [中文](2026-08-21-bash-model-output-shaping.zh.md)

## Problem

A bash result's model-facing body kept everything the executor collected (up to the 64KB tail cap): a verbose successful command poured its whole happy-path log into the context, and a failed command buried its actual error in a wall of output. Token spend and context bloat with zero informational gain — the upstream Tianshu repo measured 61% of cacheCreate tokens coming from in-turn tool-result growth and internalized rtk's per-command filtering into a layered output-store strategy.

## Decision

`dsh-tool-bash` now shapes the foreground model-facing body (upstream `output-store` lineage, internalized in `packages/bash/tool-bash/src/model-output.ts`):

- A successful body above `outputSuccessTailLines` (default 20; 0 disables) folds to its tail lines with an exact omission count.
- A FAILED body above `outputErrorThresholdLines` (default 40) keeps error-relevant lines — a diagnostics-vocabulary regex match ±2 lines of context, plus head-3/tail-2 anchors — within `outputErrorBudgetLines` (default 60); when matches alone exceed the budget it falls back to a deterministic head+tail split of the same budget.
- Bodies at or below the thresholds pass through byte-identical. Content is only deleted, never invented; every omission carries its count (inherited discipline: 小输出不动、只删不编、丢内容必留标记、原文可恢复).

Recovery: before shaping omits anything, the full composed body (stdout + stderr section, executor truncation notices included) is saved to `ctx.spillStore` and the omission notice carries the locator (`outputSpillPath` on the foreground value). A rerun is never the recovery path — commands may have side effects. Best-effort by design: no spill backend, no session owner, or a save failure degrades to a pathless omission count and never fails the call.

Per-command filters (P2, same commit family): `command-filters.ts` compacts the three highest-frequency noise families BEFORE the generic shaping — git log above 30 lines keeps ≤`gitLogMaxCommits` (15) newest commits (Author/Merge/trailers stripped, ≤3 message lines, 120-char width; custom --format respected), git diff above 40 lines caps hunks (60) and the body (300) with per-file `# +A -R` counts, recognized test runs above 15 lines keep failure blocks (±5 context, anchors) within `testRunMaxLines` (120). A curated body skips the generic shaping (re-folding curated output would keep the wrong end — the ordering is why the filters live in the render pipeline rather than a `tools/post-execute` plugin, which runs AFTER the render and would see folded text). The un-filtered original is spilled through the same predicate extension.

Environmental-failure diagnosis (P3): exit 126/127/130/137/143 with at most a couple of shell lines gets a one-line standardized `[environment: …]` diagnosis (meaning + do-not-retry-blindly guidance) inserted before the anchored exit marker, keeping the terminal pill parse intact; bodies with real output skip it.

Where it lives: the shaping functions are tool-local (no cross-package runtime dependency); the executor's own caps (64KB memory tail + spill) and the generic `spill-policy` post-execute cap (50KB, already mounted in the shipped `dsh-base` bundle) are unchanged layers below/above it. `dsh-tool-pwsh` reuses only the marker contract today; promoting the shaping to `dsh-bash` waits for a real pwsh consumer.

## Alternatives considered

- **A `tools/post-execute` plugin carrying the shaping** (the seam spill-policy uses) versus the shipped render-pipeline placement. `output.render` runs BEFORE the post-execute waterfall, so a plugin there only ever sees text the generic layer already folded — for `git log` (newest first) that fold keeps the wrong end — and it has no access to the command or the structured result the shaping decisions need. The pipeline placement runs per-command filters first and can skip the generic fold for curated bodies.
- **Hosting the shaping functions in shared `dsh-bash`** for `dsh-tool-pwsh` reuse versus tool-local files. No pwsh consumer exists today (speculative generality), and a cross-package runtime import resolves through the package's built `lib/`, breaking the source-plane test resolution — promote to `dsh-bash` when a real consumer appears.
- **Integrating the rtk binary** (the upstream's early external path) versus internalization. rtk adds an external dependency and a health-probe surface; the upstream itself later internalized the strategy. The three filter families here cover the measured high-frequency offenders without any binary.

## Consequences

Bought: verbose success output and failure walls stop pouring into the context (the upstream measured most cacheCreate tokens coming from exactly this in-turn growth); failures keep their error-relevant lines with exact omission counts; every dropped byte stays recoverable through the spill path without re-running side-effecting commands; thresholds are deployment-configurable with load-time validation.

Cost: the model sees less than the executor collected — recovery depends on the spill notice being followed; success folding can hide early-run warnings that precede a successful tail (the tail threshold is configurable down); the rendered text no longer equals the structured body byte-for-byte, so consumers parsing the envelope (none today beyond the exit markers, which survive anchored) must go through the structured value.

## Verification

- Pure functions (`model-output.spec`): body composition (stderr section, executor truncation notices), drop predicate (thresholds, 0-disables), success fold (exact counts, singular grammar, trailing newline, spill suffix), error-aware selection (head/window/tail anchors, gap markers, over-budget head+tail fallback).
- Tool-level through the real executor (`tools.spec`): `seq 1 50` folds with `[30 earlier lines omitted]`; a real failing 61-line command keeps `FATAL:` + tail anchors + `[exit code: 1]` last; spill wiring saves the full body and names `/spill/bash.txt` in the notice; no-backend and no-agent calls degrade honestly; short outputs byte-identical.
