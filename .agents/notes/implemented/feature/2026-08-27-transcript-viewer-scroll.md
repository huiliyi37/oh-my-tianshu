# Agent Note: /scroll fullscreen transcript viewer (T5)

Status: implemented

English | [中文](2026-08-27-transcript-viewer-scroll.zh.md)

Scope: `packages/tui/tui` (`format/transcript-viewer.ts` new, `engine/commit-engine.ts` accessors, `ui/app.ts` overlay wiring, `commands/registry.ts` `/scroll` command, `scrollback-transcript.ts` consumer registration), `examples/tui/tests/interactive-smoke.snapshot.ts`

## Problem

The C6 benchmark logged T5 — a fullscreen transcript viewer absorbing grok's pager navigation (`scrollback/state/nav.rs`: PageUp/Down, half-page, goto top/bottom, next/prev turn) — as open. `scrollback-transcript.ts` had shipped its parser/search/row-estimation API marked "reserved: no consumer", and terminal-native scrollback was the only way to read conversation history at scale.

## Decision

`/scroll` opens a read-only fullscreen overlay (`TranscriptViewer`) that consumes that reserved API. Three load-bearing decisions:

**Data source is the scrollback text, not the projection layer.** `CommitEngine.getContent()` (the RingBuffer-capped committed scrollback) is parsed by `parseScrollbackTranscript`. Chosen over the transcript projection (`renderTranscript`/`TranscriptView`) because the viewer's value is the exact on-screen record — command echoes, steer markers, `/btw` folded answers, tool cards — that the projection omits, and because Ctrl+F (`HistorySearchOverlay`) already owns projection-message search; a second overlay on the same source would duplicate it. Costs accepted: the 1000-line ring cap (surfaced as a header truncation notice via new `CommitEngine.size()/capacity()/isFull()` accessors) and turn navigation defined as user-message boundaries (`▌`/`❯` role blocks) instead of precise `turn` numbers.

**Snapshot at open, not live.** The overlay parses once in `openTranscriptViewer()`; streaming commits during the overlay session do not push into it (the alt screen hides the main screen anyway). Reopening re-snapshots. Recorded as a v1 limitation.

**Display-row plane with per-width rebuild.** Messages are pre-wrapped with `wrapToDisplayWidth` into a flat row plane on width change; `msgStart` uses `cumulativeRowsToMessage` (same accounting), and the viewport is a plain slice by `scrollRow`. Frame cost is zero beyond the slice; mid-wrap window positions render exact continuation rows.

Interaction: ↑/↓ j/k line scroll, PageUp/PageDown (Ctrl+U/D) half-page, home/end (g/G) top/bottom, `[`/`]` previous/next turn (user block, wrapping), `/` enters search — characters accumulate a query with live jump to the first match, `n`/`N`/Enter cycle matches via `findNext/findPrevMatch`, Esc clears the query and keeps the viewer open (the app distinguishes via `isSearchMode()`), a second Esc or Ctrl+C closes.

## Alternatives considered

### Why not the projection layer (renderTranscript)?

Exact-fidelity re-render was rejected for the on-screen-record argument above, plus the drift risk (re-render uses the *current* theme/width, not the one at commit time) and the duplication of Ctrl+F's data source. The scrollback parser was registered for exactly this consumer; landing the consumer elsewhere would have left it dead code to delete.

### Why not push streaming updates into the open viewer?

Alt-screen exclusivity makes live updates invisible until close; snapshot semantics keep the state machine pure and match the memory-browser overlay precedent. Re-snapshot on reopen is the honest recovery.

### Why Esc clears query instead of closing?

Two-step Esc mirrors pager conventions (search mode is a sub-state); Ctrl+C always closes. The app-side branch consults `isSearchMode()` so search-mode Esc rerenders rather than deactivates.

## Consequences

Bought: structured paging over the exact screen record, turn jumping, and in-viewer search with match cycling — all keyless-testable as a pure state machine and exercised end-to-end through the P0 PTY smoke.

Cost: `/scroll` content is bounded by the ring cap (long sessions see "仅显示最近 N 行" instead of full history); turn navigation is role-heuristic, not `turn`-exact; a new builtin command carries the standing obligations (palette group row, footer tip row, `BUILTIN_COMMAND_NAMES` registration).

## Verification

Focused suites: `transcript-viewer.spec.ts` (scroll clamps, half-page step, top/bottom, turn wrap, search jump/cycle/clear, wrap slicing, truncation notice, unbound keys, state reset), `commit-engine.spec.ts` (size/capacity/isFull threshold and reset), `commands.spec.ts` (`/scroll` dispatch, empty-scrollback echo, prefix resolution). PTY interactive smoke scenario three: `/scroll` → `/smoke` search hit → Esc clears → Esc closes → clean Ctrl+Q exit on the 100×40 fixture.
