# `@deepseek-ai/create-sdk`

[English](README.md) | 中文

用于 `npm create @deepseek-ai/sdk [directory]` 的交互式初始化器。目录／名称／描述都提供可见且可编辑的默认值。树形选择器用于选择功能，并通过 Right／Left 导航配置取值有限的选项；只有选中相应选项后才会询问密钥文本。本地插件创建提供 none／plugin／tool 三选一。

受支持的包接口是 `create-sdk` bin。包根不导出任何符号，也不导出 workflow、bin、source 或 package-manifest 子路径。

初始化器拒绝任何已经存在的目标路径，创建一个 `SdkProject` 编辑会话，验证并提交该会话，然后询问是否安装 NPM 依赖并构建。安装或构建失败时会保留生成的项目，并打印重试命令。

公开标志包括 `[directory]`、`--description`、`--provider`、`--base-url`、`--api-key`、`--model`、`--interface`、`--pm`、`--install`／`--no-install`，以及无头模式标志 `--config <path>`／`--config-json <json>` 和 `--json`。交互式标志会预填对应问题；无头 spec（`--config`／`--config-json`）会预先提供所有答案和功能方案，因此创建过程无需 TTY，并通过 `HeadlessPromptPort` 驱动；若缺少任何必填答案，该端口会明确失败。`--json` 会发送 NDJSON 生命周期事件（`done`／`action-required`／`error`），使 agent（智能体）能够补充其中点名的缺失输入并重新运行。

提供方可以选择 DeepSeek，也可以选择由 `llm-pi-ai` 支持的自定义端点。选择 DeepSeek 时只询问 API key，并使用公共端点与 `deepseek-v4-flash`；自定义端点还会询问 base URL。密钥为空时必须确认；系统会在 `.env` 中创建一个被注释掉的空变量，从而使提供方在为该变量填入值之前启动时明确失败。现有插件的默认值会被省略；必填 SDK 预设仍按所属包的 Config 保持类型约束。

## 模型体验

通过生成的项目组合及其所选运行时插件间接提供；此外，无头 `--config-json` + `--json` 接口允许 agent 端到端创建项目，并响应 `action-required` 事件。

#### KV Cache 影响

不会直接导致 KV Cache 失效；由具名消费方负责请求前缀变更。

## 已知限制与暂缓事项

- **无头本地插件**：无头 spec 会提供项目答案和功能方案；目前还不能在 spec 中表达本地插件脚手架（交互式 none／plugin／tool 选择），默认使用 none。
