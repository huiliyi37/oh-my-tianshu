# Agent Note: Host `/remember` and `/memory` for command adapters without a TUI registry

Status: implemented

English | [中文](2026-08-18-command-memory.zh.md)

## Problem

[`/remember` and `/memory` live in the TUI's private registry](2026-08-17-tui-bundle-tianshu-capability-roster.md). The Web slash menu renders `ctx.commands`, so those names never appear there. The TUI entries cannot be reused: they echo through the terminal channel, and bare `/memory` opens an interactive overlay. [STM](2026-08-18-adaptive-memory-stm.md) and [deep recall](2026-08-18-tool-memory-recall.md) are model-facing; they do not give a person a host command to write or delete a stored entry.

## Decision

`@huiliyi37/dsh-command-memory` registers both commands on `ctx.commands` with input hints. Each invocation records the executor-owned log-only `command/run` / `command/done` pair. The plugin injects only `commands` and resolves `memory` at handler time through `ctx.reflect.get('memory', false)` against a local `MemoryFacet` (`save` / `list` / `delete`). A missing service settles with `⚠ memory 服务不可用（未加载 memory 插件）`; usage and success strings keep the TUI's Chinese wording.

Bare `/memory` lists `- <id>: <text>` with flattened whitespace and an 80-character cap. The shipped Web bundle mounts the Markdown `memory` service and this plugin. `dsh-base` and the TUI bundle do not. The TUI keeps its private entries. Web does not mount `dsh-tool-memory` or `dsh-adaptive-memory` in this change.

## Alternatives considered

**Mount in `dsh-base` without the memory service, as `github/dev` did.** Rejected: base stays the upstream-parity spine. Commands that only answer the unavailable text in every profile are dead catalog rows. Web is the surface that lacks a private registry.

**Mount in the TUI bundle, or replace the TUI registry entries.** Rejected: the TUI already owns `/remember` and `/memory`, including the memory-browser overlay. A second registration would collide.

**Inject `memory` as a required service.** Rejected: a composition without the service would fail to load and hide the commands from discovery. Handler-time resolution keeps the catalog honest with one unavailable-text branch.

## Consequences

Web users can save, list, and delete project memories through the same host registry the TUI bypasses. Compositions without `dsh-memory` get a stable unavailable answer rather than a silent skip. The shipped Web path has no model-facing consumer yet; a saved Markdown entry stays on disk until a host adds `dsh-tool-memory` or `dsh-adaptive-memory`. Coverage: `packages/memory/command-memory/tests/*.spec.ts` (save / list / delete / usage / unavailable text / HMR unregister / Loader composition / empty invariant companion).
