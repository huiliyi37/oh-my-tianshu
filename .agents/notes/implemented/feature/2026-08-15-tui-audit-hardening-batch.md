# Agent Note: TUI audit-driven hardening batch and the visionBridge probe service

Status: implemented

English | [中文](2026-08-15-tui-audit-hardening-batch.zh.md)

## Problem

A full functionality audit of the standalone `@huiliyi37/dsh-tianshu-tui` package (2026-08-15) surfaced defects the monorepo TUI shared by lineage: the vision-bridge state reached the TUI only through assembly-injected `vision` config that no assembly ever passed (images dropped at the submit boundary even with the bridge plugin assembled); `goals`/`subagents` sat in the mandatory `inject` list, so a profile without the goal/subagent plugins silently never activated the TUI fiber; the `/tasks` `/subagents` `/workflow` `/status` `/config` `/skills` panels and the plan-mode cycle degraded silently (blank panel, no hint) when their backing service was absent; `/clear` reset only the internal buffer while the README claimed a cleared view; the `Ctrl+.` keymap panel carried 10 entries against its complete-table claim; and two acknowledged composition gaps sat as `it.todo` (fiber remount `DUPLICATE_PROVIDER`, cross-session pending approval/question residue).

## Decision

Port the audit batch into `packages/tui/tui` and close the vision-bridge loop on the plugin side:

- **Vision-bridge probe**: `TuiApp.resolveVisionBridge` treats the presence of the `visionBridge` service as bridge-available when no `vision` config was injected; `packages/context/vision-bridge` provides that service at `apply` (released on unload; `enabled: false` provides nothing). Assemblies may still inject `vision.bridgeEnabled` explicitly — the probe is the no-config fallback. The `dsh-tui` bundle patch assembles the bridge by default with `visionAutoBridge: true`, so the stock tui profile has the bridge without any overlay.
- **Optional services**: `goals`/`subagents` left the mandatory `inject` list; all reads go through `reflect.get` and fail loud per command instead of silently deactivating the whole TUI.
- **Fails-loud degradation**: panels and the plan-mode cycle echo a `⚠` warning via `TuiApp.echoWarn` when their backing service is absent; platform degradations surface too (clipboard-image toolchain missing, external-editor spawn failure, OSC52-incapable terminal).
- **Chrome fixes**: `/clear` now erases the visible screen (2J + 3J + cursor home + full live-region redraw); the keymap panel lists 20 entries and its narrow-width row overflow (one column over budget when truncation binds) is fixed, with the spec asserting display width instead of code-unit length.
- **Projection layer wired**: `turn-summary` folds session events and lands a dim `turn N · 读X 改Y · elapsed` line at non-aborted turn end (turn number from the authoritative `turn/end` event, not the fold state — a mid-turn attach shows the real turn); `summary-state` feeds a new `/status` session-totals section that works without the host projection bus, so the whole-panel render guard relaxed to per-section degradation. The model's own text formatter's decisecond assumption was corrected to real epoch milliseconds (`SessionEvent.time`).
- **Composition lane**: three `it.todo`-class behaviors are now real Loader-composition tests — activation without goals/subagents, fiber remount without `DUPLICATE_PROVIDER`, and pending approval/question settlement on session switch (`cancelled` / `ASK_CANCELLED`).

Monorepo adaptations from the standalone batch: the self-update failure notice was not ported (no self-update subsystem exists here); the vision-probe test asserts the inline `dataUrl` image shape (no attachments service here); `userQuestions` reads as `userInteraction`; and the composition test resolves the TUI's active session from the tab-bar `▸` marker because `sessions.list()` is recency-ordered and the spine's `main-session` jumps the queue.

## Alternatives considered

- **Assembly-derived `vision` config only (status quo)**: left the default assembly broken — nothing passed it. Rejected.
- **Listener introspection to detect the bridge**: cordis exposes no listener enumeration; a provided service is the explicit, typed contract and releases with the plugin fiber. Chosen.
- **Porting the attachments service flow**: the monorepo image path sends inline `dataUrl` blocks; adopting the standalone's durable-attachment pipeline is a separate capability decision, not part of this batch.
- **Growing a self-update subsystem to receive the failure notice**: no such subsystem exists here; porting the notice alone would be dead code, so it was deliberately dropped from the port.

## Consequences

The TUI now tells the user when a capability's backing service is missing instead of rendering nothing, and the vision bridge works without assembly-side config wiring. The `/status` panel keeps partial content (session totals) when the projection bus is absent, so its warning text names the affected sections rather than claiming the panel is empty. The batch cost: one more probed service name (`visionBridge`) that future bridge implementations must provide to be detected, and a slightly busier scrollback (one dim summary line per tool-calling turn).

## Testing

- `pnpm exec tsc -b packages/tui/tui` and `packages/context/vision-bridge`: 0 errors.
- `pnpm vitest run packages/tui/tui/tests`: 1607 passed (90 files), including the three new composition tests and the projection-wiring block in `app.spec.ts`.
- `pnpm vitest run packages/context/vision-bridge/tests`: 26 passed, including the probe provide/release and `enabled: false` cases.

## Related

- [TUI image paste / clipboard and the vision bridge (opencode-tui port)](./2026-08-13-tui-image-paste-and-vision-bridge.md)
