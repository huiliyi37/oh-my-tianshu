# Agent Note: /session list titles from official session-title events and the /preset command

Status: implemented

English | [中文](2026-08-16-session-list-titles-and-preset-command.zh.md)

## Problem

Two slash-command capabilities from the sibling repository `dsh-tui` (fetched as `dshtui/*` refs) were missing here: `/session list` printed bare session ids with timestamps, and there was no way to view or switch agent presets. The repositories share no git ancestor, so both were ported by semantics.

## Decision

`/session list` now shows a title per row through a new read-only adapter `src/adapter/session-title.ts`: it folds the official log-backed `session/title` event (written by `@huiliyi37/dsh-session-title`, whose LLM provider `session-title-first-message-llm` is assembled in `dsh-base` and generates titles at first-prompt cadence), falls back deterministically to the first human message's opening words (`fallbackMaxWords: 5` / `fallbackMaxBytes: 40`, aligned with the dsh-base assembly config), and finally to `新对话`. The TUI generates nothing: no API calls, no sidecar, no invented events — the pure-presentation discipline holds. `packages/tui/tui` gained a `@huiliyi37/dsh-session-title` peer dependency and a tsconfig project reference.

The `/preset` command (view/switch agent presets, standard/PTC/minimal/creative) was ported with its minimal structural `PresetFacet` (`list` / `composedPreset` / `recompose`): listing marks the composed preset with `*`, switching requires a blank session (the official `recompose` caller contract — swapping tool sets leaves historical tool calls mismatched) and appends a typed `agent-preset/selected` session event (declare-module extension on `@huiliyi37/dsh-session/types`). `BuiltinCommandDeps` gained `currentAgent()` and `isBlankSession()`. The `agentPresets` service is not assembled in this repository today, so the command fails loud with `⚠ agent-presets 服务不可用` — the same optional-service degradation pattern as `/goal`; it activates when a host assembles `dsh-agent-presets`.

## Alternatives considered

**Port the earlier self-built session-brief sidecar** (LLM-generated briefs with a TUI-owned cache file, `545122d`). Rejected: the sibling itself deleted it in favor of the official `session-title` service (`12a34e7`), and this repository already ships and assembles that service — a sidecar would duplicate the harness's own title generation and violate the pure-display discipline.

**Skip `/preset` because `agent-presets` is unassembled here.** Rejected: the command is inert-but-loud without the service (mirrors `/goal`), and the type extension and test surface become ready for the host package.

**Inline the title fold in the command instead of an adapter.** Rejected: the adapter keeps `/session list` a one-line consumer and gives the fold a dedicated unit-test surface, matching the sibling's structure.

## Consequences

`/session list` rows now carry readable titles with no session-log writes, no API calls, and no LLM cost — historical sessions show the deterministic fallback, empty ones `新对话`. The command-menu pagination test moved one item (`/compact` → `/clear`) because `/preset` joined `BUILTIN_COMMAND_NAMES`. `/preset` reports unavailable until a host assembles `dsh-agent-presets`, then switches presets on blank sessions with a typed event log. The existing `app.ts` `tailLines` lint finding remains untouched.
