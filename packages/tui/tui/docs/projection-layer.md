# dsh-tui 状态投影层（projection layer）

状态投影层把 dsh 的会话事件日志与 `agent/*` 事件流投影为 TUI 可消费的派生状态。它只读、不写回：**Model-visible ⟺ logged**，UI 投影不得追加 session log，也不发明新事件词汇——每个投影事实都能追溯到一条 `SessionEvent`（`packages/core/session` 的 `SessionEventMap`）或一条 `agent/*` 事件。

## 现状分层

事实源（Session.events 日志、`session/event` 流、`agent/*` 事件）→ 订阅接线（`ui/app.ts` 的 `attachProjections`/`detachProjections` 对称挂卸）→ 派生状态。实际在跑的接线走 `adapter/live.ts`、`adapter/transcript.ts`、`statusline.ts`（transcript/live/statusline/stream-feed 与 subagent/workflow 订阅）；会话日志回放走 `restore-session.ts`（重放进 scrollback）。

纯 fold 模型模块（输入为窄事件，输出为不可变派生状态，可脱离 cordis 单测）已落地四个，其中两个已接线到 App 主体（`ui/app.ts` 的 `handleStreamEvent` 逐事件 fold，`mountSession` 复位/重放）：

| 模块 | 职责 | 接线现状 |
|---|---|---|
| `activity-status.ts` | 单个活动状态机（phase/label/status/耗时），事件 fold | 模型与 spec 就绪；`ActivityPhase` 类型被 `fluency-hook.ts` / `format/fluency-policy.ts` 消费。状态机本体刻意不接线：`statusline.ts` 的 WorkflowStatusLine 是自包含投影（自订阅自折叠），换成它是无收益重构 |
| `activity-store.ts` | 归一 `ActivityItem` 投影 + 按 id 去重合并的只读容器 | 模型与 spec 就绪；无当前消费方，保留待用（无主的接线属于投机泛化） |
| `turn-summary.ts` | turn 内工具统计模型（数量/耗时/家族分布） | **已接线**：`handleStreamEvent` fold → `turn/end`（非 aborted 且有工具调用）经 `format/turn-summary.ts` 渲染摘要行进 scrollback（`turn N · 读X 改Y · elapsed`）；读/改计数复用 `format/tool-meta.ts` 的 read\|find\|write 家族 |
| `summary-state.ts` | 会话级跨 turn 汇总 | **已接线**：`handleStreamEvent` fold + `mountSession` 经 `summarizeSession` 从事件日志重放重建 → `/status` 面板「Σ 会话」段（`render/live-snapshot.ts` 的 `sessionTotals` 字段）；不依赖宿主投影总线，总线缺失时仍有数据 |
| `cache-telemetry.ts` | cacheHealth 投影的格式化/报告门（reason → 状态栏短标记 + 诊断日志行） | **已接线**：`ui/app.ts` 的 onChanged `cacheHealth` 分支 → `reportCacheMiss`（warn/error 级 echoWarn 日志 + 同因去重）；glanceMetrics 读 `lastMissReason` 注入缓存段短标记；数据源为 `@huiliyi37/dsh-cache-diagnostic` 注册的 `cacheHealth` 投影（bundle 装配 `cache-diagnostic` 行，未装配时诚实降级） |


子代理运行态投影（宿主侧 fold，`dsh-subagent` 包注册，委派树面板消费）：

| 模块 | 职责 | 接线现状 |
|---|---|---|
| `subagent`（身份） | mode/label/seq，descriptor 折叠 | 宿主注册（`subagent/src/projection.ts`）；`listDescendants` 同 cut 解析进条目，委派树面板消费 |
| `subagentTiming`（耗时） | 已完成 turn 累积毫秒 + 进行中 turn 边界 | 宿主注册；**由 `listDescendants` 条目携带**（`timing`）→ 委派树卡 header 耗时段。面板不从活动会话 `projectionCache` 读子会话投影（那些 key 折叠的是子日志，父会话下恒空） |
| `subagentProgress`（运行态） | turn/tool 计数 + 最新 token + 当前工具活动（`Running: <tool>`），descriptor 重置；`turn/start` 清除 `lastTurnEnd` | 宿主注册；**由 `listDescendants` 条目携带**（`progress`）→ 委派树卡：进行中 `⎿` body 画 activity/token/工具计数，终态词留在 header。`listChildren` 行不带这两项。live 子会话经 `sessionProjections.onChanged` 按树上 `s.id` 触发整树 `listDescendants` 刷新 |

设计曾承诺、至今未落地的模块：`cache-panel-source.ts`、`history-replay.ts`、`adapter/projections.ts`——处置见 [README《Known Limitations and Deferred Work》](../README.md#known-limitations-and-deferred-work)。

## 关键契约

- **工具家族分布**（turn-summary/summary-state 的 `byFamily`）复用 `format/tool-family.ts` 的 `getToolColorFamily`（file/shell/search/edit/network/other）——同一个「工具名 → 功能域」映射，投影不重复造轮子。
- **耗时**：`tool/call` 与 `tool/result` 各自携带事件 `time`，turn-summary 用两者之差算工具耗时，不依赖调用方时钟。
- **投影纪律**：活动在 `turn/end` 清空；派生状态缺输入时保持不变，不猜测（无记录 ≠ 零值）。

## 反目标

不接 council/team/worker 多 agent 数据；不移植美德结算/星域叙事/信息素记忆/CVM；不搬 evidence-obligation 完整债务模型；不改 agent-loop、不改 session 事件词汇。

## 验证

- 模型模块 spec：`activity-status.spec.ts`、`activity-store.spec.ts`、`turn-summary-model.spec.ts`、`summary-state.spec.ts`（事件注入驱动断言，不依赖真实 LLM）。
- 组合层：`tests/loader-composition.spec.ts` 经 Loader 真实 boot，断言投影订阅随 dispose 对称释放。
