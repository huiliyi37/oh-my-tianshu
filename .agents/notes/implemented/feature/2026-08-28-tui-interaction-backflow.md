# Agent Note: TUI interaction backflow wave — bell, submit queue, cancel-and-send, a11y

Status: implemented

English | [中文](2026-08-28-tui-interaction-backflow.zh.md)

Scope: `packages/tui/tui` (`term-bell.ts`, `controllers/submit-queue.ts`, `theme-contrast.ts`, `engine/ansi.ts`, `engine/input-handler.ts`, `format/keymap-panel.ts`, `prefs.ts`, `ui/app.ts`)

## Problem

The sibling repo `dsh-tianshu-tui` shipped release rc.25 (the "P0 interaction trio" wave) plus two accessibility fixes that this repo's `packages/tui/tui` port had not absorbed. Terminal users had no completion signal that survives SSH (no bell, and no OS-notification channel exists here at all); input typed while the agent was busy was silently impossible to submit (Enter did nothing until the turn ended); custom themes could declare unreadable colors with no warning; and `NO_COLOR`, the de-facto no-color standard, was ignored.

## Decision

Backported five user-facing surfaces from sibling commits (bell `704a833`, queue `9d7f421`, cancel-and-send `c53a497`, theme contrast + `NO_COLOR` `3e2cb2f`, Ctrl+R alias `181d517` partial), each as its own commit, with the divergences below.

**Bell gate lives in this package's prefs, not `notifyOs`.** Upstream couples the bell to the OS-notification preference because both are completion reminders; this package never ported the OS-notification subsystem, so `term-bell.ts` declares `SKIP_NOTIFY_ENV` locally and the toggle is a new `bellEnabled` pref key (`/bell` command, merged write into the shared `~/.dsh-tui/prefs.json`). Gate semantics are otherwise upstream's: `DSH_TUI_SKIP_NOTIFY` / `VITEST` / `CI` silence it, SSH explicitly does *not* (BEL traverses the pty to the local terminal — the remote case is the one it exists for). Write failures are swallowed; the bell is decorative and never a correctness dependency. Bells fire at `subagent/end`, `workflow/end`, and `tasks.onTaskDone`.

**The submit queue is TUI-side by choice, and its drop notice lives in `switchSession`, not `mountSession`.** The host followup channel is an inbox FIFO without a take-back API, so running-state Enters land in a local `SubmitQueueController` (rendered as a `⏳` line above the input track); `turn/end` completed drains it in submission order through the normal bubble + followup path, aborted turns keep it. Empty-input ↑ takes the oldest back into the draft. This package's `followup` returns `void` (synchronous inbox enqueue), so the upstream failure-echo path (`⚠ 排队消息发送失败`) has no rejection to catch and was not ported. The switch-session drop notice commits in `switchSession` *before* detach — `mountSession` swaps `this.transcript` to the new session on its first line, so a notice committed there would land in the new session's view.

**Ctrl+Enter (cancel-and-send) is wired directly, with the running guard inline.** The sibling routes keys through its new action registry (`c275902`, not ported); here `ctrl_return` — decoded by `enhancedKeyFromCode` from kitty CSI `13;5u`, since flag 1 is already pushed at attach — goes through a guarded branch next to Ctrl+T: consumed only while `running` (idle Ctrl+Enter keeps the draft untouched), and `cancelAndSendInput` orders clear-input → abort → `whenIdle` → normal submit path, so the draft jumps ahead of older queued messages. `handleAbort` now cancels with `keepInbox: true`: manual interrupts no longer discard unconsumed host-inbox work, matching the local queue's "interrupt never discards intent."

**Ctrl+R is an alias gated on vim mode, not a shadow.** The app-level `ctrl_f` intercept runs before `inputLine.handleKey`, so a bare `ctrl_r` alias would steal vim NORMAL's redo. The alias is `(key.name === 'ctrl_r' && !(vimEnabled && vimMode !== 'insert'))`; Ctrl+F stays unrestricted.

**Theme contrast warns, never blocks.** `validateThemeContrast` checks custom-theme foreground tokens against a nominal background for the declared `dark`/`light` band; below 3.0:1 (WCAG AA large text) it writes a `[theme] low contrast in <file>` stderr warning and still registers (fail-open — user intent is preserved). Non-hex values (chalk names) are skipped: the 16-color rail's semantics belong to the built-in themes. `NO_COLOR` (no-color.org: set and non-empty) suppresses `fg`/`bg` output and forces chalk level 0 at module load; `setColorSuppressed` exists for tests and must be restored.

Not backported, deliberately: the action registry (`c275902` — a 2k-line refactor whose value here is mostly upstream test ergonomics; revisit if its approval-tiering work lands), the approval decision tiers (`fd99567` — `p <prefix>` whitelists and reject-with-feedback must be reconciled with this repo's own standing-grant work in the chrome-closed-loops line before porting), vim insert two-key remaps (`181d517` other half — needs the upstream `VimInput` engine with `.` recording, which this port never absorbed), and the attachment-preview controller extraction (`79b539c` — internal refactor, no user-facing delta).

## Alternatives considered

### Why not gate the bell on an env var only?

`shouldBell` without a user-facing toggle hardcodes a deployment-varying choice; the prefs file already exists, is shared with the official host plugin under a merge-write contract, and `/bell` costs one registered command.

### Why not drain the queue on abort too?

An aborted turn is exactly when a user interrupts to redirect; auto-firing their queued messages after the interruption they just performed would betray the queue's purpose. ↑ take-back and the next manual submit are the recovery paths.

### Why not port the action registry first and stack the wave on it?

The registry is the sibling's answer to its own 4k-line `app.ts` ratchet; this repo's `app.ts` diverged enough that the port is a restructure, not a backport. Deferring it keeps each user-facing change reviewable and reversible; the two consumers (cancel-and-send guard, keymap projection) are small enough to inline with honest comments.

## Consequences

Bought: a completion signal that reaches SSH users, Claude Code-style message queueing with take-back and插队 lanes, a documented interrupt contract (`keepInbox`), readline-convention history search, WCAG-aware custom themes, and standards-compliant `NO_COLOR`. The prefs file gains a second modeled key (`bellEnabled`) — merge-write already covers it. Follow-up debt is explicit: action registry, approval tiers, vim remaps (see "Not backported").
