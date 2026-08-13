# @deepseek-ai/dsh-subagent

[English](README.md) | 中文

subagent seam 允许一个 agent（智能体）通过具名提供方把工作委派给子 agent。调用方使用统一的服务 API（`ctx.subagents`）；提供方决定子 agent 在当前进程、另一进程还是未来的传输之上运行。

[subagent 家族概述](../README.md)列出了实现和面向模型的消费方。本包负责提供方注册表、共享请求和结果约定、持久描述符以及可继续子级编排。多个具名提供方可以在该约定背后共存。

## 服务 API

`SubagentService` 具有以下操作：

| 成员 | 含义 |
|---|---|
| `registerProvider(provider)` | 按名称注册一个可信的同进程实现。注册受 effect 作用域约束；移除注册会阻止新的启动，但不会撤销已返回给调用方的运行。重复名称会明确报错。 |
| `getProvider(name)` | 返回提供方；不存在时返回 `undefined`。 |
| `list()` | 按插入顺序返回提供方名称。 |
| `start(name, request)` | 校验普通调用方请求，解析其分离的 `one-shot` 描述符，然后等待提供方，直到真实的一次性子 agent 发布。兑现时返回由持有方拥有的 `SubagentRun`；拒绝表示提供方已清理所有未发布的启动资源，而发布后的轮次或基础设施故障会通过该 run 结算。可继续子 agent 绝不通过此操作进入。 |
| `startContinuable(spec)` | 建立一个持久化可继续子 agent，并投递其初始提示词。子 agent 的 inbox 接受该提示词时，兑现为 `{ childId, messageId }`，无需等待轮次开始或消息写入 Session 日志；此前任何失败都会以无 id 拒绝，并完全回滚该子 agent。要求 `ctx.agents`、会话持久化以及具备 `prepareContinuable` 能力的提供方。 |
| `followup(parent, childId, content, { source, signal })` | 将来自确切在线直接父级的一条后续消息作为子 agent 的下一个 FIFO 轮次投递，术语与 `Agent.followup()` 一致，并返回被接受的 `MessageId`。驻留中的子 agent 由其 inbox 直接接受（唤醒处于 waiting 的 Activation）；不驻留的则从其持久化 Session 冷恢复。要求 `ctx.agents`；冷恢复还要求会话持久化。 |
| `interrupt(targetSessionId, authority)` | 以人类持久化 parent 地址（`{ kind: 'user', parentSessionId }`）或确切在线 ancestor Agent（`{ kind: 'ancestor', agent }`）为授权，中断一个在线可继续 child 的当前轮次。准入同步完成、生效异步进行：它发出 `Agent.cancel(cause, { keepInbox: true })` 后立即返回，不等待目标观察到信号。尚未领取的待处理 inbox 工作、Activation 与已发布的后代均保持不变；已被领取进入中断轮次的工作不会重新入队。目标不存在时接受为 no-op；错误的 parent 地址以及过期、指向自身或非祖先调用方以 `UNAUTHORIZED` 拒绝。 |
| `reportFrom(child, content, { delivery, signal })` | 从确切在线可继续 child 向其确切在线直接 parent 投递一条选中消息，并返回已接受的稳定 `MessageId`。静默投递会注入上下文；唤醒投递会提交一个后续 parent 轮次。 |
| `registerContinuableSetup(contribution)` | 把一项可选部署能力组合到每个可继续 child 尚未发布的作用域中，并支持从驻留 child 立即撤销。 |
| `drainContinuableDescendants(parents)` | 在由 host 确切拥有的在线 parent Agent 之下关闭准入，只停止其可见的可继续后代，等待在这些根之下已获准的物化过程完成发布或回滚，再按 child-first 顺序释放所选森林。该截止状态会持续到每个确切 parent 离开注册表；无关的 parent 森林和管理器全局准入保持在线。 |
| `listChildren(parentSessionId, signal?)` | 按 `createdAt` 再按 id 的顺序列出由会话支撑的直接 subagent，包括其 `one-shot`／`continuable` 模式、`running`／`inactive` 活动状态、基于 origin 分类的一层 `hasChildren` 提示与逐 child diagnostic，且不会加载或恢复它们。直接读取在线会话存储与可选的会话持久化（持久化缺席时仅枚举在线 child），并要求已挂载 `sessionProjections` 注册表；不要求 `ctx.agents`、继续执行管理器或任何查询服务。 |
| `listDescendants(rootSessionId, signal?)` | 从同一份实时优先语料按稳定 pre-order 展平根的完整会话树，并为每个 subagent 条目附加持久 `parentId` 与相对根的 `depth`。普通会话与一次性 child 仍作为遍历节点，因此其下的可继续后代仍可发现。身份、diagnostic、依赖与取消约定均沿用 `listChildren()`。 |

