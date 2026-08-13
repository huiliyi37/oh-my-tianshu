# @deepseek-ai/dsh-tool-subagent-report

[English](README.md) | 中文

可选的子级作用域 `report` 工具是 `ctx.subagents.reportFrom()` 之上的轻量适配器。它为每个可继续的进程内子级提供一条返回通道，指向启动该子级的 Agent（智能体）。本包注册的是可继续子级设置贡献，而不是全局工具，因此 `report` 只存在于这些子级内部。根 Agent、一次性 subagent、远程 subagent 提供方、同级作用域以及不关联 Agent 的工具执行都不会提供或执行它。安装本包只授予这项子级作用域能力；父到子方向仍由独立的 [`@deepseek-ai/dsh-tool-subagent-control`](../tool-subagent-control/README.md) 负责，可继续模式不依赖这两个包中的任一个。

子级可以在一个轮次中调用 `report` 零次或多次。调用成功既不会结束轮次或结算 Activation，也不会阻止父级后续消息；轮次结束也绝不会自动上报。该工具不接受接收方参数：`exec.agent` 是发送方确切在线的 Agent，也是权限凭据；服务根据该子级持久化的 `parentSession` 推导唯一接收方。成功时返回父级已接受消息的稳定 `MessageId`，不表示已读回执、inbox 中该次出现的 id、父级日志确认、轮次完成回执或持久化刷盘。父级解析由注册表中的存在性决定：父级不在注册表时，调用失败并返回 `direct parent is not live; report was not delivered`；已开始由宿主管理的 dispose（资源释放）但仍在注册表中的父级在其日志仍接受追加时仍会接受。服务不会执行注入、父级冷恢复或离线 mailbox 写入；持久化子级 transcript（文本记录）仍是恢复依据，且工具调用失败不能证明未送达（后续 `tools/post-execute` 否决可能让报告已被接受的调用以失败结束）。

`reportDelivery` 为每条已接受的报告选择父级调度方式。`quiet`（默认值）使用 `parent.inject()`，在不启动父级模型请求的情况下添加面向模型的上下文：父级空闲时，追加操作会在调用返回前完成；报告到达正在准入或运行的父级时，则会暂存到下一个安全日志位置。`wakeup` 使用 `parent.followup()`，恰好创建一个普通的后续父级轮次，并唤醒停驻的父级驱动；它绝不会对正在运行的轮次进行 steering（中途引导）。这是部署调度策略，因此面向模型的 schema 不能在单次调用中选择或覆盖该策略。

作用域局部注册有意不受子级全局 `toolFilter` 影响，因此委派允许列表无法移除唯一的返回通道。需要子级不具备返回通道的部署应省略本包。

贡献体以 `installReportTool(childCtx, ctx, delivery)` 导出，以便检查类消费方把 `report` 安装到新创建的子级作用域中。全局注册表无法公开作用域局部 schema，因此生成的工具目录会使用这条路径。生产组合仍通过 `apply()` 进入；subagent seam 的贡献注册表保持私有。

## 模型体验

### 工具 schema

#### 模型看到的内容

已生成的 [`report` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-subagent-report)：包含一个必填 `output` 字符串。其描述说明上报需要显式调用且可以重复，只会到达启动该子级的 Agent，并且不会结束轮次。它不包含接收方或投递模式参数。

#### Token 影响

每个可继续子级请求支付固定的 schema 成本，其他任何 Agent 的请求均无此成本。

#### KV Cache 影响

子级中的前缀保持稳定；schema 不会在运行时改变。移除本包会从驻留子级中撤销该 schema，从而改变其下一次请求前缀。

### 上报结果

#### 模型看到的内容

接受时返回 `report accepted by the agent that started you as message <messageId>`；规范输出携带稳定的 `messageId`。发送方未授权、父级不可用或生命周期正在关闭时，失败会成为出错的结果。描述中会说明，失败的调用仍可能已经送达，因为 `reportFrom()` 接受消息后，后续 `tools/post-execute` 失败可能替换工具结果。

#### Token 影响

每次调用都会在执行上报的子级中产生一条简短确认消息。父级还会为上报内容支付 token 成本：静默投递会把内容加入父级的下一次请求，唤醒投递则会使该内容成为一个新父级轮次中唯一的普通消息。

#### KV Cache 影响

在子级中仅追加。在父级中，带前缀的报告位于现有历史之后，并保留可复用前缀。

### 父级可见的报告

#### 模型看到的内容

一条用户角色的父级消息，以 `Background subagent <child-id> reported:` 开头，后接子级未经改动的 `output`，并带有指明该子级的持久化来源 `{ kind: 'subagent-report', senderSessionId: <child-id> }`。

#### Token 影响

子级的完整 `output` 加上一行前缀；本包不设上限。

#### KV Cache 影响

仅追加；报告位于父级可复用请求前缀之后。唤醒投递会启动一次独立的父级模型请求，静默投递则不会。

## 已知限制与暂缓事项

- **父级可能在宿主启动 dispose 后继续接受报告**：`AgentHandle.dispose()` 会先取消并等待完全停稳，然后才撤销作用域并离开注册表；它不公开「dispose 已开始」信号。在该窗口内接受的报告会追加到父级 transcript，但该父级不会在本进程中处理它。对于由继续执行管理器拥有的父级，管理器的准入边界会在整片森林拆卸期间拒绝该上报。
- **接受弱于持久投递**：没有持久化 mailbox、幂等键、投递回执、重试协议，也不保证恰好一次。任一侧记录接受后若进程失败，结果都不明确；外部重试可能产生重复上报。
- **暂存的静默报告无法立即重建**：接受时会返回其稳定 `MessageId`，但只有当待处理上下文到达普通日志边界后，父级 Session 才能重建带前缀的内容。
- **授权须等到下一个 Activation，撤销则立即生效**：子级驻留后再安装本包，只会在该子级的下一个 Activation 中授予 `report`；移除本包则会立即从驻留子级撤销该 schema。
- **嵌套上报只向上到达一条直接边**：孙级只向作为其直接父级的子级上报，不会直接到达顶层协调器；该直接父级必须随后显式发出一条衍生更新。
- **没有速率限制**：嵌套子级频繁上报时，`wakeup` 模式会放大模型工作量；部署通过选择模式自行承担这一取舍。
