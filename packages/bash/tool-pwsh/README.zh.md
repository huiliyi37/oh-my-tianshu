# @deepseek-ai/dsh-tool-pwsh

[English](README.md) | 中文

注册在 `ctx.bash` 执行器 seam 之上的模型可见 `pwsh` 工具。面向由 PowerShell 执行器（如 `@deepseek-ai/dsh-pwsh-local`）支撑 `ctx.bash` 的 Windows 组合；工具约定是 PowerShell 方言：原生 `C:\...` 路径与 `$env:NAME` 变量。行为与 `dsh-tool-bash` 逐调用对齐、减去 sandbox 面——通过通用任务运行时执行前台与 `run_in_background`、通过共享 `bash-env` 注册表管理 `DSH_*` 环境、以及 bash 的 marker/截断渲染故事（干净退出不产生 marker）。

需要已加载的执行器实现与 `bash-env` 插件；两者都存在前工具保持 pending（`inject: ['tools', 'bash', 'systemPrompt', 'bashEnv']`）。

包根只导出 Cordis 插件约定（`name`、`inject`、`Config`、`apply`）；结果渲染（`src/render.ts`）与后台任务适配（`src/background.ts`）镜像 bash 工具的结构，并可通过包的 `./src/*` 导出访问。

插件还贡献 `tool:pwsh` prompt section（order 105）：非零退出以 `[exit code: N]` marker 报告，Windows 上的中断以无 signal 的 exit 1 结算。

## 工具

### `pwsh`

| Arg | Type | Notes |
|---|---|---|
| `command` | string (required) | 通过 `pwsh -Command` 运行。调用之间不保留状态——用 `workdir`，不要用 `cd`。 |
| `description` | string (required) | 命令的一行主动语态摘要（5-10 词），仅用于 UI/日志展示——不影响执行。 |
| `timeoutMs` | number | 超时覆盖值（毫秒）。执行器应用其配置的默认值与上限。 |
| `workdir` | string | 本次调用的工作目录。默认取调用 agent（智能体）的会话 cwd（`session.header.cwd`），使每个会话在自己的工作区运行；相对 `workdir` 基于同一身份解析。 |
| `run_in_background` | boolean | 立即返回 task id；不适用超时。 |

`command`、`workdir` 与 `timeoutMs` 在执行前经 `ctx.bash.resolve()` 按执行器配置默认值解析。workdir 默认值在工具层于 `resolve()` 之前从调用 agent 的 `session.header.cwd` 取得——每次会话的 cwd 必须来自 `exec.agent`，因为 N 个会话共享一个执行器；仅当没有会话 cwd 时执行器才回退到自己的配置 / `process.cwd()`。

### Managed shell environment

每次前台与后台模型 pwsh 调用都会通过共享的 [`dsh-bash-env`](../bash-env/) 注册表收到一份新收集的受信任 `DSH_*` 环境：`DSH_HOME`（Harness 主目录绝对路径）、`DSH_SHELL=1`、agent 的 `DSH_SESSION_ID`，以及活跃持久化后端定位到 JSONL 时的 `DSH_SESSION_JSONL`。向 `ctx.bashEnv` 贡献 `DSH_*` 事实的插件对 pwsh 调用与 bash 调用一视同仁。快照通过专用的 `BashExecRequest.dshEnv` 通道传递；`process.env` 永不被修改。描述只教授通用的 `$env:DSH_*` 约定，而不是点名持久化相关的变量。

结果文本包含 stdout、可选的 `[stderr]` 段，然后是适用的截断、超时、signal 与退出 marker。干净退出（0、无 signal）不产生 marker；空体渲染为 `(no output)`。截断会链接一个安全的完整 spill 文件，或报告其不可用。超时独立于最终退出状态报告；非零退出仍是模型解读的结果而非 `isError`。Windows 上强制终止以无 signal 的 exit 1 结算，因此 `[killed by signal: …]` 在那里仅存在于 POSIX。只有基础设施失败——spawn 错误与中止（`tool call aborted`）——产生 `isError`。

规范成功形态是已完成前台进程的 `{ kind: 'foreground', ...BashRunResult }` 或已发布任务的 `{ kind: 'background', taskId }`。渲染器对后台 ack 精确保留 `started background task <id>`；编程消费者使用类型化字段而不解析渲染文本。

当 `run_in_background` 为 true 时，本插件在 spawn 前预检 `ctx.tasks.start()`，把调用 agent 注册为 owner，并将返回的 `BashProcess` 句柄适配为通用的 cancel/done/增量输出钩子。任务运行时拥有 id、跨会话隔离、完成通知、等待与清理；本插件只把 pwsh 退出事实映射进任务输出与结果明细。`enableRunInBackground: false` 会移除参数并在执行时拒绝强制的后台调用。

