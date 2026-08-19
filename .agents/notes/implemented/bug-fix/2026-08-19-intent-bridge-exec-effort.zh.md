# Agent Note: Intent-bridge main sessions keep the current reasoning effort

Status: implemented

[English](2026-08-19-intent-bridge-exec-effort.md) | 中文

## Problem

TUI 用户可以把 `reasoningEffort: max` 持久化到 `agent-default-model`（或执行 `/effort max`）。没有意图桥时，新会话已经通过 `installModelSelection` 应用该选择。桥装上之后——这是发货 TUI 的默认——`newSession` 只把 `provider`/`model` 当作 `exec` 传出，桥创建主 agent 时也只有这两个字段。`AgentOptions` 没有 effort 槽，loop 首次 seed 因此省略它；`prepareCall` 填入适配器 `defaultEffort`（DeepSeek 上是 `high`）。handoff 随后 `switchSession` 到 registry 里的 live agent 并清空 `modelRef`，禅会话上 `/effort` 也无法热切。状态栏可能在首条 `request/header` 前闪一下已保存的 max，然后变成 `high`。

## Decision

`AgentOptions.reasoningEffort` 是 `maxTokens` 缺失的对称项。当折叠 header 对该路由没有显式 effort 时，loop 在该 loop 实例的首次请求上写入它。显式选项不会被标成 `adapterDefaults.reasoningEffort`，后续步骤因此保住它。标识符是非空字符串；合法集合仍由适配器持有。

意图桥的 `exec`（以及每次对齐的 `execRoute`）可以携带 `reasoningEffort`。两条主会话 `agents.create` 路径都把它摊进 `agentOptions`。省略则保持原先的适配器默认行为。对齐会话仍只用配置里的对齐路由，不继承该 effort。

TUI `newSession` 把当前选择摊进 `exec`，以及无桥时的 `agents.create`。`switchSession` 到 live agent（交接主会话）时，从持久化 header 或当前选择重新安装 `installModelSelection`；`detachProjections` 释放这次安装，避免之后再切时叠装监听器。

## Alternatives considered

**整个禅相位强制 `max`，再恢复。** 否决：用户选择的是沿用当前值。已保存的 `high` 必须保持 `high`；禅不拥有 effort。

**只在意图桥的 `agent/request` 监听器里改写 `reasoningEffort`。** 否决：`AgentOptions` 已经用 `maxTokens` 承担同样的「创建时显式设置」职责，而且主会话的首次请求可能从 `followup` 启动，早于 TUI 监听器挂上。

**live agent 的 `modelRef` 继续置空，只修创建时 seed。** 否决：交接后 `/effort` 仍然失效，而无桥路径已经提供同一套前门契约。

## Consequences

已保存或经 slash 选定的 effort，会作为显式会话设置到达第一次禅请求。对齐仍走配置的 flash 路由和适配器默认，除非以后另作决定。切回停放的主会话会重新绑定选择，因此 `/model` 与 `/effort` 在交接后仍然可用。

## Testing

- `packages/core/agent-loop/tests/loop.spec.ts` — 空的 `AgentOptions.reasoningEffort` 在发布前失败；`max` 写入首次请求。
- `packages/core/agent-loop/tests/request-reconstruction.spec.ts` — 显式 `max` 不会被标成适配器默认。
- `packages/guard/intent-bridge/tests/intent-bridge.spec.ts` — 按次 `exec.reasoningEffort: max` 落到主 agent 及其首条 header；省略 exec effort 则 `agent.options.reasoningEffort` 保持未设。
- `packages/tui/tui/tests/app.spec.ts` — `newSession` 在桥的 `exec` 与无桥的 `agentOptions` 上都转发当前 `max`；live-registry `switchSession` 仍可热切；resume 的 `agentOptions` 包含已持久化的显式 effort。

## Related

- [意图对齐桥](../architecture/2026-08-18-intent-bridge.md) — 会话拆分，以及本 note 扩展的 `exec` 覆盖。
- [适配器持有的推理强度](../architecture/2026-07-24-adapter-owned-reasoning-effort-capabilities.md) — 请求省略 effort 时 DeepSeek 默认为 `high`。
