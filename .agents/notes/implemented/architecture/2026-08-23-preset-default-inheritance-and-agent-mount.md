# Agent Note: Preset default inheritance and agent-factory mounting

Status: implemented

English | [中文](2026-08-23-preset-default-inheritance-and-agent-mount.zh.md)

## Problem

`dsh-agent-presets` shipped a complete seam — `mount`/`composeFrom`/`recompose` plus a `settings.default` read through `defaultId` — but the two consumer links that make a choice persist were missing, so a user's preset never survived into a new session. `/preset <id>` only `recompose`d the current blank session and appended `agent-preset/selected`; it never wrote `settings.default`, and `AgentPresets` exposed no public write for it. Worse, no production agent factory called `agentPresets.mount(agentCtx)` in its unpublished `setup`, so even the shipped `default: standard` never actually attached a preset — new sessions (TUI direct, intent-bridge alignment + main, headless, scaffold) were bare and resolved tools/prompt sections against the empty global layer. The taiyi port surfaced this concretely: `taiyi` is opt-in, and there was no way to make it persist into the next session, especially the intent-bridge "zen" main session.

## Decision

- `AgentPresets.setDefault(id)` persists `settings.default` after `resolveMountable(id)`; it fails loud when no settings provider is composed, rather than silently no-oping.
- `/preset default <id>` is the explicit persistence entry; `/preset <id>` keeps its temporary-switch semantics; the list marks the current default with `（默认）`.
- Every production top-level agent factory mounts the default preset in its unpublished `setup` (`await agentPresets.mount(agentCtx)`) and writes `meta.agentPreset` (a new field on `CreateAgentOptions.meta`, passed through to `session.header.agentPreset`). Wired in TUI `newSession` (direct path), intent-bridge `createAlignedSession`/`finalize`/`finalizeFromSession`, headless `run`, scaffold `createSession`, and the ACP bridge `newSession`.
- The taiyi preset stays opt-in: the shipped default remains `standard`; inheriting taiyi requires an explicit `/preset default taiyi`. This is the "另立决策" the taiyi plan reserved for making it a default.

## Alternatives considered

- **Make `/preset <id>` also persist (switch = inherit).** Rejected: it silently rewrites the meaning of the existing temporary-switch command, so a user trying out a preset would unexpectedly change the deployment default.
- **Persist "last selected" as a separate state beside settings.default.** Rejected: `defaultId` already reads `settings.default`, and a parallel state would drift from it.
- **Wire only the intent-bridge sessions.** Rejected: the mounting gap is repository-wide (headless and scaffold are also bare), and the invariant already asserts every agent joins a preset when a roster is composed.

## Consequences

- `defaultId` becomes a user-writable durable value; the README's "changing the default only affects subsequently-created sessions" now holds, because those sessions actually mount it.
- `session.header.agentPreset` is written at creation for the first time. Resume still does not restore the recorded preset (unchanged, out of scope).
- The advisory bare-agent warning on `agent/created` should no longer fire on the shipped TUI / intent-bridge / headless / scaffold / ACP paths.

## Testing

- `settings.spec.ts`: `setDefault` persists + composes new sessions from it; rejects an unknown id without touching the default; fails loud with no settings provider.
- `commands.spec.ts`: `/preset default <id>` calls `setDefault` and echoes inheritance; bare `/preset default` shows usage; the list marks the default preset.

## Related

- [taiyi port plan](../../../../docs/research/taiyi-port-plan.md)
- [host-plane ownership after presets](2026-08-10-host-plane-ownership-after-presets.md)
