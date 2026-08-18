# Agent Note: Structured SQLite long-term memory provider

Status: implemented

English | [中文](2026-08-18-memory-sqlite-structured-ltm.zh.md)

## Problem

Markdown memory is a human-editable file store: substring search, no ranking, no versioned facts, and none of the optional seam methods. Hosts that want FTS ranking, supersede-don't-delete, topic versions, embeddings, or retirement have nowhere to put that store without a second `memory` key or a breaking Markdown format. The [widened `MemoryService` seam](2026-08-18-memory-seam-prefix-stable-digest.md) already carries the structured fields; it still needed a provider that consumes them.

## Decision

`@huiliyi37/dsh-memory-sqlite` is a second provider of the same `memory` service key (`ctx.provide('memory', store)`). A composition mounts Markdown or SQLite, never both. Schema v3 is an append-only `events` log plus a materialized `facts` view, FTS5 BM25 over text and keywords, optional `embeddings`, and `topicVersions` / `markUncertain` / `retireStale`. Old on-disk formats fail loud. Default `embeddingProvider: ''` and `keywordExpansion: 'off'` — zero extra calls, pure BM25. Half-configured `http` / `llm` fails at load. Markdown files under `<root>/.dsh/memory/` remain a coexistence source and import idempotently. `@huiliyi37/dsh-semantic-index` re-exports `vector-index` so the store reuses `cosineSimilarity` and `reciprocalRankFusion`.

Shipped TUI and `dsh-base` stay on Markdown. This package is on the tree for hosts that opt in.

## Alternatives considered

**Merge `github/dev` wholesale, or mount sqlite in TUI.** Rejected: two providers of `memory` cannot coexist, and TUI already mounts Markdown plus `/remember` and `/memory`.

**Default-on embeddings or keyword expansion.** Rejected: every save or search would pay a network or chat-model call, and a half-configured embedder would have to skip silently. Fail loud when enabled but incomplete.

**Migrate old sqlite schemas.** Rejected: pre-release stance — `SCHEMA_VERSION` mismatch fails loud.

**Land STM and a retirement driver in the same change.** Rejected: sqlite is the store. Those consumers now live in [`dsh-adaptive-memory`](2026-08-18-adaptive-memory-stm.md) and [`dsh-memory-consolidate`](2026-08-18-memory-consolidate.md); they stay off shipped compositions.

## Consequences

Hosts can swap the memory provider without changing `tool-memory` consumers. TUI behavior is unchanged. Coverage: `packages/memory/memory-sqlite/tests/*.spec.ts` (BM25 ranking, Markdown import, embeddings off by default, keyword expansion off by default, half-config load failures, `markUncertain` / `retireStale`).
