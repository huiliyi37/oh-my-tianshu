# Agent Note: TUI C4 概念稿 Wave 1+2——欢迎动作 / 顶部栏 / 状态行 / 三行底部区

Status: implemented

[English](2026-08-12-tui-c4-concepts-w12.md) | 中文

## Problem

概念稿（`docs/dsh-tui-视觉概念稿-c4.md`）面向用户可见部分提出了三个概念方案（A 航图 / B 深潜 / C 工作站）。决策须把直接欢迎动作、顶部栏上下文、回合状态与底部 metrics 分开，而不是把无关信息挤在同一行。

## Decision

Wave 1 + Wave 2 确立这些职责：

- **欢迎动作，部分被取代**：`handleKey` 保留直接的 `ctrl_n`（新建会话）、`ctrl_s`（最近的其他可恢复会话）与 `ctrl_q`（退出）路由，并在 `input-handler.ts` 解码 `ctrl_s` / `ctrl_q`。[能力门槛狐狸欢迎](./2026-08-22-tui-fox-welcome.md) 替换原 `formatWelcomeMenu` 可视入口，并拥有当前 hero、恢复提示、贴士与结算行为。
- **启动顶部栏，部分被取代**：`formatTopBar`（📁 cwd → model → (branch)，超宽从后丢段，ascii 档 📁→`~`）仍格式化启动欢迎的上下文行；分支来自 `gitBranch()`（execSync rev-parse，attach 时一次，静默）。它不是持久 live chrome。live 身份与 metrics 落在 [Oh My Tianshu 改版](./2026-08-15-oh-my-tianshu-rebrand.md) 的 composer 顶边状态栏（`formatTopStatusBar`）。快捷键提示仍属 footer 职责。
- **状态行**：`formatTurnStatus`（运行中 braille spinner 帧循环 / 等待输入 pulsing ◆，null 不占位，ascii 降级 `*`/`-`）替换 glance 状态行纯文本——`LiveSnapshot.glanceStatus` 类型放宽为 `string | null`，`renderGlancePanel` 过滤 null。
- **footer mode/hints，部分被取代**：`formatPromptFooter`（mode 段 normal + [plan]/[plan…]/[auto] 徽标 + 快捷键提示，窄宽丢尾段 mode 恒保留）仍渲染于输入行下方。metrics 不再坐在输入行下或 glance 面板；改版把它们放到 composer 顶边，因此 live footer 只有 mode 与快捷键提示。

架构约束遵守：这些视觉仍是 format/ 纯函数（窄输入 → ANSI 行，零 IO）；app.ts 只做组装；这些 formatter 不引入新依赖。

## Verification

- 直接欢迎键仍由 `app.spec.ts` 与 `input-handler.spec.ts` 覆盖；当前首屏 formatter 覆盖属于 [狐狸欢迎验证](./2026-08-22-tui-fox-welcome.md#verification)。
- `top-bar.spec.ts` 钉住启动上下文字段、丢段顺序、ascii、宽度守恒与截断。
- `turn-status.spec.ts` 钉住 null/空省略、帧循环、idle 字形、ascii 降级与宽度守恒。
- `prompt-footer.spec.ts` 钉住 mode/hint 布局、优先级与窄宽丢段。
- `live-panels.spec.ts` 与 `app.spec.ts` 钉住 glance 面板去掉 metrics，以及 footer mode/hint 装配。
- composer 顶边 metrics 属于 [改版验证](./2026-08-15-oh-my-tianshu-rebrand.md#testing)。

## Files

- `packages/tui/tui/src/format/top-bar.ts`：`formatTopBar`（启动欢迎上下文行）
- `packages/tui/tui/src/format/turn-status.ts`：`formatTurnStatus`
- `packages/tui/tui/src/format/prompt-footer.ts`：`formatPromptFooter`（mode/hints；可选 `rightSegments` 未被 app 使用）
- `packages/tui/tui/src/ui/app.ts`：ctrl_n/s/q 键路由、`gitBranch`、启动 `formatTopBar`、turnStatus 装配、输入行下方的 mode/hint footer
- `packages/tui/tui/src/engine/input-handler.ts`：KeyName 补 `ctrl_s`/`ctrl_q`、CTRL_CODES 补 0x11/0x13
- `packages/tui/tui/src/render/live-panels.ts`：renderGlancePanel 去 metrics 段、glanceStatus 可空过滤
- `packages/tui/tui/src/render/live-snapshot.ts`：glanceStatus 类型 `string | null`
- 测试：`input-handler.spec.ts`、`top-bar.spec.ts`、`turn-status.spec.ts`、`prompt-footer.spec.ts`、`live-panels.spec.ts`、`app.spec.ts`

## Alternatives considered

**top bar 保留快捷键提示（原 T6 语义）** — 否决。概念稿 A 的 top bar 只含分支+cwd，快捷键提示属底部 shortcuts 行；T6 测试在 100 列下因段超宽丢 model 暴露了信息混装。live metrics 其后再次迁到 [改版](./2026-08-15-oh-my-tianshu-rebrand.md) 顶边状态栏；启动上下文仍是 `formatTopBar`。

**欢迎页做可交互菜单（grok 的选中高亮 + Enter 执行）** — 否决。直接 ctrl+n/s/q 路由不需要选中态，当前狐狸欢迎把可见动作提示留给编号恢复行，而不是再加一层启动 overlay 生命周期。

**alwaysApprove 徽标读 `this.alwaysApprove`** — 类型错误修正。字段实际在 `ApprovalController` 上（`this.approval.alwaysApprove`），footer 徽标与其同源。

## Consequences

- metrics 离开 glance 面板，也不再形成持久底部 metrics 行；live 放置是改版 composer 顶边，footer 保持 mode/hints。
- `glanceStatus` 可空化是渲染层类型放宽，renderGlancePanel 调用方（仅 renderLive）已同步过滤。
- 当前 92×24 能力门槛 hero 及其真实 Loader + PTY 快照属于 [狐狸欢迎决策](./2026-08-22-tui-fox-welcome.md)。本 note 仍是直接欢迎键、启动 `formatTopBar`、`formatTurnStatus` 与 mode/hint footer 约定的理由。
