# Agent Note: Hook systemMessage rides hook/result and surfaces in clients

Status: implemented

English | [中文](2026-08-16-hook-systemmessage-surfaced.zh.md)

## Problem

Both hook bridges parsed the Claude Code dialect's `systemMessage` (the hook's user-facing notice) and the shared merge collected it into `MergedHookOutcome.systemMessages`, but nothing consumed it: each bridge only logged a "not yet surfaced" warning through `ctx.logger.warn`, which lands in the default in-memory ring buffer and is invisible in shipped compositions. A hook author writing `{"systemMessage": "…"}` — the dialect's documented way to talk to the user — produced silence. The C7 comparison (docs/dsh-编排机制对标-claude-c7.md §3.3) lists this as part of the hooks protocol-coverage gap.

## Decision

`systemMessage` is now durable and client-surfaced, never model-visible:

- `hook/result`'s log-only payload gains an optional `systemMessage` field (trimmed, omitted when blank), filled by the shared `appendHookResult` helper in `packages/hooks/hook-protocol/src/events.ts` — so both bridges (claude and codex dialects) record it with zero per-bridge divergence.
- The two bridges drop their "not yet surfaced" warnings; the event append was already the single recording point.
- The TUI renders a `hook/result` carrying `systemMessage` as a muted `[hook] <text>` scrollback line via the existing `handleStreamEvent` → `commitToScrollback` path (`packages/tui/tui/src/ui/app.ts`). Results without a `systemMessage` render nothing — the audit record lives in the log, not on screen.
- The web/client half needs no wire change: the scaffold server forwards every session event verbatim, so `hook/result` with the new field reaches any client; renderers opt in per the Conversation Node discipline.

The field deliberately does NOT enter any model-facing channel (no `user/message`, no surface event): Claude Code's `systemMessage` is user-facing by contract, and routing it into derived history would violate the "model-visible ⟺ logged" discipline in both directions.

## Alternatives considered

- **Keep warning through `ctx.logger.warn`**: the default logger target is an in-memory ring buffer; without a console exporter the notice is invisible in practice. That was the status quo and the gap.
- **Inject as a user message (like `additionalContext`)**: wrong semantics — `additionalContext` is model context by design, `systemMessage` is a user notice. CC keeps them on separate channels; so do we.
- **A new dedicated event kind instead of extending `hook/result`**: the notice belongs to a specific hook invocation's outcome; pairing it with the existing invoked/result envelope keeps turn enclosure and audit correlation for free.

## Consequences

- Tests flipped from "warned, not surfaced" to the new contract in both bridges' coverage suites, plus a payload-shape case in `hook-protocol` and a scrollback rendering case in the TUI suite (206 hooks-package tests + the TUI case green).
- `docs/persistence-catalog.md` regenerated (`hook/result` payload prose + field); zh counterpart synced.
- Both bridges' READMEs move `systemMessage` out of Known Limitations; `updatedInput` remains honestly listed as parsed-but-not-honored until the pre-tool input rewrite lands (its own proposed note).
