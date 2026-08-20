# Agent Note: dsh agent-router 移植（S7：指标 → 算法 → MoE 路由 → dsh 原生子代理）

Status: implemented

[English](2026-08-11-agent-router-port.md) | 中文

## 问题

dsh 已有纪律——证据门的"不准做什么"——却没有任何东西回答"该找谁做"。移植源是天枢（opencode-tui）prediction-error 纯函数核心，以及 expert-router 的星域映射思想（仅取其中的路由表部分）。两条用户约束限定了这次移植：**不做重 CMV**——只拿基础指标做算法；**子代理用 dsh 原生**——dsh 有的就用他的，之后慢慢改造。

## 决策

- **新包** `packages/guard/agent-router/`（guard 组，与 evidence-gate 并列）——纪律（证据门"不准做什么"）与调度（路由层"该找谁做"）两层正交。
- **prediction.ts**：天枢 prediction-error 纯函数核心完整移植（窗口 10、`<3 样本 → 0`、阈值 0.4/0.6/0.8 含等于、`consecutiveCorrect >= 3` tipping point）——零依赖（只 import type）。**EFE/computeEFE/adjustReasoningEffort 明确不移植**（依赖 vigor/sensorium/season 重状态，违背"不做重 CMV"）。
- **router.ts**：确定性路由表（纯函数可单测，不做学习/bandit——"之后慢慢改造"）。规则优先级降序：
  1. `escalate`（错误率 ≥0.8）→ delegate verifier（独立通道复核）
  2. `gate`（≥0.6）+ 探针冷却耗尽 → delegate code_scout（新角度侦查）
  3. 义务未决 + 零验证 → self（先写探针——证据门已拦编辑，路由不重复拦）
  4. 默认 self
- **dispatch.ts**：**dsh 原生派发**——`ctx.agents.create({ sessionId, agentOptions })` → `followup` 注入任务文本（Agent 公开方法，最简单可靠的任务入口）→ `whenIdle` 等待 → `dispose` 清理（finally 保证任何路径清理）。**不搬天枢 worker/dispatcher/council 生命周期**。派发走 dsh 子代理 seam：`ctx.subagents.start`（named provider，config `subagentProvider`，默认 `spawn`）把任务作为 child 首条用户消息投递；`await run.result` 结算；`dispose` 清理。seam 自动写 `parentSession`/`origin: 'subagent'`/`delegationDepth`，被路由的 child 进入 `/subagents`/`list_agents`/后代投影，且 zen 永不 arm（zen 按 `parentSession` 跳过）。`execute(action, { sessionId })` 要求活的父会话——seam 从它派生 workspace/血统/深度。profile 工具限制经 `toolFilter` fail loud 安装——未知工具名或缺失服务会中止派发，绝不静默放宽工具面。`profileTools`（Config）覆盖内置默认（如 headless fixture 声明 `['read','bash']` 子集）。
- **index.ts 接线**：`session/event` tool/result → recordPrediction（isError 判定）；evidence tracker 指标经 `ctx.reflect.get('evidence', false)` 可选消费（无 evidence-gate 时 prediction 独立工作）；`ctx.router` 服务面（metrics/decide/execute/resetPrediction）。
- **归账零新通道**：子代理 tool/result 经既有 session/event 自动归账回 evidence-gate。

## 关键验证事实

- 包级测试 37 全绿（prediction 17 / router 8 / dispatch 6 / integration 6）。
- integration（真实 cordis Context + 事件对象，不 mock 中间层）：8 连败 → escalate → delegate verifier → execute 派发调用序断言；3 连成 → tipping point 重置 → decide 回 self；dispatchEnabled:false 不派发。
- 测试驱动修正：mock Context 覆盖真实 `ctx.reflect` 会崩（`ctx.on` 的 proxy 依赖反射层）——**集成测试永远用真实 `new Context()` + provide**，不手改 reflect。
- dispatch 走 `ctx.reflect.get('agents', false)`（Cordis 4 注入代理，第 4 个实例——与 T4/compact/evidence-gate tools 同款）。
- lint 三轮打磨：`block.isError === true`（类型收窄后无需 optional chain）、branded sessionId 直接 toMatch、mockImplementation 同步返回 handle（避免 misused-promise）。

## 不移植清单