`SubagentStartRequest.label` 是由会话支撑的一次性 child 所使用的可选简短持久化显示标签。面向模型的委派会提供其已有的 `description`；底层调用方无需凭空构造展示元数据。可继续启动始终携带自身的必填标签。`signal` 是必填项，也是一次性 `start` 的规范取消通道。发布前中止会使 `start()` 在回滚后拒绝；发布后中止会取消已返回 run 的剩余轮次工作，但不会隐藏其 id。请求还可以选择模型、要求结构化输出、限制委派深度、约束子 agent 工具或设置子 agent persona。对于可继续启动或后续操作，调用方信号只在 inbox 接受之前掌管查找、物化和准入；此后由管理器独立拥有 Activation，因此调用方后续取消既不会取消已接受的轮次，也不会 dispose（资源释放）子 agent。

后续操作的权限来自子 agent 持久化 header 中记录的确切在线直接父级。冷恢复会在重建前检查该权限，并在最终无 await 的 inbox 准入区间再次检查，因此在物化期间被注销或替换的 parent 无法授权投递。后续操作上的 `source` 记录谁提供了所投递的消息，不授予任何权限。

同进程请求、描述符、结果和事件 payload 都是以不可变方式借用的可信类型值。服务不会克隆或冻结它们；序列化和不可信输入校验属于真实的进程、worker、持久化和模型边界。

## 能力

启动时功能通过 `provider.capabilities` 声明，因为服务必须在创建子 agent 前拒绝不受支持的一次性请求：

- `outputSchema`：强制执行结构化最终结果；
- `depthLimit`：强制执行 `maxDepth`；
- `toolFilter`：应用请求的子 agent 工具限制；
- `persona`：应用每个子 agent 独立的 persona。

可继续创建对应可选的 `SubagentProvider.prepareContinuable?()` 方法：方法是否存在就是能力检查，因此服务会在没有该方法的提供方上拒绝已配置的可继续启动，而具备该方法的提供方仍可服务普通一次性委派。该方法只返回分离的 `ContinuableCreateSpec`（`{ seed? }`）——这是数据，绝非能力：它不携带任何 Agent、`AgentHandle`、提示词投递、结果、dispose 或恢复操作，因为准备之后，继续执行管理器拥有身份预留、组合、Agent 创建、提示词投递、冷恢复、所有权和 dispose。一次性 `SubagentRun` 表示一次可 dispose 的前台委派，只有一个结果，且没有冷恢复操作。

## 持久化描述符

该 Service Definition 拥有版本化的 `subagent/descriptor` 会话事件词汇（`src/descriptor.ts`）：`snapshotSubagentDescriptor()` 会在提供方工作之前校验并分离记录，`foldSubagentDescriptor()` 则会在从已加载子 agent 日志中恢复描述符之前，校验当前版本的完整 payload。每次由本地会话支撑的启动都会追加一个带有提供方名称与生命周期 `mode` 的描述符。`one-shot` 描述符可以携带调用方拥有的可选持久化显示 `label`；`continuable` 描述符要求其持久化创建标签，并另外记录已解析的子 agent `agentOptions.provider`／`model`，以及用于从持久化存储恢复的可选 `persona`／`toolFilter`。这些是显式字段，绝不是可通过合并扩展的 `AgentOptions` 对象，因此无关的扩展值不会破坏继续执行。描述符省略 `subagentDepth`（持久化 header 的 `delegationDepth` 是单调下界）和 `outputSchema`（单次 Activation 的结果约定）。该事件只进入日志：不含 `surfaceOp`，不进入模型历史，并由仅追加日志跨压缩（compaction）保留。格式错误的当前版本 payload 属于损坏；本运行时无法对不受支持的版本进行分类。

## 委派深度

该 seam 拥有 Service provider 和 Consumer 共享的深度词汇：`AgentOptions.subagentDepth` 声明、`assertSubagentMaxDepth` 和 `delegationDepthOf(agent)`。持久化的 `SessionHeader.delegationDepth` 具有权威性且单调：运行时选项可以加深计数，但绝不能降低它，因此恢复后的子 agent 不会被重新计为顶层。

