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

Where it lives: the shaping functions are tool-local (no cross-package runtime dependency); the executor's own caps (64KB memory tail + spill) and the generic `spill-policy` post-execute cap (50KB, already mounted in the shipped `dsh-base` bundle) are unchanged layers below/above it. `dsh-tool-pwsh` reuses only the marker contract today; promoting the shaping to `dsh-bash` waits for a real pwsh consumer.

## Verification

- Pure functions (`model-output.spec`): body composition (stderr section, executor truncation notices), drop predicate (thresholds, 0-disables), success fold (exact counts, singular grammar, trailing newline, spill suffix), error-aware selection (head/window/tail anchors, gap markers, over-budget head+tail fallback).
- Tool-level through the real executor (`tools.spec`): `seq 1 50` folds with `[30 earlier lines omitted]`; a real failing 61-line command keeps `FATAL:` + tail anchors + `[exit code: 1]` last; spill wiring saves the full body and names `/spill/bash.txt` in the notice; no-backend and no-agent calls degrade honestly; short outputs byte-identical.
