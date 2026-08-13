# Agent Note: 任务注册表是一个能力 seam（`dsh-tasks` / `dsh-tasks-local`）

Status: implemented

[English](2026-07-26-task-registry-seam.md) | 中文

## 问题

[后台任务运行时](2026-06-20-generic-long-running-tool-runtime.md)交付时把 `TaskService` 做成了单个具体包：`@deepseek-ai/dsh-tasks` 既拥有每个生产方和控制接口面向编程的 `ctx.tasks` 约定，也拥有进程内 Service provider（内存存储、结算簿记、所有者清理 effect、拆除）。这种捆绑重新耦合了仓库[能力 seam 规则](2026-06-13-capability-seams.md)本要分离的两种变化速率：一旦替换注册表的存储或生命周期后端，被搅动的就是同一个包，而生产方（`dsh-tool-bash`、`dsh-tool-pty`、`dsh-tool-subagent`）、控制接口（`dsh-tool-tasks`）和 `TaskKindMap` 扩展方正是从这个包导入类型与 `ctx.tasks` 接口。harness 中其余每项可替换能力——bash、pty、fs、skill（技能）、subagent、web、会话持久化——都已具备 Service Definition / Service provider / Consumer 三分；任务注册表曾是仅剩的 `core` 模式例外，仅由一条 `TODO(task-service-backend)` 注释把守。

## 决策

`tasks/` 如今是一个 bash 三件套形态的三包能力家族：

- **`@deepseek-ai/dsh-tasks`（Service Definition）**——抽象的 `TaskService extends Service`，拥有 `ctx.tasks`、八个方法的约定（`start`、`list`、`get`、`read`、`kill`、`wait`、`onTaskDone`、`attachSurface`）、全部词汇类型（`TaskId`、`TaskKindMap`、`TaskStart`、`TaskHooks`、`TaskOutcome`、`TaskSnapshot`、`TaskRead`、`TaskDoneListener`），以及快照不变式配套插件。类级 JSDoc 陈述了每个 Service provider 都必须兑现的语义：注册的存续期长于生产方与控制接口的 fiber，有所有者的访问以会话为界，结算遵循首次结果优先且监听器错误被隔离，并且在没有附加任何控制接口时 `start` 拒绝启动工作。
- **`@deepseek-ai/dsh-tasks-local`（Service provider）**——`LocalTaskService`，即原样迁移的进程内注册表：内存存储、按 kind 划分的计数器、等待方簿记、`TASK_WAIT_TIMEOUT` deadline 代码、所有者清理 effect，以及强制失败的拆除。`dsh-timeout` 依赖随之迁入此包；Service Definition 包不含任何提供方依赖。
- **`@deepseek-ai/dsh-tool-tasks`（Consumer）**——保持不变；它注入 `'tasks'`，从不导入提供方类型。

各组合在原先加载 `dsh-tasks` 的位置改为加载 `dsh-tasks-local`：CLI（命令行界面）的 cordis.yml 配置项、`agent-spine-demo`、各测试 harness，以及工具目录生成器的启动流程。生产方的配置错误诊断信息（「background tasks unavailable: load …」）点名 `dsh-tasks`——即声明缺失的 `ctx.tasks` 服务的 Service Definition 包；Service Definition 包自身的对外呈现（其 README 与直接挂载防线）会指向各 Service provider，因此当另一个后端日后成为推荐默认时，生产方的消息依旧正确。生产方、`TaskKindMap` 声明合并和控制接口仍然只导入 `@deepseek-ai/dsh-tasks`。

该 seam 保持进程内约定语义不变：`TaskStart.run()` 仍然传入回调和确切的 `Agent` 对象，因此持久化或跨进程后端在能满足此 Service Definition 之前仍有设计工作要做（身份、重启、所有权、观察）。这次拆分把该项未来工作移出了每个 Consumer 的依赖图；它并不预先设计后端。

## 曾考虑的替代方案

**在第二个后端出现之前保持具体服务（维持现状）。**这正是运行时 Agent Note 当初的立场：在第二个 Service provider 出现前抽取 Service Definition，可能固化错误的边界。该方案落选，因为这条边界已不再是臆测：八个服务方法及其语义自引入以来在每一次生产方集成中都保持稳定，它们正是 `dsh-tool-tasks` 与各生产方已经面向编程的那套接口，而且仓库约定默认将可替换能力拆成三个包。剩余风险（持久化后端可能需要变更约定）不因这次拆分而改变：无论拆分与否，这类变更都会落在 Service Definition 包里；而若维持现状，它们今天还会连带搅动每个 Consumer 的提供方依赖。

**在单个包内仅抽取 Service Definition（在具体类旁导出一个抽象类）。**否决，因为它在运作层面并未分离任何东西：Consumer 依然依赖携带 Service provider 及其依赖项的那个包，而替换后端若不把本地 Service provider 纳入自身依赖图，就仍然无法发布。在这里，包边界才是独立演进的单位。

**拆出 `types.ts` 但让服务保持具体。**基于同样的理由否决：类型并不是完整能力，`ctx.tasks` Service Definition 及其方法约定才是。生产方需要的是服务键和语义，而不只是类型形状。

## 后果

换来的是：任务注册表如今与全仓库通行的 seam 形态一致；持久化、远程或带插桩的注册表将是一个实现八个抽象方法的同级 Service provider，这样的注册表落地时，任何生产方、控制接口或 `TaskKindMap` 扩展方都无需改动。Service Definition 的 README 陈述约定；生命周期簿记方面的事实归 Service provider 的 README 所有。注册表行为测试套件（所有者清理、结算、等待、拆除）随 `dsh-tasks-local` 存放；Service Definition 包保留一个桩子类（stub subclass）测试，固定 `ctx.tasks` 下的注册行为与单一服务的重复注册行为，外加基于探针的不变式测试套件。

代价是：多出一个包，即多一份 manifest（元数据清单）、tsconfig、README 与不变式配套插件；同时各组合必须点名 Service provider 包。`abstract` 在运行时会被擦除，而这个包名过去正是可挂载的具体注册表，因此直接挂载 Service Definition 时，其构造函数会明确报错——一条陈旧的组合配置行会在加载时得到「load a Service provider such as @deepseek-ai/dsh-tasks-local」，而不是一个未完整注册的 `ctx.tasks` 在远离错误配置处才失败。