`inheritsParentContext` 只用于描述，不能强制执行。它仅说明子 agent 是否能看到父级已完成的对话历史（`fork` 可以；`spawn` 和各进程外一次性提供方不可以），不表示是否继承工具、服务或权限。

## 一次性所有权与生命周期

`provider.start(request): Promise<SubagentRun>` 是所有权转移边界；委派工具也会在其由 Task 支撑的一次性后台路径中使用它。兑现前，提供方拥有设置过程，并且每次失败时都必须取消、回滚并使未发布资源完全停稳。兑现后，调用方拥有该运行，并且必须在每条路径上调用 `dispose()`；剩余提示词和轮次工作属于 `SubagentRun.result`。

`SubagentRun.result` 兑现为 `{ output, structured?, stopReason }`。子 agent 级失败会以非 `completed` 原因兑现；只有 seam 无法表示的基础设施故障才可以拒绝。`dispose()` 是幂等的，会取消剩余工作，并等待结果结算以及子 agent 资源完全停稳。`result` 的 rejection 仍归 `result` 通道；只有独立的资源释放失败会使 `dispose()` 拒绝。

本地运行会在 `start()` 兑现前发布普通的子 agent／会话，把该共享会话 id 作为 `SubagentRun.id` 返回，以 `SubagentRun.localAgent` 公开准确的子 agent，把 `request.parent.session.id` 记录到子 agent 的 `parentSession` header，并在其初始轮次内追加已解析的描述符。远程提供方则生成 parent 作用域的生命周期 id，并返回 `localAgent: undefined`；由于没有本地 child 会话，其一次性运行不会进入基于追踪的枚举结果。

## 可继续子 agent 与 Activation

可继续子 agent 拥有一个持久化 Session 和至多一个进程内 **Activation**——即被重建的子 agent 的一个驻留时段，而不是请求、结果、取消或 Task 边界。Agent inbox 是唯一的轮次队列，因此继续执行管理器负责驻留，而 agent loop（智能体循环）负责所有轮次排序与执行。任何可继续路径都不会创建 Task 或中间的承载结果的包装层。

管理器根据 Agent 停稳状态和所拥有的子 agent 集合推导三个内部驻留条件，而非维护第二个状态机：running（存在活跃准入、进行中的轮次或唤醒型 inbox 工作）、waiting（已停稳但仍拥有至少一个未 dispose 的子 agent）、settled（已停稳且所有拥有的子 agent 都已 dispose，因此管理器 dispose `AgentHandle` 并移除 Activation）。每条后续消息都使用 `Agent.followup()` 并成为一个 FIFO 轮次，且不会对当前轮次进行 steering（中途引导）。路由只取决于驻留状态：running 入队、waiting 唤醒同一 Agent，无 Activation 时则冷恢复一个新的。

管理器预留子 agent 身份、解析持久化描述符，通过私有的 activation-owner 作用域调用 `ctx.agents.create()`（冷恢复时为 `ctx.agents.resume()`），把返回的 `AgentHandle` 安装到 Activation 中，建立任何可继续父级所有权，然后提交提示词。冷恢复绝不通过提供方分发，因为持久化 Session 已持有初始前缀，折叠后的描述符即是全部重建输入。

受继续执行管理的父级 Activation 会在子 agent 能够运行之前，把每个子 agent 的 Session id 记录到 `ownedChildren` 集合中，并且只有在每个所拥有的子 agent Activation 完成 `AgentHandle` dispose 之后才会 dispose（子先于父）。拆卸会先自顶向下传播 Agent 取消，再等待缓慢的后代，而 handle 释放仍保持 child-first。顶层及其他非继续执行的 Agent 没有 Activation，处于该等待图之外。最终结算会在 dispose handle 前等待 best-effort 的 `ctx.sessions.flush(child.session)`。listener rejection 会被记录，但不会使 Activation 失败，因为 listener 是否参与无法标识持久化后端；因此，恢复时持久化状态可能缺失或陈旧。

## 生命周期事件

服务会为每次一次性运行以及每个已驻留的可继续 Activation 时段发出一对 `subagent/start`/`subagent/end`，因此可继续子 agent 可用与一次性运行相同的词汇观察，且不会暴露管理器是物化、唤醒还是冷恢复了它们。对于一次性启动，它会在同步的 `subagent/start` 之前附加结果观察器，因此即使子 agent 已经结算，也仍会先产生 `subagent/start`，再产生 `subagent/end`；在驻留前失败的可继续时段不会发出这对生命周期事件中的任何一个。这对事件共享服务生成的 `runId`；`local` 标志取自提供方准确 `localAgent` 的快照（可继续子 agent 恒为 true），因此观察器绝不会从可复用的提供方/会话名称推断运行身份或本地性。`provider` 字段包含子 agent 初次创建时记录的提供方名称，不表示该提供方当前仍在注册：已接受的一次性 run 可在提供方移除后才结算；冷恢复时段会从描述符读取初始提供方名称，不会调用或注册该提供方。

