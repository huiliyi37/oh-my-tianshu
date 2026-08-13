# Agent Note: 将 TUI agent 接入默认模型选择路由

Status: implemented

[English](2026-08-10-tui-agent-default-model-routing.md) | 中文

## 问题

每个 TUI 轮次都以 `agent … has no provider/model` 报错失败。`TuiApp` 创建 agent（智能体）时只传 `sessionId`：既不传 `AgentOptions.provider/model`，也没有 `agent/request` waterfall（瀑布式事件）参与者，而 headless 前门经由 `agentDefaultModel` 服务加 `installModelSelection` 路由。`tui` profile 组合已经在 `dsh-base` 之上挂载了 `@deepseek-ai/dsh-agent-default-model`，只是 runner 从未消费它。

## 决策

TUI 镜像 headless 的接线。runner 的 inject 列表新增 `agentDefaultModel`。`newSession` 传入来自 `currentSelection()` 的 `agentOptions: { provider, model }`，并在 `setup` 中安装模型选择，使提示词组装与请求路由耦合。`switchSession` 的恢复路径优先采用会话持久化的请求头路由（会话在重启之间保持其模型），仅当从未落盘过任何请求头时才回退到当前默认选择；这同时修复了在路由缺失期间持久化的会话。

## 备选方案

**恢复时应用当前默认选择，忽略持久化的请求头。** 不予采纳：恢复旧会话会让它在不同模型上静默继续，与会话日志已为其轮次记录的路由相矛盾。

**传 `agentOptions` 但不调用 `installModelSelection`。** 不予采纳：这偏离了其他前门的请求整形路径，并丢失模型选择钩子在组装期提供的 provider/model 变量。

## 影响

`@deepseek-ai/dsh-tui` 声明了对 `@deepseek-ai/dsh-agent-default-model` 的对等依赖（peer dependency）与开发依赖，外加一条 tsconfig 项目引用。在路由缺失窗口期创建的会话无需手工清理：恢复其中一个会话后，其下一个轮次会从默认路由落盘一条新的 `initial` 请求头。
