# @huiliyi37/dsh-agent-router

[English](README.md) | 中文

agent 路由层——基础指标 → 算法 → MoE 路由 → dsh 原生子代理派发（天枢 prediction-error 纯函数核心移植，增量精简）。

## 机制

- **prediction**（工具成败预测）：窗口 10 滑动，错误率 ≥0.4/0.6/0.8 → hint/gate/escalate 三级干预；连续 3 次正确 → tipping point 重置（环境恢复，干预撤销）。
- **router**（确定性路由表）：
  1. escalate（错误率 ≥0.8）→ `delegate verifier`（独立通道复核）
  2. gate（≥0.6）+ 探针冷却耗尽 → `delegate code_scout`（新角度侦查）
  3. 默认 `self` — 义务/验证计数已采集进指标但尚无规则消费；先写探针的责任在证据门
- **dispatch**（dsh 子代理 seam）：`ctx.subagents.start`（named provider，默认 `spawn`）把任务作为 child 首条用户消息投递 → `await run.result`（结构化终态）→ `dispose` 清理。seam 自动写血统（`parentSession`/`origin: 'subagent'`/`delegationDepth`），被路由的 child 进入 `/subagents`、`list_agents` 与后代投影，且 zen 永不 arm 它们。profile 工具限制经 `toolFilter` fail loud 安装——未知工具名或缺失服务会中止派发，profile 绝不带着全量工具面静默运行。agent-definitions 服务在场时，派发按 cwd 解析 profile 的角色（`code_scout → explore`、`verifier → verify`），工具收紧为「角色工具集 ∩ profile 天花板」，并透传角色 persona 与 `read-only` 沙箱；未知角色或空交集 fail loud。每个被接受的 delegate 会在父会话落一条 log-only 的 `router/route` 记录（决策可审计），child settle 后落配对的 `router/outcome` 记录（终态可自日志重建；完成的结构化捕获落为有界 `finding`）。结果经 session/event 自动归账回 evidence-gate（零新通道）。

## 装配

```ts
declare const ctx: any
declare const sessionId: string
export {}
// cordis.yml 或宿主装配（可选 evidence-gate 联动；无它时 prediction 独立工作）
plugins: ['@huiliyi37/dsh-agent-router']

// 宿主调用（任务边界或 turn 结束）：
const router = ctx.router
const action = router.decide({ sessionId })
if (action.kind === 'delegate') {
  const subagentId = await router.execute(action, { sessionId })  // 派发子代理（父会话必填）
  // 结果经事件流自动归账
}
```

## 服务面

`ctx.router`（RouterService）：

| 方法 | 语义 |
|---|---|
| `metrics({ sessionId })` | 当前指标快照（interventionLevel/unresolvedHigh/verifications/probeCooledTargets），取自该会话的累计器 |
| `decide({ sessionId })` | 路由决策（纯函数，可重复调用），取自该会话的累计器 |
| `execute(action, { sessionId, signal? })` | 执行动作（delegate → 经 seam 派发子代理，返回 `{ sessionId, stopReason, output, budget, finding? }`——`finding` 为有界结构化捕获，仅 child 完成且捕获通过父边界形状校验时存在；self → null）；`sessionId` 为父会话（活 agent），child 血统自此派生 |
| `resetPrediction(sessionId?)` | 重置预测累计器（单个会话；缺省清空全部会话） |

## 配置

