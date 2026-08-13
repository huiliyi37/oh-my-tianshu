# @deepseek-ai/dsh-tasks

[English](README.md) | 中文

后台任务注册表约定（`ctx.tasks`）。抽象的 `TaskService` 及其词汇类型在同一份约定下为长时间运行的生产方提供共享 id、owner 隔离、读取、取消、等待、通知和清理；进程局部注册表位于 [`dsh-tasks-local`](../tasks-local/README.md)。生产方插件使用其不透明 id namespace 扩展 `TaskKindMap`。

## 服务约定

- `start(spec): TaskId` 验证控制表层、spec、确切且仍存活的 owner，以及可选的 `outputLimitBytes`（如提供则须为正数），然后只调用生产方的 `run()` 一次。启动方抛出异常时不注册任何内容；成功返回会直接提交，不再执行其他可能失败的步骤。
- `get(id, caller?)` 和 `list(caller?)` 返回非消费式快照。列表只包含调用方拥有及无 owner 的任务。
- `read(id, caller?)` 消费流任务的唯一游标；对于最终输出任务，则以幂等方式读取终止输出。
- `kill(id, caller?, reason?)` 在更改状态前调用生产方取消。取消抛出异常时任务保持运行；成功则把状态改为 `stopping`，并将终止交付标记为已报告。
- `wait(id, timeoutMs, caller?, signal?)` 返回终止快照，或在超时时返回存活快照。中止只会停止等待；一旦终止交付已向该等待方提交，终止结果优先。
- `onTaskDone(listener)` 观察每条终止记录及其精确 owner。监听器抛出的异常和产生的拒绝都会被隔离；系统不会等待监听器工作。
- `attachSurface(name)` 在其 effect 生命周期内声明控制表层。如果没有附加任何表层，`start()` 会在生产方执行前失败。

有 owner 的访问会比较任务的 `SessionId` 与调用方。`bash-1` 等 id 可预测，因此这道隔离是安全边界。无 owner 的任务向调用方开放，并持续到服务释放。

`outputLimitBytes` 是生产方拥有的模型呈现策略，会原样携带到快照中。控制表层在添加状态或通知元数据后应用它；注册表不会重写生产方输出，也不会为省略此字段的生产方虚构默认值。

实现还必须兑现约定的生命周期语义：注册的存续期长于生产方 fiber 与控制表层 fiber，owner 释放和服务释放会取消仍在运行的工作并等待守约的生产方，结算遵循首次结果优先（一条终止记录、一轮异常受到隔离的监听器通知，然后释放等待方）。

参见[任务类型目录](../../../docs/subsystems/tasks.md)、[运行时 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md)和 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-26-task-registry-seam.md)。

## 模型体验

通过生产方插件和 [`dsh-tool-tasks`](../tool-tasks/README.md) 间接影响；它们会渲染 task id、输出、状态、取消和完成通知。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **流输出只有一个消费游标**：独立观察者需要游标或快照 API。
- **前台工作无法转为后台**：生产方在启动前选择前台或后台。
- **约定是进程内的**：`TaskStart.run()` 传入回调和确切的 `Agent` 对象；持久化或跨进程后端必须先重塑身份、重启、所有权与观察语义，才能实现此 seam。
