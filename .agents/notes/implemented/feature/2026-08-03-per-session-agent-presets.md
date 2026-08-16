# Agent Note: Per-Session Agent Presets

Status: implemented

English | [中文](2026-08-03-per-session-agent-presets.zh.md)

## Problem

The official `dsh-agent-presets` subsystem was missing from this fork: sessions had no per-session agent preset composition, the CLI had no way to view or switch presets, and the typed `agent-preset/selected` session event had no owning declaration. The service, its session header record, and the `/preset` command surface were ported together from the official repository (semantics port; no shared git ancestor).

## Decision

Each Session composes its model-facing plugin set from exactly one agent preset. The preset is a package list resolved at session creation and recorded in the session header (`SessionHeader.agentPreset`); a later `recompose` swap is legal only while the session is still blank, because swapping the tool set under accumulated history would leave recorded tool calls that no longer match the composition. The service (`ctx.agentPresets`) mounts the preset's plugins on the session's own fiber, keyed per session, so plugin instances, tool registrations, prompt sections, and projection units exist exactly once per session. `resolveSessionPreset` rebuilds the preset named in the header — never the live composition of a forked parent.

The port adapted the official chain semantics to this repository's names: the scope chain (`dsh-scope` parent binding, `chainLayers`, ancestor-tag routing), chain-aware `dsh-tools` view/guard (`ctx.tools.get(name, scopeOf(ctx))`), chain-aware prompt assembly (`PromptSection.complete` / `suppressRuntimeContext`), and `dsh-session`'s `agentPreset` header field. Preset isolate keys use the local service names, and the `/preset` CLI command reaches the service through `ctx.reflect.get('agentPresets', false)`, failing loud with a teaching message when the host does not assemble the package. The `agent-preset/selected` session event has exactly one declaration (the `dsh-agent-presets` `SessionEventMap` merge), enforced by the persistence catalog gate; the CLI's type-only import pulls that merge into its compile surface without a runtime dependency.

## Alternatives considered

**Let each package declare the session event locally.** Rejected: the persistence catalog requires exactly one declaration per log event; the service that records the fact owns it.

**Give the CLI a runtime dependency on `dsh-agent-presets`.** Rejected: the `/preset` command deliberately keeps a minimal `PresetFacet` service face (`list` / `composedPreset` / `recompose`) so the CLI stays lean; the event type merge rides a type-only import instead.

**Allow recompose on any session.** Rejected: the official blank-only caller contract holds — swapping tool sets under history leaves mismatched recorded tool calls.

## Consequences

`dsh-agent-presets` (with `dsh-persona`) ships in `packages/preset/`; a session created under a preset rebuilds the same composition after resume or fork. `/preset` lists presets and switches on blank sessions with a typed event log, and reports the service unavailable (inert-but-loud, like `/goal`) when no host assembles `dsh-agent-presets`. Tool visibility follows the session scope through the chain-aware tools view/guard, so preset tools reach the session and its subagents without leaking across sessions.
