# Agent Note: TUI Esc abort, sticky newline mode, and session tab labels

Status: implemented

English | [中文](2026-08-17-tui-esc-csi-u-and-compose-newline.zh.md)

## Problem

Cursor and other xterm-family terminals encode Esc as Kitty CSI u (`CSI 27 u`) even before the app asks for the protocol. The input parser consumed that complete CSI sequence, then `resolveEscapeSequence` only recognized forms with a semicolon (`CSI 13;2u`), so `[27u` became `unknown` and Esc never reached abort. The same family of encodings is the only reliable way to tell Shift+Enter from Enter; without it both are CR, so a compose-newline mode cannot exist. Session tab labels took `id.slice(0, 8)` of ids like `session-<uuid>`, so every tab rendered `[session-]`. Long compose in newline mode had wrap-by-width but no row cap, so a tall draft could push the chrome off the screen.

## Decision

`decodeEnhancedKey` maps Kitty CSI u (`CSI 27 u`, `CSI 13;2u`, …) and xterm modifyOtherKeys (`CSI 27;2;13~`) to `escape` / `return` plus modifier bits, and runs before the unknown-CSI fallback. Attach writes Kitty keyboard protocol flag 1 only (`CSI >1u`); printable keys stay as original bytes; dispose pops the stack (`CSI <u`). Terminals that ignore the private sequence keep lone-Esc and CR behavior.

Abort uses `isAgentBusy()` (`status === 'running'` or in-flight `activity` or a non-empty inbox), not status alone. While busy, `setEscapeImmediate(true)` so a remaining lone Esc does not wait the 80ms disambiguation timeout. Idle Esc still does not quit.

Shift+Enter toggles sticky `newlineMode` at the app key router (slash-menu Enter ignores shift so the toggle is reachable). While on, a non-inline Enter inserts `\n`; a second Shift+Enter leaves the mode and the next Enter submits. One-shot newlines remain `Ctrl+J`, Alt+Enter, and a trailing `\`+Enter. Without enhanced keys, Shift+Enter is still submit; the footer advertises `ctrl+j 换行`. Long paste still folds at 10 lines or 1000 characters to `[paste #N +M lines]` and expands on submit. The input viewport caps visible rows at `inputViewportMaxLines(rows)` (min 3, max 12, about `rows / 3`), keeping the caret line in view.

`sessionTabLabel` strips a leading `session-` then takes eight characters.

## Alternatives considered

**Treat every CSI `u` terminator as Esc.** Rejected: Kitty encodes many keys that way; only code 27 is Esc, and Shift+Enter is code 13 with shift.

**Enable the full Kitty keyboard protocol (flags beyond disambiguate).** Rejected: later flags rewrite printable keys into CSI u and would force a second parser for ordinary typing.

**Make Shift+Enter insert one newline (common GUI mapping) instead of a sticky mode.** Rejected: the requested contract is a toggle so repeated Enter can compose, then a second Shift+Enter restores submit-on-Enter.

**Abort only when `status === 'running'`.** Rejected: a tool can be in flight, or a follow-up can sit in the inbox, while status has not flipped yet; Esc would then no-op.

**Keep tab labels as the first eight characters of the raw id.** Rejected: every official session id shares the `session-` prefix, so the bar is unreadable.

## Consequences

Esc in Cursor's terminal aborts a busy turn and prints `⏹ 已取消`. Sticky newline mode is visible as footer `换行中`. Session tabs show uuid prefixes instead of `[session-]`. A text+CR paste flush still holds 12ms so the next chunk can mark the CR inline ([paste burst merge](2026-08-16-input-paste-line-burst-merge.md)). Tests pin CSI 27 u abort, CSI 13;2u toggle, cross-chunk inline return, newlineMode submit vs insert, tab labels, and attach/dispose of `CSI >1u` / `CSI <u`.
