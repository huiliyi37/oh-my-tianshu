# Agent Note: TUI slash command dropdown menu (grok slash_dropdown port)

Status: implemented

English | [中文](2026-08-12-tui-slash-menu-dropdown.zh.md)

## Problem

Slash command hints are a single inline text line (`slash.hint()` emits `命令: /a /b …`) with no list, no selection, no scrolling; Tab only completes `@` file paths, and command completion is unwired (`slashSelectedIdx` is a dead field). User feedback:「/ doesn't show a command list, and commands can't be scrolled up/down」, asking to follow grok-build's (xai-grok-pager) slash_dropdown design.

## Decision

Port and adapt grok's `slash_dropdown.rs` + `SlashController` + `prompt.rs` key routing (phase 1: core dropdown):

- **Match data source** (`engine/input-controller.ts`): `refreshSlash(value)` driven from a single InputLine onChange entry — opens when the input starts with `/` and matches exist (a bare `/` shows the full list), closes otherwise; matching = prefix first + substring fallback (stable registration order); `moveSlashSelection` (↑↓ wrap) / `scrollSlashSelection` (PageUp/Down clamp) are no-ops while the menu is closed; `carrySelection` keeps the selection by command name while the query is unchanged. Reuses the injected `slashCommands` (`SlashHintEntry { name, description, argsHint }`); the registry is untouched.
- **Pure-function rendering** (new `format/slash-menu.ts`): `formatSlashMenu` emits label-column-aligned rows with truncated descriptions; the selected row gets a `❯` prefix + primary + bold (the theme has no background slot, so a prefix marker replaces bg highlight — a constraint already recorded in the C4 draft); `maxRows` (default 8) scroll window keeps the selection visible, appending「↑↓ 还有 N 项」when overflowing; ascii degrades (`❯`→`>`, `↑↓`→`^v`); width-conserving (below 4 columns it degrades to a truncated prefix row).
- **app.ts wiring**: renderLive renders the list while the menu is open (replacing the one-line hint, which stays as the fallback when the menu is closed); handleKey intercepts before history navigation (grok key routing aligned; Ctrl+P/N are already taken by the command palette / new-session, so ↑↓ + PageUp/Down are used): ↑↓ move, PageUp/Down page, Tab accepts the completion, Enter accepts and submits (a fully typed command name submits directly and **clears the input line** — aligned with InputLine's normal clearAfterSubmit path, otherwise leftover command text makes later typing concatenate into invalid `/cmd/xxx`), Esc closes.
- **Commands with arguments** (argsHint present): Tab/Enter complete to `cmd ` leaving the argument slot; argument suggestions (chained completion) are deferred to a later batch.

## Verification

- New `tests/slash-menu.spec.ts` 14 cases: shape/alignment/selected coloring/argsHint/scroll window (first/last selection pan)/custom maxRows/ascii/extreme narrow/width conservation.
- `tests/input-controller.spec.ts` +10: open/close/prefix-substring ordering/bare `/` full list/carry keep and fallback/move wrap/scroll clamp/closed no-op.
- `tests/app.spec.ts` +5 wiring: `/` renders the list + ↓ moves, ↑ wraps to the last item (including the externally registered /density), Tab completes and closes the menu, Enter submits and clears the input line, Esc closes.
- Regression fix: the menu submit path not clearing the input line once broke the `/status` case (the second typing concatenated into `/status/status`, the panel never closed) — added `setValue('')` plus an assertion.
- TUI full **1382 passed / 2 todo** (77 files); `tsc --noEmit` 0 errors; oxlint 0 errors; verify-export-jsdoc passes; changed files 100% covered (unreachable defensive branches carry `v8 ignore` notes per repo convention).

## Files

- `packages/tui/tui/src/format/slash-menu.ts` (new): `formatSlashMenu` + `SLASH_MENU_MAX_ROWS` + `SlashMenuItem`
- `packages/tui/tui/src/engine/input-controller.ts`: `SlashMenuState` + refresh/move/scroll/close/carry + private suggestMatches
- `packages/tui/tui/src/ui/app.ts`: InputLine onChange wiring, handleKey menu interception, renderLive menu rendering, `acceptSlashCompletion`
- `packages/tui/tui/SOURCE-MAP.md`: registers `src/format/slash-menu.ts` (new)
- `docs/dsh-tui-视觉概念稿-c4.md`: decision record section 9
- Tests: `slash-menu.spec.ts` (new), `input-controller.spec.ts`, `app.spec.ts`

## Alternatives considered

**Matching in registry.suggest** — rejected: matching lives in the engine layer (reusing the injected `slashCommands`), keeping the registry's single command-registration responsibility and avoiding an engine→commands reverse dependency.

**Menu rendered as an overlay-engine floating panel (grok chrome panel)** — rejected: live-area row rendering shares the existing slash-hint mechanism with zero overlay lifecycle cost; the floating panel can be upgraded after visual acceptance.

**Ctrl+P/N to move the selection (grok's original keys)** — rejected: ctrl_p is already the command palette and ctrl_n is already the welcome page's「new session」(C4 decision); ↑↓ + PageUp/Down are used instead.

## Consequences

- Typing `/` pops the list immediately (a bare `/` shows everything); the one-line hint only backstops when nothing matches — slash interaction upgrades from「hint」to「selection」.
- While the menu is open, ↑↓ hijack history navigation and Esc hijacks other escape consumers — same semantics as grok (menu first); vim/history users close with Esc first.
- Phase 2 backlog: chained argument suggestions (argsHint data already exists), MRU ordering, mid-text slash token highlighting, input-line ghost text (needs InputLine extension).

## Phase 2 addendum (2026-08-12): MRU ordering / argument-placeholder ghost / input-line ghost preview

### Decision

- **MRU most-recent-first**: `InputController.slashMru` (cap `SLASH_MRU_MAX`=10, `recordSlashUse` dedupes and moves to front); `suggestMatches` sorts stably by MRU within the bare `/` full list and within each match group (unused scores 0). `app.ts` records on successful `runSlash` execution.
- **Argument-placeholder ghost**: typing the full command name plus a trailing space (`/theme `) on a command with `argsHint` → `refreshSlash` keeps the menu open (matches contain only that command), and `slashGhostText` returns argsHint as the input-line ghost (`/theme ` + dim `<name>`); Enter submits the full input line (trim handled by handleSubmit).
- **Input-line ghost preview**: `InputLine.setGhost(text | null)` (idempotent, pure render state that does not trigger onChange); `displayLinesWithCaret` renders the ghost to the right of the █ on the cursor line in ANSI dim (`\x1B[2m`) (activation: cursor at the end of the value and no selection — selection rows carry ANSI highlighting where column ≠ character position, so insertion would misalign); the wrap path (maxWidth) inserts at `cursorCol + 1` (after █) on the cursor line and truncates to the line width. `app.ts` calls `setGhost(slashGhostText())` every renderLive frame: previews the completion remainder while a menu command is selected (`/th` → `eme`).

### Not doing

Mid-text slash token highlighting: it would change InputLine's core rendering (wrap/selection/IME cursor-coordinate coupling), and commands are typed at line start today — low value; deferred until real-terminal acceptance.

### Verification

- New `tests/input-line.spec.ts` 8 cases: dim rendering/clear/cursor-not-at-end hidden/empty value/selection hidden/wrap insertion/wrap truncation/no onChange trigger.
- `tests/input-controller.spec.ts` +9: MRU dedupe-and-front, cap truncation, full-list ordering, in-group ordering; argument mode enter / no-argsHint no-enter / incomplete-name no-enter / continued typing exits.
- `tests/app.spec.ts` +4: ghost dim preview, argument-mode Enter submit, MRU wiring (/density first after execution); plus PageUp/Down paging and Esc-close cases (lone ESC waits 80ms; previously a false positive).
- Regression fix: the Esc case previously did not wait for the 80ms lone-ESC timeout — a false positive (the empty-string assertion passed); after waiting it genuinely covers the menu-close path.
- TUI full **1402 passed / 2 todo** (78 files, two consecutive runs + stable under coverage); `tsc --noEmit` 0 errors; oxlint 0 errors; coverage gate 0 ERROR (app.ts 100%).

### Files (phase 2)

- `packages/tui/tui/src/engine/input-line.ts`: `setGhost` + ghost rendering (both paths) + `insertGhost` helper + GHOST_DIM constants
- `packages/tui/tui/src/engine/input-controller.ts`: `slashMru`/`recordSlashUse`/`mruRank`/`SLASH_MRU_MAX` + refreshSlash argument mode
- `packages/tui/tui/src/ui/app.ts`: runSlash MRU record, `slashGhostText`, renderLive setGhost, acceptSlashCompletion argument-mode submit
- Tests: `input-line.spec.ts` (new), `input-controller.spec.ts`, `app.spec.ts`

## Phase 3 addendum (2026-08-12): subagent conversation-stream status lines (grok SubagentBlock port)

### Problem

dsh subagent runs are visible only in the delegation-tree panel (/subagents); the conversation stream has no status feedback. grok renders a single-line SubagentBlock in the scrollback (running spinner → terminal ✓/✗/◌). The user asked to close the loop on subagent conversation-stream rendering.

### Decision

Port grok's `scrollback/blocks/subagent.rs`, adapting to dsh's live→scrollback mechanism (scrollback is append-only; running state lives in the live area):

- **Pure functions** (new `format/subagent-line.ts`): `formatSubagentRunning` → `⠋ 子代理 <label>` (braille spinner frame follows tick, ascii degrades to `*`); `formatSubagentDone` → terminal single line `✓/◌/✗ 子代理 <label> · <seconds>` — completed → ✓ (success color); aborted → ◌ (muted); error/max-tokens/refusal and merge-extensible unknown reasons → ✗ (error color) with a ` (reason)` suffix (completed/aborted carry none). Width-conserving (label truncation first).
- **Wiring** (app.ts mountSession): `subagent/start` → record into `subagentRuns` (runId → label/startedAt) + renderBatcher; `subagent/end` → settle the elapsed time, `commitToScrollback` the terminal line (append), remove from the collection; the disposer joins subagentDisposer (released on unmount). **label best-effort from the delegation-tree cache** (may lag) → falls back to an id short hash (same fallback as the delegation panel). Unpaired end (unknown runId) renders nothing — cross-session event immunity.
- **Event-contract fix**: the TUI event declarations were stale `{ parentId, id }`; updated to the real contract `{ runId, id }` / `{ runId, stopReason }` (dsh-subagent's SubagentRunInfo/SubagentRunEndInfo).
- Not doing: Enter/Ctrl+F to open the child-session full-screen view (dsh has no child-session view concept; deferred).

### Verification

- New `tests/subagent-line.spec.ts` 10 cases: spinner frames/tick-default fallback/ascii/three terminal states/reason suffix/unknown-reason default/width conservation.
- `tests/app.spec.ts` +4 wiring: start → live-area running line (label from cache), end completed → scrollback terminal + running line removed, end error → ✗ + (error), unpaired end immunity. The existing delegation-refresh case adapts to multi-handler collection (array, first handler).
- TUI full **1416 passed / 2 todo** (79 files); `tsc --noEmit` 0 errors; oxlint 0 errors; subagent-line.ts 100% covered (the `tick ?? 0` nullish fallback is covered by a non-ascii tick-absent case — the ascii ternary short-circuit had made it unreachable).

### Files (phase 3)

- `packages/tui/tui/src/format/subagent-line.ts` (new): `formatSubagentRunning` / `formatSubagentDone`
- `packages/tui/tui/src/ui/app.ts`: subagentRuns field, start/end wiring, subagentLabel, renderLive running line, event-declaration fix
- `packages/tui/tui/SOURCE-MAP.md`: registers `src/format/subagent-line.ts` (new)
- Tests: `subagent-line.spec.ts` (new), `app.spec.ts`
