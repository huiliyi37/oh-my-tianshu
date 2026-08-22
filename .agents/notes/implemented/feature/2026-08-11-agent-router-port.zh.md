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
  3. 默认 self——义务/验证计数已采集进指标但尚无规则消费（注释曾列出一条代码从未实现的义务规则；注释现已与代码一致）
- **dispatch.ts**：**dsh 原生派发**——**不搬天枢 worker/dispatcher/council 生命周期**。派发走 dsh 子代理 seam：`ctx.subagents.start`（named provider，config `subagentProvider`，默认 `spawn`）把任务作为 child 首条用户消息投递；`await run.result` 结算；`dispose` 清理。seam 自动写 `parentSession`/`origin: 'subagent'`/`delegationDepth`，被路由的 child 进入 `/subagents`/`list_agents`/后代投影，且 zen 永不 arm（zen 按 `parentSession` 跳过）。`execute(action, { sessionId })` 要求活的父会话——seam 从它派生 workspace/血统/深度。profile 工具限制经 `toolFilter` fail loud 安装——未知工具名或缺失服务会中止派发，绝不静默放宽工具面。`profileTools`（Config）覆盖内置默认（如 headless fixture 声明 `['read','bash']` 子集）。
- **index.ts 接线**：`session/event` tool/result → recordPrediction（isError 判定），按会话隔离并排除 child 会话（`header.parentSession`——镜像 zen 的跳过条件）；evidence tracker 指标经 `ctx.reflect.get('evidence', false)` 可选消费（无 evidence-gate 时 prediction 独立工作）；`ctx.router` 服务面（`metrics`/`decide`/`execute` 均带归属 `sessionId`；`resetPrediction(sessionId?)`）。
- **归账零新通道**：子代理 tool/result 经既有 session/event 自动归账回 evidence-gate。
- **决策可审计**：每个被接受的 delegate 在 acceptance 时向父会话落一条 log-only 的 `router/route` 记录（profile/task/targets/child session id）——路由决策可从会话日志重建。
- **结构化结果回传**（闭环 Phase 2）：`execute` 返回 `DispatchOutcome { sessionId, stopReason, output }`（原为只返回 child id）；child settle 后 dispatch 落配对的 log-only `router/outcome` 记录，终态可自日志重建并供调用方喂给综合。
- **主代理综合**（闭环 Phase 2）：存在未综合 child 结论时渲染 `router:synthesis` 提示节（内容纯派生自已落盘的 `router/outcome` 减 `router/adoption` 记录——model-visible ⟺ logged）；`router_adopt` 工具把采用/拒绝声明落成 log-only `router/adoption`（每条 outcome 至多一条，工具边界与 invariant companion 的每会话配对状态双重强制）。router 从不合并或投票——综合是主代理的行为。存在验证缺口（文件改动后无新 `run_tests`/`related_tests`）时提示节附软提醒（claim-audit 新鲜度，仅建议）。插件声明 `inject: ['tools', 'systemPrompt']`，新增 `dsh-tools`/`dsh-system-prompt` peer 依赖与 tsconfig references。两个贡献都按可派发性门控（`dispatchEnabled` 且显式 `provider`/`model`）：不可派发的装配（发货 TUI 的 shadow 重挂）上 outcome 不可能存在——综合节恒空、adopt 每调必抛——故两者都不注册，模型面不背死重。
- **预算计算与记录，加上强制运行边界**：`budget` 配置为路由的 `{ maxTurns, deadlineMs }` 定价记录提供输入，而 auto 派发另行通过 subagent 能力 seam 传递已校验的 `runBudget { maxSteps, timeoutMs }`。进程内提供方强制执行两项边界；当前终态与校验约定由[单专家 Auto 灰度 Agent Note](2026-08-21-tui-single-expert-auto-rollout.md) 负责。
- **晋升证据，而非自主适应**：`promotion.ts` 基于持久账本暴露 kill-switch 优先的模式解析，以及 shadow readiness 与 canary 健康关卡。关卡只记录判定结果；配置仍由人修改。[单专家 Auto 灰度 Agent Note](2026-08-21-tui-single-expert-auto-rollout.md) 规定当前样本要求与 veto 顺序。
- **路由记录不变量**：包拥有的 durable 状态是 `router/route` 记录；invariant companion 校验 payload 形状（已知 profile、非空 task、字符串数组 targets、非空 child id），且 child 在场时校验血统一致性（记录所在会话是 child 的 `header.parentSession`）。child 不在场时降级为形状校验——一个会话可多次 route，故无唯一性检查。
- **累计器回收**：按会话的 prediction map 在 `agent/disposed` 时逐条 evict，长驻 TUI 进程不会为每个已结束会话累积小对象。
- **升级迟滞**（闭环 Phase 1）：累计器新增 `consecutiveFailed`，经 `RouterMetrics.consecutiveFailures` 供 escalate 分支消费——连续失败 ≥ `escalation.minConsecutiveFailures`（缺省 2）且 `escalation.cap` 非 `off` 才升级，单次偶发失败不触发。策略经 `resolveEscalationPolicy` 解析（非法配置 fail loud）。
- **turn-end 触发**（生产触发点）：`trigger: { mode, onTurnEnd }` 缺省 off。shadow 在 `turn/end` 作出决策并追加一条 log-only `router/decision`；auto 经 seam 派发，并在接受时、结果结算前记录 `dispatched:true` + `subagentSessionId`。接受前失败记录 `dispatched:false`；接受后的基础设施拒绝记录一条配对错误 outcome，不覆写已接受的决策。排除 child 会话。发货 TUI 仍为 shadow；切换到 auto 是闭环验证后的产品决定。

