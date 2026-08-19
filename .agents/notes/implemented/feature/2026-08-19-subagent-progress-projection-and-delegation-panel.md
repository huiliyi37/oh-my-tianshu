# Agent Note: subagent progress projection and delegation-panel richness

Status: implemented

English | [中文](2026-08-19-subagent-progress-projection-and-delegation-panel.zh.md)

## Problem

The `dsh-tui` delegation-tree panel (`/subagents`) showed only shape facts — tree depth, activity `●/○`, mode `▶/↻`, label, and settled timing — so a running subagent was information-invisible: no activity text (`Running: bash`), no token spend, no tool count, and no terminal reason. Three gaps stood behind that thinness:

- **The data source was thin.** `SessionProjectionMap` carried only `subagent` (identity: mode/label/seq) and `subagentTiming` (settledMs). No unit folded running activity from the child's log.
- **A parent-panel wiring bug hid timing.** The panel read `subagent`/`subagentTiming` from the *active* session's `projectionCache`, but those units fold the *child's* own log. `attachProjections` snapshots only the active session, so a parent always saw null/zero and never rendered `· 43s`.
- **No control affordance.** `ctx.subagents.interrupt()` existed (user/ancestor authority) but the panel and slash surface had no stop path; the TUI `SubagentsFacet` did not declare it.

## Decision

A running-state projection folds existing child-log events and rides the descendant listing. The panel consumes entry-carried fields. `/subagents kill` stops a live continuable child. No new event vocabulary, no agent-loop or session-event change (Model-visible ⟺ logged).

### D1 — `SubagentProgressProjection`

The public shape lives in `projection-types.ts` and on the [subagent subsystem page](../../../../docs/subsystems/subagent.md). Deliberately excluded: `contextPct` (needs the live `contextWindow` query) and `stopReason` (the `refusal` variant is not log-derivable; terminal outcome stays on `subagent/end`). `turns` and `reasoningTokens` stay on the type for other consumers; the P0 panel row does not print them.

### D2 — Fold rules

`subagentProgressProjectionDefinition` mirrors the timing unit's descriptor-reset discipline. State carries `descriptorSeen`; `subagent/descriptor` resets accumulation so only the child's own suffix counts.

- `turn/start` clears `lastTurnEnd`, so an open turn is not terminal. A continuable child that finished one turn and then calls a tool must not show `Running: bash` beside `✓ 已完成`.
- `tool/call` increments `toolCalls`, sets `lastTool`/`lastCallId`, and records the pending own-key. `tool/result` clears that pending entry only via `Object.hasOwn` (a prototype-named `callId` is unmatched and returns the same state reference).
- `assistant/message` with `usage` is last-wins for `tokensUsed` (input+output+cacheRead+cacheWrite). `reasoningTokens` is last-wins with the *latest* usage: if that usage omits the field, the prior value is dropped, not sticky.
- `turn/end` increments `turns` and records a known reason kind. An unknown merged kind counts the turn without guessing a label.
- Uninteresting events return the same state reference. Zod strict schema, `stateVersion: 1`; the fold never throws.

### D3 — Carrier

`listDescendants` embeds optional `progress`/`timing` on a `child` row when the same three-rung cut folds a meaningful value (`meaningfulProgress` / `meaningfulTiming`). `listChildren` never embeds them. The TUI no longer reads `projectionCache.subagent` / `subagentTiming` for the parent panel (that was D0).

### D4 — TUI consumption

`DelegationTreeEntry` child rows carry the same optional fields. Chrome is owned by [the live-card language note](2026-08-19-live-card-language.md): in-flight rows are a `⠋` header plus a `⎿` body (`Running: <lastTool>` / tokens / tool count); finished rows are header-only with the terminal word and elapsed suffix. Activity text is `Running: <lastTool>` while in flight, else `Done: <lastTool>` when a tool has run. Tokens reuse `formatTokenCount`. Suffixes drop right-to-left; the label survives first. A present `lastTurnEnd` appends a status word (`✓ 已完成`, `✗ 出错`, …) and suppresses the body. Live `now` computes open-turn elapsed from `timing.active`.

Refresh: `sessionProjections.onChanged` matching a tree member (or `subagentProgress`/`subagentTiming` on a child already on the tree) re-runs `listDescendants` for the current root — one consistent cut, including cold inspect when needed. That is not a no-I/O render-only schedule.

### D5 — `/subagents kill <id>`

The live region has no row selection or mouse handling. Kill lists the *current* session's descendants and calls `interrupt(id, { kind: 'user', parentSessionId: entry.parentId })` — the durable **direct** parent, which `interrupt()` checks against `header.parentSession`. It does not use `sessions.list()[0]` and does not pass the tree root as parent.

One-shot, inactive, unknown-in-this-tree, missing service, and `sessionId === null` fail loud *before* `interrupt`. A service-level absent target remains an accepted no-op; the command does not claim success for cases it can detect.

## Alternatives considered

**Per-child registry reads in the TUI** (`sessions.get(childId)` + `projections.snapshot` + `onChanged` by `s.id`). Rejected: the TUI would duplicate the live-watermark vs cold-persisted cut `list-children.ts` already owns, and would leave D0 in place for timing.

**A new `subagent/progress` plugin event.** Rejected: invents event vocabulary. Every projection fact must trace to an existing session event.

**Keep reading the active-session `projectionCache` and add a key.** Rejected: reproduces D0 for progress exactly as it hid timing.

**Accumulated tokens in the projection.** Rejected: the panel shows current state, not an audit; accumulation drifts after compaction/replay.

**`parentSessionId: rootSessionId` for user interrupt.** Rejected: `interrupt()` authorizes the durable direct parent, not the tree root. Nested children would get `UNAUTHORIZED` or a silent no-op.

## Consequences

The parent panel can show activity, tokens, tool count, elapsed time, and a terminal word from one descendant listing. Timing is visible on the parent because it rides the child row. Kill works for a nested continuable child when the caller is looking at any ancestor session that lists it. Refusal-style outcomes stay on the scrollback `subagent/end` line. `turns`/`reasoningTokens` are folded for the type contract but unused in the P0 row format.

Per-child progress stays one consistent cut per listing — the shared `resolveCandidateRows` path. A visible-panel refresh may still `inspect` a cold descendant.

P1/P2 work (activity-store wiring, cache panel, history replay, timeline rail, dashboard, subagent fullscreen transcript, progress-bar component) stays out of scope.

## Testing

- `packages/subagent/subagent/tests/subagent-progress.spec.ts` — descriptor reset; in-flight tools; `lastTurnEnd` cleared on a later `turn/start`; prototype-named `tool/result` same-ref; last-wins tokens including dropped `reasoningTokens`; unknown `turn/end` kind counted without a label.
- `packages/subagent/subagent/tests/list-children.spec.ts` — `listDescendants` embeds meaningful runtime fields; `listChildren` rows stay identity-only.
- `packages/tui/tui/tests/delegation-panel.spec.ts` — live-card chrome, suffix drop, terminal words, one-shot without a kill glyph.
- `packages/tui/tui/tests/commands.spec.ts` — kill uses the entry's `parentId`; one-shot / inactive / unknown id / null session / missing service do not call `interrupt`.

## Related

- [Subagent list identity via the projection unit](../architecture/2026-08-06-subagent-list-identity-projection.md) — the three-rung cut this progress unit rides; listing still does not depend on session-query.
