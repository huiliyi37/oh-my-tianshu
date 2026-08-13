# scaffold/ — create, launch, and drive projects from outside

English | [中文](README.zh.md)

This group contains developer tooling for Harness projects and the client stack for driving a Harness runtime from another process. Folders are role-named without the legacy `sdk-` prefix; npm names converge on `dsh-sdk-*` through the FIXME-tracked renames in the [regrouping Agent Note](../../.agents/notes/implemented/architecture/2026-07-29-package-regrouping.md).

| Package | Role |
|---|---|
| [`helper/`](helper/README.md) | Provides the shared project-editing domain |
| [`scripts/`](scripts/README.md) | Provides the `dsh-sdk` project commands |
| [`create-sdk/`](create-sdk/README.md) | Creates new SDK projects |
| [`protocol/`](protocol/README.md) | Defines the SDK runtime wire protocol |
| [`client/`](client/README.md) | Drives a Harness runtime through the TypeScript client API |
| [`server/`](server/README.md) | Serves out-of-process SDK clients over stdio JSON-RPC |
| [`telemetry/`](telemetry/README.md) | Provides launcher telemetry, consent, and redaction primitives |

`@deepseek-ai/create-sdk` follows npm's scoped initializer naming convention; the other packages follow the repository's `@deepseek-ai/dsh-*` convention. See the [developer-project workflow](../../.agents/notes/proposed/feature/2026-07-14-sdk-developer-projects.md), [project-editing architecture](../../.agents/notes/proposed/architecture/2026-07-15-sdk-project-editing-architecture.md), and [TypeScript SDK design](../../.agents/notes/implemented/feature/2026-07-27-typescript-sdk-and-sdk-subagent-backend.md).
