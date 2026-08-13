# @huiliyi37/dsh-agent-router

[English](README.md) | 中文

agent 路由层——基础指标 → 算法 → MoE 路由 → dsh 原生子代理派发（天枢 prediction-error 纯函数核心移植，增量精简）。

## 机制

- **prediction**（工具成败预测）：窗口 10 滑动，错误率 ≥0.4/0.6/0.8 → hint/gate/escalate 三级干预；连续 3 次正确 → tipping point 重置（环境恢复，干预撤销）。
- **router**（确定性路由表）：
  1. escalate（错误率 ≥0.8）→ `delegate verifier`（独立通道复核）
  2. gate（≥0.6）+ 探针冷却耗尽 → `delegate code_scout`（新角度侦查）
  3. 义务未决 + 零验证 → `self`（先写探针）
  4. 默认 `self`
- **dispatch**（dsh 原生子代理）：`ctx.agents.create` → `followup` 注入任务 → `whenIdle` 等待 → `dispose` 清理。结果经 session/event 自动归账回 evidence-gate（零新通道）。

## 装配

```ts
declare const ctx: any
export {}
// cordis.yml 或宿主装配（可选 evidence-gate 联动；无它时 prediction 独立工作）
plugins: ['@huiliyi37/dsh-agent-router']

// 宿主调用（任务边界或 turn 结束）：
const router = ctx.router
const action = router.decide()
if (action.kind === 'delegate') {
  const subagentId = await router.execute(action)  // 派发子代理
  // 结果经事件流自动归账
}
```

## 服务面

`ctx.router`（RouterService）：

| 方法 | 语义 |
|---|---|
| `metrics()` | 当前指标快照（interventionLevel/unresolvedHigh/verifications/probeCooledTargets） |
| `decide()` | 路由决策（纯函数，可重复调用） |
| `execute(action)` | 执行动作（delegate → 派发子代理，返回子代理 sessionId；self → null） |
| `resetPrediction()` | 重置预测累计器 |

## 配置

```ts
declare const ctx: any
declare const apply: (ctx: any, config: Record<string, unknown>) => void
export {}
apply(ctx, {
  dispatchEnabled: true,   // 是否实际派发（false 时只决策不回显）
  provider: 'deepseek',    // 子代理模型（派发必需）
  model: 'deepseek-v4-flash',
})

```
## 模块

- `prediction.ts` — 工具成败预测累计器（天枢纯函数核心，零依赖）
- `router.ts` — 确定性路由表（指标 → 动作）
- `dispatch.ts` — dsh 原生子代理派发（create/followup/whenIdle/dispose）
- `index.ts` — Cordis 插件接线（事件采集 + 服务面）
- `invariant.ts` — 运行时不变量 companion

## 验证

```sh
pnpm vitest run packages/guard/agent-router/tests/
```

## Model Experience

Indirectly, through dsh-native subagent dispatch: the routed task becomes the delegate session's ordinary user message, and results flow back through logged session events.

#### KV Cache effect

None directly; the delegate session is an independent model request, and the parent request prefix is untouched by routing decisions.

## Known Limitations and Deferred Work

- **派发需要显式模型配置** — `dispatchEnabled: true` 时必须提供 `provider`/`model`；未配置时只决策不派发（决策结果仍可查询）。
- **预测窗口是内存态** — 滑动窗口与 tipping point 状态随进程消失；跨会话的错误率画像为延期工作。
- **路由表是固定策略** — 三级干预阈值（0.4/0.6/0.8）与动作映射为移植时的天枢常量；可配置化随实际调参需求再做。
