# Tianshu Harness 架构

[English](architecture.md) | 中文

**Tianshu Harness SDK** 使用 Cordis：**一切皆插件**，循环也不例外。

## 概览

每个 harness 都是 [Cordis](cordis-primer.md) 上下文；各包贡献服务、类型化事件和可释放的注册项。`packages/core/` 汇集默认流程；各项能力仍以插件形式存在。

### 默认服务

| ctx 键 | 包 | 职责 |
|---|---|---|
| — | [`dsh-scope`](../packages/core/scope/README.md) | 作用域上下文注册项与共享层存储（库） |
| `ctx.sessions` | `dsh-session` | 内存中的事件溯源会话 |
| `ctx.systemPrompt` | `dsh-system-prompt` | 有序的提示词片段、工具 schema 和变量 |
| `ctx.tools` | `dsh-tools` | 工具注册表和[执行流水线](tool-execution-pipeline.md) |
| `ctx.agents` | `dsh-agent` | 活跃 agent（智能体）、委托创建、`agent/*` 事件、进程内发起方作用域 |
| `ctx.agentDefaultModel` | [`dsh-agent-default-model`](../packages/core/agent-default-model/README.md) | 由 Settings 支撑、供 Agent 入口共享的模型选择 |
| `ctx.modelRoles` | [`dsh-model-roles`](../packages/core/model-roles/README.md) | 由 Settings 支撑的 视觉/副模型/子代理 角色模型 pin |
| `ctx.agentLoop` | `dsh-agent-loop` | 具体 `Agent` 驱动器 |

### 能力服务

| ctx 键 | 包族 | 职责 |
|---|---|---|
| `ctx.llm` | [`llm/`](../packages/llm/README.md) | 适配器注册表和模型流式调用 |
| `ctx.tokenMeter` | [`llm/token-meter`](../packages/llm/token-meter/README.md) | 感知回放的请求压力与表面压力 |
| `ctx.bash` | [`bash/`](../packages/bash/README.md) | 前台和后台命令执行 |
| `ctx.subprocess` | [`subprocess/`](../packages/subprocess/README.md) | 可执行文件查找、受管进程树、终端 |
| `ctx.pty` | [`pty/`](../packages/pty/README.md) | 按 owner 隔离的持久化终端会话 |
| `ctx.sandbox` | [`sandbox/`](../packages/sandbox/README.md) | 通过 argv 包装和逐调用策略限制与宿主共享文件系统和内核的进程 |
| `ctx.sandboxPolicy` | [`sandbox/`](../packages/sandbox/README.md) | 共享沙箱策略归属点 |
| `ctx.codeRuntime` | [`code-runtime/`](../packages/code-runtime/README.md) | 执行模型编写的程序 |
| `ctx.fs` | [`fs/`](../packages/fs/README.md) | 执行世界路径、有界 I/O 和策略事件 |
| `ctx.lsp` | [`lsp/`](../packages/lsp/README.md) | 语义导航注册表 |
| `ctx.skills` | [`skill/`](../packages/skill/README.md) | skill（技能）提供方注册表和渐进式披露 |
| `ctx.web` | [`web/`](../packages/web/README.md) | 搜索与抓取提供方注册表 |
| `ctx.compact`，`ctx.toolResultPrune` | [`compact/`](../packages/compact/README.md)/[`compact-tool-result-prune`](../packages/compact/compact-tool-result-prune/README.md) | 摘要压缩（compaction）和可选的无模型结果裁剪 |
| `ctx.subagents` | [`subagent/`](../packages/subagent/README.md) | 具名委托提供方 |
| `ctx.planMode` | [`plan/`](../packages/plan/README.md) | 落日志的 plan 协作状态 |
| `ctx.tasks` | [`tasks/`](../packages/tasks/README.md) | 后台任务注册表和通用 `task_*` 控制 |
| `ctx.workflows` | [`workflow/`](../packages/workflow/README.md) | 脚本驱动的多 agent 编排 |
| `ctx.goals` | [`goal/`](../packages/goal/README.md) | 持久化的同会话目标 |
| `ctx.sessionPersistence` | [`session/`](../packages/session/README.md) | 会话日志的持久化存储 |
| `ctx.sessionQuery` | [`session-query/`](../packages/session-query/README.md) | 基于 SQLite 全文搜索的实时优先精确检索／过滤／追踪、经工作区授权的模型工具 |
| `ctx.sessionTitle` | [`session/session-title`](../packages/session/README.md) | 基于日志的回退标题和单个可选异步提供方 |
| `ctx.settings` | [`settings/`](../packages/settings/README.md) | 按插件划分的用户设置命名空间，分层叠加在装配条目之上 |
| `ctx.credentials` | [`credentials/`](../packages/credentials/README.md) | 具名密钥引用，按操作解析，绝不内联进配置 |
| `ctx.directoryPicker` | [`host/directory-picker`](../packages/host/directory-picker/README.md) | GUI 宿主目录选取（`native`／`browse` 交互） |
| `ctx.typert` | [`typert/registry`](../packages/typert/registry/README.md) | 生成的包反射和实时 Zod schema 的运行时注册表 |
| `ctx.typertGateway` | [`api/gateway`](../packages/api/gateway/README.md) | 通过 [API Gateway](api-gateway.md) 分发 TypeRT Remote 一元调用 |
| `ctx.invariants` | [`support/invariants`](../packages/support/invariants/README.md) | 按包名筛选包自有运行时检查的注册表 |