EFE 全套、season/vigor/sensorium、天枢 worker/dispatcher/council、bandit-promotion（自适应路由）、expert-router 多专家合并（星域角色表只在路由语义上借鉴）。

## 真实装配（S7 收尾）

- **examples/headless-agent** 挂 agent-router：cli.cordis.yml 加插件（provider/model: cli-mock）+ mock LLM 连败模式（`DSH_CLI_MOCK_FAIL_LOOP=1`，实例字段 failCount 跨轮计数，8 轮失败后回正常回复防死循环）+ driver 暴露 router 状态（`DSH_ROUTER_DEMO=1` 打印 metrics + decide）。
- **真实装配暴露的判定缺口**：dsh bash 对非零退出码**不标 isError**（实测 8 次 `isError: false` 但命令失败，退出码在文本 `[exit code: 1]`）——成败判定 = `isError || 文本含 [exit code: 非0]`。这是"信任 TypeScript 但别信任单一信号"的又一实例。
- **evidence 服务面缺口**：agent-router 消费 `evidence?.cooldown()` 崩溃（服务面无此方法）——evidence-gate 补 `cooldownTable()`/`verificationCount()`（暴露 tracker 已持状态）。
- **e2e 断言教训**：失败计数断言先写 isError:true（过时——真实失败在文本），改为查 `[exit code: 1]` 文本。

## 验证命令

```sh
pnpm vitest run packages/guard/agent-router/tests/                     # 4 文件 37 测试全绿
npx oxlint packages/guard/agent-router/                                # 0 错误
npx tsc -p packages/guard/agent-router/tsconfig.json                   # 0 错误
```

## 曾考虑的替代方案

**连同 prediction 核心一起移植 EFE 全套（EFE/computeEFE/adjustReasoningEffort）**。否决：它依赖 vigor/sensorium/season 重状态，违背"不做重 CMV"约束——只有基础指标进入算法。

**做学习型路由（bandit-promotion / 自适应路由）**。否决：确定性路由表是纯函数、可单测；本次移植的规则是之后慢慢改造，而不是先上一套没有测试能钉住的自适应能力。

**沿用天枢的 worker/dispatcher/council 生命周期**。否决：dsh 本身已具备所需部件——`ctx.agents.create` 加上 `followup`、`whenIdle`、`dispose`——因此派发走 dsh 原生，由 finally 保证任何路径都清理。

**照 expert-router 的做法合并多专家**。否决：只借鉴星域角色表的路由语义；多专家合并不属于这次路由表移植的范围。

**把路由并入 evidence-gate**。否决：纪律与调度是正交的两层，因此路由作为独立的 guard 组包与 evidence-gate 并列落地。

**义务未决且零验证时由路由层拦截编辑**。否决：证据门已经拦编辑，因此该规则改为路由到 self（"先写探针"），不做第二次拦截。

**为子代理归账新增事件通道**。否决：子代理 tool/result 本就流经既有 session/event，会自动归账回 evidence-gate。

**在集成测试里用手改 `ctx.reflect` 的 mock Context**。否决，因为它会崩：`ctx.on` 的 proxy 依赖反射层，所以集成测试用真实 `new Context()` + provide。

## 后果

路由层是建立在基础指标之上的纯决策函数，因此 32 个包级测试加上跑在真实 Context 上的集成用例就能钉住它；没有 evidence-gate 时 prediction 仍独立工作；归账零新增事件类型。代价是所有自适应能力都留在门外：没有 bandit promotion 和 EFE 全套，路由只对写死在表里的错误率阈值与冷却状态作出反应，扩展它意味着加规则，而不是学规则。

派发继承了同样有界的形态。profile 工具限制现在 fail loud 安装（restrict 签名已探明：未知工具名抛错），被委派的子代理只拿到 profile 允许的只读/验证工具集；e2e 证据止于路由决策，未覆盖 verifier 子代理的实际 turn；路由表只带写作时的那几个 profile，没有 doc_scout/verifier 变体；与 evidence-gate 的联系是单向的指标消费——escalate 既不建义务，也不记录 delegate attempt。真实装配换回了两处修正：因为 dsh bash 不标 isError，成败判定改为读取 `[exit code: …]` 文本；evidence-gate 也暴露出 `cooldownTable()`/`verificationCount()`，把 tracker 已持的状态开放出来。
