# Agent Note: TUI 审查驱动的加固批次与 visionBridge 探测服务

Status: implemented

[English](2026-08-15-tui-audit-hardening-batch.md) | 中文

## Problem

独立仓 `@huiliyi37/dsh-tianshu-tui` 在 2026-08-15 做了一轮全量功能核查，发现的缺陷 monorepo 的 TUI 因同源全部共有：视觉桥状态只能经装配方注入的 `vision` 配置到达 TUI，而没有任何装配传过它（断链——桥插件装配了图片也会在提交边界被丢弃）；`goals`/`subagents` 在必选 `inject` 清单里，缺 goal/subagent 插件的 profile 会让整个 TUI fiber 静默永不激活；`/tasks` `/subagents` `/workflow` `/status` `/config` `/skills` 面板与 plan 模式循环在 backing 服务缺失时静默降级（空白面板、无提示）；`/clear` 只清内部缓冲而 README 声称清视图；`Ctrl+.` 键位表自称完整却只有 10 条；两个已认领的组合层缺口以 `it.todo` 挂着（fiber 重挂载 `DUPLICATE_PROVIDER`、跨会话挂起审批/提问残留）。

## Decision

把审查批次移植进 `packages/tui/tui`，并在插件侧闭环视觉桥：

- **视觉桥探测**：`TuiApp.resolveVisionBridge` 在未注入 `vision` 配置时按 `visionBridge` 服务存在性判定桥可用；`packages/context/vision-bridge` 在 `apply` 时 provide 该服务（随卸载释放；`enabled: false` 不提供）。装配方仍可显式注入 `vision.bridgeEnabled`——探测是无配置兜底。
- **可选服务**：`goals`/`subagents` 移出必选 inject；读取一律走 `reflect.get`，服务缺失按命令 fails loud，不再让整个 TUI 静默失活。
- **降级 fails-loud**：面板与 plan 模式循环在 backing 服务缺失时经 `TuiApp.echoWarn` 回显 `⚠` 警告；平台层降级同样上屏（剪贴板读图工具链缺失、外部编辑器 spawn 失败、终端不支持 OSC52）。
- **chrome 修复**：`/clear` 真清屏（2J + 3J + 光标回顶 + live 区全量重绘）；键位表补全到 20 条，并修复窄宽截断绑定宽度时整行超 1 列的 off-by-one（spec 改按显示宽度断言）。
- **投影层接线**：`turn-summary` 折叠会话事件，非中断回合结束落 dim 摘要行 `turn N · 读X 改Y · 耗时`（轮号取 `turn/end` 事件的权威值而非 fold 状态——中途挂载显示真实轮号）；`summary-state` 供 `/status` 新增的会话汇总段，不依赖宿主投影总线，面板整面渲染闸放宽为逐段降级。模型自带文本摘要的 10ms 单位假设修正为真实 epoch 毫秒（`SessionEvent.time`）。
- **组合拦截线**：三条原 `it.todo` 行为翻绿为真实 Loader 组合测试——无 goals/subagents 激活、fiber 重挂载不抛 `DUPLICATE_PROVIDER`、切会话结算挂起审批/提问（`cancelled` / `ASK_CANCELLED`）。

相对独立仓批次的 monorepo 适配：自更新失败提示未移植（本仓无自更新子系统）；视觉桥探测测试断言内联 `dataUrl` 图片形状（本仓无 attachments 服务）；`userQuestions` 在本仓读作 `userInteraction`；组合测试里 TUI 活跃会话经 tab 栏 `▸` 标记解析——`sessions.list()` 按 recency 排序，spine 的 `main-session` 会后到插队。

## Alternatives considered

- **维持装配方派生 `vision` 配置（现状）**：默认装配下没有任何一方传它，等于断链。否决。
- **经监听器内省探测桥**：cordis 不暴露监听器枚举；provided 服务是显式、带类型的契约，且随插件 fiber 释放。采用。
- **移植 attachments 服务流**：monorepo 图片路径走内联 `dataUrl`；引入独立仓的持久化附件管线是独立的能力决策，不在本批次。
- **为接失败提示新造自更新子系统**：本仓没有自更新子系统，单独移植提示方法是死代码，故刻意不带。

## Consequences

TUI 现在在能力 backing 服务缺失时明确告知用户，而不是渲染空白；视觉桥无需装配方接配置线即可工作。投影总线缺失时 `/status` 保留部分内容（会话汇总段），因此警告文案点名受影响段落而非声称面板整体无数据。本批次的代价：多一个被探测的服务名（`visionBridge`）——未来的桥实现要 provide 它才会被识别；以及 scrollback 略增（每个有工具调用的回合一行 dim 摘要）。

## Testing

- `pnpm exec tsc -b packages/tui/tui` 与 `packages/context/vision-bridge`：0 错误。
- `pnpm vitest run packages/tui/tui/tests`：1607 通过（90 文件），含三个新组合测试与 `app.spec.ts` 的投影层接线块。
- `pnpm vitest run packages/context/vision-bridge/tests`：26 通过，含探测服务 provide/释放与 `enabled: false` 两例。

## Related

- [TUI image paste / clipboard and the vision bridge (opencode-tui port)](./2026-08-13-tui-image-paste-and-vision-bridge.md)
