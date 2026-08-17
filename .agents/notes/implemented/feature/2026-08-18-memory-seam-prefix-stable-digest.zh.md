# Agent Note: MemoryService 可选结构化字段与前缀稳定的 tool-memory digest

Status: implemented

[English](2026-08-18-memory-seam-prefix-stable-digest.md) | 中文

## Problem

`MemoryService` 原先只有 Markdown 形态的 `save` / `search` / `list` / `delete`。后续若再加结构化 provider，就要另做一套消费方类型，而每次给 `save` 加字段都会变成破坏性变更。另一方面，`tool-memory` 把最近二十条记忆的摘要注入 order-130 的 system-prompt section，并在每次 `memory_save` 后刷新，从而重写请求前缀、让整段后续对话失去 provider 前缀缓存。那些刷新所威胁的参照是 [96.8% 无 digest 基线](../../../../docs/cache-hit-baseline-20260812.md)。发货 TUI bundle 已经挂上这一对插件（[能力 roster](2026-08-17-tui-bundle-tianshu-capability-roster.md)），因此 digest 缺省值是产品可见的前缀缓存选择，不是闲置的库开关。

## Decision

`MemorySaveInput` 增加可选的 `kind` / `topic` / `entities` / `confidence` / `fact` / `sourceRefs`。`MemorySearchOptions` 增加 `excludeIds`（精确 id 或非空 id 前缀；空串不排除任何条目）以及 `entities` / `topic`。`search` 返回带可选 `score` 的 `MemorySearchResult`。`topicVersions` / `markUncertain` / `retireStale` 是可选方法；消费方以 `typeof memory.topicVersions === 'function'` 探测（另两个方法同理）。Markdown provider 忽略结构化 save 字段，把 `entities` / `topic` 过滤退化为 `tags` 精确匹配，不设置 `score`，也不实现可选方法。

`tool-memory` 的 `digest` 缺省为 `false`：system-prompt section 只有静态能力指引字面量。`digest: true` 仍是调试开关，会追加二十行摘要并在每次 save 后刷新。`memory_search` 接受 `excludeIds`，并把模型的 `limit` 钳制到 `searchLimit`（缺省 10）。TUI bundle patch 使用库默认值，不设置 `digest: true`。

## Alternatives considered

**保持 digest 默认开启。** 否决：每次 save 都会重写 system-prompt section，并从该字节起丢掉前缀缓存复用，而发货 TUI 已经挂载该插件。

**把结构化字段写进 Markdown HTML 注释。** 否决：文件格式是人类可编辑契约；额外属性会把 Markdown provider 绑到它无法查询的 schema 上，而结构化 provider 仍然需要自己的存储。

**在同一改动里再挂一个 `provide('memory')` 后端。** 否决：两个插件不能同时 provide 同一键，发货 TUI 继续用 Markdown，直到有专门组合另作选择。

## Consequences

消费方可以传入结构化 save 字段和 `excludeIds`，而不必在以后做类型破坏；Markdown 仍然只存储 `text` / `scope` / `tags` / `source`。缺省的 `tool-memory` 指引在 save 之间逐字节稳定，记忆写入不再使请求前缀失效。`digest: true` 仍可用来测量该成本。覆盖：`packages/memory/memory/tests/memory.spec.ts`（excludeIds / 退化为 tags 的过滤 / 被忽略的结构化字段 / 缺席的可选方法）与 `packages/memory/tool-memory/tests/tool-memory.spec.ts`（缺省静态 section / digest 刷新 / excludeIds 透传 / `searchLimit` 钳制）。
