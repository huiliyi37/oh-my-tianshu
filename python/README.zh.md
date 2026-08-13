# DeepSeek Harness Python SDK

[English](README.md) | 中文

用于以子进程方式驱动 DeepSeek Harness 的 Python 包。客户端 SDK 通过 stdio 上按行分隔的 JSON-RPC 与内置运行时通信。

## 包

| 目录 | 分发名 / 模块 | 职责 |
|---|---|---|
| [sdk](sdk/README.md) | `deepseek-harness` / `deepseek_harness` | 高层轮次 API 与低层 JSON-RPC 客户端 |
| [sdk-runtime](sdk-runtime/README.md) | `deepseek-harness-runtime-bin` / `deepseek_harness_runtime` | 内置运行时二进制与默认 agent（智能体）配置 |

## 行为

除非调用方选择显式通道，否则 SDK 会启动匹配的内置运行时。客户端负责选择通道和注入默认配置；运行时本身始终要求显式配置。完整的解析与配置约定分别由 [SDK 参考](sdk/README.md)和[运行时载体参考](sdk-runtime/README.md)定义。

## 贡献者工作流

[Python 贡献者工作流](development.md)介绍运行时产物构建、包验证、源码模式开发和分发。
