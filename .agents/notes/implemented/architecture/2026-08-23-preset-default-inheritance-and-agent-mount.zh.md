# Agent Note: 预设默认可继承与 agent factory 挂载

Status: implemented

[English](2026-08-23-preset-default-inheritance-and-agent-mount.md) | 中文

## Problem

`dsh-agent-presets` 交付了完整的能力缝——`mount`/`composeFrom`/`recompose`，加上经 `defaultId` 读出的 `settings.default`——但让选择持久化的两条消费方链接缺失，于是用户的 preset 选择从未存活到新会话。`/preset <id>` 只 `recompose` 当前空白会话并追加 `agent-preset/selected`；它从不写 `settings.default`，且 `AgentPresets` 没有公开的写入口。更糟的是，没有任何生产 agent factory 在未发布的 `setup` 里调用 `agentPresets.mount(agentCtx)`，因此连随附的 `default: standard` 也从未真正挂上 preset——新会话（TUI 直连、intent-bridge 对齐 + 主会话、headless、scaffold）都是裸 agent，工具/提示词段对着空的全局层解析。太一移植把这一点具体暴露了出来：`taiyi` 是 opt-in，却没有任何办法让它持久到下一个会话，尤其是 intent-bridge 的"禅"主会话。

## Decision

- `AgentPresets.setDefault(id)` 在 `resolveMountable(id)` 之后持久化 `settings.default`；无 settings provider 时响亮失败，而非静默空操作。
- `/preset default <id>` 是显式的持久化入口；`/preset <id>` 保持临时切换语义；列表用 `（默认）` 标记当前默认。
- 每个生产顶层 agent factory 在未发布的 `setup` 里挂载默认 preset（`await agentPresets.mount(agentCtx)`），并写入 `meta.agentPreset`（`CreateAgentOptions.meta` 的新字段，传递到 `session.header.agentPreset`）。接线覆盖 TUI `newSession`（直连路径）、intent-bridge `createAlignedSession`/`finalize`/`finalizeFromSession`、headless `run`、scaffold `createSession`、ACP 桥 `newSession`。
- taiyi preset 仍为 opt-in：出厂默认仍是 `standard`；继承 taiyi 需显式 `/preset default taiyi`。这正是太一计划为"设默认"预留的"另立决策"。

## Alternatives considered

- **让 `/preset <id>` 同时持久化（切换即继承）。** 否决：静默改写了现有临时切换命令的语义，用户试用一个 preset 会意外改动部署默认。
- **在 settings.default 之外持久化"最近选择"的独立状态。** 否决：`defaultId` 已经读 `settings.default`，平行状态会与它漂移。
- **只接线 intent-bridge 会话。** 否决：挂载缺口是仓库级的（headless 与 scaffold 也是裸的），且 invariant 已经断言配置了 roster 时每个 agent 必须 join preset。

## Consequences

- `defaultId` 成为用户可写的持久值；README 的"更改默认值只影响此后创建的会话"如今成立，因为这些会话确实挂载了它。
- `session.header.agentPreset` 首次在创建时被写入。Resume 仍不恢复记录的 preset（未变，超出范围）。
- `agent/created` 上的裸 agent 建议性警告，在随附的 TUI / intent-bridge / headless / scaffold / ACP 路径上不应再触发。

## Testing

- `settings.spec.ts`：`setDefault` 持久化 + 据此组装新会话；拒绝未知 id 且不动默认；无 settings provider 时响亮失败。
- `commands.spec.ts`：`/preset default <id>` 调 `setDefault` 并回显继承；裸 `/preset default` 显示用法；列表标记默认预设。

## Related

- [太一词回流计划](../../../../docs/research/taiyi-port-plan.md)
- [host-plane ownership after presets](2026-08-10-host-plane-ownership-after-presets.md)