## 事件

事件就是服务的扩展 API（[子系统](subsystems/core.md)、[生产方与消费方映射](event-producer-consumer.md)）。

### 事件域

- **会话事件**是通过 `session/event` 发出的持久日志事实。
- **Agent 事件**携带活跃 `Agent`，用于 inbox、步骤、状态、请求、验证和续跑。
- **能力事件**无需导入循环即可附加策略和适配器。

### 拦截语义

waterfall（瀑布式事件）是环绕中间件：监听器通过 `next()` 委托；不调用它而直接返回会短路或接管（[语义](cordis-primer.md#cordis-waterfall-semantics)）。

## 默认循环生命周期

**会话**采用仅追加方式。一个**轮次**领取一条已排队的后续消息，等待前一轮次的检查点，并可与其共用 `running` 区间（[决策](../.agents/notes/implemented/simplification/2026-07-17-one-send-one-turn.md)）；注入不领取输入。一个**步骤**包含一次模型请求及其工具。新建与持久化恢复会先取得精确的未发布 `SessionPreparation`；只有基于该 Session 的私有设置准备完毕后，系统才会发布 agent 与会话（[决策](../.agents/notes/implemented/architecture/2026-08-05-session-preparation.md)）。[时序](agent-lifecycle.md)中的引号标记持久事件。

创建时若未提供 id，流程会生成 `<config-id>-session-<uuid>`；`sessionId` 用于恢复或创建会话，而 `resumeSessionId` 要求已有历史。恢复流程在发布前还原沿袭关系和委托深度；初始化失败会发出 `agent-loop/config-start-failed`。

### 轮次流程

```text
choose declarative identity and acquire fresh/restored SessionPreparation
  -> prepare private agent.ctx around exact Session -> await unpublished setup -> invoke optional synchronous setup commit
  -> enter session + agent -> session/created -> agent/created
  -> enable driving -> agent/session-start(source) -> start driver
forever:
  waking inbox insertion starts the driver before send returns
  -> emit agent/status(running) if starting an interval
  -> 'turn/start'
  claim next-step input plus one next-turn message
  -> emit agent/inbox/claimed({ message, turn }) for each claimed message
  -> agent/pre-step({ agent, messages, turn, step, signal })
    reject, empty input, cancellation, or listener failure
      -> the claimed batch stays removed; close the no-step turn; stop the driver
    enter -> step loop:
      'step/start'
      append the returned batch as separate 'user/message' events
      assemble ordered prompt and tool schemas -> snapshot derived messages
      agent/request (config only) -> resolve adapter defaults and mark defaulted fields + context capacity under turn signal -> log request/header (+ request/context on route change) -> llm/stream (frozen, registration-bound)
      'assistant/chunk'
      'assistant/message'
      schedule tool calls by ctx.tools.executionMode:
        exclusive -> barrier
        parallel -> rolling pool, <= maxParallelToolCalls; reclassify at start
        start -> 'tool/call' -> tools/pre-execute -> concurrent tools/execute
        model-order result -> ordered tools/post-execute -> 'tool/result'
      'step/end'
      tools owe another request or next-step inbox is nonempty
        -> claim -> agent/pre-step -> append entered batch -> continue
      otherwise agent/turn-stopping -> re-check the next-step inbox
    'turn/end'
  start the next waking queued message, or emit agent/status(idle)

idle inject:
  queue non-waking next-step context
  leave it pending until followup or steer wakes the driver
```

每个步骤都会组装有序的提示词片段、工具 schema 和变量；未知引用会使该轮次失败。`dsh-system-prompt` 负责身份和角色设定；循环提供 `provider`、`model` 和 `cwd`（[提示词归属](../.agents/notes/implemented/architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md)）。

`inject()` 将不会唤醒驱动器的上下文排入 `next-step`；空闲驱动器会让它保持待处理，直至 `followup()` 或 `steer()` 唤醒。工具执行后的 `additionalContexts` 使用同一个 inbox。`agent/pre-step` 的 payload 携带独占的已领取批次，以及即将使用的轮次、步骤和信号。拒绝则不进入步骤；进入则提供在 `step/start` 后追加的完整批次。空的工具续跑仍会经过 waterfall，其最终值一次性结算所有改写。

裁剪先于摘要；溢出重试必须取得持久进展。`agent/request-error` 可以授权使用冻结提示词进行同步骤重试；取消优先。适配器的 `retryPolicy` 使 normal mode 保持有界，always mode 则在专门恢复后重试（[压缩](../.agents/notes/implemented/architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md)、[重试基础](../.agents/notes/implemented/architecture/2026-06-21-bounded-llm-request-recovery.md)、[提供方策略](../.agents/notes/implemented/feature/2026-07-24-provider-retry-policies.md)）。精确事件顺序由生成的 [agent 生命周期](agent-lifecycle.md)定义；队列、steering（中途引导）、重试与取消机制由 [agent-loop README](../packages/core/agent-loop/README.md)定义。

### 失败边界

适配器选择、分发与迭代失败会成为 error 或 aborted 类型的终止 `finish` 分片。`agent/request-error` 接收请求坐标、标准化 `LlmFailure`、可用的重试策略和信号；middleware 与消费方错误仍在恢复之外。失败分片既不提交消息，也不提交工具调用。

其他故障使用 `agent/error`；取消和 dispose（资源释放）优先于恢复。在提交请求头之前，轮次信号会取消能力准备；尚未分派的工具会得到合成的 `tool/call`/`ABORTED_BEFORE_DISPATCH` 对。实际生效的 `cancel(cause)` 会在清空队列和中止前报告原因；空闲调用不发事件。abort 触发后、收敛前到达的唤醒输入会在 driver 的收敛边界执行，而 `disposed` 取消则将其停放（[取消收敛窗口唤醒锁存](../.agents/notes/implemented/bug-fix/2026-08-07-cancel-convergence-wake-latch.md)）。持久性以 `aborted` 区分取消，以 `disposed` 区分会等待完全停稳的拆卸（[决策](../.agents/notes/implemented/architecture/2026-07-16-explicit-turn-cancellation.md)）。

轮次和步骤事件均位于轮次边界内；loop 只会在轮次内从进入步骤的批次追加 `user/message`。轮次会在首次领取与 pre-step 之前打开，因此拒绝、空输入、取消或失败会关闭一个不包含任何步骤事件的持久轮次。独立的 `compact/* { turn: null }` 事件不占用轮次，其锁定时刻标记可以与 inbox splice 交错。重新加载会为中断的轮次合成结束事件；`session/end-seed` 区分陈旧的压缩遗留项与活跃锁。关闭后仅由 `agent/error` 报告故障。每个轮次有一个 [TurnEndReason](subsystems/session.md#why-a-turn-ended-turnendreasonmap)。

### Agent 句柄

`ctx.agents` 拥有 agent 并返回 `AgentHandle { agent, dispose() }`。插件使用 `send()`，或使用其 `followup()`、`steer()` 和 `inject()` 预设。`cancel()` 与 `whenIdle()` 控制生命周期，拆卸由需等待完成的 dispose 负责。后续消息的 `MessageId` 跟踪持久 inbox 的插入、领取与丢弃通知，而不标识提示词输出或轮次结束；只有完整活动区间的所有者才能将其概括为一次运行结果（[决策](../.agents/notes/implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.md)）。

### Agent 作用域

每个 agent 都拥有作用域化的 `agent.ctx`；共享存储会将其工具、提示词和命令条目叠加到全局条目之上，同时保留各领域视图（[决策](../.agents/notes/implemented/architecture/2026-07-12-scoped-layers-store.md)）。作用域监听器会过滤分派；贡献都会在撤销时等待清理完成。`CreateAgentOptions.setup(agentCtx)` 在发布前完成组合。类型化解析器从合并后的 `Events` 和 `scopeTarget` 推导载体检查（[语义门禁](../.agents/notes/implemented/process/2026-07-14-typescript-program-backed-semantic-gates.md)）。详情见 [agent 作用域](../.agents/notes/implemented/architecture/2026-07-08-agent-scope-contexts.md)和 [subagent 组合](../.agents/notes/implemented/feature/2026-07-12-subagent-persona-tool-filter-and-depth.md)。`AgentLoop` 在 `ctx.agents.withInitiator()` 内运行；私有编排会派生 `agent.session`，但轮次、步骤、信号、cwd 和权限仍保持显式（[决策](../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md)）。

## 状态

### 会话日志

会话日志是权威依据。`deriveMessages()` 投影出模型历史；原始 `assistant/chunk` 事件保证回放和 UI 保真。fork、恢复、transcript（文本记录）渲染、遥测和持久化均派生自该事件流。截断会回退日志并重置派生状态。

**模型可见 ⟺ 已记录**：在 `step/start` 进入的消息加上折叠后的 `request/header` 可以重建每个请求。该 header 会标记适配器默认值，使后续提议丢弃这些值并重新解析路由，同时不丢失显式设置。`request/context` 会在路由变化时另行记录与注册项绑定的提供方、模型及容量元数据；它不参与请求重建或 header 相等性判断。`dsh-agent-loop/invariant` 通过 `ctx.invariants` 断言可重建性（[可重建性](../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md)）。

持久性由插件负责。后端会将同步的 `session/event` 通知复制到固定窗口的持久化批次中；`session/flush` 会绕过等待，在请求与顶层工具分发之前执行，并在 `turn/end` 之后、另一个轮次或空闲状态之前执行。`SessionPersistence` 存储事件和 header 元数据；JSONL 默认采用带校验和的 Zstandard，SQLite 遵循同一约定（[检查点决策](../.agents/notes/implemented/bug-fix/2026-07-21-semantic-session-checkpoints.md)、[批处理决策](../.agents/notes/implemented/architecture/2026-08-08-bounded-session-persistence-write-batching.md)）。

在轮次之间，事件所有方通过 `Session` 追加纯日志事件，仅为持久性而刷写。`session/title` 依赖有界后台持久化与生命周期排空；手动压缩会在操作完成前 flush 其标记对。标题工作绝不延迟响应；最新的标题事件生效，并记录来源消息 seq，以及标题由用户、后备逻辑还是提供方提供。标题记录是可继承的 fork 边界（[决策](../.agents/notes/implemented/feature/2026-07-21-log-backed-session-titles.md)）。

### 模型内容

消息使用从可合并扩展的 `ContentBlockMap` 派生的类型化块；同一模式也为 `MessageSource`、`FinishReason`、`TurnTrigger` 和 `TurnEndReason` 定义类型。新增块会协调适配器、UI、压缩、token 计量和持久化；回放计量见 [token-meter.md](subsystems/token-meter.md)。

流式输出使用原始分片和 `BlockAssembler`。每次 `LlmAdapter.stream()` 调用代表一次提供方尝试；适配器报告标准化的故障事实，负责处理的 `agent/request-error` 插件会返回重试动作。循环会记录分片、成功使用的提供方／模型路由和回放状态。远程适配器使用逐次读取空闲看门狗。回放仅通过共用的适配器实例跨路由传递（[约定](subsystems/llm-streaming.md)）。

## 扩展与组合

### 能力模式

一个 **seam** 是一项包含 **Service Definition**、**Service provider** 和 **Consumer** 三种角色的可替换能力。包可以合并承担多个角色；任何单一角色都不是 seam。文件系统与进程管理提供方共享一个执行世界，Bash、PTY 和 LSP 都在其中运行，无需提供方专用 fork（[能力图](capability-seams.md)）。

例外情况包括 LLM（大语言模型）Service Definition／消费方角色合并、文件系统策略、web 注册表，以及 skill/subagent 提供方。subagent 可以通过 spawn 创建全新实例、fork 一个已完成轮次的前缀、使用 ACP（Agent Client Protocol）子 agent，或将一个独立完整的轮次委派给 Codex 或其他产品提供方（[subagent.md](subsystems/subagent.md)）。

`dsh-workspace-context` 在第一次 `agent/pre-step` 组合基线并将它折入最终进入的批次、紧随已领取的直接提示词之后，使其与直接提示词一同抵达第一次请求；reject 则将它留在 next-step inbox。当压缩从可见表层移除该基线时，下一次进入步骤的 pre-step 会组合当前基线，并在同一请求中携带它。工具执行后投影的文件系统变更也会折入下一次进入步骤的 pre-step，而不会另外创建稍后的纯上下文步骤（[决策](../.agents/notes/implemented/feature/2026-06-24-workspace-context.md)）。`dsh-paths` 负责共享路径。

### 组合包与应用

`dsh-agent-spine-demo` 组合一套主干和可选目标。应用包负责 CLI（命令行界面）、ACP 自动化入口和 JSON-RPC 入口（[README](../packages/examples/agent-spine-demo/README.md)、[acp/](../packages/acp/README.md)、[interaction/](../packages/interaction/README.md)）。`dsh-sdk-server-agent` 启动外部 `cordis.yml`；Python SDK 在配置缺失时提供默认项（[Python SDK](../python/README.md)）。轻量部署使用可替换后端和可选工具（[examples/](../examples/AGENTS.md)、[可运行接线](cookbook/extension-cookbook.md#runnable-wirings)、[图谱](graph-atlas.md)）。

### 新行为的归属位置

新行为附加到已有文档记录的扩展点；循环发生变更时，本架构图随之更新。

| 目标 | 机制 |
|---|---|
| 添加模型提供方 | 在 `ctx.llm` 上注册其适配器 |
| 添加面向模型的能力 | 在 `ctx.tools` 上注册；schema 加入提示词组装 |
| 添加 shell 执行 | 实现并注册 `ctx.bash` 后端；本地后端通过 `ctx.subprocess` spawn 进程 |
| 添加持久化终端执行 | 注册 `ctx.pty` 后端和 `dsh-tool-pty` |
| 添加用户命令 | 在 `ctx.commands` 上注册；适配器无需模型轮次即可发现并分派 |
| 添加后台工作 | 在 `ctx.tasks` 上注册；通用 `task_*` 工具负责收集或停止 |
| 添加文件系统访问或策略 | 实现 `ctx.fs` 提供方，或监听 `fs/*` 策略事件 |
| 限制 spawn 出的进程 | 使用 `ctx.sandbox` 后端；消费方在 spawn 前包装 argv |
| 拦截请求、工具或轮次 | 使用相应的 `agent/*` 或 `tools/*` 事件；`agent/turn-stopping` 是停止边界 |
| 强制验证或路由纪律 | 在工具/agent 事件上注册 guard 插件（`guard/` 家族） |
| 添加模型可见上下文 | 调用 `agent.inject()`，将带来源的上下文排入下一次获准请求 |
| 添加 UI 或编辑器集成 | 驱动 `ctx.agents` 并从 `session/event` 渲染 |
| Web Client Chat 节点 | 注册 `ConversationNodeDefinition` + keyed renderer |
| 添加持久会话状态 | 扩展 `SessionEventMap`；从日志渲染和回放 |
| 回退会话日志 | 调用 `Session.truncate`；持久化后端实现 `deleteFrom` |
| 添加异步会话标题生成 | 注册唯一的 `ctx.sessionTitle` 提供方 |
| 管理同会话目标 | 使用 `ctx.goals`；通过 `Agent` 和 `agent/*` 续跑 |
| fork 活跃会话 | 调用 `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| 将注册项限定到单个 agent | 使用其 `agent.ctx`（参见 Agent 作用域） |

[扩展实操手册](cookbook/extension-cookbook.md)将功能映射到能力；指南涵盖[包](cookbook/adding-a-package.md)、[工具](cookbook/adding-a-tool.md)、[LLM 适配器](cookbook/adding-an-llm-adapter.md)、[Chat 节点](cookbook/adding-a-conversation-node.md)和 [vendored 包](cookbook/adding-a-vendored-package.md)。
