# TUI C4 概念稿 Wave 1+2：欢迎页菜单入口 / 顶部栏 / 状态行 / 三行底部区

Status: implemented

[English](2026-08-12-tui-c4-concepts-w12.md) | 中文

## Problem

概念稿（`docs/dsh-tui-视觉概念稿-c4.md`）面向用户可见部分提出了三个概念方案（A 航图 / B 深潜 / C 工作站），用户选型：**① 欢迎页用菜单入口（A）；② 输入框多行化放到下一批；③ metrics 行常驻底部（C 的三行底部区）**。既有 C1/C2/C3 对比文档只覆盖功能差距，未覆盖欢迎页与底部区的视觉形态；现状欢迎页是 4 行迷你框 + 环境检查行，底部只有输入行，无模式/快捷键提示行，metrics 行在顶部 glance 面板。

## Decision

按概念稿推荐路径实施 Wave 1 + Wave 2（不含 Wave 3 多行输入）：

- **欢迎页菜单入口**：`formatWelcomeMenu`（label 左 BOLD + keyHint 右对齐 secondary，宽度守恒，不可用项 muted）在 `renderRestorableSessions` 统一渲染；`handleKey` 新增 ctrl_n（newSession，P3 keepHandle 保留旧会话）/ ctrl_s（切到最近非当前会话）/ ctrl_q（onExit 退出）。ctrl_s/ctrl_q 键名与 0x13/0x11 解析补进 `input-handler.ts`（此前 KeyName 无这两个键）。
- **顶部栏**：`formatTopBar`（📁 cwd → model → (branch)，超宽从后丢段，ascii 档 📁→`~`）替换原内联 context bar；分支经 `gitBranch()`（execSync rev-parse，attach 时一次，静默）读取。快捷键提示移出 top bar——概念稿 A 中属底部 shortcuts 行（footer）职责。
- **状态行**：`formatTurnStatus`（运行中 braille spinner 帧循环 / 等待输入 pulsing ◆，null 不占位，ascii 降级 `*`/`-`）替换 glance 状态行纯文本——`LiveSnapshot.glanceStatus` 类型放宽为 `string | null`，`renderGlancePanel` 过滤 null。
- **三行底部区**：`formatPromptFooter`（mode 段 normal + [plan]/[plan…]/[auto] 徽标 + 快捷键提示，窄宽丢尾段 mode 恒保留）渲染于输入行下方；metrics 行从 glance 面板移出，在输入行下方常驻渲染（`formatGlanceBar` 输出，组合器取 `line.text` 包装——首次接线误把 LiveRegionLine 对象整体包进 `{ text }` 导致 `l.text.includes` 运行时错误，修复为取 `.text`）。

架构约束遵守：全部新视觉是 format/ 纯函数（窄输入 → ANSI 行，零 IO）；app.ts 只做组装；不引入新依赖；SOURCE-MAP.md 补三个新文件条目。

## Verification

- `welcome.spec.ts` 23/23（新增 6 用例：右对齐/宽度守恒/disabled 降级/超长 label 丢 keyHint/空 items）。
- `top-bar.spec.ts` 6/6（cwd+model 无快捷键提示、分支段、无分支、窄宽丢段顺序 branch 先于 model、ascii、宽度守恒、截断省略号）。
- `turn-status.spec.ts` 8/8（null/空不占位、帧循环、tick 回卷、idle ◆、ascii 降级、宽度守恒）。
- `prompt-footer.spec.ts` 6/6（默认/plan/planPending 优先/auto/宽度守恒/窄宽丢段）。
- `live-panels.spec.ts` metrics 用例更新为"已移出 glance 面板"。
- `app.spec.ts` T6 context bar 用例更新（快捷键提示移出 top bar）；145 → 146 用例全绿。
- TUI 全量：**1326 passed / 2 todo（75 文件）**；`tsc --noEmit -p packages/tui/tui/tsconfig.json` 0 错误。
- 提交后审查（auto, L1）已入后台。

## Files

- `packages/tui/tui/src/format/welcome.ts`：`formatWelcomeMenu` + `WelcomeMenuItem`/`FormatWelcomeMenuInput`
- `packages/tui/tui/src/format/top-bar.ts`（新）：`formatTopBar`
- `packages/tui/tui/src/format/turn-status.ts`（新）：`formatTurnStatus`
- `packages/tui/tui/src/format/prompt-footer.ts`（新）：`formatPromptFooter`
- `packages/tui/tui/src/ui/app.ts`：菜单渲染、ctrl_n/s/q 键路由、gitBranch、top bar 装配、turnStatus 装配、底部 footer+metrics 渲染
- `packages/tui/tui/src/engine/input-handler.ts`：KeyName 补 `ctrl_s`/`ctrl_q`、CTRL_CODES 补 0x11/0x13
- `packages/tui/tui/src/render/live-panels.ts`：renderGlancePanel 去 metrics 段、glanceStatus 可空过滤
- `packages/tui/tui/src/render/live-snapshot.ts`：glanceStatus 类型 `string | null`
- `packages/tui/tui/SOURCE-MAP.md`：三个新文件条目
- 测试：`welcome.spec.ts`、`top-bar.spec.ts`（新）、`turn-status.spec.ts`（新）、`prompt-footer.spec.ts`（新）、`live-panels.spec.ts`、`app.spec.ts`

## Alternatives considered

**top bar 保留快捷键提示（原 T6 语义）** — 否决。概念稿 A 的 top bar 只含分支+cwd，快捷键提示属底部 shortcuts 行；T6 测试在 100 列 mock 下因段超宽丢 model 暴露了信息混装，按概念稿分流（model 在 top bar、快捷键在 footer）后各段职责清晰。

**欢迎页做可交互菜单（grok 的选中高亮 + Enter 执行）** — 否决。dsh 的键路由更直接（ctrl+n/s/q 直发），菜单行作为可视入口提示即可；主题无 bg_highlight 槽，选中高亮需改主题契约。

**alwaysApprove 徽标读 `this.alwaysApprove`** — 类型错误修正。字段实际在 `ApprovalController` 上（`this.approval.alwaysApprove`），footer 徽标与其同源。

## Consequences

- 三行底部区（输入行 → footer → metrics）改变了 live 区底部形态；metrics 不再出现在顶部 glance 面板（避免双份）。
- `glanceStatus` 可空化是渲染层类型放宽，renderGlancePanel 调用方（仅 renderLive）已同步过滤。
- 输入框多行化（Wave 3）与欢迎页 hero 布局（宽 ≥90 终端专属）按用户决策留待下一批。
- 渲染验证受环境限制：无交互 TTY，视觉断言基于纯函数 spec；真实终端验收待 TTY 环境（与 C1/C2 系列同基线）。
