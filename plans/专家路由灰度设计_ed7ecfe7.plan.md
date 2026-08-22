---
name: 专家路由灰度设计
overview: 先补齐可重构的 shadow 证据、共享子代理预算与结构化结果契约，再由人工证据关卡将 TUI 切到“每会话最多一个自动专家”的保守灰度。共享能力落在 agent-router/subagent 包，headless 仅作为 keyless 验证装配，Web、正式 headless 与 ACP 本轮不接入。
todos:
  - id: shadow-ledger
    content: 补齐 decision/evaluation/gate 持久账本与 shadow readiness 证据
    status: pending
  - id: shared-budget
    content: 扩展 subagent seam，强制 maxSteps、timeout、取消与只读角色边界
    status: pending
  - id: structured-finding
    content: 落地有界结构化 finding、synthesis 与 adoption 闭环
    status: pending
  - id: loader-proof
    content: 用真实 Loader auto 路径和 keyless snapshot 完成上线前证明
    status: pending
  - id: tui-canary
    content: 证据通过后开启 TUI 单专家 auto 灰度并保留一键回退
    status: pending
  - id: docs-gates
    content: 完成 Agent Note、双语文档、生成目录与最小验证
    status: pending
isProject: false
---

# DSH 单专家 Auto 灰度设计

## 目标与边界
- 终点：真实 shadow 证据通过人工关卡后，在 TUI 开启请求级单专家 auto 灰度；不做四专家并行、投票、加权合并或多意图团队编排。
- “共享核心”指共享包契约，不把 agent-router 挂进 base/web/headless/ACP；TUI 是唯一发货消费者，examples/headless-agent 只承担 Loader/e2e/snapshot 证明。
- Macaron 只借用“每轮单选、工具循环粘性、完整子轨迹留在子会话、父会话只接收有界摘要”；不复制 LoRA、token-MoE 或固定四角色。
- 实施前把当前 credentials/OpenRouter/branding 等无关 WIP 隔离到独立分支或 worktree，避免混入本线变更。

```mermaid
flowchart LR
  TurnEnd["Parent turn/end"] --> Decision["router/decision: self or delegate"]
  Decision --> Evaluation["Deterministic shadow evaluation"]
  Evaluation --> Readiness["Shadow readiness report"]
  Readiness -->|"manual approval"| TuiAuto["TUI auto canary"]
  TuiAuto --> Role["Resolve one agent definition"]
  Role --> Run["Budgeted, cancellable subagent run"]
  Run --> Outcome["router/outcome with bounded finding"]
  Outcome --> Synthesis["router:synthesis from durable log"]
  Synthesis --> Adoption["router/adoption"]
  Adoption --> Health["Canary health report"]
  Health -->|"veto"| ShadowRollback["Return TUI to shadow"]
```

## Phase 1 — 完整 shadow 账本与两阶段证据门
- 在 [packages/guard/agent-router/src/index.ts](packages/guard/agent-router/src/index.ts) 将 `router/decision` 改为带品牌化 `decisionId` 的判别联合；每个非 zen 的合格 turn-end 都记录 `self` 或 `delegate`、完整 `RouterMetrics`、模式和派发状态，消除当前只有 delegate 分子的偏差。
- 新增纯函数投影与持久事件，将后续固定窗口内的父会话工具结果归为 `recovered | persisted | inconclusive`；观察窗口与阈值进入校验过的 Config，不写插件常量。
- 重构 [packages/guard/agent-router/src/promotion.ts](packages/guard/agent-router/src/promotion.ts)：区分“shadow readiness”（样本、假绿、范围健康）与“canary health”（实际派发、adopt/reject、预算终态、收益代理），避免在没有真实派发时伪造 margin。关卡只记录 `router/gate`，绝不自行切换模式；产品仍通过配置人工晋升。
- 同步 [packages/guard/agent-router/src/invariant.ts](packages/guard/agent-router/src/invariant.ts) 与单元/集成测试，确保每条 decision 最多一个 evaluation，非法 kind/metrics/id 引用 fail loud。
- 验收：shadow 零派发；任一会话日志可重建合格 turn 分母、self/delegate 比例、指标输入、evaluation 与 veto 理由。

## Phase 2 — 共享预算、取消与角色边界
- 在 [packages/subagent/subagent/src/types.ts](packages/subagent/subagent/src/types.ts) 为 `SubagentStartRequest` 增加相对预算 `{ maxSteps, timeoutMs }`，为 `SubagentCapabilities` 增加 `runBudget`，并扩展 merge-extensible stop reason 表示 `budget-exhausted`；持久 `router/route` 记录解析后的绝对 `deadlineMs`。
- 在 [packages/subagent/subagent-inprocess/src/index.ts](packages/subagent/subagent-inprocess/src/index.ts) 用子作用域 `agent/pre-step` 强制步数，用组合 AbortSignal 强制墙钟和父取消；spawn 声明支持，不能保证该契约的 provider 声明不支持并由 service 在启动前 fail loud。
- 在 [packages/guard/agent-router/src/index.ts](packages/guard/agent-router/src/index.ts) 增加每会话 run controller、单飞锁、派发总帽与冷却；父 agent dispose 时 abort。删除永不触发的临时 `AbortController().signal`。
- 在 [packages/subagent/agent-definitions/src/index.ts](packages/subagent/agent-definitions/src/index.ts) 提供/复用 `explore` 与只读 `verify` 角色；agent-router 配置只映射 `code_scout → explore`、`verifier → verify`。派发时按 cwd 解析角色，把角色工具集与 `profileTools` 天花板求交，并透传 persona、sandbox；未知角色、空交集或 auto 缺 provider/model 均 fail loud。
- 初始 TUI canary 的显式配置上限：每会话同时 1 个、总计 1 个自动派发、至少间隔 3 个合格 turn；`maxSteps=24`、`timeoutMs=600000`。这些是装配值，不是插件默认硬编码。
- 验收：预算越界得到可区分终态；父取消不留孤儿；侦查/复核角色不能写工作区；连续 turn-end 不会重复并发派发。

