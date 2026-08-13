# Agent Note: TUI bracketed paste wiring — multi-line/long paste lands whole in the input line

Status: implemented

English | [中文](2026-08-12-tui-bracketed-paste.zh.md)

## Problem

The TUI input box never sent `\x1B[?2004h` (DECSET 2004) to enable bracketed paste, and never registered an `InputHandler.onPaste` handler. Without terminal paste bracketing, every line-ending `\r` (0x0d) of a multi-line paste parses as an Enter key → **one submit per line** — pasting an error trace fired one message per line, and the queued messages could not be interrupted with Ctrl+C. The long-text fold path (past the 10-line/1000-char threshold → `[paste #N +M lines]` marker) was unreachable too (the fold logic lives in `insertText`, but nothing called it).

## Decision

- `engine/ansi.ts`: add `BRACKETED_PASTE_ON` (`\x1B[?2004h`) / `BRACKETED_PASTE_OFF` (`\x1B[?2004l`).
- `ui/app.ts` attach: write `BRACKETED_PASTE_ON` and register `input.onPaste(text => { inputLine.insertText(text); flushLiveRender() })` (pasteDisposer rebuilt per attach, released at dispose); dispose writes `BRACKETED_PASTE_OFF` restoring terminal default.
- Pasted text enters the input line via insertText: ≤10 lines / 1000 chars inserted directly (including `\n`, the input line renders multi-line), beyond that folded to an atomic marker, expanded by expandPastes at submit — **one Enter submits the whole block**, no per-line submits.
- Incidental fix: onChange only refreshes slash state without re-rendering, so a `flushLiveRender` was added after paste.

## Verification

- `tests/app.spec.ts` +3: attach writes `2004h`, dispose writes `2004l`; simulated `\x1B[200~…\x1B[201~` multi-line paste lands whole in the input line (no per-line submit); over-threshold long paste shows the fold marker.
- TUI full **1421 passed / 2 todo** (79 files); `tsc --noEmit` 0 errors; oxlint 0 errors.

## Files

- `packages/tui/tui/src/engine/ansi.ts`: BRACKETED_PASTE_ON/OFF
- `packages/tui/tui/src/ui/app.ts`: attach/dispose wiring + onPaste registration + flush
- `packages/tui/tui/tests/app.spec.ts`: +3 cases

## Alternatives considered

### Parse \r per line instead of enabling bracketed paste

Not changing the terminal mode and distinguishing `\r` from paste context inside InputHandler (e.g. swallowing Enter inside a paste window) would also stop per-line submits, but it pushes "paste state" into the input parser with fragile cross-chunk paste-boundary detection, and never gets "the whole block arrives at once" semantics. DECSET 2004 is a native terminal contract — zero cost, behavior guaranteed by the terminal.

## Consequences

- Multi-line/long paste lands whole in the input line and submits with one Enter; per-line submits are gone (previously a pasted error trace was split into many queued messages that could not be interrupted).
- attach writes `2004h`, dispose writes `2004l` restoring terminal default; pasteDisposer rebuilds per attach and releases at dispose.
- The later image-paste work ([2026-08-13-tui-image-paste-and-vision-bridge](2026-08-13-tui-image-paste-and-vision-bridge.md)) prepends clipboard-image detection to the onPaste handling chain — bracketed paste remains the text-channel entry, the two are mutually exclusive.
