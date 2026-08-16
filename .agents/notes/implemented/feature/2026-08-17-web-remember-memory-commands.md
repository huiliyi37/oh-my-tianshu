# Agent Note: Web `/remember` and `/memory` commands over the host registry

Status: implemented

English | [中文](2026-08-17-web-remember-memory-commands.zh.md)

## Problem

`/remember` and `/memory` existed only in the TUI's private command registry (`packages/tui/tui/src/commands/registry.ts`), so the Web slash menu — which renders the host `ctx.commands` catalog — could not save or inspect project memories at all. The TUI entries cannot be reused: they echo through the terminal's own channel and bare `/memory` opens an interactive terminal browser, neither of which exists behind a host command adapter.

The memory service is deliberately optional: no shipped composition mounts `@huiliyi37/dsh-memory`, yet the commands should still be discoverable and must fail honestly there.

## Decision

A new host plugin package `@huiliyi37/dsh-command-memory` (`packages/memory/command-memory`) registers both commands through `ctx.commands` with `input` hints, so every command adapter (Web menu, any future surface) discovers and executes them, and each invocation records the executor-owned log-only `command/run` / `command/done` pair. The plugin injects only `commands`, never statically imports `dsh-memory`, and resolves the service at handler time through `ctx.reflect.get('memory', false)` against a locally declared minimal `MemoryFacet` (save/list/delete). When the service is absent, both commands settle with `⚠ memory 服务不可用（未加载 memory 插件）`; the usage lines and save/delete success strings keep the TUI's exact Chinese wording.

Bare `/memory` lists entries as deterministic plain text (`- <id>: <text>`, whitespace flattened, 80-character cap with `…`) instead of the TUI's browser, because command adapters have no interactive surface. The shipped `dsh` base mounts the plugin without the memory service, and the Web fixture catalog plus execute branch mirror that composition exactly.

## Alternatives considered

- **Inject `memory` directly** — would make the plugin unloadable in every composition without the service and hide the commands from discovery; the dynamic facet keeps the catalog honest with one unavailable-text branch.
- **Move the TUI registry entries into a shared package consumed by both surfaces** — the TUI registry's echo/run shape and its memory-browser dependency are terminal-specific; the host command contract (typed `CommandResult`, lifecycle events) is the shared layer, so only the strings are kept verbatim.
- **Render the list as a structured command card payload** — `CommandResult` is `kind` + text; inventing a richer payload for one command would widen the wire contract before a second consumer needs it.

## Consequences

Web users can save, list, and delete memories through the same host registry the TUI bypasses, and compositions without `dsh-memory` get a stable, testable unavailable answer. The cost is a duplicated minimal facet shape (TUI and host package each declare it) and two parallel command implementations whose user-visible strings must stay aligned by convention; if a third surface appears, promoting the facet to a shared type package becomes worth revisiting.
