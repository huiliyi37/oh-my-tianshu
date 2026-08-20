# Agent Note: live-area card language

Status: implemented

English | [中文](2026-08-19-live-card-language.zh.md)

## Problem

The live area painted process-like rows in three chrome dialects: tool cards used `›`/`⠋`/`✗` plus a `⎿` body; the delegation tree jammed activity, tokens, tool count, terminal words, and elapsed time onto one `●`/`○` line; background-task snapshots used `⏳`/`✓`/`✗` with an inline `· detail`. A running child and a running `pnpm build` did not look like the same kind of object as an in-flight tool card. grok-build's `tasks_pane` keeps one list language (running vivid, finished recede, activity suffix) but sits on a mouse overlay this live region does not have.

## Decision

[`format/live-card.ts`](../../../../packages/tui/tui/src/format/live-card.ts) is the single chrome for process-like live rows. Status glyphs match `formatToolCardHeader`: in-flight `⠋` (ASCII `-`), success `›`, error `✗` (ASCII `x`), question `?`. The first body line uses `⎿  `; continuations use three spaces. Header suffixes drop right-to-left; the title is last to truncate. In-flight rows with activity render a second `⎿` line. Idle or finished rows stay header-only (elapsed and terminal word on the header); when a theme is passed, the finished title is muted. No new session events, no new projection fields, no row selection, no mouse hit-rects, and `/tasks` stays a separate toggle from `/subagents`.

### Tool cards

`formatToolCard` / `formatToolCardHeader` / `indentToolBody` / `formatToolCardLive` consume the shared prefixes and `liveCardGlyph`. An in-flight live tool header without a tick uses `⠋` (or the ASCII spinner when `tick` is set), not `●`. Diff / read / compact / Enter-expand behavior is unchanged.

### Delegation tree

[`projectDelegationTree`](../../../../packages/tui/tui/src/delegation-panel.ts) still reads entry-carried `progress` / `timing` from [the progress-projection note](2026-08-19-subagent-progress-projection-and-delegation-panel.md). The title keeps `↻`/`▶` (continuable vs one-shot). Glyph is `⠋` only while `toolInFlight`; `lastTurnEnd` of `error` / `aborted` / `interrupted` uses `✗`; otherwise `›`. While the child is not finished, activity / tokens / tool count move to the `⎿` line. A present `lastTurnEnd` or `activity === 'inactive'` is finished: no body, terminal word and elapsed stay on the header. `/subagents kill` is unchanged.

### Background tasks and todos

[`renderTasksPanel`](../../../../packages/tui/tui/src/render/live-panels.ts) paints `taskSnapshots` with the same card (`running` → `⠋` plus optional `⎿ detail`; `completed` → `›`; other statuses → `✗`). [`projectTaskPanel`](../../../../packages/tui/tui/src/format/task-panel.ts) todos stay `[ ]` / `⏳` / `[x]`: a checklist is not a process card. `/tasks kill` stays a slash command.

## Alternatives considered

**Port grok-build's unified overlay with per-row kill/view hit-rects.** Rejected: the live region has no row selection and no mouse handling ([progress-projection D5](2026-08-19-subagent-progress-projection-and-delegation-panel.md)). In-row kill would be a new input primitive, not a paint change.

**Interleave `/tasks` and `/subagents` into one list.** Rejected: that changes sort order, empty states, and the slash-command story. This change only unifies row chrome.

**Paint todo rows with `›`/`⠋`.** Rejected: checkbox semantics (`[ ]` / `[x]`) are the object; grok-build also keeps todos distinct from running processes.

**Keep three glyph sets and only add a second delegation line.** Rejected: the inconsistency was the product defect; a fourth local dialect would not close it.

## Consequences

A running delegation child or background task now occupies two lines, so the input box can shift by one row when activity appears or clears. Finished rows recede (single line, muted title when themed) without a color-blend algorithm. Kill remains slash-only. `contextPct` still needs a live `contextWindow` query and stays out of the progress projection.

## Testing

- `packages/tui/tui/tests/live-card.spec.ts` — glyphs, two-line vs one-line, suffix drop, muted finished title, ASCII fallback.
- `packages/tui/tui/tests/delegation-panel.spec.ts` — in-flight header `⠋` + `⎿` body; finished header-only with terminal word; error glyph `✗`.
- `packages/tui/tui/tests/live-panels.spec.ts` — background-task snapshots use the card; todos still render through `projectTaskPanel`.
- `packages/tui/tui/tests/tool-card.spec.ts` — live header without a tick is `⠋`.
- `packages/tui/tui/tests/task-panel.spec.ts` — checklist marks unchanged.

## Related

- [subagent progress projection and delegation-panel richness](2026-08-19-subagent-progress-projection-and-delegation-panel.md) — the facts this chrome consumes; kill remains slash-only.