## Phase 3 — 有界结构化 finding 与可重构综合
- 为 `code_scout` 与 `verifier` 定义闭合、带 discriminant 的 `outputSchema`：共同包含有界 `summary` 和有限 `findings[]`，verifier 额外包含 `supported | unsupported | inconclusive`；完整 child output 只保留在 child session。
- 在 [packages/guard/agent-router/src/dispatch.ts](packages/guard/agent-router/src/dispatch.ts) 请求结构化输出，并把成功捕获写入 `router/outcome`；错误、取消和预算终态不伪造 finding。所有字符串在父边界一次性转义、整体限界后再持久化。
- 在 [packages/guard/agent-router/src/synthesis.ts](packages/guard/agent-router/src/synthesis.ts) 仅从 `router/outcome − router/adoption` 渲染模型可见节；模型看到的 finding 必须与日志中持久值逐字可重构。`router_adopt` 继续保证每个 outcome 恰好一次 adopt/reject。
- 将 `router_adopt` 纳入 [scripts/gen-tool-catalog.ts](scripts/gen-tool-catalog.ts) 与能力分组，更新 tool/config/persistence/event/capability catalogs，避免工具发货后目录门缺项。
- 验收：父模型能看到真实、有界 finding；恶意子输出不能注入提示；无 finding 时不占模型面；adoption 只引用本会话未处理 outcome。

## Phase 4 — Loader 自动触发证明，TUI 仍保持 shadow
- 在 [examples/headless-agent/tests/agent-router.e2e.ts](examples/headless-agent/tests/agent-router.e2e.ts) 与新 keyless fixture 中覆盖真实 `turn/end → auto dispatch`，不再依赖 driver 手调 `router.execute()`。
- 扩充 [examples/headless-agent/tests/headless.snapshot.ts](examples/headless-agent/tests/headless.snapshot.ts) 与 golden，逐字证明：单次派发、预算终态、结构化 outcome、下一轮 synthesis、`router_adopt`、child 不递归触发；另加 auto 缺 provider/model、角色不存在、provider 不支持预算的装配期负例。
- 核心代码落地后，TUI 继续维持 [packages/tui/tui/cordis.patch.yml](packages/tui/tui/cordis.patch.yml) 的 shadow，收集真实会话。人工晋升最低证据：至少 30 条合格 decision、日志/invariant 零损坏、delegate 候选全部可解释、shadow readiness 无 veto；不使用跨会话在线学习或数据库 bandit。
- 未达到证据门时到此停止，不进入 Phase 5。

## Phase 5 — TUI 单专家 Auto 灰度与一键回退
- 在 [packages/tui/tui/cordis.patch.yml](packages/tui/tui/cordis.patch.yml) 显式配置 `mode:auto`、provider/model、角色映射、预算与 canary 上限；初始复用现有 `deepseek-official/deepseek-v4-flash` 路由，避免新增凭据面。
- 更新 [packages/tui/tui/tests/bundle-patch.spec.ts](packages/tui/tui/tests/bundle-patch.spec.ts)；让 zen face 包含 `router_adopt`，避免 synthesis 要求一个当前不可见的工具。
- 灰度期间只收集 canary health，不扩大派发帽。出现取消失效、可写 sandbox、预算失控、事件不变量错误或 gate veto 时，将 TUI 配置改回 `shadow`；已在飞 run 通过父 controller 收敛。
- Web、正式 headless、ACP 和多专家 fan-out 保持不接入。TUI 的现有 descendant/delegation tree 负责展示自动 child；本轮不新建另一套路由 UI。

## 文档与验证
- 新建 `.agents/notes/implemented/feature/2026-08-21-tui-single-expert-auto-rollout` 中英/i18n 三件套；交叉更新 `2026-08-20-agent-router-algorithm-candidates` 与 `2026-08-11-agent-router-port`，记录从 shadow 到 canary 的证据门和被拒绝的四专家并行方案。
- 更新 agent-router、guard、TUI、subagent/agent-definitions README 双语对，以及 [docs/dsh-expert-routing-closed-loop.md](docs/dsh-expert-routing-closed-loop.md)；重生成 config、persistence、tool、capability-seams、event-producer-consumer 与 module-graph 文档。
- 最小验证面：agent-router 单元/集成，subagent seam/provider 预算测试，agent-definitions/tool-subagent 角色边界，TUI bundle/Loader 测试，真实 Loader e2e，keyless snapshot，`doc-sync` 与相关配置/不变量 gate。TUI 产品行为变更的 PR 录制真实流程 GIF；不默认跑全仓套件。