```ts
declare const ctx: any
declare const apply: (ctx: any, config: Record<string, unknown>) => void
export {}
apply(ctx, {
  dispatchEnabled: true,   // 是否实际派发（false 时只决策不回显）
  provider: 'deepseek',    // 子代理模型（派发必需）
  model: 'deepseek-v4-flash',
  subagentProvider: 'spawn', // 可选：子代理 provider（缺省 spawn；需 ctx.subagents 已注册）
  profileTools: {          // 可选：profile 工具集覆盖（缺省用内置只读/验证集合）
    codeScout: ['read', 'bash'],
    verifier: ['read', 'bash'],
  },
  trigger: {               // 可选：turn-end 触发（缺省 off 不触发）
    mode: 'shadow',        // shadow 只决策并记录；auto 决策并派发（canary 上限必填，见 auto）
    onTurnEnd: true,
  },
  escalation: {            // 可选：升级迟滞（缺省 cap verifier、连续失败 ≥2）
    cap: 'verifier',       // 'off' 关闭升级分支
    minConsecutiveFailures: 2,
  },
  evaluation: {            // 可选：决策评估观察窗口（缺省 8/3/3/0.5）
    windowToolResults: 8,  // 决策后计多少条父会话 tool/result
    minSamples: 3,         // 归账最小样本（不足 → inconclusive）
    recoveredConsecutive: 3, // 尾部连续成功达此 → recovered
    persistedErrorRate: 0.5, // 窗口错误率达此 → persisted
  },
  readiness: {             // 可选：shadow readiness 关卡阈值（缺省 30/30/0/0.5）
    window: 30,            // 统计最近多少条已评估决策
    minSamples: 30,        // 最小样本（低于即 veto）
    maxFalseGreenRate: 0,  // 假绿率上限（> 即 veto）
    persistedScopeShare: 0.5, // persisted 占比达此 → scopeHealth high
  },
  canary: {                // 可选：canary health 关卡阈值（缺省 30/10/0.1/0.5）
    window: 30,            // 统计最近多少次真实派发
    minDispatches: 10,     // 最小派发数
    maxBudgetExhaustedShare: 0.1, // 预算耗尽占比上限
    minBenefitProxy: 0.5,  // 收益代理（recovered 占比）下限
  },
  auto: {                  // mode 'auto' 时五字段全部必填（灰度装配值，缺即 fail loud）
    maxConcurrent: 1,      // 每会话同时在飞自动派发上限
    maxTotal: 3,           // 每会话累计自动派发上限
    cooldownTurns: 3,      // 两次自动派发间的最小合格 turn 间隔（self 轮也计数）
    maxSteps: 24,          // 子代理步数预算（seam runBudget 强制）
    timeoutMs: 600_000,    // 子代理墙钟预算毫秒（seam runBudget 强制）
  },
  synthesis: {             // 可选：主代理综合提示 rubric（缺省内置角色裁定纪律）
    section: '...',        // 覆盖 rubric 文本；存在未综合 child 结论时渲染
  },
  budget: {                // 可选：派发预算（方案 a：计算与记录，不强制）
    defaultMaxTurns: 48,   // 回合预算（每多一个目标文件 +6）
    ceilMaxTurns: 100,     // 回合绝对帽
    ceilTimeoutMs: 1_800_000, // 墙钟预算（毫秒，单发绝对帽）
    turnsPerExtraFile: 6,
  },
})

```
## 模块

- `prediction.ts` — 工具成败预测累计器（天枢纯函数核心，零依赖）
- `router.ts` — 确定性路由表（指标 → 动作），含升级迟滞策略
- `dispatch.ts` — dsh 子代理 seam 派发（start/result/dispose），profile 工具限制 fail loud，可选已解析角色（persona/沙箱/只读工具交集）与结构化 finding 捕获
- `synthesis.ts` — 主代理综合节 + 采用声明（`router:synthesis` 逐字引用持久 finding 渲染、`router_adopt` 参数校验、outcome 减 adoption 的未综合推导）
- `budget.ts` — 派发预算定价（天枢同构按文件数加回合 + 双绝对帽；只计算与记录）
- `evaluation.ts` — 会话日志的纯投影：观察窗口 → `router/evaluation` 分类，shadow-readiness 与 canary-health 证据
- `finding.ts` — 有界结构化 finding：每 profile 的闭合判别 outputSchema + 父边界一次性净化（折叠/单行化/截断）
- `ids.ts` — 品牌化 `RouterDecisionId`（`rtdec-<seq>`，append 时点按 `seq = log.length` 连续性契约铸造）
- `promotion.ts` — 两道确定性晋升关卡纯函数：`resolveShadowReadinessGate`（样本/假绿/范围，阈值取 `readiness.*`）与 `resolveCanaryHealthGate`（派发/adopt-reject/预算占比/收益代理，阈值取 `canary.*`）；判定只留痕，模式切换始终人工
- `index.ts` — Cordis 插件接线（事件采集 + 全量决策账本 + 服务面 + 按可派发性门控的综合面贡献）
- `invariant.ts` — 运行时不变量 companion：校验 `router/route`/`router/outcome`/`router/adoption`/`router/decision`/`router/evaluation`/`router/gate` 记录（payload 形状、按会话 adoption↔outcome 与 decision↔evaluation 配对状态、有界 finding、live child 血统；已加载历史在晚注册时重放校验）

