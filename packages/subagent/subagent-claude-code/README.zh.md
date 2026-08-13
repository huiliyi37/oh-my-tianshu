# @deepseek-ai/dsh-subagent-claude-code

[English](README.md) | 中文

本包（package）注册固定的 `claude-code` subagent 提供方。每次接受运行请求后，它都会在发起委托的会话工作区中调用官方 Claude Agent SDK，通过共享子进程服务启动 SDK 分发的 Claude Code CLI，提交一个自包含的文本任务，并通过共享的 [`dsh-subagent`](../subagent/README.md) 结果约定仅返回最终答案。

## 启动与所有权

`start(request)` 只接受非空的文本块序列，并根据父会话确定子级 cwd。它会创建一个私有 `AbortController`，调用官方 SDK 的 `query()`，并仅在 SDK 的 `spawnClaudeCodeProcess` 钩子已经提供由 [`dsh-subprocess`](../../subprocess/subprocess/README.md) 管理的活动 CLI 句柄后发布此次运行。若在发布前发生失败或取消，它会关闭 query、终止所有已取得的进程树并等待其退出，然后拒绝 `start()` 调用。

SDK 接收由文本块原样拼接成的任务。提供方会完整迭代 SDK 消息流，而且只接受满足以下条件的 `result` 消息：其 `subtype: "success"`、`is_error: false` 且 `result` 非空白，之后迭代器还须正常结束。所有 SDK 错误子类型、标记为错误的成功消息、缺失答案、迭代器失败、协议失败或进程失败都映射为 `error`；本版本不会产生 `max-tokens` 或 `refusal`。

本地取消会在结果竞态中胜出并映射为 `aborted`。`dispose()` 具有幂等性：它会中止此次运行、请求 SDK query 关闭、调用共享的进程树逐级终止机制，并等待整棵进程树退出。SDK 的优雅关闭只表达协议意图；进程是否完全停稳仍以子进程句柄为准。结果失败与独立的清理失败仍彼此分离。

## 原生设置与交互

提供方故意省略 SDK 的 `settingSources` 选项。因此，官方 SDK 会相对于父会话 cwd 读取宿主机常规的用户、项目和本地 Claude 设置，包括原生账户状态与产品配置。提供方既不复制也不过滤这些文件，也不会创建或修改登录状态。

每次 query 都设置 `persistSession: false` 并禁用 `AskUserQuestion`。提供方不设置 `canUseTool`、elicitation 或对话回调，因此无人值守交互会经 SDK 失败，而不会等待本提供方不负责的用户界面。

## 能力与上下文

本提供方不声明任何可选的启动时能力，并报告 `inheritsParentContext: false`。Claude Code 会接收独立文本任务和父会话 cwd，但不会接收父会话的对话、角色设定、工具筛选器、深度策略或结构化输出约定。每次运行都拥有独立的 SDK query、取消控制器、CLI 进程和不持久化的产品会话。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `env` | `{}` | 显式指定的 SDK/CLI 环境，叠加在由共享机制清除凭证后的父环境之上。 |
| `disposeGraceMs` | `3000` | 共享进程树责任方各终止层级之间的宽限期，单位为毫秒且须为正有限值，并不得大于仓库共享的 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)；随后资源释放会等待整棵进程树退出。 |

生产环境使用 `@anthropic-ai/claude-agent-sdk` 提供的 Claude Code CLI，以及宿主机原生设置与身份验证。本插件不安装另一份 CLI、不选择模型、不创建产品主目录、不执行登录，也不探测账户。具有凭证特征的环境变量会在显式 `env` 覆盖生效前被清除，因此供子进程使用的 API 密钥或 token 必须在该配置中显式提供。除非被覆盖，`ANTHROPIC_BASE_URL` 等非凭证端点变量以及 `PATH` 和 `HOME` 等普通环境变量仍会被继承。

请安装此包，并将以下配置项添加到你自己的 `cordis.yml`。正式 CLI 配置默认不会加载此提供方，也不会暴露 `subagent_claude_code`。

```yaml
- id: subagent-claude-code
  name: '@deepseek-ai/dsh-subagent-claude-code'
  config:
    env:
      ANTHROPIC_API_KEY: !!js process.env.ANTHROPIC_API_KEY

- id: tool-subagent-claude-code
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: claude-code
    toolName: subagent_claude_code
    enableRunInBackground: false
    maxDepth: provider-managed
```

## 产品兼容性与证据

运行时依赖精确锁定为 `@anthropic-ai/claude-agent-sdk@0.3.220`，其平台可选依赖提供 Claude Code 2.1.220。强制证据会通过无密钥回环产品路径与带密钥 DeepSeek 路径运行该官方发行版，而 Loader 组合则证明两个选择启用的产品包能够共存，且不会启动任一产品。

项目所有者按身份范围授权分发官方 SDK 及每个 SDK 版本声明的官方 CLI／平台载荷。[`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md) 会披露当前可选载荷闭包，但不会把其声明条款归类为宽松许可证；其他无关的非宽松运行时依赖仍会使第三方声明门禁失败。

## 模型体验

### 子任务请求

#### 模型看到的内容

Claude Code 子任务会在一个全新的 SDK query 中接收独立文本任务。它的工作区是父会话 cwd；其模型、系统指令、工具、权限和身份验证来自宿主机原生 Claude 设置与产品安装。

#### 对 token 的影响

子任务需为独立的 Claude Code 上下文和 query 承担 token 开销。子任务 token 不会进入父级上下文。

#### 对 KV Cache 的影响

这与父请求缓存相互独立。能否复用只取决于 Claude Code 自身的模型、指令、工具、原生设置和全新 query。

### 父级工具结果（间接）

#### 模型看到的内容

通过 `dsh-tool-subagent`，父级模型只会看到符合严格成功条件的 Claude Code 最终答案，或者在结果未完成时看到消费方给出的原样错误。Claude Code 的推理、工具活动、中间消息、stderr、工作区差异、用量信息和产品标识符均不会复制到父会话。

#### 对 token 的影响

父级输入只会增加工具结果中保留的最终答案或错误内容。本提供方自身不添加父级工具 schema。

#### 对 KV Cache 的影响

仅追加：新的工具结果接在可复用的父请求前缀之后。

## 已知限制与后续工作

- **每次运行均新建一个 query 和一个进程**：不支持续接、恢复、池化、进度流或产品会话持久化。
- **宿主设置有意保持权威**：项目和用户设置可以改变模型、工具与行为；本提供方不提供经过筛选或与宿主环境隔离的生产模式。
- **产品安装与账户状态仍由原生机制管理**：不兼容的 SDK 载荷、配置错误或身份验证失败都会呈现为启动错误或运行错误；本插件不提供安装程序或登录流程。
- **没有人工交互路径**：`AskUserQuestion` 被禁用，其他交互回调也不存在，因此需要新审批或输入的任务会失败而不会挂起。
- **仅返回最终文本**：推理、中间消息、工具通信、用量信息、stderr 和工作区差异仍只保留在产品内部。
- **没有可选的共享能力**：对于本提供方，共享服务会拒绝输出 schema、子任务角色设定、工具筛选和 harness 深度强制约束。
- **没有按实际经过时间触发的超时或副作用回滚**：长时间运行的工作由调用方取消，且取消前已更改的文件或外部系统不会恢复原状。