## 关键验证事实

- 针对性的包级、集成与快照检查覆盖路由表、派发生命周期、持久账本、综合、预算、晋升关卡与真实装配。
- 快照义务：`examples/headless-agent/tests/headless.snapshot.ts` 的 `agent-router-synthesis` 场景钉住装配 transcript——连败升级 → 真实 verifier 派发 → followup 请求的 `header.system` 逐字携带 `router:synthesis` 节 → mock 调 `router_adopt` → `router/adoption` 落账（route/outcome/adopt-call/adoption 链；预算钉住、墙钟 deadline 归零）。
- integration（真实 cordis Context + 事件对象，不 mock 中间层）：8 连败 → escalate → delegate verifier → execute 派发调用序断言；3 连成 → tipping point 重置 → decide 回 self；dispatchEnabled:false 不派发。
- 测试驱动修正：mock Context 覆盖真实 `ctx.reflect` 会崩（`ctx.on` 的 proxy 依赖反射层）——**集成测试永远用真实 `new Context()` + provide**，不手改 reflect。
- dispatch 走 `ctx.reflect.get('agents', false)`（Cordis 4 注入代理，第 4 个实例——与 T4/compact/evidence-gate tools 同款）。
- lint 三轮打磨：`block.isError === true`（类型收窄后无需 optional chain）、branded sessionId 直接 toMatch、mockImplementation 同步返回 handle（避免 misused-promise）。

## 不移植清单

EFE 全套、season/vigor/sensorium、天枢 worker/dispatcher/council、bandit-promotion（自适应路由）、expert-router 多专家合并（星域角色表只在路由语义上借鉴）。

## 真实装配（S7 收尾）

- **examples/headless-agent** 挂 agent-router：cli.cordis.yml 加插件（provider/model: cli-mock）+ mock LLM 连败模式（`DSH_CLI_MOCK_FAIL_LOOP=1`，实例字段 failCount 跨轮计数，8 轮失败后回正常回复防死循环）+ driver 暴露 router 状态（`DSH_ROUTER_DEMO=1` 打印 metrics + decide）。
- **发货 TUI 重挂**：TUI bundle 曾无配置挂载 agent-router——惰性（decide/execute 无生产调用者，execute 缺 provider/model 即短路）而 session/event 监听无条件运行——挂载行一度移除。Phase 1 以 `trigger: { mode: 'shadow', onTurnEnd: true }` 重挂（bundle-patch 测试钉住）：turn-end 决策只落 log-only `router/decision` 不派发，切 auto 是闭环验证后的产品决定。headless e2e 装配仍是参考集成。
- **真实装配暴露的判定缺口**：dsh bash 对非零退出码**不标 isError**（实测 8 次 `isError: false` 但命令失败，退出码在文本 `[exit code: 1]`）——成败判定 = `isError || 文本含 [exit code: 非0]`。这是"信任 TypeScript 但别信任单一信号"的又一实例。
- **evidence 服务面缺口**：agent-router 消费 `evidence?.cooldown()` 崩溃（服务面无此方法）——evidence-gate 补 `cooldownTable()`/`verificationCount()`（暴露 tracker 已持状态）。
- **e2e 断言教训**：失败计数断言先写 isError:true（过时——真实失败在文本），改为查 `[exit code: 1]` 文本。

## 验证命令

```sh
pnpm vitest run packages/guard/agent-router/tests/                     # 8 文件 95 测试全绿
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

路由层是建立在基础指标之上的纯决策函数，包级测试加上跑在真实 Context 上的集成用例能钉住它；没有 evidence-gate 时 prediction 仍独立工作；归账零新增事件通道。代价是所有自适应能力都留在门外：没有 bandit promotion 和 EFE 全套，路由只对该表所依据的已配置阈值与冷却状态作出反应，扩展它意味着加规则，而不是学规则。

派发继承了同样有界的形态。profile 工具限制 fail loud 安装（restrict 签名已探明：未知工具名抛错），被委派的子代理只拿到 profile 允许的只读/验证工具集；headless e2e 已覆盖 verifier 子代理的完整往返（`DSH_ROUTER_EXECUTE`）；路由表只带写作时的那几个 profile，没有 doc_scout/verifier 变体；与 evidence-gate 的联系是单向的指标消费——escalate 不建义务，delegate attempt 本身有记录（acceptance 落 `router/route`，turn-end 落 `router/decision`）。真实装配换回了两处修正：因为 dsh bash 不标 isError，成败判定改为读取 `[exit code: …]` 文本；evidence-gate 也暴露出 `cooldownTable()`/`verificationCount()`，把 tracker 已持的状态开放出来。
