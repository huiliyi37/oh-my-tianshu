# @deepseek-ai/dsh-tool-tasks

[English](README.md) | 中文

`ctx.tasks` 的面向模型控制表层：三个与 kind 无关的工具、完成通知和一个后台工作提示词区段。加载该插件会附加 `ctx.tasks.start()` 所要求的表层。

## 工具

- `task_output(task_id, wait?, timeout_ms?)` 默认以非阻塞方式读取。流任务只返回下一个增量；最终输出任务在终止后返回结果。每个响应都以 `[status: ...]` 结尾。`wait: true` 最多等待到配置上限，超时时仍让运行中的任务保持存活。
- `task_list()` 以 `<id> [<kind>] <status> — <label>` 返回调用方可见的任务。
- `task_kill(task_id, reason?)` 立即请求取消并转发已记录的原因。终止任务返回非消费式快照。

三个工具都使用通用 UI 卡片：output 和 list 使用 `read`，kill 使用 `execute`。

它们的规范值依次为 `{ text, task }`、`PublicTaskSnapshot[]` 和 `{ outcome: 'cancellation-requested' | 'already-finished', task }`。公共快照携带 id、kind、label、status/detail 及开始／结束时间；它有意省略 `ownerSession` 和内部 `reported` 通知位。原生 renderer 保留上述状态与确认文本。

当生产方提供 `outputLimitBytes` 时，`task_output`、针对已终止任务的 `task_kill` 和完成通知会在添加状态或通知文本后，对完整的原生 UTF-8 结果施加上限。只要能够容纳，读取就会保留输出尾部与控制后缀；有界完成通知则先为 `background task <id>` 和 `task_output` 收集指令预留空间，再把剩余字节用于可变的 kind、label、status、detail 与截断标记。一个前置 pre-execute 监听器会在策略运行前捕获调用方可见任务；每个任务控制定义的 final-content 回调会把其生产方上限应用到单文本拒绝、短路、规范化工具或流水线失败、替换和阻止；结构化多块策略结果保持自身形状。已有的生产方截断标记会复用，不会重复添加。省略该字段的生产方保留现有的无界控制表层行为。

## 完成通知

一项尚未报告的完成会把 `background task <id> (<kind>: <label>) finished [status: ...]. Read its output with task_output.` 注入到确切所有者的 next-step inbox。应用上限时，即使采用 PTY 支持的 64 字节下限，稳定 id 前缀和收集命令的优先级也高于可变 label/detail，因此通知仍可操作。注入是等待后续 pre-step 领取的持久上下文，并非唤醒；取消或 owner 释放可能在领取前丢弃它。kill 或针对已终止任务的 read/wait 会把交付标为已报告，并抑制重复通知。

## 配置

| key | 默认值 | 含义 |
|---|---|---|
| `waitTimeoutMs` | `30000` | `wait: true` 省略 `timeout_ms` 时使用的等待时间 |
| `maxWaitTimeoutMs` | `600000` | 模型所给等待时间的上限 |

默认值高于上限时，插件会在加载时失败。

## 模型体验

### 系统提示词

#### 模型看到的内容

该插件注册 scope 中的每次请求都包含以下指引。按 agent（智能体）scope 过滤工具时，可能会隐藏工具，却不会移除独立注册的提示词区段。

##### 后台任务指引

```markdown
Track every background task id you start. You are notified in-session when a task finishes — do not busy-poll or sleep on one; keep working on independent steps and do not duplicate a running task's work. Before giving a final answer, collect every still-relevant task with task_output (set wait: true only when you are genuinely blocked on it), and task_kill tasks that stopped mattering.
```

#### Token 影响

激活期间，每次请求都会产生少量固定的输入 token 开销。

#### KV Cache 影响

只要插件 scope 与指引文本不变，前缀就保持稳定。激活或释放可能使从该提示词区段起的复用失效。

### 工具 schema

#### 模型看到的内容

该表层可见时，会看到生成的 [`task_output`、`task_list` 和 `task_kill` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-tasks)。

#### Token 影响

工具可见时，每次请求都会产生固定的 schema token 开销。

#### KV Cache 影响

只要工具定义与可见性不变，前缀就保持稳定。注册生命周期或 scope 限制可能使从第一个发生变化的 schema token 起的复用失效。

### 结果与通知

#### 模型看到的内容

读取会返回输出或 `(no new output)`，随后是 `[status: <status>]` 和可选 detail。空列表返回 `(no background tasks)`。kill 返回 `requested cancellation of task <id>` 或现有终止状态。尚未报告且有 owner 的任务完成时使用上述通知。

#### Token 影响

结果与通知在压缩（compaction）前保留于父级历史。流读取不会重复已消费的输出；生产方提供的 `outputLimitBytes` 会限制每次完整读取或通知。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV-cache 条目失效。

## 已知限制与暂缓事项

- **完成通知不会唤醒空闲 agent**：需要立即获得结果的调用方必须使用 `task_output`。
- **流读取只有单一消费方**：独立观察者需要另一套运行时 API。
- **无 owner 的任务没有会话隔离**：外部表层必须提供调用方策略或避开这些任务。
