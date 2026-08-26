# Agent Note: TUI chrome closed loops

Status: implemented

English | [中文](2026-08-26-tui-chrome-closed-loops.zh.md)

Scope: `packages/tui/tui` (`ApprovalController` consumers, `LiveSnapshot`, `render/live-panels`, `TuiApp.attach` / `renderLive`, `live-engine` row budget)

## Problem

After `0.5.0`, three TUI loops were half-wired. `[p]` could finish a persist after the request had already settled `cancelled`, and no test named the disk / card / outcome triple. Shift+Tab and `/yolo` already short-circuit as `allowed-always`, but `mode-cycle` still expected `allowed-once`. `formatActivityBand` folded activity beside `LiveSnapshot` while eight other live segments were already snapshot-pure. `attach` always subscribed `intent-bridge/handoff` even when the plugin was disabled or absent.

Welcome-first `skipPad` forced a zero budget and left Working rows unclipped. A full activity band on a 24-row window could push the approval card and input rail off the live region. The 120 ms ticker still ran a full `renderLive` assemble on idle frames whose snapshot and chrome had not changed.

## Decision

The TUI keeps two planes. Theme, tip, and panel visibility stay process-local. Human decisions that claim durability or a standing grant must agree on card, disk, and status line.

`[p]` still persists an exact allow first and ignores y/n/a/esc while the write is in flight. If the request is already `cancelled` when the write returns, that card stays `cancelled`; the persisted rule may settle the next matching ask. `[a]` and the always-approve short-circuit remain process-local `allowed-always`; a new `TuiApp` after dispose asks again. Web and `apiproxy` decide stay `allowed-once` | `rejected`.

`LiveSnapshot` carries `activityBandEnabled`, `activityItems`, `activityBandMaxRows`, and `tick`. `renderLive` folds once when assembling the snapshot and draws the band through `renderActivityBand`. The `activityBand: false` escape hatch still paints per-run spinner rows from `subagentRuns`.

`attach` subscribes `intent-bridge/handoff` only when `reflect.get('intentBridge')` exists and `enabled` is true.

Working (dynamic) rows have a documented max: `workingRowsCap(terminalRows, chromeRows)` = `liveMaxRowsFor(terminalRows) - chromeRows`. Chrome after `chromeStart` (question, approval, input, footer) is never clipped from the top. `skipPad` still refuses to pad empty space on the welcome-first frame, but it clips Working rows to that cap (`pad: false`) so a full activity band cannot eject chrome. Each `renderLive` also refreshes `LiveEngine.setMaxRows` from the current terminal height.

The 120 ms ticker skips assemble when `liveIdleKey({ snapshotKey, chromeKey })` is unchanged and `liveHasSpinner` is false. Keypress, approval, and stream events still assemble (batcher / `flushLiveRender`). The ticker increments `tick` only when a spinner row is visible (running agent, running activity, pending tools, or live reasoning). Overlay stay-paused remains contract A6: an active overlay skips the live write and clears `lastIdleKey` so the exit `flushLiveRender` cannot skip the main-screen restore.

The sitting-fox welcome (`28` / `36` bands) is a different line and is not in this change. Published welcome bands stay `56` / `72`.

## Alternatives considered

### Why not widen Web decide to `allowed-always`?

The standing-grant note already records the remote/Web decide union as a one-shot human channel. This change pins TTY honesty; it does not open that channel.

### Why not rebuild `renderLive` as a bottom-pane framework?

`LiveSnapshot` already exists. Putting the activity band on it closes the leftover live segment without a second compositor.

### Why not treat overlay pause or every local flag as a second authority?

Overlay skip of the live write is contract A6. Theme, tip, and panel flags are the live control plane. Only decision leaks and dead subscriptions are in scope.

### Why not land the sitting-fox welcome here?

The published rest grids are `56` / `72`. Mixing `28` / `36` into this honesty change would collide two contracts.

### Why not keep skipPad as budget 0 and unclipped?

Zero budget meant “do not pad,” but `padDynamicRegion` treated it as “do not clip.” Welcome-first frames with a full activity band then overflowed chrome. Clip-without-pad keeps the no-blank-welcome rule and the 24-row chrome rule together.

### Why not skip assemble while a spinner is visible?

Shimmer rows are tick-driven. Skipping those frames freezes the glyph. The ticker still runs; it only advances `tick` for spinner rows.

## Consequences

TUI tests now pin persist-then-abort, restart-still-asks, `allowed-always` mode-cycle / `/yolo`, snapshot-driven activity rows, no handoff listener when the bridge is off, `workingRowsCap` plus skipPad clip-without-pad, chrome survival at 24 rows with a full activity band, and idle-ticker assemble skip. Maintainers must not fold activity beside the snapshot again, must not subscribe `intent-bridge/handoff` on a disabled plugin, and must not let Working rows clip chrome from the top. Sitting-fox welcome (`28` / `36`) stays a separate line.
