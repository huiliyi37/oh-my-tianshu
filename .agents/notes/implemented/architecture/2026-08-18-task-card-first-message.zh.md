# Agent Note: 任务卡——首条消息的语义增强

Status: implemented

[English](2026-08-18-task-card-first-message.md) | 中文

## 问题

新会话的第一条用户消息往往又短又无结构（「帮我重构 xxx」），首轮模型语义因此劣化：目标不完整、约束与验收缺失，模型只能反问或猜测。zen 相位的 triage 启发式会在首次请求前跳过琐碎短消息（≤80 字符、单行、纯文本）——短首条消息连锚定面都到不了。要求用户写更长、更结构化的提示是模型侧纪律：无法强制执行、被无视时 host 不可见。

## 决策

任务卡是 `packages/guard/task-card`（`@huiliyi37/dsh-task-card`，ctx key `taskCard`）拥有的内置生命周期增强：会话的第一条用户消息在进入模型前被改写成结构化卡片——`# 标题`、`## 目标`、可选 `## 约束` / `## 验收`，以及 `—— 原始请求 ——` 下的逐字原文。

- **改写 seam：`agent/pre-step` waterfall。** 它是唯一返回值生效的 seam（`packages/core/agent-loop/src/agent.ts:206-214`），agent-loop 把改写后的 `decision.messages` 逐条落会话日志（`agent.ts:288-291`）——`model-visible ⟺ logged` 免费闭合，无需额外事件面。zen 相位的 timeout 提示是同一模式。
- **生成阶梯，绝不阻塞第一步。** LLM（一次有界调用、显式路由——首条消息无 assistant 消息可推导路由，故 `mode: 'llm'` 要求 provider/model 对，加载时响亮失败；短超时默认 5000ms；零重试）→ 语义模板（纯函数、必然成功：首行标题截断 40 字符 + 整段原文作目标）→ 原样放行（不满足触发条件的消息直接通过）。
- **触发条件（全部满足才改写）。** 首条消息是用户消息；顶层会话（无 `header.parentSession`——子代理派发提示已是锚定）；文本非空、无任务卡标记、不超过 `maxInputChars`；日志尚无 `user/message`（只首条——resume/fork 绝不重复改写）。
- **逐字原文是硬性要求。** 日志只保存改写后的消息，`—— 原始请求 ——` 段是用户输入可重建、可追溯的唯一保证。LLM 契约禁止编造消息不支持的约束/验收；`parseLlmCard` 在模型边界校验形状（缺标题/目标 → 回退模板）。
- **与 zen 正交。** triage 在 `agent/inbox/inserted` 判定（早于 pre-step），改写发生在 `agent/pre-step`——互不依赖、互不干扰。改写后的卡片天然多行超长，带卡首条消息不会被 triage 判为琐碎；但改写不依赖 zen，zen 也不依赖任务卡。
- **配置错误响亮失败。** `resolveConfig` 在插件加载时对未知键、非法 mode、非正整数预算、`mode: 'llm'` 缺 provider/model 对抛错。
- **不变量。** `@huiliyi37/dsh-task-card/invariant` 从权威会话日志验证归属关系：带卡消息保留非空逐字原文、保持 `source.kind === 'user'`（它是用户消息的增强，不是插件插入）、且是会话的第一条用户消息（这同时使第二张卡不可能出现）。

## 备选方案否决

- **`inbox.replace` 改写（联动禅模式进入）。** 监听 `agent/inbox/inserted`（注册在 zen 之前）异步改写并 `replace` pending 消息，重发 inserted 让 zen triage 看到卡片文本、短消息进入禅模式。MVP 否决：异步生成期间 driver 可能已 claim 消息（`replace` 届时返回 false——`packages/core/agent/src/inbox.ts:127-135`），且效果依赖 listener 注册顺序（脆弱，需 bundle 顺序测试锁死）。记为后续增强，不是本次路径。
- **TUI 确认面板。** 客户端生成卡片、用户确认后发送。否决：只在 TUI 生效（headless 客户端没有）；TUI 层不应调 LLM（架构分层）；多一步交互改变流程。
- **纯提示引导。** 求模型自行重构输入——模型侧纪律，无法强制执行且 host 不可见；zen 消融已证明引导词单独救不了劣质面。

## 后果

- 每个新顶层会话的首次请求携带结构化卡片而非原始输入；模型看到标题/目标/约束/验收加逐字原文。
- `mode: 'llm'`（默认）每新会话多一次有界 LLM 调用，`mode: 'template'` 零调用；调用失败回退模板——绝不阻塞第一步、绝不向循环抛错。
- 无新持久事件：改写复用 `user/message`；消费者（transcript、resume/fork、session-title）无需改动。
- TUI bundle 默认以 `mode: 'template'` 装配（bundle 无 provider 默认；部署方以自有 provider/model 选择 llm 模式）。

## 测试

- `tests/generate.spec.ts` — 解析契约（完整/部分/缺失节、噪声）、模板推导、带逐字原文的渲染、幂等标记（11 测试）。
- `tests/task-card.spec.ts` — 全链路 scripted-model 集成：改写落入模型请求与日志；第二条不改写；超长不改写；`enabled: false`；resume seed 绝不重写；子代理绝不改写；llm 模式先消耗卡片调用再主调用；契约失败回退模板；缺 provider/model 加载时失败（9 测试）。
- `tests/invariant.spec.ts` — 带卡消息不变量，live append 与晚注册（8 测试）。
- 共 28 测试，macOS 全绿；zen 套件（61 测试）重跑无回归。

## 执行记录

- `1dcaac77` — 核心包（生成器、LLM 调用、pre-step 接线、不变量、28 测试）。
- `387f940c` — README 配对、本 note、TUI bundle 行（`mode: template`）、keyless 快照（真实 Loader + 回放 fixtures）。
- `3d819047` — host 编译面登记 + workspace lockfile。
- `594af410` — 提交后审查 HIGH-4 修复：TUI bundle 的 `cordis.patch.yml` 行要求包出现在 `packages/tui/tui/package.json` dependencies（裸插件必须出现在其 resolver manifest；`verify-cordis-config` 强制，修复后 105 配置全绿）。

## 后续工作

- **禅模式进入联动（方案 B）**——经 `inbox.replace` 改写（listener 注册在 zen 之前）让短首条消息也进入禅相位；需 bundle 顺序测试锁死 listener 顺序。已记录，未发货。
- **TUI 卡片渲染**——transcript 目前以普通用户消息显示改写后文本；专属卡片面列为后续。
- **`mode: 'llm'` bundle 默认**——TUI 以 `template` 装配（bundle 无 provider 默认）；部署方以自有 provider/model 选择 llm。

## 相关

- [禅相位工程范式](2026-08-17-zen-phase-engineering-paradigm.md) — 本包正交组合的锚定面相位。
- [memory-consolidate extract-llm](../feature/2026-08-18-memory-consolidate.md) — 本包 llm 路径镜像的有界调用 + 回退 + 契约解析模式。