运行事件受执行委派的父级作用域约束。每个监听器都独立隔离：同步抛出或返回的 promise 被拒绝时，只会记录日志，不会阻塞同级监听器或改变运行。

提供方新增和移除还会发出 `subagent/provider-added` 与 `subagent/provider-removed`。面向模型的工具等消费方使用这些事件，因为 Cordis 可能并发加载同级插件；配置顺序不能证明注册顺序。

可继续子级不会创建 `SubagentRun` 或 Task。继续执行管理器为每个驻留子 Session 直接拥有一个仅存在于当前进程的 Activation 和一个留存的 `AgentHandle`，使用 Agent inbox 作为唯一 FIFO，并从持久化描述符冷恢复。父到子投递由确切在线的直接父级身份授权。上报则由确切在线的子级身份授权；管理器根据持久化的 `parentSession` 推导接收方，`MessageSource` 记录发送方，但不授予权限。中断权限被刻意设计得比投递权限更宽：人类出示持久化直接 parent 地址，因此即使 parent Agent 离线，在线 child 仍可被停止；Activation 物化时记录的任何确切在线 ancestor 也可以停止其后代，因为停止一个轮次是幂等的，且不投递任何内容。

当 `ctx.sessionProjections` 可用时，服务会注册两个投影单元。`subagentTiming` 会在每个描述符处重置，使 fork 种子中的祖先工作不会计入 child 总量，随后累加 `turn/start` → `turn/end` 活跃时间，并为未结束的轮次保留同一切面的 `active.since` 和 `active.through` 边界；在该轮次保持未结束期间，`active.through` 会跟随最近折叠的事件，从而为 inactive 消费方提供保守的崩溃上界，又不会混入更新的会话元数据。`subagent` 以同样的 last-wins 重置纪律从 `subagent/descriptor` 事件折叠持久化身份——模式与创建标签——因此 fork 种子中的祖先描述符只在 child 自身的描述符覆盖之前有效；畸形或版本不识别的载荷折叠为可序列化的 `null` 哨兵——与没有描述符的日志不可区分，且能完好通过每个 JSON 推送帧，让消费方以之替换掉手中过时的身份而非永久滞留——绝不抛错。

`registerContinuableSetup()` 允许可选包添加子级作用域能力，而无需让继续执行管理器知道这些能力的名称。贡献会在 Activation 发布前同步安装，在设置失败时一并回滚，并随子级作用域释放。新授权须等到下一个 Activation，移除贡献则会立即撤销每个驻留安装项。

## 收集模型

