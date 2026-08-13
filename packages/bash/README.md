# bash/ — bash capability family

English | [中文](README.zh.md)

The capability family spans the canonical executor seam, its implementations, the shared shell environment, and the model-facing tools. All are **product** packages.

| Package | Role | ctx key |
|---|---|---|
| [`bash/`](bash/README.md) | Defines the executor contract shared by Service providers and Consumers. | `ctx.bash` |
| [`bash-local/`](bash-local/README.md) | Executes commands through the local [`subprocess`](../subprocess/README.md) service. | (registers `ctx.bash`) |
| [`bash-sandbox/`](bash-sandbox/README.md) | Applies the configured [`sandbox`](../sandbox/README.md) backend before local execution. | (registers `ctx.bash`) |
| [`pwsh-local/`](pwsh-local/README.md) | Executes PowerShell commands with Windows-specific process behavior. | (registers `ctx.bash`) |
| [`bash-env/`](bash-env/README.md) | Provides the managed `DSH_*` environment shared by shell tools. | `ctx.bashEnv` |
| [`tool-bash/`](tool-bash/README.md) | Exposes Bash execution and background-task integration to the model. | (registers on `ctx.tools`) |
| [`tool-pwsh/`](tool-pwsh/README.md) | Exposes PowerShell execution to the model. | (registers on `ctx.tools`) |

A leaf `cordis.yml` selects one executor implementation and the model-facing tools it needs. A sandboxed composition also selects a `ctx.sandbox` provider; the [ACP example](../../examples/acp-agent/) shows one complete wiring.

The subsystem reference — request/spec vocabulary, results, background processes, the service, and events — is [docs/subsystems/bash.md](../../docs/subsystems/bash.md).
