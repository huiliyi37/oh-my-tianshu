# @huiliyi37/dsh-agent-router

English | [中文](README.zh.md)

The agent routing layer — base metrics → algorithm → MoE routing → dsh-native subagent dispatch (a port of Tianshu's prediction-error pure-function core, incrementally trimmed).

## Mechanics

- **prediction** (tool success/failure prediction): a sliding window of 10; error rate ≥0.4/0.6/0.8 → the three intervention levels hint/gate/escalate; 3 consecutive successes → tipping-point reset (environment recovered, interventions withdrawn).
- **router** (deterministic routing table):
  1. escalate (error rate ≥0.8) → `delegate verifier` (independent-channel recheck)
  2. gate (≥0.6) + probe cooldown exhausted → `delegate code_scout` (fresh-angle reconnaissance)
  3. unresolved obligations + zero verifications → `self` (write a probe first)
  4. default `self`
- **dispatch** (the dsh subagent seam): `ctx.subagents.start` (named provider, default `spawn`) delivers the task as the child's first user message → `await run.result` (structured terminal state) → `dispose` cleans up. The seam stamps the lineage (`parentSession`/`origin: 'subagent'`/`delegationDepth`), so routed children appear under `/subagents`, `list_agents`, and the descendants projection, and zen never arms them. The profile tool restriction installs via `toolFilter` fail-loud — unknown tool names or a missing service abort the dispatch, so a profile never silently runs with the full tool surface. Results are accounted back to evidence-gate automatically through session/event (zero new channels).

## Assembly

```ts
declare const ctx: any
export {}
// cordis.yml 或宿主装配（可选 evidence-gate 联动；无它时 prediction 独立工作）
plugins: ['@huiliyi37/dsh-agent-router']

// 宿主调用（任务边界或 turn 结束）：
const router = ctx.router
const action = router.decide()
if (action.kind === 'delegate') {
  const subagentId = await router.execute(action, { sessionId })  // 派发子代理（父会话必填）
  // 结果经事件流自动归账
}
```

## Service surface

`ctx.router` (RouterService):

| Method | Semantics |
|---|---|
| `metrics()` | Current metrics snapshot (interventionLevel/unresolvedHigh/verifications/probeCooledTargets) |
| `decide()` | Routing decision (pure function, safe to call repeatedly) |
| `execute(action, { sessionId, signal? })` | Executes an action (delegate → dispatches a subagent through the seam and returns the child sessionId; self → null); `sessionId` names the live parent session the child lineage derives from |
| `resetPrediction()` | Resets the prediction accumulator |

## Configuration

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
})

```
## Modules

- `prediction.ts` — tool success/failure prediction accumulator (Tianshu pure-function core, zero dependencies)
- `router.ts` — deterministic routing table (metrics → action)
- `dispatch.ts` — dsh subagent-seam dispatch (start/result/dispose) with fail-loud profile tool restriction
- `index.ts` — Cordis plugin wiring (event collection + service surface)
- `invariant.ts` — runtime-invariant companion

## Verification

```sh
pnpm vitest run packages/guard/agent-router/tests/
```

## Model Experience

Indirectly, through dsh-native subagent dispatch: the routed task becomes the delegate session's ordinary user message, and results flow back through logged session events.

#### KV Cache effect

None directly; the delegate session is an independent model request, and the parent request prefix is untouched by routing decisions.

## Known Limitations and Deferred Work

- **Dispatch requires explicit model configuration** — with `dispatchEnabled: true`, `provider`/`model` must be supplied; unconfigured, the router only decides without dispatching (decision results stay queryable).
- **Dispatch requires a live parent session** — `execute` takes the parent `sessionId` and fails loud when that session is not a live agent; the seam derives the child's workspace, lineage, and delegation depth from it.
- **The prediction window is in-memory** — the sliding window and tipping-point state vanish with the process; cross-session error-rate profiles are deferred work.
- **The routing table is a fixed policy** — the three intervention thresholds (0.4/0.6/0.8) and the action mapping are the Tianshu constants from the port; configurability waits for real tuning demand.
- **Profile tool sets are deployment-scoped** — the built-in defaults name the shipped tool catalog (`grep`/`read`/`glob`/`repo_graph`/`semantic_search`/`bash`); a slim assembly declares its own subset via `profileTools`, and unknown names fail the dispatch loudly rather than widening the tool face.
