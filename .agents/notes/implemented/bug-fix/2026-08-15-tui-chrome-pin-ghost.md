# Agent Note: Pin TUI input chrome and stop ghost rails / two-line blue metrics

Status: implemented

English | [中文](2026-08-15-tui-chrome-pin-ghost.zh.md)

## Problem

After a tall thinking or tool overlay, `clearForCommit` erased the live region and the idle chrome collapsed to content height. The input frame jumped up, a black hole opened below it, and previous rounded rails (`╭─╮`) stayed in the gap — LiveEngine only climbs `lastDisplayRows`, so a shrink leaves uncleared cells. This fork had inverted Tianshu's `padDynamicRegion`: short dynamic segments were not padded, so overlay height followed content and shrank every turn. Narrower than 80 columns, `renderLive` dumped metrics onto a second line colored with `theme.primary`, so the footer suddenly wrapped and turned blue while right-side drop-from-the-end was already the intended width degradation. During a turn the live activity surface was only about three lines: a status row, a pending tool title, and `⎿  …`. That is a collapsed tool card, not the full think stream — `formatReasoningLive` still took only the last three logical lines, `formatToolCardLive` was called with `tailLines: 2` and no elapsed time, and the card tail slot was not padded, so the input jumped as the overlay grew and shrank. The session log has no tool-stdout deltas, so a live bash/`job_output` card cannot stream command output until `tool/result`.

## Decision

Restore Tianshu's fixed-viewport contract. `padDynamicRegion` pads empty lines between dynamic content and chrome up to exactly `budget` display rows (still clipping oldest dynamic rows from the top when over budget). `nextDynamicBudget` keeps a high-water mark that only grows, capped by `liveMaxRowsFor` (min 4, max 28, else `rows-1`). Welcome / first idle (no transcript messages, agent not running) still skips padding so the hero is not pushed apart by invented blank. Session switch and `newSession` reset the high-water mark. Footer metrics always merge into the same line as the mode/shortcut hints, dropping right segments back-to-front, colored with `CHROME_INACTIVE_SHIMMER`; `formatGlanceBar` is no longer appended as a second primary-colored row. Exact-fit (`pad === 0`) still merges instead of dropping the last right segment. Live think uses Claude Code's collapsing-tail method: `reasoningTailBudget` scales the tail from 3 to 6 display rows. Long logical lines are wrapped with `wrapToDisplayWidth` and only the last budget rows are kept, so one paragraph cannot latch the overlay at the ceiling. Ctrl+O still expands the full draft for that frame; `nextDynamicBudget(..., freezeHighWater)` does not write that peak into the high-water mark, so collapse returns to the collapsing tail. In-progress tool cards follow Tianshu's live-card rule: at most `LIVE_TOOL_CARD_MAX` cards, only the latest expands a padded 3-line tail slot, older cards are title-only, and the header shows elapsed time. No new session event is added for tool stdout.

## Alternatives considered

**Pad the overlay to the full terminal height every idle frame.** Rejected: that covers committed transcript with a blank overlay, and existing tests require the welcome frame not to insert a full-screen band of empty lines before the input rail.

**Keep the 80-column two-line metrics fallback and only recolor it.** Rejected: the jump from one fog-blue line to two primary-colored lines is the defect; dropping segments from the right on a single line is the already-accepted width behavior.

**Reset the high-water mark on idle.** Rejected: Tianshu already tried this — the height drop is the input jump and the ghost rails.

**Invent a tool-stdout session event so live cards can stream bash/`job_output`.** Rejected: the TUI must not invent session vocabulary; full output already lands in scrollback on `tool/result`. Wiring a new delta would be a harness change, not a chrome fix.

## Consequences

Idle chrome after a tall turn stays at the peak live-region height, so the input frame does not bounce between mid-screen and the bottom, and empty pad lines overwrite leftover rails. Welcome still sits naturally under the hero. Narrow terminals keep one footer line; some metrics (including `API ✓/✗`) disappear earlier as width shrinks, which is intentional. LiveEngine's `maxRows` now follows `liveMaxRowsFor` instead of `rows-1` with an 8-row floor, matching the pad ceiling so cursor-up on a small terminal cannot overshoot the screen. Tall terminals show up to six wrap-aware think-tail rows instead of three logical lines; a long unwrapped paragraph is split and tailed so it cannot freeze the overlay at full height. Ctrl+O can grow the overlay for that frame only. In-progress tool cards keep a stable tail slot so the input does not jump when a placeholder becomes a line of output. Live tool cards still show `…` until `tool/result`, because the session log has no stdout stream.
