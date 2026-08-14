# scaffold/：从另一进程驱动 Harness 运行时

[English](README.md) | 中文

本组包含从另一进程经由稳定通信协议驱动 Harness 运行时的客户端栈。

| 包 | 职责 |
|---|---|
| [`protocol/`](protocol/README.md) | 定义 SDK 运行时通信协议 |
| [`client/`](client/README.md) | 通过 TypeScript 客户端 API 驱动 Harness 运行时 |
| [`server/`](server/README.md) | 通过 stdio JSON-RPC 为进程外 SDK 客户端提供服务 |

所有包都遵循仓库的 `@huiliyi37/dsh-*` 约定。参见 [TypeScript SDK 设计](../../.agents/notes/implemented/feature/2026-07-27-typescript-sdk-and-sdk-subagent-backend.md)。
