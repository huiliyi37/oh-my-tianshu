# 示例

[English](README.md) | 中文

展示 DeepSeek Harness 主要接口和扩展点的可运行演示。每个子目录负责自己的配置、前置条件、命令和详细行为。

## mcp-memory

通过通用 MCP 客户端连接受支持第三方记忆服务器的可选 overlay。详见[记忆示例参考](mcp-memory/README.md)。

## headless-agent

非交互式 agent（智能体）：接受一项任务并运行，然后以选定的机器可读或人类可读格式输出结果。详见[无头示例参考](headless-agent/README.md)。

## jsonrpc-agent

由 Python SDK 和 JSON-RPC 驱动的无人值守编码 agent。详见 [JSON-RPC 示例参考](jsonrpc-agent/README.md)。

## web-cordis

能够检查并更改内存中 Cordis 插件树的自指 agent。详见 [web-cordis 示例参考](web-cordis/README.md)。

## acp-agent

面向程序化客户端的 ACP（Agent Client Protocol）自动化服务器，支持会话、权限和取消操作。详见 [ACP 示例参考](acp-agent/README.md)。
