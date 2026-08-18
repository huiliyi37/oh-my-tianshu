# Agent Note: 意图对齐桥——主会话之前的对齐模型

Status: implemented

[English](2026-08-18-intent-bridge.md) | 中文

## 问题

新会话的首条消息往往又短又模糊（「帮我重构 xxx」）。执行模型既要理解需求又要执行——昂贵（flash 级 token）、薄弱（短消息被 zen triage 跳过、从不锚定）、且被歧义引发的澄清轮次打断。task-card（单轮改写）无法澄清；它只结构化已有的内容。

## 决策

意图对齐桥（`packages/guard/intent-bridge`，`@huiliyi37/dsh-intent-bridge`，ctx key `intentBridge`）拆分职责：低成本**对齐模型**（minimax MiniMax-M3，已在 pi-ai catalog）在专用对齐会话中与用户做多轮意图对齐；意图清晰后调用 `finalize_alignment`，桥把结构化任务卡（task-card 契约）交给**全新主会话**。主会话从不继承对齐上下文——只接收任务卡——因此它是干净的顶层会话：task-card 幂等（不改写）、zen triage 不跳过多行任务卡、主模型在禅相位锚定后解锁全量工具面。

- **对齐会话。** `createAlignedSession()` 创建路由到 `alignProvider`/`alignModel` 的顶层 agent，seed 一组已完成的 `zen/phase` 序列（`{zen, arm}` → `{full, timeout}`），zen 的 resume 分支（历史存在）因此绝不 arm 它（`packages/guard/zen/src/index.ts:441-447`）；桥以 agent-scoped 方式注册 `finalize_alignment`（agent-scoped 工具绕过 restrict 的 allow 列表——zen 的 `zen_anchor` 是同一模式）并安装 `tools.restrict({ allow: [] })` 使任何全局工具不可见。`session/title { '意图对齐' }` 事件标记 tab。`intent:policy` 提示段只在对齐会话存活时渲染对齐契约。
- **多轮澄清就是普通 turn。** 对齐模型提问（纯文本、无工具调用）→ turn 结束 → 用户经 `followup` 回答 → 下一轮。无需挂起等待机制。
- **交接。** `finalize_alignment` 在边界校验（`parseFinalizeArgs`：非空 title/goal、约束/验收 ≤4 条、非法调用拒绝回模型）、以逐字原文渲染任务卡（task-card 的 `renderTaskCard(card, original)`）、创建主会话（路由到 `execProvider`/`execModel`）、把任务卡作为首条用户消息喂入、在主会话记录 log-only 的 `intent-bridge/handoff`、并 emit `intent-bridge/handoff` 派发事件（TUI 监听并 `switchSession`）。
- **失败路径绝不阻塞任务。** 对齐轮数耗尽（`alignMaxRounds`，默认 5）→ 强制产出模板任务卡并 reject 该 step；对齐 agent 出错 → 逐字原文直通主会话（task-card 单轮改写兜底）。
- **TUI 接线。** `newSession()` 在装配桥时创建对齐会话（否则行为不变）；handoff 监听自动切到主会话。bundle 装配双路由（`minimax/MiniMax-M3` + `deepseek-official/deepseek-v4-flash`）。
- **不变量。** `@huiliyi37/dsh-intent-bridge/invariant` 从权威会话日志验证：每会话至多一条 handoff 记录且 reason 已知；handoff 后的带卡首条用户消息保留非空逐字原文。

## 备选方案否决

- **主会话内模型切换**——否决：继承全部上下文（违背需求），且不存在会话中途路由切换机制。
- **`ask_user_question` 挂起式澄清**——否决：强制结构化提问工具 + 挂起链路，丢失对话语境；普通 turn 更简单且已被证明（btw-controller 单轮样板）。
- **主模型纯提示引导**——否决：模型侧纪律，无法强制执行；zen 消融已证明引导救不了劣质面。

## 后果

- 每个新 TUI 会话从可见的对齐 tab 开始；澄清发生在那里，意图清晰后才创建主会话。
- 主会话是干净会话：首条消息 = 任务卡（逐字原文保留）、zen arm、锚定进行。
- 每新会话多一次对齐模型调用；成本由 `alignMaxRounds` 与短澄清轮次约束。
- `task-card` 与 `zen` 零改动（只复用其契约）。

## 测试

- `tests/align.spec.ts` — 对齐契约文本 + finalize 参数校验表（15 测试）。
- `tests/intent-bridge.spec.ts` — 全链路 scripted-model 集成：多轮对齐 → finalize → 主会话任务卡 → zen arm；轮数耗尽强制模板卡；非法 finalize 拒绝且不建主会话；disabled 响亮失败（4 测试）。
- `tests/invariant.spec.ts` — handoff 记录不变量（live append 与晚注册，8 测试）。
- keyless 快照（`examples/headless-agent/tests/intent-bridge.snapshot.ts`，真实 Loader + 双 provider 路由的 replay 适配器）：单轮对齐 → 主会话持久化日志含任务卡 → handoff 记录 → zen arm；对齐会话 seed full 且带标题。
- 27 包测试 + 快照 macOS 全绿；zen（61）、task-card（28）、TUI app（260）套件重跑无回归。

## 相关

- [禅相位工程范式](2026-08-17-zen-phase-engineering-paradigm.md) — 主会话进入的锚定面相位。
- [任务卡首条消息](2026-08-18-task-card-first-message.md) — 桥复用的卡片契约与单轮改写。
- [MiniMax-M3 provider 支持](../../../docs/config-catalog.md) — pi-ai 内置 `minimax` provider（v0.78.1 起入 catalog）。
