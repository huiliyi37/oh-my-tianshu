# tasks/ — background-task capability family

English | [中文](README.zh.md)

This family gives long-running tools one owner-isolated background-task protocol for observation, cancellation, waiting, and completion notices.

| Package | Role | ctx key |
|---|---|---|
| [`tasks/`](tasks/README.md) | Defines the task registry and lifecycle contract | `ctx.tasks` |
| [`tasks-local/`](tasks-local/README.md) | Implements the process-local task registry | registers on `ctx.tasks` |
| [`tool-tasks/`](tool-tasks/README.md) | Exposes task control and completion notices to the model | registers on `ctx.tools` |

See the [background-task runtime](../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md) and [task-registry](../../.agents/notes/implemented/architecture/2026-07-26-task-registry-seam.md) decisions.

The subsystem reference — the id scheme, the owner-fenced contract, snapshots — is [docs/subsystems/tasks.md](../../docs/subsystems/tasks.md); design in the [background-task runtime](../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md) and [task-registry contract](../../.agents/notes/implemented/architecture/2026-07-26-task-registry-seam.md) Agent Notes.
