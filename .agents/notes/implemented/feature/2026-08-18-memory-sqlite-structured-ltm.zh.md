# Agent Note: 结构化 SQLite 长期记忆 provider

Status: implemented

[English](2026-08-18-memory-sqlite-structured-ltm.md) | 中文

## Problem

Markdown 记忆是人类可编辑的文件存储：子串检索、无排序、无版本化事实，也没有可选 seam 方法。主机若要 FTS 排序、supersede-don't-delete、topic 版本、嵌入或退役，要么再开一个 `memory` 键，要么破坏 Markdown 格式。[加宽后的 `MemoryService` 缝](2026-08-18-memory-seam-prefix-stable-digest.md) 已经带上结构化字段，但仍缺一个真正消费它们的 provider。

## Decision

`@huiliyi37/dsh-memory-sqlite` 是同一 `memory` 服务键的第二个 provider（`ctx.provide('memory', store)`）。组合里挂 Markdown 或 SQLite，不能同时挂。schema v3 是 append-only 的 `events` 日志加物化 `facts` 视图、对 text 与 keywords 的 FTS5 BM25、可选 `embeddings`，以及 `topicVersions` / `markUncertain` / `retireStale`。旧磁盘格式 fail loud。缺省 `embeddingProvider: ''` 与 `keywordExpansion: 'off'`——零额外调用、纯 BM25。半配的 `http` / `llm` 在装配时失败。`<root>/.dsh/memory/` 下的 Markdown 文件仍是共存源，按内容哈希幂等导入。`@huiliyi37/dsh-semantic-index` 再导出 `vector-index`，store 复用 `cosineSimilarity` 与 `reciprocalRankFusion`。

发货 TUI 与 `dsh-base` 继续挂 Markdown。本包上树供主机按需选用。

## Alternatives considered

**整支 merge `github/dev`，或把 sqlite 挂进 TUI。** 否决：两个 `memory` provider 不能共存，而 TUI 已经挂了 Markdown 以及 `/remember` 与 `/memory`。

**缺省开启嵌入或关键词扩展。** 否决：每次 save 或 search 都要付网络或 chat 模型调用，半配的 embedder 只能静默跳过。启用但不完整时 fail loud。

**迁移旧 sqlite schema。** 否决：预发布立场——`SCHEMA_VERSION` 不符即 fail loud。

**同一改动里再上 STM 和退役驱动方。** 否决：sqlite 是存储。那些消费方现在是 [`dsh-adaptive-memory`](2026-08-18-adaptive-memory-stm.md) 与 [`dsh-memory-consolidate`](2026-08-18-memory-consolidate.md)；仍不进入发货组合。

## Consequences

主机可以替换 memory provider，而不必改 `tool-memory` 消费方。TUI 行为不变。覆盖：`packages/memory/memory-sqlite/tests/*.spec.ts`（BM25 排序、Markdown 导入、嵌入缺省关、关键词扩展缺省关、半配装配失败、`markUncertain` / `retireStale`）。
