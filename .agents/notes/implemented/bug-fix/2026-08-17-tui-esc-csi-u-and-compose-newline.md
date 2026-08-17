# Agent Note: TUI Esc abort, sticky newline mode, and session tab labels

Status: implemented

English | [中文](2026-08-17-tui-esc-csi-u-and-compose-newline.zh.md)

## Problem

Cursor and other xterm-family terminals encode Esc as Kitty CSI u (`CSI 27 u`) even before the app asks for the protocol. The input parser consumed that complete CSI sequence, then `resolveEscapeSequence` only recognized forms with a semicolon (`CSI 13;2u`), so `[27u` became `unknown` and Esc never reached abort. The same family of encodings is the only reliable way to tell Shift+Enter from Enter; without it both are CR, so a compose-newline mode cannot exist. Session tab labels took `id.slice(0, 8)` of ids like `session-<uuid>`, so every tab rendered `[session-]`. Long compose in newline mode had wrap-by-width but no row cap, so a tall draft could push the chrome off the screen.

## Decision

`decodeEnhancedKey` maps Kitty CSI u (`CSI 27 u`, `CSI 13;2u`, `CSI 99;5u`, …) and xterm modifyOtherKeys (`CSI 27;2;13~`, `CSI 27;5;99~`) onto `escape` / `return` / `ctrl_*` plus modifier bits, and runs before the unknown-CSI fallback. The CSI matcher accepts colons so Kitty's `code;mod:event` form (`CSI 99;5:1u`) parses; event type 3 (release) is consumed without dispatch so a press+release pair cannot count as two Ctrl+C. Attach writes Kitty keyboard protocol flag 1 only (`CSI >1u`); unmodified printable keys stay as original bytes; flag 1 rewrites Ctrl+letter to CSI u (Ctrl+C is `CSI 99;5u`, not `0x03` / SIGINT); dispose pops the stack (`CSI <u`). Terminals that ignore the private sequence keep lone-Esc and CR behavior.

Abort uses `isAgentBusy()` (`status === 'running'` or in-flight `activity` or a non-empty inbox), not status alone. While busy, `setEscapeImmediate(true)` so a remaining lone Esc does not wait the 80ms disambiguation timeout. Idle Esc still does not quit. When vim is enabled, idle Esc neither arms nor triggers double-Esc rewind — the Esc that leaves insert is still an Esc (`vimMode` is insert until the input line handles it), and a habitual follow-up press must not open the overlay; use `/rewind`. Busy abort still runs before this guard. The double-Ctrl+C exit does not require an empty line: any second press inside the window exits the process, draft or in-flight turn notwithstanding. A busy first press aborts and arms the 2s window, so a second press exits without waiting for idle; an idle non-empty line clears the draft on the first press (`setValue` records undo, so Ctrl+Z restores it) and arms the window, so the second press exits — no more `⏹ 已取消` noise, and no dead end where a draft blocks exit. The chrome line above the input says the next Ctrl+C leaves the process.

Shift+Enter toggles sticky `newlineMode` at the app key router (slash-menu Enter ignores shift so the toggle is reachable). While on, a non-inline Enter inserts `\n`; a second Shift+Enter leaves the mode and the next Enter submits. One-shot newlines remain `Ctrl+J`, Alt+Enter, and a trailing `\`+Enter. Without enhanced keys, Shift+Enter is still submit; the footer advertises `ctrl+j 换行`. In newline mode the paste-stream-final return behaves like a user Enter — it folds into the draft (with the trailing newline) instead of submitting, matching the bracketed-paste direct-insert path; non-newline mode keeps the merge-and-submit contract. Long paste folds only at 100 lines or 10,000 characters to `[paste #N +M lines]` (singular `line`) and expands on submit — below the threshold the pasted text stays fully editable. Wrapping measures width per code point through `charDisplayWidth` (two bounded mode-keyed caches, results identical to `displayWidth`) and drops the `Array.from` full allocation, cutting a 100K-char keystroke render from ~1.3s to ~10ms; visual-row starts use the same cached measure so Up/PageUp line up with the rendered wrap. The input viewport caps visible rows at `inputViewportMaxLines(rows)` (min 3, max 16, about `rows / 3`), keeps the caret line in view, and labels overflow as `… 上 N 行` / `… 下 N 行`. Up/Down move by wrapped visual rows when the draft wraps or contains newlines; PageUp/PageDown page by the viewport height; Home / Ctrl+A / Ctrl+U and End / Ctrl+E / Ctrl+K are logical-line scoped.

`sessionTabLabel` strips a leading `session-` then takes eight characters.

## Alternatives considered

**Treat every CSI `u` terminator as Esc.** Rejected: Kitty encodes many keys that way; only code 27 is Esc, and Shift+Enter is code 13 with shift.

**Enable the full Kitty keyboard protocol (flags beyond disambiguate).** Rejected: later flags rewrite printable keys into CSI u and would force a second parser for ordinary typing.

**Make Shift+Enter insert one newline (common GUI mapping) instead of a sticky mode.** Rejected: the requested contract is a toggle so repeated Enter can compose, then a second Shift+Enter restores submit-on-Enter.

**Abort only when `status === 'running'`.** Rejected: a tool can be in flight, or a follow-up can sit in the inbox, while status has not flipped yet; Esc would then no-op.

**Keep tab labels as the first eight characters of the raw id.** Rejected: every official session id shares the `session-` prefix, so the bar is unreadable.

## Consequences

Esc in Cursor's terminal aborts a busy turn and prints `⏹ 已取消`. A second Ctrl+C inside the exit window leaves the process even while the agent is still marked busy or the input line holds a draft. Sticky newline mode is visible as footer `换行中`. Session tabs show uuid prefixes instead of `[session-]`. A text+CR paste flush still holds 12ms so the next chunk can mark the CR inline ([paste burst merge](2026-08-16-input-paste-line-burst-merge.md)). Tests pin CSI 27 u abort, CSI 99;5u / `CSI 99;5:1u` Ctrl+C (release ignored), CSI 13;2u toggle, cross-chunk inline return, newline-mode paste fold vs submit, draft second-press exit, busy-abort second-press exit, vim-enabled double-Esc no rewind (including the insert→normal first Esc), the leave-process Ctrl+C hint, wrapped-row Up and PageUp, tab labels, and attach/dispose of `CSI >1u` / `CSI <u`.
