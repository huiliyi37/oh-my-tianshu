# Agent Note：TUI 统一活动带（CC 对标 subagent/workflow 展示）

Status: implemented

[English](2026-08-21-tui-activity-band.md) | 中文

## Problem

活跃的 subagent/workflow/后台任务进度散落在三处，无统计、无统一入口：subagent 运行行在 live 区散行渲染（`⠋ 子代理 <label>`，无工具/token 计数、无高度封顶），workflow 运行态只在切换出的 `/workflow` 面板里（live 区无运行态、run 结束无 scrollback 摘要），后台任务只在 `/tasks` 面板里。`/subagents` 委派树分不清「执行中」与「空闲存活」（只有 store 活性），workflow roster 行无法关联子会话（TUI 丢弃了 `workflow/agent-start` 的 `childId`），外部进程 provider（acp/claude-code/codex/dsh-sdk）因无 Session 而在 session 语料枚举中完全不可见。

## Decision

TUI（`packages/tui/tui`）现在把三类活跃活动 fold 成输入轨上方一个高度封顶的**统一活动带**，由 `format/activity-band.ts` 渲染（`ActivityItem` + `foldActivityItems` + `formatActivityBand`）：分组计数头 + 每 item 恒 1 行（subagent `⠋` 带工具/token/耗时统计，workflow `⏳ [name] description · phase · N 个 agent · 耗时`，task `› kind: label`）+ 仅最新活跃 subagent 一条 `⎿` 子行 + 常驻入口尾行（`/workflow 管理 · /subagents 树`，超 `activityBandMaxRows`（缺省 5，`TuiRunnerConfig` 校验字段）折叠为 `└ …(+N) /workflow 管理`）+ 逃生门 `activityBand: false` 回退旧散行。完成项塌成一行 commit 进 scrollback：subagent 完成行加统计段（`✓ label · N 工具 · X tok · 耗时`），`workflow/end` commit 一行摘要。带行统计来自 TUI 本地 child 投影缓存（`childProgress`，由 `projections.onChanged` 对运行中 subagent 子会话恒缓存；`subagent/end` 时取快照用于完成行并清除）。

跨包（G1/G3）：`subagentProgress` 新增 `running` 执行位，从子会话自身 `turn/start|end` 边界折叠（stateVersion 1→2，旧缓存行重折叠）——零新事件词汇。`SubagentService.activeExternalRuns()` 是活跃外部 run 的等价状态面（发布登记、结算移除）；TUI 在 `/subagents` 面板的 `⤷ 外部子代理` 段渲染它们。workflow roster 行现在把 `childId` 透传进 TUI（`ui/app.ts` 保留字段），经面板 `childState` 选项（委派树派生）追加 `⤷ 子会话 label`（运行中 ⏳ 前缀）。

## Alternatives considered

- **新增 `subagent/status` 会话事件**（running/idle/settled）+ 独立投影，对比已落地的 `running` 位（turn 边界折叠）。事件路径引入新事件词汇、lifecycle/continuation 的发射点与 turn 围栏不变量面——而这些事实子会话日志本身已携带；折叠方案零新事件、零发射机制即送达同一实时状态信号。
- **把外部 run 合成进 `listChildren`/`listDescendants`**，对比已落地的 `activeExternalRuns()` 等价状态面。外部 run 没有 Session 身份，混入 `SubagentListEntry` 会破坏 `id: SessionId` 契约，也违背该模块「不咨询 provider 状态」的契约；独立注册表保持枚举契约不变，满足活跃窗口需求（历史仍走 `subagent/start|end` 事件路径）。
- **`renderActivityBand(snapshot)` 面板放进 `live-panels.ts`**，对比已落地的 renderLive 组合器直接调用 `formatActivityBand`。面板层是 `(snapshot) => string[]` 且无 tick；带需要 spinner 帧，tick 属于组合器——直接调用与既有 tick 依赖渲染（工具卡、推理尾巴）同一模式。

## Consequences

收获：一个封顶、稳定、带统计的带替换三处散落面；完成行与 workflow 摘要落入 scrollback；树/roster 行带实时执行状态与子会话关联；外部 run 有活跃窗口视图；带高只随活跃 item 数变化（防跳、可测：每 item 恒 1 行、`⎿` 子行至多 1 条、封顶折叠尾行）。

代价：`subagentProgress` stateVersion 1→2（schema 含 `running`）使既有投影缓存行在下次使用时重折叠；TUI `app.spec` 的 subagent 接线断言改写为带语义；逃生门存在是因为旧散行仍可加载。仍开放：G2 workflow 持久化/回放（带 + 结束 commit 行覆盖活窗口；重启后历史 workflow run 除父会话 tool/result 外仍不可重建）与子代理暂停/恢复语义。

Verification：`packages/tui/tui/tests/activity-band.spec.ts`（fold 形状、每 item 1 行、封顶、数字更新、子行落点、计数头、纯文本模式）、更新的 `subagent-line.spec`/`workflow-panel.spec`/`delegation-panel.spec`/`app.spec`（带接线、child 投影缓存、逃生门、workflow 摘要、外部 run 段），以及 `packages/subagent/subagent/tests/subagent-progress.spec.ts`/`service.spec.ts`/`list-children.spec.ts`（`running` 位与外部 run 注册表）。设计文档 `docs/dsh-tui-subagent工作流面板细设计.md` §9 记录与设计稿的差异。

## Related

- 设计：`docs/dsh-tui-subagent工作流面板细设计.md`（细设计，CC 对标）与 `docs/dsh-tui-todo与subagent面板设计.md`（概览）。
- 参考：天枢 `docs/plans/2026-08-03-tui-subagent-workflow-display-cc-parity.md`。
