# Agent Note: 成功门控之后的会话结束巩固

Status: implemented

[English](2026-08-18-memory-consolidate.md) | 中文

## Problem

成功会话里可复用的事实、纠正与做法只留在已关闭的事件日志里。失败会话把这些信号和未解决错误混在一起。[sqlite provider](2026-08-18-memory-sqlite-structured-ltm.md) 已经暴露 `markUncertain` 与 `retireStale`，但没有调用方，也没有在任务结束时写入结构化经验。`session/flush` 是每请求的持久化检查点，不是任务结束。

## Decision

`@huiliyi37/dsh-memory-consolidate` 监听 `session/disposed`。成功门控（`standard`：末轮；`strict`：全会话）要求至少一个 completed turn，且范围内无未解决工具错误或可观察的测试失败。通过的会话提取候选；失败的会话仅在 `recordFailures` 为 true 时写入 `failure-pattern` 经验。缺省提取器是启发式、零模型调用（显式 remember、用户纠正、错误→解决、决策、由编码了方法的纠正沉淀的保守 procedure）。`extractor: 'llm'` 在 dispose 后做一次有界结构化调用，任何失败都回退启发式。写入 `global`，`source: 'auto'`，带 `sourceRefs`。同一次巩固内的 (subject, predicate) 冲突探测 `markUncertain`；每次巩固可探测 `retireStale`。巩固失败只记日志，绝不阻断拆除。子会话缺省跳过，除非 `consolidateChildSessions`。`llmProvider` / `llmModel` 必须成对。任何发货组合都不挂本插件。

## Alternatives considered

**挂在 `session/flush`。** 否决：flush 每请求会跑多次；dispose 才是离开 store 的终态信号。

**缺省 `extractor: 'llm'`。** 否决：每个会话结束都要付一次模型调用；零额外调用是契约，LLM 失败本来就会回退。

**挂进发货 TUI，或把成功事实混进失败会话。** 否决：TUI 继续挂 Markdown 记忆工具；失败会话的事实会污染 LTM。

## Consequences

按需挂载的主机在会话结束时写入当前装配的 `memory` provider，不碰在途请求路径。sqlite 的冲突与退役方法有了调用方；Markdown 经 `typeof` 探测跳过。覆盖：`packages/memory/memory-consolidate/tests/*.spec.ts`（门控级别、启发式规则、LLM 解析/回退、dispose 接线、`markUncertain` / `retireStale` 探测、子会话跳过）。
