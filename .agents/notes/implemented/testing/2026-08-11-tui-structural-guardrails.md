# Agent Note: TUI structural guardrails — recording ctx, real composition, and ratchet gates

Status: implemented

English | [中文](2026-08-11-tui-structural-guardrails.zh.md)

## Problem

The TUI port line landed 74 commits with its package tests green while a whole defect family shipped anyway: projection subscriptions leaked across `newSession()`, the `userInteraction` provider re-registration threw `DUPLICATE_PROVIDER` after remount, and `completedWorkflowRuns` grew without bound. The tests could not catch any of this because of their shape, not their count: `app.spec.ts` used a mock ctx whose `on()` recorded listeners but threw the disposers away, so release balance was unassertable; no test booted the plugin through the Loader against a real Cordis context, so lifecycle wiring was never exercised as composed; width/glyph specs read the host locale, so results changed by machine. Meanwhile three package-citizenship gates (`verify-package-invariants`, README Model Experience/Limitations) and `verify-config-catalog` were red and stayed red, and `SOURCE-MAP.md` claimed per-file `identical` status that nothing could verify because the upstream snapshot is not vendored.

## Decision

Guardrails now intercept the observed failure classes at the layer where each is visible, without touching `app.ts` structure (owned by the C4 split line):

- **Recording ctx** — `app.spec.ts`'s `makeCtx` records every `ctx.on()` subscription with its disposer, and `afterEach` asserts subscription/release balance whenever a test drove the app through full disposal. Landing this immediately exposed a real product defect: `TuiApp.newSession()` mounted a new session without `detachProjections()`, orphaning 11 listeners per switch; the fix mirrors `switchSession`'s symmetric detach.
- **Real composition test** — `tests/loader-composition.spec.ts` boots a test-only `cordis.yml` through the Loader in-process (real Cordis context, real plugin tree with `llm-replay` stubbing the LLM, fake TTY streams as the only fakes) and asserts behavior, not introspection: raw-mode symmetric restore, live rendering reacts to `workflow/start`, and after disposing only the TUI fiber, further `data`/`workflow/start`/`subagent/start` events produce zero writes.
- **Env baseline** — `tests/env-baseline.ts` pins `LANG`/`LC_*`/`RIVET_*` and resets the width/term-caps caches around each env-sensitive spec, replacing per-spec manual save/restore.
- **Source budgets ratchet** — `scripts/verify-source-budgets.ts` + `source-budgets.manifest.json` cap named monolith files at their current line counts (wired into `run-gates`); growth requires a review-visible manifest edit, and ceilings tighten manually after splits land.
- **Provenance made checkable** — `SOURCE-MAP.md` reclassifies every `src` file under a closed enum (`ported`/`modified`/`new`) that does not claim byte identity, `tests/source-map.spec.ts` guards coverage and enum validity, `NOTICE` delegates the Apache §4(b) modification list to the map, and `projection-layer.md` states which fold models are actually wired (none yet) instead of the designed-but-unbuilt eight-module story.
- **Workflow history cap** — `completedWorkflowRuns` evicts drop-oldest beyond `TuiRunnerConfig.workflowHistoryLimit` (validated positive integer, default 50, fails loud at `apply()`), landed before C4 Wave 1 so the field migrates with the split.
- **Citizenship** — tui/fs-snapshot/agent-router/evidence-gate carry the standard README sections and invariant companions; the config catalog is regenerated and now includes their entries.
- **Wire-shape drift fixed on discovery** — documenting the TUI's local event redeclarations for the Cordis catalog exposed that `workflow/phase` was declared and handled as `(info, { title })` while the owning `dsh-workflow` dispatches `(info, title: string)`: with a real workflow the phase title could never render, and only the tests' wrong-shaped emissions kept the suite green — the mock-shadowing thesis proven a second way. The declaration, handler, and test emissions now match the owner, and the redeclaration block carries full event JSDoc so catalog gates diff it against the owner on every regeneration.

## Alternatives considered

**Fix the disposer defects individually and stop.** Rejected: the defects were already fixed in prior commits; what shipped them was test shape. Without changing the mock's disposer blindness and adding a composed-lifecycle lane, the next port re-imports the same blindness.

**Full-TTY e2e (node-pty subprocess) instead of in-process Loader boot.** Rejected: slower, platform-sensitive, and needless — every defect in the observed family (leaked listeners, provider re-registration, render-after-dispose) is reproducible against a real Cordis context with fake streams; the terminal byte protocol itself is already covered by engine unit specs.

**Lint-rule line caps (`max-lines`) instead of a manifest ratchet.** Rejected: the repo lints with oxlint, which has no per-file named-ceiling ratchet; a JSON manifest makes every ceiling raise a reviewable diff and lets ceilings differ per file without rule contortions.

**Byte-identity verification for SOURCE-MAP.** Rejected as dishonest: the upstream snapshot is not vendored, so `identical` claims are unverifiable by construction. The closed enum plus coverage spec guards what is checkable (every file mapped, statuses legal, no ghost entries) and nothing more.

## Consequences

Bought: the disposer family now fails loudly at two independent layers (unit `afterEach` balance and composed dispose silence), monolith growth is review-visible, provenance and projection docs describe reality, and the unbounded-map class has a configured cap. Cost: every future `app.spec.ts` test that fully disposes the app inherits the balance assertion (leaky tests fail even when their own assertions pass); the composition lane adds a few seconds to the tui suite; source-budget ceilings require manual re-tightening after the C4 split lands (deliberate — automatic tightening would flake on in-flight work); the config catalog now carries tui/guard entries whose bilingual pair must be kept in sync on regeneration.

## Related

The C4 split plan (`docs/dsh-tui-拆分方案-c4.md`) owns `app.ts` decomposition, dispose completion for interaction/taskDone/taskSurface, and pending-approval cross-session settlement; this note deliberately claims none of that. The composition lane is the designated consumption path for the `TODO(tui)` coverage exemptions listed in `vitest.config.ts`.
