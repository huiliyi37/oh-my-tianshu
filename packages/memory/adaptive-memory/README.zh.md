# @huiliyi37/dsh-adaptive-memory

[English](README.md) | 中文

自适应记忆：每会话的 intent 状态 + 经 intent 门控的 STM（短期记忆）快照，从 `dsh-memory` 存储渲染，经 append-on-change 运行时上下文通道注入。阶段一落地了缓存安全骨架；阶段二b 接入了结构化 provider（BM25 检索、置信度门、按 topic 版本失效）与规则兜底提醒。设计契约见 [Agent Note](../../../.agents/notes/proposed/feature/2026-08-16-adaptive-memory-cache-contract.md)。

## 行为

- 每会话的 intent 状态（`{ intentId, intentKey, startedAtTurn, lastReviewedTurn, entities, topicVersions }`）由会话日志启发式推导——首个用户消息（或之后含目标动词的用户消息）是 intent 锚点；工具调用中出现的文件路径与错误码成为实体。全程零额外模型调用。
- 每轮一次（在 `system-prompt/assemble` 瀑布上）评估门控：仅当 intentKey 变化、相关 topic 版本变化、出现新实体、或距上次刷新满 `reviewIntervalTurns` 轮时才重渲染 STM；否则缓存文本逐字节保持。每次决策记为 log-only 会话事件（`memory/cache-hit`、`memory/cache-miss`、`memory/stm-selected`——绝不进模型可见面）。
- **能力探测，绝不假设 provider**：当装配的 `memory` 服务暴露 `topicVersions()`（即 `dsh-memory-sqlite` provider）时，检索走 `search`——以锚点文本为 BM25 query，外加一次合取语义的实体过滤检索；刷新门控改为比较检索命中覆盖的 topic 版本号——无关 topic 的写入不再触发 STM 刷新。装配纯 Markdown provider 时保持阶段一 fallback：全量 `list` + 关键词子串筛选 + relevanceSignature 门控。
- **置信度门（仅对产出 score 的 provider 生效）**：命中项 `score ≥ confidenceHigh` 时条目全文进快照；`≥ confidenceMedium` 只进索引行；再低则不注入，模型保留 `memory_search` 通道。经 `alwaysIncludeTags` 钉入的约束条目无论得分至少保留索引行。Markdown fallback 无 score，保持阶段一行为（全部索引行）。
- **topic 加分（阶段三b）**：`topicBoosts` 把 topic 映射为加性 score 提升（0..1，封顶 1），在置信度门判定前施加。小语料上 BM25 归一化得分趋零，`procedure`（巩固写入的做法条目）这类高价值 topic 不抬升就永远到不了注入层——例如 `{ procedure: 0.2 }` 可让做法条目像其他条目一样排进 STM 候选集。加分只抬升已有 score 的命中，绝不制造得分（pinned 语义不变）。做法条目是带溯源（`sourceRefs`）的建议，不是自动执行的 playbook。
- **规则兜底提醒**：`tools/result` 观察器在以下情况触发——工具调用触及当前 STM 快照文本未覆盖的路径，或结果携带未覆盖的错误码（`error.info.code` 或结果文本里的 `E[A-Z]{3,}` 形 token）。提醒是一个 `memory:reminder` 运行时上下文贡献——与 STM 一样在会话尾部追加，绝不编辑 system prompt——受 `maxRemindersPerTurn` 与 `maxRemindersPerIntent` 限量，intent 切换时清空，并记 log-only 的 `memory/reminder` 事件。
- 渲染经过 canonicalization：确定性，不含时间戳/随机 id/访问计数；逐字节相同的重渲染不会追加任何内容（agent loop 的 `RuntimeContextProjection` 比较保留文本）。
- 装配本插件而未装配 `@huiliyi37/dsh-memory` 属配置错误，首次评估即 fail loud；`confidenceHigh < confidenceMedium` 在装配时 fail loud。

全部阈值都是带 schema 缺省的 Config 字段：`stmTokenBudget`（600）、`maxEntries`（12）、`maxIntentTokens`（6）、`maxEntities`（24）、`reviewIntervalTurns`（8）、`goalVerbs`、`alwaysIncludeTags`（`['safety', 'constraint', 'preference']`）、`summaryMaxChars`（120）、`maxKeywords`（5）、`confidenceHigh`（0.82）、`confidenceMedium`（0.55）、`retrievalLimit`（24）、`topicBoosts`（`{}`）、`maxRemindersPerTurn`（1）、`maxRemindersPerIntent`（3）。

## Model Experience

### STM 运行时上下文快照

#### What the model sees

门控刷新且至少有一条相关条目时，一个 user 角色的运行时上下文快照携带一个 `memory:stm` section：固定头部，随后每条目或是全文块（`- 短id | topic（全文）` + 缩进正文——高置信层），或是一行索引（`短id | topic | 单行摘要 | 关键词`——中置信层与钉入条目）。两次刷新之间快照字节不变。检索决策事件（`memory/cache-hit` 等）绝不到达模型；快照本身由常规的 context-snapshot 机制记录。兜底提醒触发时，快照中出现第二个 `memory:reminder` section：一行指出未覆盖的路径或错误码并建议 `memory_search`——尾部追加内容，绝不改写历史消息。

##### STM 快照头部

```markdown
相关项目记忆（按当前任务筛选；用 memory_search 检索全文，excludeIds 传下列短 id 可排除已载条目）：
```

#### Token effect

条件性且有上限：无相关条目时为零；否则每份快照受 `stmTokenBudget`（估算 token，正文计入——放不下的正文块降级为索引行）与 `maxEntries` 约束，仅在门控刷新时重新追加。提醒每条一行，按轮与按 intent 限量。

#### KV Cache effect

仅追加。两个贡献都走运行时上下文通道而非 system prompt section，刷新或提醒只在历史尾部追加一份快照、前缀逐字节稳定；门控保持时完全复用上一份快照。compaction 可能清掉保留的快照，之后相同文本会被重新投影。

## Known Limitations and Deferred Work

- **intent 检测滞后一轮**——loop 在 assembly 前就 claim 了当前轮的用户消息，门控要到下一轮的评估才能看到改换目标的消息；引入新 intent 的那一轮，STM 仍反映旧 intent。
- **置信度阈值是占位值**——0.82/0.55 缺省未经校准。score 语义由 provider 定义（`dsh-memory-sqlite`：归一化 BM25 × 状态权重），而小语料上 BM25 归一化得分趋零（IDF 退化），默认阈值下几乎不注入——在真实任务集上调参是阶段二的收尾工作（A–E 基线臂）。
- **提醒启发式刻意简单**——「未覆盖」=「不是当前 STM 快照文本的子串」；实体过滤检索是合取语义（所有实体都须命中），是精确兜底而非召回手段。
- **启发式未经校准**——目标动词锚定在真实任务集上可能过粘或过跳；所有旋钮都是 Config 字段，待调参。
