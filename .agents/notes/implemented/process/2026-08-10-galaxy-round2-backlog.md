# Agent Note: Galaxy round-2 backlog — four-layer plan and remaining work

Status: implemented

English | [中文](2026-08-10-galaxy-round2-backlog.zh.md)

> 2026-08-10 · test-huiliyi37 workspace · snapshots/20260809T140917Z-a6bb5a95ba branch. Related: the round-1 error log in 2026-08-10-galaxy-round1-error-log.md (commit 52debaf). Reference baseline: /Users/banxia/app/deepseek-tui/opencode-tui/src/tui/ (Apache 2.0, the DSH port source)

## Problem

The first-round galaxy cluster (landing the four layers) has committed its RED-phase output (commit 0ccb2d5, 30 files), but **all implementation and verification remain unfinished**. This document records the four-layer plan and the outstanding gaps, as the reconciliation baseline for the round-2 continuation. Anti-goals (dsh-tui-next-phase.md): no council/team/worker multi-agent panel, no updater/desktop build, no changes to the core/agent/session packages, no inventing new event types.

### Plan content (four layers)

1. **controller-layer (render controllers)** — split the hand-written renderLive() assembly in `ui/app.ts` into standalone controllers: stream-render-controller (stream commits / tail control), overlay-controller (overlay lifecycle + CPR suppress/resume coordination), metrics-glance-controller (bottom glance data and refresh throttling), tool-accumulator / tool-group-controller (in-progress tool-card aggregation). ui/app.ts is the sole owner of the assembly point.
2. **format-layer (formatting renderers)** — pure render functions (data + width + theme → LiveRegionLine[]): glance-bar, activity-labels, spinner-status, welcome, separator, collapsed-bash, collapsed-read-search, turn-summary.
3. **projection-layer (state projections)** — data models separated from subscriptions, consuming only the existing session/event and agent/* events: activity-status / activity-store (live activity labels), summary-state + the turn-summary model (tool-call statistics), cache-panel-source + cache-telemetry (token/cache metrics), history-replay (the history replay projection).
4. **interaction-layer (interaction enhancements)** — command-palette (Ctrl+P, reusing the existing SlashCommandRegistry), mention-parser (pure-function @ parsing), restore-session (the resumable-sessions projection), tool-elapsed / tool-label / tool-status (tool-card helpers). **6.4 external editor and 6.5 Vim mode are explicitly excluded** (Phase candidates for another session).

### Done (commit 0ccb2d5)

- 23 RED test specs (per layer, including the Ctrl+P integration test appended to app.spec.ts)
- 3 controller implementations on disk: engine/metrics-glance-controller.ts, engine/overlay-controller.ts, engine/stream-render-controller.ts (the metrics one not read back for review)
- 2 design documents: docs/tui-render-controllers.md, packages/tui/tui/docs/projection-layer.md
- the mention-semantics Agent Note (2026-08-10-tui-mention-semantics.*, compliant format)

### Unfinished (round 2 must complete)

| Dimension | Missing implementation | Assembly | Verification |
|---|---|---|---|
| controller | engine/tool-group-controller.ts never landed (three writes blocked); the metrics implementation unreviewed | ui/app.ts assembles no controller (renderLive still hand-written) | vitest GREEN, typecheck, lint not run |
| format | all 8 implementations missing: glance-bar / activity-labels / spinner-status / welcome / separator / collapsed-bash / collapsed-read-search / turn-summary (.ts) | none (pure functions; assembly belongs to the projections above them) | vitest GREEN not run (7/8 specs on disk) |
| projection | all 8 implementations under src missing: activity-status / activity-store / summary-state / turn-summary (the model) / cache-panel-source / cache-telemetry / history-replay + adapter wiring | none | vitest GREEN not run (4 specs on disk) |
| interaction | all 6 implementations missing: command-palette / mention-parser / restore-session / tool-elapsed / tool-label / tool-status | app.ts not wired (the Ctrl+P test is already appended) | vitest GREEN not run (7 specs on disk) |

Round-1 root causes (see the error log for detail): worker budgets exhausted in the RED phase + the write_file pointer-substitution misjudgment; this backlog does not rewrite tests — it continues straight into the implementations.

## Decision

Execution discipline for the round-2 cluster (the GREEN continuation):

- **Full budget up front**: maxTurns ≥60, timeout ≥25min; the worker goal is explicit — "continue the implementations, do not rewrite existing tests".
- **After finishing each file, read it back with read_file to confirm it landed** (do not trust auto-recovered claims).
- **Verification gates**: per layer, run vitest (its specs all green) → full typecheck (`pnpm run typecheck`) → staged lint (oxlint) → deliver only after they pass.
- **Assembly coordination**: ui/app.ts is held by the controller dimension alone; the other dimensions add new files only and never touch assembly.
- Run every lefthook job locally before committing; when deliver_task reports failure, check git log/status for the real state first (Scoped commit failed is often a false positive after a successful commit).
- The anti-goals hold: no multi-agent panel / updater / desktop build; no core-package changes; no invented events.

## Alternatives considered

**Round 1 doing "design + implementation + tests" in one pass** — failed. The budget could not carry the whole journey; all four layers broke before implementation. Changed to a round 2 that does implementation only (the tests are already in the repository), with an enlarged budget.

**Splitting into one cluster round per layer** — the fallback. If round 2 still exceeds budget, degrade to layer-by-layer serial progress (controller → projection → format → interaction), one cluster round per layer.

## Consequences

- Round-2 target state: all four layers' implementations on disk, their vitest all green, typecheck/lint passing, the ui/app.ts assembly complete (the controller dimension), and one new commit delivered.
- Each layer may commit separately on completion (a files subset), avoiding one big cross-area commit that trips the cohesion gate.
- This document plus the error log form the complete context for starting round 2; on completion this backlog is marked closed or archived.
