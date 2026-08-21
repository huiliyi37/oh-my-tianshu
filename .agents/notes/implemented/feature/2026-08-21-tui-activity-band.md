# Agent Note: TUI unified activity band (CC-parity subagent/workflow display)

Status: implemented

English | [中文](2026-08-21-tui-activity-band.zh.md)

## Problem

Active subagent/workflow/background-task progress was scattered across three surfaces with no stats and no unified entry point: subagent running lines in the live region (`⠋ 子代理 <label>`, no tool/token counts, no height cap), workflow runtime state visible only inside the toggled `/workflow` panel (nothing in the live region, no scrollback summary when a run ended), and background tasks visible only inside `/tasks`. The `/subagents` tree could not tell an executing child from an idle-alive one (store liveness only), workflow roster rows could not link to their child sessions (the TUI dropped `workflow/agent-start`'s `childId`), and out-of-process providers (acp/claude-code/codex/dsh-sdk) were invisible to session-corpus enumeration (they have no Session).

## Decision

The TUI (`packages/tui/tui`) now folds the three active-activity sources into one height-capped **activity band** above the input track, rendered by `format/activity-band.ts` (`ActivityItem` + `foldActivityItems` + `formatActivityBand`): a group count header, one line per item (subagent `⠋` with tool/token/elapsed stats, workflow `⏳ [name] description · phase · N agents · elapsed`, task `› kind: label`), one `⎿` child line only for the newest active subagent, a permanent entry tail line (`/workflow 管理 · /subagents 树`, or `└ …(+N) /workflow 管理` when folded at `activityBandMaxRows`, default 5, a validated `TuiRunnerConfig` field), and the escape hatch `activityBand: false` for the legacy scattered lines. Completed items collapse to one scrollback line: subagent done lines gained a stats segment (`✓ label · N 工具 · X tok · elapsed`), and `workflow/end` commits a one-line summary. The band's stats come from a TUI-local child-projection cache (`childProgress`), fed by `projections.onChanged` for running subagent children; `subagent/end` snapshots it for the done line and clears it.

Cross-package (G1/G3): `subagentProgress` gained a `running` execution bit folded from the child's own `turn/start|end` boundaries (stateVersion 1→2, older cache rows refold) — zero new event vocabulary. `SubagentService.activeExternalRuns()` is the equivalent state view for active out-of-process runs (registered on publication, removed on settlement); the TUI renders them in a `⤷ 外部子代理` section of `/subagents`. Workflow roster rows now carry `childId` through the TUI (`ui/app.ts` keeps the field) and append `⤷ <child label>` (⏳ when running) via the panel's `childState` option derived from the delegation tree.

## Alternatives considered

- **A `subagent/status` session event** (running/idle/settled) plus a dedicated projection, versus the shipped `running` bit folded from `turn/start|end`. The event path adds new event vocabulary, emission points in lifecycle/continuation code, and turn-enclosure invariant surface for facts the child's own log already carries — the fold option ships the same live-state signal with no new events and no emission machinery.
- **Synthesizing out-of-process runs into `listChildren`/`listDescendants`** versus the shipped `activeExternalRuns()` equivalent state view. An external run has no Session identity; mixing it into `SubagentListEntry` would break the `id: SessionId` contract and pollute a module whose contract says it consults no provider state. The separate registry keeps the enumeration contract intact and serves the active-window need (history stays on the `subagent/start|end` event path).
- **A `renderActivityBand(snapshot)` panel in `live-panels.ts`** versus the shipped composer-direct `formatActivityBand` call in `renderLive`. The panel layer is `(snapshot) => string[]` with no tick; the band needs the spinner tick, which the composer owns — the composer-direct call matches the existing tick-dependent rendering pattern (tool cards, reasoning tail).

## Consequences

Bought: one capped, stable, stats-carrying band replaces three scattered surfaces; done lines and workflow summaries land in scrollback; tree/roster rows carry live execution state and child links; out-of-process runs have an active-window view; band height only changes with the active-item count (anti-jump, testable: every item exactly one line, at most one `⎿` child line, capped fold tail).

Cost: `subagentProgress` stateVersion 1→2 (schema now includes `running`) refolds all existing projection-cache rows on next use; TUI `app.spec` subagent wiring assertions were rewritten to the band semantics; the escape hatch exists because the legacy scattered lines are still loadable. Deferred, still open: G2 workflow persistence/replay (the band + end-commit line cover the live window; historical workflow runs remain unreconstructable after restart except via the parent tool result) and pause/resume semantics for children.

Verification: `packages/tui/tui/tests/activity-band.spec.ts` (fold shape, one-line-per-item, cap, number updates, subline placement, header counts, plain-text mode), updated `subagent-line.spec`/`workflow-panel.spec`/`delegation-panel.spec`/`app.spec` (band wiring, child-projection cache, escape hatch, workflow summary, external-run section), and `packages/subagent/subagent/tests/subagent-progress.spec.ts`/`service.spec.ts`/`list-children.spec.ts` for the `running` bit and the external-run registry. The design doc `docs/dsh-tui-subagent工作流面板细设计.md` §9 records the shipped deviations from the draft.

## Related

- Design: `docs/dsh-tui-subagent工作流面板细设计.md` (detailed, CC parity) and `docs/dsh-tui-todo与subagent面板设计.md` (overview).
- Reference: Tianshu `docs/plans/2026-08-03-tui-subagent-workflow-display-cc-parity.md`.
