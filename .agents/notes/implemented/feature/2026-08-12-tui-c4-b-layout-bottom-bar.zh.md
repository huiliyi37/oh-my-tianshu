# Agent Note: TUI C4 概念稿 B 布局 Wave——输入框底边线 / 欢迎页会话限高 / footer 合并

Status: implemented

[English](2026-08-12-tui-c4-b-layout-bottom-bar.md) | 中文

## Problem

TUI 底部与欢迎页曾偏离概念稿：启动列表没有上限，会话一多即可占满首屏；输入行也没有下边线区分 composer。所选概念 B 布局要求简洁启动列表，以及不带完整包围框的底边线。

## Decision

按 B 布局确立三项纯函数层选择（零 IO、宽度守恒、ascii 可降级）：

- **输入 chrome 边线，部分被取代**：本波选择在输入行下方画模式着色底边线、四周不带完整包围框（B「只画底边圆角框」）。该边线符号已不存在；当前输入 chrome 由 `formatInputFrame` 与 [Oh My Tianshu 改版](./2026-08-15-oh-my-tianshu-rebrand.md) 的 composer 顶边状态栏（`formatTopStatusBar` + 模式响应的 `promptBorderColor`）拥有。
- **欢迎页会话列表限高，部分被取代**（`restore-session.ts`）：`formatRestorableSessions` 保留向后兼容的 `maxRows` 选项与折叠提示。当前启动区经 `formatRestorablePickerList` 投影最多三行编号行；[会话恢复决策](./2026-08-20-session-resume-visibility.md) 拥有数字键路由，[狐狸欢迎决策](./2026-08-22-tui-fox-welcome.md) 拥有最终组合与上限。
- **footer 右合并能力，部分被取代**（`format/prompt-footer.ts`）：`formatPromptFooter` 仍暴露可选 `rightSegments` 作为纯函数合并（右对齐进同一行；放不下从后丢右段）。app 不传 `rightSegments`。live metrics 与 API 状态落在改版的 `formatTopStatusBar`（composer 顶边）；footer 只渲染模式徽标与快捷键提示。

## Verification

- `restore-session.spec.ts` 钉住限高、超总数、不限制与编号选择器行行为。
- `prompt-footer.spec.ts` 钉住 mode/hint 布局，以及调用方传入时可选 `rightSegments` 合并。
- `app.spec.ts` 钉住 mode/hint footer 与当前三行编号欢迎投影。
- composer 顶边 metrics 与 input-frame chrome 由 [改版验证](./2026-08-15-oh-my-tianshu-rebrand.md#testing) 覆盖。

## Files

- `packages/tui/tui/src/format/prompt-footer.ts`：mode/hint footer，带 app 未使用的可选 `rightSegments` 合并
- `packages/tui/tui/src/restore-session.ts`：`RestorableOptions.maxRows` + 折叠提示行
- `packages/tui/tui/src/ui/app.ts`：欢迎页投影最多三行编号行；live footer 只取 mode/hints（不传 `rightSegments`）
- `docs/dsh-tui-视觉概念稿-c4.md`：决策记录第 8 节
- 测试：`restore-session.spec.ts`、`prompt-footer.spec.ts`、`app.spec.ts`

## Alternatives considered

**输入行上方整行横线分隔（概念稿 C 主界面形态）**——否决：用户明确「四周不带框线」，选 B 的只画底边圆角线。当前 composer chrome 所有权属于 [改版](./2026-08-15-oh-my-tianshu-rebrand.md)。

**欢迎页会话列表默认展示 5 个 + 数字键选择（概念稿 C 会话选择器）**——本布局波否决，因为当时要求的首屏上限是一个。其后的 [会话恢复决策](./2026-08-20-session-resume-visibility.md) 增加数字键路由，[狐狸欢迎决策](./2026-08-22-tui-fox-welcome.md) 结算为最多三行可见，而非五行。

**metrics 行无条件并入 footer**——此处否决，因为 B 想要窄屏纵排回退。该布局已过时：metrics 落在改版顶边状态栏，footer 不再承载它们。

## Consequences

- `formatRestorableSessions` 保留可选 `maxRows` 参数；省略时默认不限高，存量调用无感。
- 可选 `rightSegments` 仍是 `formatPromptFooter` 的纯函数能力，但不属于 live 装配约定。
- 启动 hero、行上限与结算属于 [狐狸欢迎](./2026-08-22-tui-fox-welcome.md)；数字键路由属于 [会话恢复可见性](./2026-08-20-session-resume-visibility.md)；输入 chrome 与 metrics 放置属于 [改版](./2026-08-15-oh-my-tianshu-rebrand.md)。本 note 仍是仍塑造这些后续 owner 的 B 布局选择理由。
