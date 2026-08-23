# interaction/ — the human-collaboration plane

English | [中文](README.zh.md)

The services and plugins through which a human collaborates with a running agent — questions, approvals, permission presets, commands. These are **product** packages: real interfaces a person drives.

| Package | Role | ctx key |
|---|---|---|
| [`commands/`](commands/README.md) | Registers and dispatches human commands for interactive adapters. | `ctx.commands` |
| [`user-approval/`](user-approval/README.md) | Coordinates one-shot approval decisions. | `ctx.approval` |
| [`permission/`](permission/README.md) | Presents and persists user-facing permission presets. | `ctx.permission` |
| [`output-style/`](output-style/README.md) | Ships switchable output-style presets as an ordered prompt section with hot `/style` switching. | (registers on `ctx.systemPrompt`) |
| [`command-files/`](command-files/README.md) | Loads user- and project-authored Markdown command files into the command registry. | (registers on `ctx.commands`) |
| [`approval-rules/`](approval-rules/README.md) | Answers approvals from persisted per-tool allow/deny pattern rules with a `/permissions` manager. | (registers on `ctx.approval` waterfall) |
| [`user-interaction/`](user-interaction/README.md) | Defines the provider-neutral human question/answer seam. | `ctx.userInteraction` |
| [`tool-ask-user/`](tool-ask-user/README.md) | Exposes human questions to the model. | (registers on `ctx.tools`) |

These packages integrate through existing agent and session contracts rather than changing the loop. Interactive applications provide the concrete command, approval, and question adapters; automation uses [`acp/`](../acp/README.md), and runnable demo bundles live under [`examples/`](../examples/README.md). The product [`dsh`](../../apps/cli/README.md) CLI composes these packages directly.

The subsystem references: [approval.md](../../docs/subsystems/approval.md), [permission.md](../../docs/subsystems/permission.md), [user-interaction.md](../../docs/subsystems/user-interaction.md), and [commands.md](../../docs/subsystems/commands.md). The automation-only ACP transport is [`acp/`](../acp/README.md), the SDK's JSON-RPC server half [`scaffold/server`](../scaffold/README.md), and the shared bin boot glue [`boot/`](../boot/README.md).
