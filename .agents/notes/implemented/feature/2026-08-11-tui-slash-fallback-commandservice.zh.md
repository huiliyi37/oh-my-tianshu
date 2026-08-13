# Agent Note: TUI slash 通道 fallback 到 CommandService + plan pending 状态显示（A1）

Status: implemented

[English](2026-08-11-tui-slash-fallback-commandservice.md) | 中文

## Problem

C1 对标（`docs/dsh-tui-与claude的对比-c1.md`）的 A1 项指出 plan 模式在 TUI 里缺少入口。plan-mode 包（`packages/plan/plan-mode/`）已经把 `/plan` 注册到 cordis `CommandService`——handler 调用 `ctx.planMode.set()`，投影的 `pending` 由 `command/run` 事件驱动——但 TUI 的 slash 通道（`ui/app.ts` 的 `runSlash`）只查自己那 14 个 UI 命令的 registry，未命中就回显「未知命令」，于是 `/plan` 在 TUI 内不可达。statusline 又只消费 plan 投影的 `active`，轮内切换尚未生效（pending）时用户拿不到任何反馈。

## Decision

TUI 是命令输入通道，不是命令的所有权者。`/` 输入在 registry 未命中时，`runSlash` fallback 到 `ctx.reflect.get('commands', false)` 上的 `execute(agent, line, signal)`，由 CommandService 记录 `command/run` → `command/done` 生命周期，进而驱动 plan 投影的 `pending`。服务经 `reflect.get` 读取而非属性访问，因为 TuiApp 的 `runtimeCtx` 未 inject `commands`，Cordis 4 的属性访问会抛 "without inject"——与 compact、goal 命令同款模式。服务未装配、无会话，或命令名未知（`execute` 返回 `undefined`）时，通道降级为既有的「未知命令」回显。

statusline 在 active 之外补上 pending 态：`formatStatusLine(view, planActive, planPending)`，`WorkflowStatusLine.setPlanActive(active)` 改为 `setPlanState({active, pending})`，其幂等判断比较两个字段。pending 时渲染 `[plan…]`，优先级高于 `[plan]`。

三件事留在范围之外：三态模式（DSH 的 plan off 就是常规态）、快捷键（Tab 归 `@`-path 补全所有），以及对 plan-mode 包的任何改动。

## Verification

- Wave 1，fallback：`app.spec.ts` 承载五个用例（success 回显、error 回显、`undefined` 未知命令、无会话、服务不可用），RED 时两个失败，随后 GREEN 5/5；该文件 59/59。
- Wave 2，pending 态：`statusline.spec.ts` 承载一个 pending 渲染用例，既有 `setPlanActive` 测试同步迁移到 `setPlanState`；statusline 21/21、app 59/59。
- 类型：只检查四个改动文件的 scratch project 报告零错误。全量 `tsc -b` 受并行会话与既有 60 多个错误阻塞，见 evidence-gate 线。
- 装配可达性只有静态证据支撑，由 delegate 子代理收集：TUI profile 是同一根 ctx 上的 base 加 tui，base 装配了 dsh-commands 与 plan-mode（`cordis.patch.yml` L236/L251），因此 `ctx.reflect.get('commands', false)` 可解析。真实装配下的运行时验证没有做——本地没有具备执行权限的环境——而仓库在 `commands.execute` 一级没有先例，只有 `apps/web/tests/shipped-composition.e2e.ts` L92 的 `commands.list` 先例。降级路径就是这一缺口的兜底。

## Files

- `packages/tui/tui/src/ui/app.ts`：`runSlash` fallback、`runCordisCommand` 私有方法、`CommandServiceFacet` 最小消费面，以及 `planState` 消费（attach 与 `onChanged` 双路径都传 `pending`）
- `packages/tui/tui/src/statusline.ts`：`formatStatusLine` 第三参 `planPending` 与 `WorkflowStatusLine.setPlanState`
- `packages/tui/tui/tests/app.spec.ts`：五个 fallback 用例
- `packages/tui/tui/tests/statusline.spec.ts`：pending 渲染用例与 `setPlanState` 迁移
- `docs/dsh-tui-与claude的对比-c1.md`：A1 标记为已完成

## Alternatives considered

**把 `/plan` 注册进 TUI 自己的命令 registry** — 否决。命令的所有权已在 plan-mode 包，且其投影的 `pending` 由只有 CommandService 才记录的 `command/run` 生命周期驱动；TUI 侧再抄一份，要么复制 handler，要么绕开 statusline 依赖的那些事件。把 TUI 当成输入通道，能力归属留在能力所在处，plan-mode 包一行不动。

**用属性访问（`ctx.commands`）拿到服务** — 否决。TuiApp 的 `runtimeCtx` 未 inject `commands`，Cordis 4 的属性访问会抛 "without inject"。`ctx.reflect.get('commands', false)` 是 compact、goal 命令已在用的模式，其可选形式正好给降级路径提供判定条件。

**三态的模式指示** — 否决。DSH 的 plan off 态就是常规态，`active` 加 `pending` 已经覆盖 statusline 需要显示的全部状态。

**为切换 plan 模式配快捷键** — 否决。Tab 已被 `@`-path 补全占用，也没有别的按键空闲到值得挤掉既有绑定。

## Consequences

- 把 TUI 当通道，换来的是一个 fallback 同时带来 `/plan` 以及其他所有插件注册的 cordis 命令，付出的是提示文本仍只列 TUI 命令：未知命令回显的可用列表不含 cordis 命令，只有知道命令名的人才能用到它们。把 `commands.list(agent)` 并入该列表即可补全提示。
- statusline 的 plan API 形状变了——`setPlanActive` 变成 `setPlanState({active, pending})`——因此所有调用点都传两个字段，轮内切换会先显示 `[plan…]` 再显示 `[plan]`。
- 命令执行触达一个 TUI 并未 inject 的服务，因此通道的正确性依赖一条由配置证据而非实跑支撑的装配假设。降级的「未知命令」回显把失败面收窄了：服务未装配看起来与命令名未知完全一样。
- 真实装配下的端到端行为在此未获验证；`/plan`、`/plan off` 与状态栏 `[plan…]` 由运行 `dsh web` 或 `dsh --profile tui` 的用户实测。