## 验证

```sh
pnpm vitest run packages/guard/agent-router/tests/
```

## Model Experience

Indirectly, through dsh-native subagent dispatch: the routed task becomes the delegate session's ordinary user message, and results flow back through logged session events.

#### KV Cache effect

None directly; the delegate session is an independent model request, and the parent request prefix is untouched by routing decisions.

## Known Limitations and Deferred Work

- **派发需要显式模型配置** — `dispatchEnabled: true` 时必须提供 `provider`/`model`；未配置时只决策不派发（决策结果仍可查询），且综合面贡献（`router:synthesis` 节、`router_adopt` 工具）不注册——不可派发即无 outcome 可综合，模型面不背死重。
- **派发需要活的父会话** — `execute` 接收父 `sessionId`，该会话不是活 agent 时 fail loud；seam 从父会话派生 child 的 workspace、血统与委派深度。
- **turn-end 触发以 shadow 发货** — 发货 TUI 挂 `trigger: { mode: 'shadow', onTurnEnd: true }`：每个非 zen 的合格 turn-end 都落一条 log-only `router/decision`（self 与 delegate 全量，携带完整指标快照），shadow 下 delegate 决策绝不派发。切 `auto` 是 readiness 关卡在真实 shadow 数据上通过后的产品决定；`auto` 需要 `provider`/`model` 加五个显式 `auto.*` canary 上限。触发会跳过 `zen/phase` 折叠仍为 `zen` 的会话——对齐/锚定轮跑在受限工具面上，其成败不构成可路由信号，晋升 `full` 前不决策、不记录、不派发；且触发在 `turn/end` 发布窗口之外执行，否则 shadow 的 `router/decision` append 会在发布中重入 `Session.append` 并撞上重入守卫。
- **综合是主代理的行为** — 存在未综合 child 结论时渲染 `router:synthesis` 提示节（完成的 child 的有界 finding 逐字引用——持久值即模型可见值），`router_adopt` 工具把采用/拒绝声明落成 log-only `router/adoption`（每条 outcome 至多一条，工具边界与 invariant companion 配对状态双重强制）。router 从不合并或投票，只搬运结论与声明。
- **晋升关卡只留痕，切模式是人工动作** — 每个闭合的观察窗口落一条 `router/evaluation`（recovered/persisted/inconclusive）并随后落一条 log-only `router/gate` 判定：shadow-readiness（样本/假绿/范围，阈值取 `readiness.*`）恒记录，canary-health（真实派发、adopt/reject 覆盖、预算耗尽占比、收益代理，阈值取 `canary.*`）在 auto 下记录。关卡绝不自行切模式；晋升 `auto` 是人工配置变更。会话的最后一条决策在 `agent/disposed` 时以 final 窗口收尾归账，尾部样本不静默丢失。
- **auto 派发在 seam 层强制预算** — `auto.maxSteps`/`auto.timeoutMs` 走 `SubagentStartRequest.runBudget`：进程内 driver 以子作用域 pre-step 计数强制步数、组合信号计时器强制墙钟，越界以可区分的 `budget-exhausted` 终态收敛（区别于 `aborted`）；无法保证该契约的 provider 在启动前被拒。`budget` 配置本身仍是随 route 记录的计算与记录型定价。auto 派发另受每会话单飞锁、累计帽与合格 turn 冷却（self 轮也推进冷却时钟）约束，父 dispose 经被跟踪的 controller 收敛在飞 run。
- **预测窗口是内存态** — 滑动窗口与 tipping point 状态随进程消失。累计按会话隔离且排除 child 会话（`header.parentSession`），被路由的子代理绝不污染父会话窗口。
- **路由表是固定策略** — 三级干预阈值（0.4/0.6/0.8）与动作映射为移植时的天枢常量；可配置化随实际调参需求再做。
- **profile 工具集随部署而定** — 内置默认面向发货工具目录（`grep`/`read`/`glob`/`repo_graph`/`semantic_search`/`bash`）；精简装配经 `profileTools` 声明自己的子集，未知工具名会让派发响亮失败而不是放宽工具面。
