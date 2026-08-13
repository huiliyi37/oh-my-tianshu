# DeepSeek Harness Python SDK

[English](README.md) | 中文

通过 JSON-RPC stdio 驱动 DeepSeek Harness 的 Python 子进程 SDK。运行时继承常规的 DeepSeek Harness 环境变量（如 `DEEPSEEK_BASE_URL` 与 `DEEPSEEK_API_KEY`），调用方可以直接用真实模型端点，也可以在跑基准测试时把它们指向本地代理。

安装 `deepseek-harness` 会同时安装版本完全相同的 `deepseek-harness-runtime-bin` 平台 wheel 包。因此常规入口不需要传可执行文件参数：

```py
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness() as harness:
    result = harness.run("Say hi.")
```

`DeepSeekHarness` 会保留延迟启动的运行时子进程，以供多次调用复用。请像上例一样将其用作上下文管理器，或在用完后显式调用 `close()`。

默认情况下，SDK 启动 `deepseek-harness-runtime-bin` 包内置的单文件 `dsh-jsonrpc-agent` 可执行程序，并通过 `DSH_CORDIS_CONFIG` 注入该包的默认配置（stdio JSON-RPC 服务器、`agent-core`、预载的 DeepSeek 适配器、配有显式组合语义检查点策略的 JSONL 会话持久化、本地 bash）。要运行自己的插件组合，请在配置里保留 `@deepseek-ai/dsh-jsonrpc` 条目，并传入 Cordis 配置路径。

```py
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cordis="examples/jsonrpc-agent/cordis.yml",
) as harness:
    result = harness.run("Make the requested code change.")
```

`provider` 用于选择当前 Cordis 组合已注册的提供方路由；`model` 是该适配器解析的模型 ID。`max_tokens` 是可选的正整数，用于限制根 agent（智能体）及其进程内后代每次请求的输出 token；省略时由提供方默认值控制。压缩摘要继续使用压缩插件单独配置的上限。内置默认组合注册 `deepseek-official`。自定义组合可以挂载 `llm-pi-ai`，在其中配置各提供方的凭据与端点，再选择 pi-ai 已安装目录中的任意提供方/模型组合。

`Session.run()` 拥有一个从提示词进入持久 inbox 时开始、到整个 agent 下一次进入空闲状态为止的活动区间，并返回 `RunResult(session_id, final_response, events, notifications, session_root)`。结果不携带提示词级状态或轮次原因：`final_response` 是该区间内根会话最后提交的助手文本，并非因果上归属于该提示词的输出。steering（中途引导）、注入的上下文和其他排队工作都可能在进入空闲状态前参与其中。

`HarnessClient` 会在运行时进程的生命周期内保留已发现的 subagent（子 agent）祖先关系。每次执行 `Session.run()` 时，`RunResult.notifications` 与 `on_notification` 会按协议传输顺序收到根会话及所有已知后代的通知，其中包括嵌套 subagent 的生命周期事件与会话事件。`RunResult.events` 只包含根会话事件，因此后代消息不会覆盖根会话回复。底层 `session_prompt()` 会立即返回已排队消息的 `MessageId`；绕过 `Session.run()` 的调用方必须自行负责后续的活动边界。

同样的行为也可以通过 `DSH_CORDIS_CONFIG` 为运行时子进程选定。注入逻辑位于 `HarnessClient.start()`，因此底层客户端的默认启动也具有此行为：当启动解析到内置运行时，且 `cordis` 与非空的 `DSH_CORDIS_CONFIG` 均未设置时（运行时把空值视为缺省，注入检查与之一致），使用内置的默认配置；显式给出 `runtime_bin`、`bridge_bin` 或 `launch_args_override` 则完全禁用注入。运行时载体（生产用 exe 与仅限开发的 `node` 闭包）及其获取方式见 [sdk-runtime README](../sdk-runtime/README.md)。

`cwd` 与 `runtime_cwd` 会在启动子进程、注入环境变量和协议握手前解析为绝对路径。公开 API 只暴露真正生效的选项：部署的角色设定与持久化配置归 `cordis.yml` 管理，而 `session_root` 继续作为设置 `DSH_SESSION_ROOT` 的高层便捷选项。
