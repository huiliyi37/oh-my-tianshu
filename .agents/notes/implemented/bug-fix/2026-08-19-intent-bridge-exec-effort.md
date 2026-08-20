# Agent Note: Intent-bridge main sessions keep the current reasoning effort

Status: implemented

English | [中文](2026-08-19-intent-bridge-exec-effort.zh.md)

## Problem

A TUI user can persist `reasoningEffort: max` on `agent-default-model` (or set `/effort max`). Fresh sessions without the intent bridge already applied that selection through `installModelSelection`. With the bridge mounted — the shipped TUI default — `newSession` only passed `provider`/`model` as `exec`, and the bridge created the main agent with those two fields. `AgentOptions` had no effort slot, so the loop's first seed omitted it; `prepareCall` materialized the adapter `defaultEffort` (`high` on DeepSeek). The handoff then `switchSession`ed onto a live registry agent and cleared `modelRef`, so `/effort` could not hot-apply on the zen session either. The status bar could flash the saved max before the first `request/header` and then show `high`.

## Decision

`AgentOptions.reasoningEffort` is the missing sibling of `maxTokens`. The loop seeds it on the first request of a loop instance when the folded header has no explicit effort for that route. An explicit option is not marked `adapterDefaults.reasoningEffort`, so later steps keep it. The identifier is a non-empty string; adapters still own the legal set.

Intent-bridge `exec` (and the per-alignment `execRoute`) may carry `reasoningEffort`. Both main-session `agents.create` paths spread it into `agentOptions`. Omission keeps the previous adapter-default behavior. The alignment session still uses only the configured align route and does not inherit the effort.

TUI `newSession` spreads the current selection into `exec` and into the no-bridge `agents.create`. `switchSession` onto a live agent (the handoff main session) reinstalls `installModelSelection` from the durable header or the current selection, and `detachProjections` disposes that install so a later switch does not stack listeners.

## Alternatives considered

**Force `max` for the whole zen phase, then restore.** Rejected: the user chose pass-through. A saved `high` must stay `high`; zen does not own effort.

**Rewrite `reasoningEffort` only on an intent-bridge `agent/request` listener.** Rejected: `AgentOptions` already carries `maxTokens` for the same "explicit create-time setting" job, and the first main-session request can start from `followup` before the TUI listener is attached.

**Leave live-agent `modelRef` null and only fix create-time seed.** Rejected: `/effort` after handoff would still be dead, which is the same front-door contract the no-bridge path already offers.

## Consequences

A saved or slash-selected effort reaches the first zen request as an explicit conversation setting. Alignment stays on the configured flash route and the adapter default unless a later change decides otherwise. Switching back to a parked main session rebinds selection, so `/model` and `/effort` keep working after handoff.

## Testing

- `packages/core/agent-loop/tests/loop.spec.ts` — empty `AgentOptions.reasoningEffort` fails before publication; `max` seeds the first request.
- `packages/core/agent-loop/tests/request-reconstruction.spec.ts` — explicit `max` is not marked as an adapter default.
- `packages/guard/intent-bridge/tests/intent-bridge.spec.ts` — per-call `exec.reasoningEffort: max` lands on the main agent and its first header; omitted exec effort leaves `agent.options.reasoningEffort` unset.
- `packages/tui/tui/tests/app.spec.ts` — `newSession` forwards current `max` on both the bridge `exec` and no-bridge `agentOptions`; live-registry `switchSession` still hot-applies; resume `agentOptions` include a persisted explicit effort.

## Related

- [Intent bridge](../architecture/2026-08-18-intent-bridge.md) — session split and the `exec` override this note extends.
- [Adapter-owned reasoning effort](../architecture/2026-07-24-adapter-owned-reasoning-effort-capabilities.md) — DeepSeek default `high` when the request omits effort.
