# Agent Note: 经 append-on-change 通道的 intent 门控 STM 快照

Status: implemented

[English](2026-08-18-adaptive-memory-stm.md) | 中文

## Problem

把记忆摘要写进 system prompt，每次 save 都会改写请求前缀。[加宽后的 `MemoryService` 缝](2026-08-18-memory-seam-prefix-stable-digest.md) 与 [sqlite provider](2026-08-18-memory-sqlite-structured-ltm.md) 已经能存带排序、带版本的事实，但仍没有按 intent 选出工作集、并在不碰前缀的情况下注入。占位阈值 0.82/0.55 若当产品缺省猛注入：小语料 BM25 上几乎什么都不进，校准之后又可能进得太多。

## Decision

`@huiliyi37/dsh-adaptive-memory` 是按需挂载的插件。它从会话日志推导 intent（首条用户消息，或之后含目标动词的消息；路径与错误码成为实体），每轮在 `system-prompt/assemble` 瀑布上评估一次，经 `ctx.systemPrompt.context()` 注入规范化 STM 快照（`memory:stm`，order 120）。仅当 intentKey 变化、相关 topic 版本变化、出现新实体、或满 `reviewIntervalTurns` 轮时才重渲染；否则缓存字节保持不变。决策记 log-only 会话事件（`memory/cache-hit`、`memory/cache-miss`、`memory/stm-selected`、`memory/reminder`）。

当装配的 `memory` 服务暴露 `topicVersions()` 时，检索走带 score 的 `search` 加合取实体过滤，以及三层置信度门（high → 正文，medium → 索引行，low → 不注入）。Markdown 无 score，保持 list + 子串的索引行。`topicBoosts` 只抬升已有 score 的命中。`tools/result` 观察器可在未覆盖路径或错误码时追加一行 `memory:reminder`，按轮次与 intent 限量。缺 `memory` 在首次评估 fail loud；阈值倒挂或非法加分在装配时失败。任何发货组合都不挂本插件。

## Alternatives considered

**整支 merge `github/dev`，或把 adaptive-memory 挂进发货 TUI。** 否决：TUI 继续挂 Markdown 以及 `/remember` 与 `/memory`；占位阈值不是产品缺省，sqlite 也不能与 Markdown 共用 `memory` 键。

**把评估挂在 `agent/pre-step`。** 否决：loop 在 pre-step 之前就 assemble，刷新赶不上当前快照。

**用 LLM 检测 intent，或缺省猛注入。** 否决：每轮额外模型调用；未校准的 score 要么几乎不注入，要么不断改写尾部。

## Consequences

按需挂载的主机得到 append-only 的 STM 尾部，system-prompt 前缀逐字节稳定。Markdown 与 sqlite 经能力探测可互换。按需的原始历史问题走 [`dsh-tool-memory-recall`](2026-08-18-tool-memory-recall.md)，不消费 `memory` 键。覆盖：`packages/memory/adaptive-memory/tests/*.spec.ts`（Markdown fallback、sqlite 结构化路径、cache hit/miss 原因、提醒预算、fail-loud 配置、log-only 不变量）。
