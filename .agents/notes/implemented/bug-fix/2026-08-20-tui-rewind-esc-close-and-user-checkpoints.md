# Agent Note: TUI rewind closes on Esc and lists user checkpoints

Status: implemented

English | [中文](2026-08-20-tui-rewind-esc-close-and-user-checkpoints.zh.md)

## Problem

Double-Esc opens the rewind overlay, but once it is open the rewind key branch always `return`s after `handleKey`. `RewindOverlay.handleKey` treats `escape` / `ctrl_c` as consumed and documents that the assembler closes the overlay; the assembler only called `deactivate()` when `isDone()` was true. Esc therefore redrew the panel, and the first Ctrl+C never reached the double-press process-exit path, so the only way out was to kill the process. The list also dumped every folded `user/message` and `assistant/message`, including plugin-injected user rows (`source.kind === 'plugin'`) drawn as `❯` and tool-only assistant rows with empty `foldText`. The hint line was appended after a message-count window; turn separators then pushed the total past the terminal height, and `OverlayEngine` clipped the "Esc 取消" footer.

## Decision

The rewind key branch matches the memory overlay for dismiss: Ctrl+C, and Esc while `isListPhase()` or `isDone()`, call `overlay.deactivate()` and return. Mode-phase Esc stays on the overlay: `handleKey` sets the phase back to `list` and the assembler rerenders. `handleKey` still returns true for list Esc so unit tests keep the "consumed" contract.

`rewindSession()` keeps only transcript rows that are `kind === 'user'`, have non-empty `text`, and whose `event` is `user/message` with `data.source.kind === 'user'`. An empty checkpoint list does not activate the overlay and echoes `没有可回退的用户消息`. List and mode `render` reserve the hint row first (`height - 2`) and window the body (including turn separators) so the last line stays the hint: `↑↓/j k 选检查点 · Enter 选粒度 · Esc 取消` on the list, `1/2/3 确认 · Esc 返回列表或取消` on the mode step. Opening still clears `escRewindPendingSince`; a later idle Esc only arms a new double-Esc window.

`executeRewind`, file snapshots, session truncate, and the double-Esc open window are unchanged.

## Alternatives considered

**Have `handleKey` flip to `done` / a cancelled phase so the existing `isDone()` deactivate path closes the panel.** Rejected: the overlay's Esc contract is "consumed, assembler closes", and folding cancel into `done` would show a completion frame the user never asked for.

**Filter rows inside `render` and keep passing the full transcript into `setMessages`.** Rejected: a session with only plugin or empty-assistant rows would still open an empty panel; the open guard has to run on the filtered list.

**Keep assistant rows as checkpoints.** Rejected: the user-facing job is "go back to something I said". Tool-only assistant lines and plugin injections are not that.

**Teach `OverlayEngine` a reserved-footer slot for every overlay.** Rejected: only rewind was lying about a clipped Esc hint; a local reserve in `render` is enough.

## Consequences

The first Ctrl+C on the rewind list leaves the overlay, so a later Ctrl+C can arm and then exit the process. Mode Esc does not dismiss, which avoids closing immediately after Enter. Plugin injections and empty assistant rows no longer appear as `❯` / blank `✦` checkpoints. The hint line remains visible on a short terminal. Sessions with no user checkpoints stay on the main screen and print the empty-list echo. `/rewind` still also prints `⚠ 当前无可回退的会话` when `rewindSession()` returns false (no session or empty checkpoints).

## Testing

- `packages/tui/tui/tests/app.spec.ts` — third Esc after double-Esc writes `ALT_SCREEN_OFF` and does not reopen; Ctrl+C while rewind is open closes without `onExit`; plugin source and empty assistant rows are absent; plugin-only transcripts refuse to open and echo `没有可回退的用户消息`.
- `packages/tui/tui/tests/rewind-overlay.spec.ts` — mode Esc returns to the list; a short `height` keeps the hint as the last line.

## Related

- [TUI Esc abort and compose newline](2026-08-17-tui-esc-csi-u-and-compose-newline.md) — idle double-Esc open window and vim exclusion, which this note leaves in place.
