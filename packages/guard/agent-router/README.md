# @huiliyi37/dsh-agent-router

English | [中文](README.zh.md)

The agent routing layer — base metrics → algorithm → MoE routing → dsh-native subagent dispatch (a port of Tianshu's prediction-error pure-function core, incrementally trimmed).

## Mechanics

- **prediction** (tool success/failure prediction): a sliding window of 10; error rate ≥0.4/0.6/0.8 → the three intervention levels hint/gate/escalate; 3 consecutive successes → tipping-point reset (environment recovered, interventions withdrawn).
- **router** (deterministic routing table):
  1. escalate (error rate ≥0.8) → `delegate verifier` (independent-channel recheck)
  2. gate (≥0.6) + probe cooldown exhausted → `delegate code_scout` (fresh-angle reconnaissance)
  3. default `self` — obligations/verifications are collected into the metrics but no rule consumes them yet; probe duty stays with the evidence gate
- **dispatch** (the dsh subagent seam): `ctx.subagents.start` (named provider, default `spawn`) delivers the task as the child's first user message → `await run.result` (structured terminal state) → `dispose` cleans up. The seam stamps the lineage (`parentSession`/`origin: 'subagent'`/`delegationDepth`), so routed children appear under `/subagents`, `list_agents`, and the descendants projection, and zen never arms them. The profile tool restriction installs via `toolFilter` fail-loud — unknown tool names or a missing service abort the dispatch, so a profile never silently runs with the full tool surface. When agent-definitions is present, dispatch resolves `code_scout → explore` or `verifier → verify` by cwd, intersects the role tools with the profile ceiling, and transfers the persona; unknown roles or empty intersections fail loud. Both router profiles are confined with `sandboxMode: 'read-only'` at the dispatch boundary even when definitions are absent or an override omits sandbox metadata; the in-process seam pairs that ceiling with approval policy `never`. Each accepted auto delegate appends `router/route` with its decision identity, then records `dispatched:true` without waiting for settlement. Settlement appends exactly one paired `router/outcome`, including `stopReason: 'error'` for an infrastructure rejection after acceptance.

## Assembly

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

## Service surface

`ctx.router` (RouterService):

| Method | Semantics |
|---|---|
| `metrics({ sessionId })` | Current metrics snapshot (interventionLevel/unresolvedHigh/verifications/probeCooledTargets) for that session's accumulator |
| `decide({ sessionId })` | Routing decision (pure function, safe to call repeatedly) from that session's accumulator |
| `execute(action, { sessionId, signal? })` | Executes an action (delegate → dispatches a subagent through the seam and returns `{ sessionId, stopReason, output, budget, finding? }` — `finding` is the bounded structured capture, present only when the child completed and its capture passed the parent-boundary shape check; self → null); `sessionId` names the live parent session the child lineage derives from |
| `resetPrediction(sessionId?)` | Resets the prediction accumulator (one session; all sessions when omitted) |

## Configuration

```ts
declare const ctx: any
declare const apply: (ctx: any, config: Record<string, unknown>) => void
export {}
apply(ctx, {
  dispatchEnabled: true,   // 是否实际派发（false 时只决策不回显）
  provider: 'deepseek',    // 子代理模型（auto + dispatchEnabled 时必需）
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
    timeoutMs: 600_000,    // 子代理墙钟预算毫秒（1..2_147_483_647）
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
## Modules

- `prediction.ts` — tool success/failure prediction accumulator (Tianshu pure-function core, zero dependencies)
- `router.ts` — deterministic routing table (metrics → action) with the escalation-hysteresis policy
- `dispatch.ts` — dsh subagent-seam dispatch (start/result/dispose) with fail-loud profile tool restriction, optional role persona/tool intersection, mandatory read-only confinement and structured-finding capture
- `synthesis.ts` — main-agent synthesis section + adoption declaration (`router:synthesis` rendering quoting persisted findings verbatim, `router_adopt` arg validation, outcome-minus-adoption pending derivation)
- `budget.ts` — dispatch budget pricing (Tianshu-shaped turns-by-file pricing with double ceilings; compute-and-record)
- `evaluation.ts` — pure projections from the session log: observation windows → `router/evaluation` classification, shadow-readiness and canary-health evidence
- `finding.ts` — bounded structured findings: closed discriminant output schemas per profile and the one-shot parent-boundary sanitization (fold/single-line/truncate)
- `ids.ts` — branded `RouterDecisionId`; synchronous appends use short `rtdec-<seq>` ids, while auto-admission reservations add a random suffix so concurrent not-yet-logged decisions cannot collide
- `promotion.ts` — the two deterministic promotion gates as pure functions: `resolveShadowReadinessGate` (samples/false-green/scope over `readiness.*`) and `resolveCanaryHealthGate` (dispatches/adopt-reject/budget share/benefit proxy over `canary.*`); verdicts are recorded, mode switches stay human
- `index.ts` — Cordis plugin wiring (event collection + full decision ledger + service surface + dispatchability-gated synthesis contributions)
- `invariant.ts` — runtime-invariant companion: validates the `router/route`/`router/outcome`/`router/adoption`/`router/decision`/`router/evaluation`/`router/gate` records (payload shape, per-session route→outcome→adoption and decision→evaluation pairing state, bounded findings, live-child lineage; loaded history re-validates at late registration)

## Verification

```sh
pnpm vitest run packages/guard/agent-router/tests/
```

## Model Experience

Indirectly, through dsh-native subagent dispatch: the routed task becomes the delegate session's ordinary user message, and results flow back through logged session events.

#### KV Cache effect

None directly; the delegate session is an independent model request, and the parent request prefix is untouched by routing decisions.

## Known Limitations and Deferred Work

- **Auto requires explicit model configuration** — `trigger.mode: 'auto'` with `dispatchEnabled: true` fails at assembly unless non-empty `provider` and `model` values are present. Shadow/off assemblies may omit them; such assemblies do not register `router:synthesis` or `router_adopt`, because they cannot produce an outcome to synthesize.
- **Dispatch requires a live parent session** — `execute` takes the parent `sessionId` and fails loud when that session is not a live agent; the seam derives the child's workspace, lineage, and delegation depth from it.
- **Turn-end trigger ships in shadow** — the shipped TUI mounts `trigger: { mode: 'shadow', onTurnEnd: true }`: every non-zen qualified turn-end records a log-only `router/decision` (self and delegate alike, carrying the full metrics snapshot), delegate decisions are never dispatched in shadow. Switching to `auto` is a product call after the readiness gate is satisfied on real shadow data; `auto` requires `provider`/`model` plus the five explicit `auto.*` canary caps. The trigger skips a session whose folded `zen/phase` is still `zen` — the alignment/anchoring turns run on a restricted tool face whose outcomes are no routable signal, so nothing is decided, recorded, or dispatched until promotion to `full` — and it runs outside the `turn/end` publish window, because a synchronous `router/decision` append would reenter `Session.append` mid-publish and trip its reentry guard.
- **Synthesis is the main agent's act** — when unresolved child findings exist, `router:synthesis` lists the persisted bounded values verbatim and `router_adopt` records one adopt/reject declaration as log-only `router/adoption`. The dynamic synthesis text enters the prompt as a single-pass variable value, so literal `{{...}}` inside a finding is not interpreted as another prompt reference. The router never merges or votes.
- **Promotion gates record, humans switch** — each closed observation window appends one `router/evaluation` (recovered/persisted/inconclusive), followed by a log-only `router/gate` verdict. Shadow readiness requires the configured total sample count plus at least one evaluated delegate; canary health requires both actual and evaluated dispatches to reach `canary.minDispatches` before checking declarations, budget share, and benefit. Gates never switch mode. `agent/disposed` aborts and awaits that session's admitted triggers before closing its final windows.
- **Auto dispatches are budget-enforced and restart-stable** — `auto.maxSteps`/`auto.timeoutMs` ride `SubagentStartRequest.runBudget`; timeout values above the platform timer limit fail at assembly. Durable child terminals cannot be rewritten by later cancellation or timers. Admission reserves cap/cooldown capacity before provider startup; restart projects accepted auto routes together with decisions, so an acceptance that crashed before its decision still consumes capacity. Plugin disposal aborts and awaits active triggers before unregistering its tool and prompt contributions.
- **The prediction window is in-memory** — the sliding window and tipping-point state vanish with the process. Accumulation is keyed per session and child sessions (`header.parentSession`) are excluded, so routed children never pollute their parent's window.
- **The routing table is a fixed policy** — the three intervention thresholds (0.4/0.6/0.8) and the action mapping are the Tianshu constants from the port; configurability waits for real tuning demand.
- **Profile tool sets are deployment-scoped** — the built-in defaults name the shipped tool catalog (`grep`/`read`/`glob`/`repo_graph`/`semantic_search`/`bash`); a slim assembly declares its own subset via `profileTools`, and unknown names fail the dispatch loudly rather than widening the tool face.