面向模型的工具默认同步收集：先等待子 agent 结果，再 dispose 运行，然后才返回。一次性后台委派会在工具中注册普通 Task，其通用状态、收集和取消工具负责后续交互，并将模型提供的 `description` 持久化为可选显示标签。可继续后台委派会调用 `ctx.subagents.startContinuable()`，只返回持久化子 agent id；子 agent 自 inbox 接受起就拥有自己的轮次，因此没有 Task、也没有结果 promise——调用方通过 `send_message` 后续操作工具发送后续工作，`interrupt()` 只停止当前轮次而不 dispose 子 agent，而持久化子 agent Session 仍是子 agent 详细输出的来源。只有 `ctx.agents` 可用时，继续执行管理器才会存在，而会话持久化按每项继续执行操作解析。与此独立，`listChildren()` 枚举在线会话存储与可选会话持久化的在线优先合并——持久化缺席时仅枚举在线 child，因为那时冷 child 本就无法恢复——并由已注册的 `subagent` 投影单元供给每个 child 的持久化模式与标签：在线 child 取注册表的水位快照；冷 child 先取可选投影缓存的持久化行，且仅当其 `seq` 门证明该值折叠自 child 自身后缀（fork 种子之后——自有描述符一经追加即不可变）才直接采用，否则经一次有界并发的持久化 inspect 再经注册表折叠，且 inspect 结果必须仍指向枚举时的生命周期（同 id 被重新发布的会话降级为 `corrupt` diagnostic）。缓存读取抛错不产生判决——缓存是派生数据——静默落到该权威重折。投影折叠是唯一的分类权威；列表自身不解析任何描述符。取得身份值即产出 child 行；已定局而折叠未产出身份的候选是 `corrupt` diagnostic，inspect 失败是瞬时的 `unavailable`（下次列表重试），运行中而暂无身份值的候选整行省略（描述符尚未追加的创建窗口）。它不查询继续执行管理器、Agent 注册信息、Activation 或提供方。每个 child 行都会根据合并结果中携带持久化 `origin: 'subagent'` 的 header 派生读取时的 `hasChildren` 提示；它不会读取后代事件日志，展开后仍以描述符支撑的 child 目录为权威依据。UI 等服务消费方可以保留两种模式，并为无标签的一次性 child 选择回退展示；面向模型的 `list_agents` 工具只投影 `continuable` 条目，通过在线 Agent 注册表细化状态（`running`／`idle`／`complete`），并在 `descendants` scope 下遍历 `listDescendants()`。列表操作会把调用方的取消信号转发到每次持久化读取，在这些 await 前后检查取消，并将每次检测到的中止报告为 `SubagentError` 错误码 `CANCELLED`；投影注册表未挂载则以 `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE` 响亮失败，会话存储缺失则以 `SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE` 响亮失败。完整约定见[后台 subagent 任务 Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-background-subagent-tasks.md)、[可继续后台 subagent Agent Note](../../../.agents/notes/implemented/feature/2026-07-21-continuable-background-subagents.md)、[持久化目录 Agent Note](../../../.agents/notes/implemented/feature/2026-07-22-durable-subagent-catalog-and-list-agents.md)、[服务合并 Agent Note](../../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.md)、[能力 seam Agent Note](../../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md)和 `src/types.ts`。

可继续 Activation 会等待 best-effort 的最终会话 flush，但不会把 listener 参与视为持久性确认。一次性运行保留尽力执行的会话检查点，因此已完成的一次性 child 只有在其会话确实进入持久化存储时，才可在 dispose 后继续被发现；如果该检查点缺失，服务不会根据 Task 历史虚构目录条目。

## 模型体验

通过 `dsh-tool-subagent`、`dsh-tool-subagent-control` 和 `dsh-tool-subagent-report` 间接产生影响。第一个工具负责委派 schema，第二个负责父级延续和发现，第三个只向可继续子级作用域贡献 `report`。

#### KV Cache 影响

不会直接使缓存失效；具名消费方共同负责请求前缀的任何变化。

## 已知限制与暂缓事项

- **ACP 子 agent 仍为一次性，且无法通过追踪枚举**：ACP 运行在 parent 会话语料中没有本地 child 会话。ACP 的 `prepareContinuable` 需要在提供方专用描述符数据中持久化远端会话 id，以及逐子 agent 的继续执行能力声明，因为 ACP 的 `loadSession` 支持按子 agent 协商，而不是通过方法是否存在来确定。远程提供方还需要一份独立的 Activation 所有权约定，具备等效的经认证控制和子先于父的停稳保证，才能支持可继续子 agent。
- **无 host-user 继续执行**：`followup()` 要求确切在线直接父级。只有 `interrupt()` 接受持久化 parent 地址形式的用户授权，因为停止一个轮次是幂等的且不投递任何内容；未来 host 适配器需要具体的经认证交互，才能让该 seam 获得用户投递能力。
- **不对当前轮次进行 steering**：可继续消息和唤醒式 report 会排入后续轮次，均不会重定向正在进行的轮次。
- **取消收敛期间存在唤醒缺口**：中断信号发出后、活动 driver 进入 idle 前被接受的唤醒型 follow-up 会保持排队，直到另一条唤醒发送到达。Issue #1838 负责 agent-loop 的唤醒锁存；普通会话取消也受此影响。
- **驻留仅限进程内**：Activation inbox 与所有权图不会在两个 harness 进程之间协调；对单个持久化存储的并发访问仍然需要持久化邮箱和跨进程租约协议。
- **不重放已接受但未记录的消息**：只有写入子 agent Session 日志的消息才能连同提供该消息的来源一起重建。崩溃可能丢失从未写入日志、已被接受的初始提示词或后续消息；此后一条经授权的消息可以冷恢复该子 agent，但丢失的消息不会自动重放。
- **没有持久化的上报 mailbox**：上报需要实时直接父级，提供的是接受标识，不保证恰好一次投递，也不提供已读回执。
- **生命周期事件只供观察**：影响运行的 `subagent/end` 延续或决策接口仍需等待具体消费方。
