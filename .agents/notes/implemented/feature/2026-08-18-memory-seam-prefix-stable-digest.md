# Agent Note: MemoryService optional structured fields and prefix-stable tool-memory digest

Status: implemented

English | [中文](2026-08-18-memory-seam-prefix-stable-digest.zh.md)

## Problem

`MemoryService` only carried Markdown-shaped `save` / `search` / `list` / `delete`. A later structured provider would otherwise need a second consumer-facing type, and every extra `save` field would be a breaking addition. Separately, `tool-memory` injected a digest of the twenty most recent entries as an order-130 system-prompt section and refreshed it after every `memory_save`, rewriting the request prefix and forfeiting provider prefix-cache reuse for the rest of the conversation. Those refreshes put a high no-digest prefix-cache hit rate at risk. The shipped TUI bundle already mounts this pair ([capability roster](2026-08-17-tui-bundle-tianshu-capability-roster.md)), so the digest default is a product-visible prefix-cache choice, not an unused library knob.

## Decision

`MemorySaveInput` adds optional `kind` / `topic` / `entities` / `confidence` / `fact` / `sourceRefs`. `MemorySearchOptions` adds `excludeIds` (exact id or non-empty id prefix; an empty string excludes nothing) plus `entities` / `topic`. `search` returns `MemorySearchResult` with optional `score`. `topicVersions` / `markUncertain` / `retireStale` are optional methods; consumers probe with `typeof memory.topicVersions === 'function'` (and the same for the other two). The Markdown provider ignores structured save fields, degrades `entities` / `topic` filters to exact `tags` matches, never sets `score`, and does not implement the optional methods.

`tool-memory` `digest` defaults to `false`: the system-prompt section is the static capability-guidance literal only. `digest: true` remains a debug switch that appends a twenty-line digest and refreshes it after each save. `memory_search` accepts `excludeIds` and clamps the model's `limit` to `searchLimit` (default 10). The TUI bundle patch mounts the library defaults and does not set `digest: true`.

## Alternatives considered

**Keep the digest on by default.** Rejected: every save rewrites the system-prompt section and drops prefix-cache reuse from that byte onward, while the shipped TUI already mounts the plugin.

**Encode structured fields into Markdown HTML comments.** Rejected: the file format is the human-editable contract; extra attributes would couple the Markdown provider to a schema it cannot query, and a structured provider still needs its own store.

**Land a second `provide('memory')` backend in the same change.** Rejected: two plugins providing the same key cannot coexist, and the shipped TUI stays on Markdown until a dedicated composition chooses otherwise.

## Consequences

Consumers can pass structured save fields and `excludeIds` without a later type break; Markdown keeps storing only `text` / `scope` / `tags` / `source`. Default `tool-memory` guidance is byte-stable across saves, so memory writes no longer invalidate the request prefix. `digest: true` still exists to measure that cost. The sibling [sqlite provider](2026-08-18-memory-sqlite-structured-ltm.md) later consumes those fields without changing TUI's Markdown mount. Coverage: `packages/memory/memory/tests/memory.spec.ts` (excludeIds / tag-degraded filters / ignored structured fields / absent optional methods) and `packages/memory/tool-memory/tests/tool-memory.spec.ts` (static default section / digest refresh / excludeIds passthrough / `searchLimit` clamp).
