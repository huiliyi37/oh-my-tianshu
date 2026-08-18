# Agent Note: 经只读 reader 子代理的按需原始历史召回

Status: implemented

[English](2026-08-18-tool-memory-recall.md) | 中文

## Problem

[intent 门控的 STM 快照](2026-08-18-adaptive-memory-stm.md) 能在不改写请求前缀的情况下注入有界工作集。`memory_search` 能找到已存条目。两者都无法在不把转录倒进当前请求的前提下回答「以前某个会话里发生了什么」。把 session-query 的原始命中直接还给父会话，会把另一会话的工具轨迹混进来，并且 token 成本没有上限。

## Decision

`@huiliyi37/dsh-tool-memory-recall` 注册 `memory_deep_recall`。模型传入一个自成一体的问题。工具经 `ctx.subagents.start` 启动进程内 reader（`provider` 缺省 `spawn`），带静态 persona、固定 `outputSchema`、只读 `toolFilter`（缺省 `session_search` / `session_event_search` / `session_event_read`），以及 `maxDepth` 1，使 reader 位于深度 1、不得再委托。只有按预算钳制的蒸馏结果 `{ answer, evidence: [{ sessionId, eventSeqs, quote }], uncertainties, confidence }` 作为工具结果返回。原始转录字节永不进入父会话。

能力在执行时探测：缺 `sessionQuery` 服务、缺 reader 工具、缺 `subagents` 服务或具名 provider、或 provider 不具备 `toolFilter` / `outputSchema` / `persona` / `depthLimit` 时，都以模型可见错误 fail loud。工具 schema 与 order-131 指引 section 都是静态字符串。返回预算是 Config 字段：`maxAnswerChars` 2000、`maxEvidence` 5、`maxQuoteChars` 240。事件 seq `0` 会保留。

发货 TUI bundle 在 `tool-session-query` 之后挂载本插件。禅锚定 `face` 与 `FACE_EXTRAS` 不含 `memory_deep_recall`；晋升后进入全工具面。`dsh-base` 不挂载。本插件不消费 `memory` 键。

## Alternatives considered

**挂进 `dsh-base`、禅 `face` 或 `FACE_EXTRAS`。** 否决：base 保持上游对齐主干；禅首面是测过的 alt-0 集合；命中「previous session」的 extras 已经追加 `session_search`。深度召回要额外付一次模型调用（reader），不进锚定面。

**把 session-query 原始命中还给父会话，或在父代理里直接搜。** 否决：父会话仍会看到无界转录字节。隔离需要子会话和蒸馏边界。

**把 STM、巩固或 sqlite embeddings 并进这次改动。** 否决：那些仍是按需消费方或存储旋钮；本工具只读 session-query。

## Consequences

发货 TUI 会话可以询问先前转录，而不把原始历史混进父前缀。缺 session-query 或 subagent 能力时以工具错误呈现，绝不静默给空答案。覆盖：`packages/memory/tool-memory-recall/tests/*.spec.ts`（成功路径、fail-loud 探测、预算钳制、保留 seq 0、reader dispose、HMR 卸载、空 invariant 伴侣）。
