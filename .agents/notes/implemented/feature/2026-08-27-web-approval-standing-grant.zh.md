# Agent Note：Web 审批常设授权——窄并集等待的 [a] 交互

状态：implemented

[English](2026-08-27-web-approval-standing-grant.md) | 中文

范围：`packages/host/apiproxy`（`api/approvals.ts`、`api/approvals.schema.ts`、`api-proxy.ts`），`packages/client/ui-conversation`（`contract/slots.ts`、`skeleton/ApprovalPanel.tsx`、`locales.ts`），`apps/web/tests/approval-composer.e2e.ts` 与快照 golden

## 问题

Web 审批卡（composer takeover，`ApprovalPanel`）只能回答 `allowed-once` 或 `rejected`——正是[常设授权](2026-08-25-approval-standing-grants.md)为远端/Web 通道保留的窄并集，"直到它长出属于自己的 always-allow 交互"。P2④（Web UI 追平）就是那个时刻：TUI 卡片的 `[a] 本会话总是允许` 在 Web 没有对应物，面对连续越权的 Web 用户只能每次点允许。

## 决策

Web 在回答通道上长出该交互，在协议桥处镜像 TUI 控制器的 always-approve 旗标：

**协议。** `ApprovalResponsePayload.outcome` 与 zod schema 增加 `'allowed-always'`（客户端可答并集现为 `allowed-once | allowed-always | rejected`；cancelled/unavailable 仍是 host 侧结果）。host 的 `ApprovalOutcome` 自 P1 起已含该值——服务侧零改动。

**常设授权放在 api-proxy 桥，不放进 user-approval。** pending 注册表旁一个 `Set<SessionId>`：`respond()` 在答案携带 `allowed-always` 时登记会话；审批 answerer 在**创建任何 pending 条目或 `approval/requested` 帧之前**对已登记会话短路。逐请求审计完整保留——每个被短路的 ask 仍各自落 `approval/asked` + `approval/decided` 对且 outcome 为 `allowed-always`（审计语义，非放行宽度；与 TUI 控制器短路完全一致）。授权会话级、随 proxy 生命周期消亡；其他会话照常询问。

**面板。** `PendingApproval.answer` 接受扩展并集；动作行加第三个按钮——拒绝 · **本会话总是允许** · 允许一次——同一 one-shot 锁存（三键点击后全禁用；失败重新武装）。locales 增 `approval.allowAlways`（英/中）。

## 备选方案

### 为什么不把常设授权放进 user-approval 服务？

TUI 先例把旗标放在控制器（一个 answerer 提供方）而非服务——服务保持纯粹的 ask/审计接缝，所有消费方原样复用。api-proxy 桥是 Web 的控制器等价物：它已拥有 pending 注册表与 answerer 链路，旗标落在交互通道所在处，无需拓宽服务面。

### 为什么扩展 wire 并集而不是新增一个 unary 方法？

答案本就乘着回显 rpcId 的 client-response；第三个 outcome 值是最小的协议增量，one-shot 锁存、receipt 语义与 resolved 帧广播全部原样不动。单独的"授权"方法需要自己的关联、拆卸与重放故事，却无行为收益。

### 为什么不在同一改动里给 Web 加 [p] 持久规则与 /permissions？

`approval-rules` 持久化与规则列举命令是 host API 领土（新 unary 方法 + web 命令注册）——另一条接缝，不是回答通道扩展。P2④ 阶段 1 只做常设授权；持久规则在 Web 长出自己的入口前仍属 TUI 的 `/permissions` 面。

## 后果

买入：Web 用户一次点击解决会话内连续越权——与 TUI 卡片 `[a]` 对齐——每请求以 `allowed-always` 落审计。

成本：wire 并集放宽（从不发送该值的旧客户端不受影响；收到该值的 host 必须支持并集——P1 已落地）。常设授权集合是 proxy 生命周期（过期会话 id 不可能误伤，且受会话创建数约束），无跨重启持久——刻意会话级，与 TUI 旗标一致。

## 验证

聚焦套件：`api-proxy-approval.spec.ts`（新 P2④ 用例：allowed-always 以授权 outcome 结算并广播 resolved；同会话下一次 ask 不产生新 requested 帧直接结算；异会话照常询问），`rpc-schemas.spec.ts`（schema 接受 allowed-always、仍拒 cancelled），`ui-conversation` 测试（429 通过）。Web e2e `approval-composer.e2e.ts` 断言三个动作按钮、golden 列 "Always allow this session"（replay 泳道走 CI；浏览器泳道在本地沙箱无法 boot）。
