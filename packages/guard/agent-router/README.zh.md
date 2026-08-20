# @huiliyi37/dsh-agent-router

[English](README.md) | 中文

agent 路由层——基础指标 → 算法 → MoE 路由 → dsh 原生子代理派发（天枢 prediction-error 纯函数核心移植，增量精简）。

## 机制

- **prediction**（工具成败预测）：窗口 10 滑动，错误率 ≥0.4/0.6/0.8 → hint/gate/escalate 三级干预；连续 3 次正确 → tipping point 重置（环境恢复，干预撤销）。
- **router**（确定性路由表）：
  1. escalate（错误率 ≥0.8）→ `delegate verifier`（独立通道复核）
  2. gate（≥0.6）+ 探针冷却耗尽 → `delegate code_scout`（新角度侦查）
  3. 默认 `self` — 义务/验证计数已采集进指标但尚无规则消费；先写探针的责任在证据门
- **dispatch**（dsh 子代理 seam）：`ctx.subagents.start`（named provider，默认 `spawn`）把任务作为 child 首条用户消息投递 → `await run.result`（结构化终态）→ `dispose` 清理。seam 自动写血统（`parentSession`/`origin: 'subagent'`/`delegationDepth`），被路由的 child 进入 `/subagents`、`list_agents` 与后代投影，且 zen 永不 arm 它们。profile 工具限制经 `toolFilter` fail loud 安装——未知工具名或缺失服务会中止派发，profile 绝不带着全量工具面静默运行。每个被接受的 delegate 会在父会话落一条 log-only 的 `router/route` 记录（决策可审计），child settle 后落配对的 `router/outcome` 记录（终态可自日志重建）。结果经 session/event 自动归账回 evidence-gate（零新通道）。

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
| `execute(action, { sessionId, signal? })` | 执行动作（delegate → 经 seam 派发子代理，返回 `{ sessionId, stopReason, output }`；self → null）；`sessionId` 为父会话（活 agent），child 血统自此派生 |
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
    mode: 'shadow',        // shadow 只决策并记录；auto 决策并派发
    onTurnEnd: true,
  },
  escalation: {            // 可选：升级迟滞（缺省 cap verifier、连续失败 ≥2）
    cap: 'verifier',       // 'off' 关闭升级分支
    minConsecutiveFailures: 2,
  },
})

```
## 模块

- `prediction.ts` — 工具成败预测累计器（天枢纯函数核心，零依赖）
- `router.ts` — 确定性路由表（指标 → 动作）
- `dispatch.ts` — dsh 子代理 seam 派发（start/result/dispose），profile 工具限制 fail loud
- `index.ts` — Cordis 插件接线（事件采集 + 服务面）
- `invariant.ts` — 运行时不变量 companion：校验 `router/route` 记录（payload 形状 + live child 血统；已加载历史在晚注册时重放校验）

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
- **派发需要活的父会话** — `execute` 接收父 `sessionId`，该会话不是活 agent 时 fail loud；seam 从父会话派生 child 的 workspace、血统与委派深度。
- **turn-end 触发以 shadow 发货** — 发货 TUI 挂 `trigger: { mode: 'shadow', onTurnEnd: true }`：delegate 决策落 log-only `router/decision` 但绝不派发。切 `auto` 是闭环验证后的产品决定；`auto` 需要 `provider`/`model`。
- **预测窗口是内存态** — 滑动窗口与 tipping point 状态随进程消失。累计按会话隔离且排除 child 会话（`header.parentSession`），被路由的子代理绝不污染父会话窗口。
- **路由表是固定策略** — 三级干预阈值（0.4/0.6/0.8）与动作映射为移植时的天枢常量；可配置化随实际调参需求再做。
- **profile 工具集随部署而定** — 内置默认面向发货工具目录（`grep`/`read`/`glob`/`repo_graph`/`semantic_search`/`bash`）；精简装配经 `profileTools` 声明自己的子集，未知工具名会让派发响亮失败而不是放宽工具面。