## UI presentation

工具拥有自己的 `presentCall`/`presentResult` 呈现意图。前台调用是携带命令、描述与可选 cwd 的 `terminal` 卡；`run_in_background` 调用是携带原始命令的 `generic` 卡，镜像 bash 工具的后台呈现。完成的前台结果同样是 `terminal` 卡：退出 marker 变成卡片的退出状态 pill（`exitCode`/`signal`），去 marker 的正文成为卡片输出——与 bash 工具的 terminal 卡故事完全一致，经由 `@deepseek-ai/dsh-bash` 的共享退出状态解析。后台 ack 与执行错误保持 `generic` 卡，以 `console` 围栏包裹渲染输出。这些 presenter 是纯函数且可重放。

## Model Experience

### System prompt

#### What the model sees

本插件注册作用域内的每个请求都包含下面的 pwsh 指引。作用域工具限制可以隐藏 schema，但不会移除这个独立注册的段落。

##### Pwsh guidance

```markdown
Non-zero exits are reported as `[exit code: N]` markers; investigate failures before moving on. On Windows a killed process settles as `[exit code: 1]` without a signal marker; treat a bare exit 1 after an interruption as a termination, not a command failure.
```

#### Token effect

插件激活期间每次请求的固定小额输入成本。

#### KV Cache effect

注册作用域与 prompt 文本不变时前缀稳定。插件激活或释放可能使该 prompt 段落的复用失效。

### Tool schemas

#### What the model sees

模型看到生成的 [`pwsh` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-pwsh)。按 agent 作用域的工具限制可以移除该 agent 的定义。

#### Token effect

工具可见的每个请求上的固定 schema 成本。

#### KV Cache effect

可见性与工具定义不变时前缀稳定。限制或配置变更可能从首个变化 token 起使复用失效。

### Foreground result

#### What the model sees

渲染器输出数据相关的 stdout 尾部，然后是可选的 `[stderr]` 与 stderr 尾部。条件行精确为 `[output truncated; full output: <path>]`、`[timed out after <timeoutMs>ms]`、`[killed by signal: <signal>]` 与 `[exit code: <exitCode>]`（仅非零退出）；空体渲染为 `(no output)`。

#### Token effect

调用前零结果 token。每个流的输出有界，而每条已发出的行保留在历史中直到压缩。

#### KV Cache effect

仅追加；新出现的内容跟随可复用的请求前缀，不会使既有 KV-cache 条目失效。

### Background result

#### What the model sees

后台启动精确渲染为 `started background task <id>`；随后的读取与状态通过通用 `task_output`/`task_kill` 工具流转，包括内存截断丢弃未读字节时的 lossy 读取 spill 通知。

#### Token effect

ack 是固定短行；任务输出按读取有界。

#### KV Cache effect

仅追加；新出现的内容跟随可复用的请求前缀，不会使既有 KV-cache 条目失效。

### Tool errors

#### What the model sees

校验与基础设施失败规范化为 `Error: <message>`。本包的稳定消息包括 `invalid command: expected a non-empty string`、`invalid description: expected a non-empty string`、`invalid timeoutMs: expected a positive number, got <value>`、`run_in_background is disabled for this deployment (enableRunInBackground: false)`、`background tasks unavailable: load @deepseek-ai/dsh-tasks and @deepseek-ai/dsh-tool-tasks` 与 `tool call aborted`。

#### Token effect

只有失败的调用会新增这些保留 token；被中止的调用不产生命令输出。

#### KV Cache effect

仅追加；新出现的内容跟随可复用的请求前缀，不会使既有 KV-cache 条目失效。

## Known Limitations and Deferred Work

- **无 sandbox 升级** — 没有 `sandbox_permissions`/`justification`；升级等待 Windows-confining 执行器（bash 工具的 sandbox 面不被镜像）。
- **无持久 shell 或 PTY** — 每次调用都启动全新的 `pwsh -Command`；PTY 后端目前仅限 Linux/macOS，Windows ConPTY 持久 shell 属于路线图工作。
- **PowerShell 方言约定** — 模型必须写 PowerShell（原生路径、`$env:` 变量），而不是 bash；没有方言翻译。
- **会话 cwd 身份不做规范化** — workdir 基座直接取会话头 cwd 原值，不同于 bash 工具经 sandbox-root 规范化的身份；此处只涉及无 sandbox 场景。
