# Agent Note: 子代理进度投影与委派树信息密度

Status: implemented

[English](2026-08-19-subagent-progress-projection-and-delegation-panel.md) | 中文

## Problem

`dsh-tui` 的委派树面板（`/subagents`）原先只展示形状事实——树深、activity `●/○`、mode `▶/↻`、label 与已结算耗时——运行中的子代理在信息层面不可见：没有 activity 文本（`Running: bash`）、没有 token 消耗、没有工具计数、没有终态原因。其背后有三个缺口：

- **数据源太薄。** `SessionProjectionMap` 只有 `subagent`（身份：mode/label/seq）与 `subagentTiming`（settledMs）。没有单元从子会话日志折叠运行活动。
- **父面板接线错误把耗时藏起来了。** 面板从*活动*会话的 `projectionCache` 读 `subagent`/`subagentTiming`，但这两个单元折叠的是*子会话自己的*日志。`attachProjections` 只快照活动会话，因此父会话下这两个 key 恒为 null/零值，从不渲染 `· 43s`。
- **无控制入口。** 服务层已有 `ctx.subagents.interrupt()`（user/ancestor 授权），但面板与 slash 面没有停止路径；TUI 的 `SubagentsFacet` 也未声明该方法。

## Decision

运行态投影从既有子会话日志事件折叠，并挂在后代列表上。面板消费条目自带的字段。`/subagents kill` 停止在线的 continuable 子代理。不发明事件词汇，不改 agent-loop / 会话事件（Model-visible ⟺ logged）。

### D1 — `SubagentProgressProjection`

公开形状在 `projection-types.ts` 与 [subagent 子系统页](../../../../docs/subsystems/subagent.md)。刻意排除：`contextPct`（需实时 `contextWindow` 查询）与 `stopReason`（`refusal` 变体不可从日志派生；终态仍走 `subagent/end`）。`turns` 与 `reasoningTokens` 留在类型上供其他消费方使用；P0 面板行不打印它们。

### D2 — 折叠规则

`subagentProgressProjectionDefinition` 沿用 timing 单元的 descriptor 重置纪律。状态携带 `descriptorSeen`；`subagent/descriptor` 重置累计，只统计子会话自身后缀。

- `turn/start` 清除 `lastTurnEnd`，因此未结束的 turn 不是终态。可继续子代理第一轮结束后再调用工具时，不得同时出现 `Running: bash` 与 `✓ 已完成`。
- `tool/call` 增加 `toolCalls`，写入 `lastTool`/`lastCallId`，并以自有 key 记录 pending。`tool/result` 仅在 `Object.hasOwn` 命中时清除该 pending（原型名 `callId` 视为未匹配，返回同一 state 引用）。
- 带 `usage` 的 `assistant/message` 对 `tokensUsed` 为 last-wins（input+output+cacheRead+cacheWrite）。`reasoningTokens` 跟*最新*一条 usage last-wins：该 usage 省略该字段时，前值被丢掉，不粘滞。
- `turn/end` 增加 `turns` 并记录已知 reason kind。未知的合并 kind 只计数、不猜测标签。
- 无关事件返回同一 state 引用。zod strict schema，`stateVersion: 1`；fold 永不 throw。

### D3 — 载体

`listDescendants` 在同一份三级 cut 折叠出有意义的值时（`meaningfulProgress` / `meaningfulTiming`），把可选的 `progress`/`timing` 嵌到 `child` 行上。`listChildren` 从不嵌入它们。TUI 不再为父面板读 `projectionCache.subagent` / `subagentTiming`（即 D0）。

### D4 — TUI 消费

`DelegationTreeEntry` 的 child 行携带同样的可选字段。行格式：`● ↻ 主探索 · Running: bash · 12.3k tok · 5 工具 · 43s`。进行中为 `Running: <lastTool>`，否则在已跑过工具时为 `Done: <lastTool>`。token 复用 `formatTokenCount`。suffix 从右往左丢，label 优先保留。存在 `lastTurnEnd` 时追加状态词（`✓ 已完成`、`✗ 出错` 等）。live 的 `now` 用 `timing.active` 算进行中 turn 的耗时。

刷新：`sessionProjections.onChanged` 命中树上成员（或已在树上的子会话的 `subagentProgress`/`subagentTiming`）时，对当前根重跑 `listDescendants`——同一 cut，冷子代仍可能 `inspect`。这不是无 I/O 的纯重绘调度。

### D5 — `/subagents kill <id>`

live 区无行选中、无鼠标处理。kill 列举*当前*会话的后代，并调用 `interrupt(id, { kind: 'user', parentSessionId: entry.parentId })`——即持久化**直接**父，`interrupt()` 用它对照 `header.parentSession`。不用 `sessions.list()[0]`，也不把树根当作 parent。

一次性、已结束、不在本树、服务缺失、以及 `sessionId === null`，都在调用 `interrupt` *之前*大声失败。服务层对缺失目标仍是接受的 no-op；命令对能检测的情形不报假成功。

## Alternatives considered

**TUI 按子会话解析投影**（`sessions.get(childId)` + `projections.snapshot` + 按 `s.id` 的 `onChanged`）。否决：TUI 会重复 `list-children.ts` 已拥有的 live 水位 vs 冷持久化 cut，且 timing 的 D0 原样保留。

**新增 `subagent/progress` 插件事件。** 否决：发明事件词汇。每个投影事实必须可溯源到既有会话事件。

**继续从活动会话 `projectionCache` 读、只加一个 key。** 否决：progress 会精确复现 D0（如同 timing 已被隐藏）。

**投影内累计 token。** 否决：面板展示当前状态而非审计；压缩/回放后累计会漂移。

**user interrupt 使用 `parentSessionId: rootSessionId`。** 否决：`interrupt()` 授权的是持久化直接父，不是树根。嵌套 child 会拿到 `UNAUTHORIZED` 或静默 no-op。

## Consequences

父面板可以从一次后代列举中展示 activity、token、工具数、耗时与终态词。耗时之所以在父面板可见，是因为它挂在子行上。只要调用方当前会话能列出该节点，嵌套的 continuable 子代理就可以被 kill。refusal 类结局仍留在 scrollback 的 `subagent/end` 行。`turns`/`reasoningTokens` 为类型合同而折叠，P0 行格式不用它们。

每个子代理的 progress 在单次 listing 中保持一个一致 cut——共享 `resolveCandidateRows`。面板可见时的刷新仍可能对冷后代 `inspect`。

P1/P2 工作（activity-store 接线、cache 面板、history replay、timeline rail、dashboard、子代理全屏转录、进度条组件）仍不在范围。

## Testing

- `packages/subagent/subagent/tests/subagent-progress.spec.ts` — descriptor 重置；进行中工具；后续 `turn/start` 清掉 `lastTurnEnd`；原型名 `tool/result` 同引用；token last-wins（含丢掉的 `reasoningTokens`）；未知 `turn/end` kind 计数但不贴标签。
- `packages/subagent/subagent/tests/list-children.spec.ts` — `listDescendants` 嵌入有意义的运行态字段；`listChildren` 行保持纯身份。
- `packages/tui/tui/tests/delegation-panel.spec.ts` — 行格式、suffix 丢弃、终态词、一次性无 kill 字形。
- `packages/tui/tui/tests/commands.spec.ts` — kill 使用条目的 `parentId`；一次性 / 已结束 / 未知 id / 空会话 / 服务缺失不调用 `interrupt`。

## Related

- [经投影单元的 subagent 列表身份](../architecture/2026-08-06-subagent-list-identity-projection.md) — 本进度单元所乘坐的三级 cut；列举仍不依赖 session-query。
