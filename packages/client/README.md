# client/ — web-GUI browser half

English | [中文](README.zh.md)

The browser side of the dsh web GUI: shell boot, browser-host communication, shared UI services, and feature plugins. Authoring rules live in [AGENTS.md](AGENTS.md); the host half is [`host/`](../host/README.md). All except `test-runtime` are **product** packages named `@deepseek-ai/dsh-client-<name>`.

| Package | Purpose |
|---|---|
| [`web/`](web/README.md) | Boots the browser shell from the client entry graph. |
| [`modules/`](modules/README.md) | Loads browser-side client modules. |
| [`web-react/`](web-react/README.md) | Connects the shell runtime to React rendering. |
| [`connection/`](connection/README.md) | Maintains browser-host RPC communication and event delivery. |
| [`runtime/`](runtime/README.md) | Provides shared client services for sessions, workspaces, and UI composition. |
| [`hmr/`](hmr/README.md) | Refreshes client plugins during development. |
| [`locale/`](locale/README.md) | Provides localization preferences and message dictionaries. |
| [`schema-form/`](schema-form/README.md) | Provides schema-backed draft handling for settings editors. |
| [`test-runtime/`](test-runtime/README.md) | Provides shared repository test support for client feature packages. |
| [`ui-slots/`](ui-slots/README.md) | Defines how UI features register and compose extension slots. |
| [`ui-theme/`](ui-theme/README.md) | Applies the selected color theme. |
| [`ui-primitives/`](ui-primitives/README.md) | Provides shared React controls, icons, and content renderers. |
| [`ui-layout/`](ui-layout/README.md) | Arranges the main application regions. |
| [`ui-sidebar/`](ui-sidebar/README.md) | Presents workspace and session navigation. |
| [`ui-workspace/`](ui-workspace/README.md) | Provides workspace selection and creation surfaces. |
| [`ui-conversation/`](ui-conversation/README.md) | Presents the active conversation and its input surface. |
| [`ui-tool/`](ui-tool/README.md) | Composes Tool call trees and keyed per-Tool views. |
| [`ui-goal/`](ui-goal/README.md) | Presents and manages the current goal. |
| [`ui-trajectory/`](ui-trajectory/README.md) | Presents alternate views of agent activity. |
| [`ui-command/`](ui-command/README.md) | Provides session-aware command discovery and dispatch. |
| [`ui-slash/`](ui-slash/README.md) | Coordinates inline command and reference suggestions. |
| [`ui-skill/`](ui-skill/README.md) | Adds skill references to inline suggestions. |
| [`ui-subagent/`](ui-subagent/README.md) | Provides subagent navigation, child transcript states, and inline references. |
| [`ui-model/`](ui-model/README.md) | Provides model selection in conversation surfaces. |
| [`ui-permission/`](ui-permission/README.md) | Configures default permissions and switches the current session's access. |
| [`ui-plan/`](ui-plan/README.md) | Presents active plan-mode status and its exit control. |
| [`ui-question/`](ui-question/README.md) | Presents interactive questions requested by the agent. |
| [`ui-settings/`](ui-settings/README.md) | Hosts the settings interface and its extension areas. |
| [`ui-settings-general/`](ui-settings-general/README.md) | Provides the general settings section. |
| [`ui-models/`](ui-models/README.md) | Provides model-provider configuration and DeepSeek onboarding. |

Each child reference owns its contract and detailed behavior. The [slot system standard](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) and [web client architecture note](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) own the cross-package composition and loading decisions.

The subsystem reference is [client-modules.md](../../docs/subsystems/client-modules.md); the [slot system standard](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) is the definitive slot model, and the [web client architecture note](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) owns the loading chain and object layer.
