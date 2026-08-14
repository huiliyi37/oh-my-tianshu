# scaffold/ — drive Harness runtimes from another process

English | [中文](README.zh.md)

This group contains the client stack for driving a Harness runtime from another process over a stable wire protocol.

| Package | Role |
|---|---|
| [`protocol/`](protocol/README.md) | Defines the SDK runtime wire protocol |
| [`client/`](client/README.md) | Drives a Harness runtime through the TypeScript client API |
| [`server/`](server/README.md) | Serves out-of-process SDK clients over stdio JSON-RPC |

All packages follow the repository's `@huiliyi37/dsh-*` convention. See the [TypeScript SDK design](../../.agents/notes/implemented/feature/2026-07-27-typescript-sdk-and-sdk-subagent-backend.md).
