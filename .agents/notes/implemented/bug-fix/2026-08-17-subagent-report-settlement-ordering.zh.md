# Agent Note（agent 决策记录）：Subagent 报告进入 parent 的下一个 step

Status: implemented

[English](2026-08-17-subagent-report-settlement-ordering.md) | 中文

## 问题

Subagent 报告曾使用 `Agent.followup()`，进入 parent 的 `next-turn` 队列。一个轮次的第一个 step 会先领取完整 `next-step` 批次，再领取一条 `next-turn` 消息，因此任何更晚的 `next-step` 输入都可能超越更早的报告。每份报告还独占一个 parent 轮次：parent 无法同时处理两份报告，且在 parent 运行期间提交的报告要等待一个独立的后续轮次。

report 工具要求 child 在发现会改变 parent 下一步动作的信息时上报。把这条消息推迟到后续轮次违背了工具的调度含义。

## 决策

`SubagentReportDelivery` 为 `'quiet' | 'next-step'`，默认值为 `next-step`。Next-step 投递调用 `parent.steer()`：运行中的 parent 会在最近的安全 step 边界读取报告，空闲 parent 则会启动一个轮次。静默投递继续调用 `parent.inject()`，进入同一队列但不唤醒 parent。对于投递到驻留可继续 parent 的 next-step 报告，继续执行管理器保留其唤醒发送的准入记账。

### 不同 parent 状态下的顺序

运行中的 parent 在同一个 `next-step` FIFO 中接收报告，该 FIFO 同时承载其他所有 next-step 输入；一起等待的报告进入同一个领取批次。既有的 `Agent.send()` 重定向仍然适用：取消后提交的唤醒输入会移入 `next-turn` 队列，因此 parent 轮次被取消的报告会以更晚轮次的形式到达，而不会中途打断 step。

### 验证

report 包把 parent 保持在一个活动模型请求中，提交报告，让 child 结算，并断言报告停留在 parent 的 next-step 批次中、没有排队的后续轮次。独立覆盖还固定了重复报告形成一个 FIFO next-step 批次、空闲 parent 唤醒，以及驻留 parent 的唤醒准入记账。Subagent 运行时覆盖空闲 parent 被 next-step 报告唤醒。

整体组装的 ACP 场景使用随附默认值。调度围栏让 child 等到 parent 的委派轮次结束；报告随后把停驻的 parent 唤醒进入一个确定性轮次，且后续提示词仍从持久化日志读到该报告。

## 备选方案

**保留 `wakeup` 名称，但把其实现改为 `steer()`。** 旧名称描述的是投递引起的轮次唤醒，而不是报告进入的队列。配置值若无法说明自己选择的行为，就会辜负需要静默形态的部署；预发布命名应直接命名队列。

**暴露 `quiet | next-step | next-turn`。** Next-turn 报告仍会被每一个 next-step 输入超越，因此该选项需要先建立跨队列顺序屏障才有意义。当前没有任何部署需要推迟的报告。

**保留静默投递作为默认值。** 停驻的 parent 没有其他理由查看自己的 inbox，因此一份已接受的报告会无人阅读，直到一次无关的唤醒。校验默认值不应要求额外配置才能投递。

## 后果

实现固定了以下行为：

- 报告可能延长已打开的 parent 轮次，但绝不会打断活动模型请求：准入只发生在 step 边界。
- 一起接受的报告共享一个 next-step 批次，按 FIFO 顺序读取，减少原先每份报告各占一个轮次所造成的放大。
- `wakeup` 配置值会被拒绝，而不是保留为别名；本仓库对预发布 Cordis 配置不作外部兼容承诺。
- 对于不得唤醒停驻 parent 的部署，`quiet` 仍是退路，同时保留既有风险：在另一条唤醒输入到达之前，报告无人阅读。
