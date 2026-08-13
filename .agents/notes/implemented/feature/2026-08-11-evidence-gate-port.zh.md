# Agent Note: dsh 证据门最小内核移植（S1–S6 全貌）

Status: implemented

[English](2026-08-11-evidence-gate-port.md) | 中文

## 问题

dsh 没有任何机制让 agent 为自己的编辑挣得资格：没有东西记录一次改动声称了什么，没有东西把测试运行归账到该声称上，也没有东西拦住声称背后无证据的编辑。移植源是天枢（opencode-tui）evidence-gate 体系——恰恰是该机制可能冗余的完整版；而 dsh 既没有天枢的 turn-step-producer 任务边界，也没有它的 worker 结构可供挂载。设计约束是增量精简：只拿最精简能力，一边实验一边增强。

## 决策

### S1 证据门内核
- **新包** `packages/guard/evidence-gate/`（guard 组，tdd-gate/探针候选同组）——独立边界，不污染 core。
- **编辑门走 `tools.guard()`**（单调、返回 reason 拒绝）而非 `tools/pre-execute` waterfall——guard 无人能翻案（pre-execute 可被其他 listener 覆盖），且携带执行参数。
- **验证归账走 `session/event` 的 tool/call→tool/result 配对**（callId→bash command 内存映射 + 输出文本启发式）——零新事件类型，零测试框架耦合（命令文本识别 vitest/pytest/node --test/npm test）。
- **义务创建走显式服务面**（`ctx.evidence.createObligation`）——dsh 无天枢的 turn-step-producer 任务边界，宿主在任务开始处调用；`supersedeAll()` 作废未决义务。
- **RED 三规则与天枢一致**（evidence-obligation.ts:341-387 语义）：blocked→仅 attempt；failed+关联→记 `red:`；passed 需先 RED 才 satisfied（pass-without-red 不是证据）；`blocked ≠ satisfied`（受阻不是死刑）。
- **once latch 防死锁**：同一义务只拦一次编辑，原样重发放行。

### S2 TDD 门
- **默认 suggest**（不硬拦），`{ tddMode: 'enforce' }` 才拦截——与天枢 `RIVET_TDD_GATE=enforce` 取舍一致。
- tracker 持编辑计数（`trackFileModified`）+ 验证计数（`applyVerification` 归账后重置），验证后编辑计数清零。

### S3 探针候选
- `probe-candidates.ts` 纯函数：存活假设（candidate/inconclusive）→ targeted_test 且 `expect: 'fail'`（RED 优先）；已探过跳过；预算 ≤3 降级 grep；冷却（uninformative ≥2）跳过；`recordProbeFeedback` 反馈闭环。

### S4 精准建议 + L2 final gate
- `probe-suggest.ts`：给 agent 的具体下一步——`tests/<同名>.spec.ts` 测试路径 + 期望失败；**已验证命令含目标 → 降级 grep**（避免重复 targeted_test）；拦截消息附 `建议探针:` 行。
- `evaluateFinal` 完整版（天枢 once latch）：首次未决 high → `continue_once` + 探针建议 nextAction；`markContinued` 后 → `honest_blocked` + 未决清单披露（`{id, claim}`）。

### S5 真实装配
- **examples/headless-agent** 挂 evidence-gate：`fixtures/cli.cordis.yml` 加插件 + driver 任务边界接线（`DSH_EVIDENCE_DEMO=1` 时建义务/supersede）。
- **关键发现：dsh 原生编辑工具是 `str_replace_editor`**（`@huiliyi37/dsh-tool-str-replace-editor`，参数 `{command: view|create|str_replace|insert, path}`），不是天枢的 edit_file——最初按天枢工具名找（`grep name: 'edit_file'` 零命中）误导了 S5 的"dsh 无编辑工具"结论。

### S6 原生工具端到端 + 两个真实装配修复
- **EDIT_TOOLS 适配 str_replace_editor**（首位，原生优先）：`command === 'view'` 读操作放行；create/str_replace/insert 写操作拦截（提取 `path` 字段）；保留天枢风格工具兼容宿主。
- **guard 注册时机（真实装配暴露的第 4 个注入问题）**：顶层插件 apply 时 tools 服务可能未加载，`reflect.get('tools', false)` 提前返回 undefined → guard **静默未注册**（S5 e2e 无法区分"guard 注册但 bash 不在 EDIT_TOOLS"与"guard 未注册"——str_replace_editor 实证暴露）。修复：**双路径注册**——同步 reflect.get 兜底（测试环境 provide 已就绪）+ `ctx.inject(['tools'])` 等真实装配就绪（同 guard 函数引用，Set 天然去重）。
- **invariant companion**：新包缺 `src/invariant.ts` 触发仓库 test-invariants 门禁（13 测试全败的根因，非逻辑问题）；补上（空 install + 说明，义务为内存态无持久关系）。
- **mock 死循环**：headless mock LLM 编辑模式必须放首轮（有 tool-result 后不再重试），否则拦截后无限重试。
- **fs-local 重复注册**：headless fixtures 加 fs-local 前先查根 cordis.yml——base 已含（`service "fs" has been registered`）；只补缺的 str-replace-editor。

## 不移植清单（保持精简）

L3 worker 交付门、CMV（behavior-mirror 天枢侧是死代码）、prediction-error（依赖 sensorium）、virtue-signals（影响面仅破坏性 gate 文案）、天枢 turn-orchestrator/worker 重型结构。

## 关键验证事实

- 包级端到端（integration.spec，真实 cordis Context + 真实事件对象，不 mock 中间层）：create→编辑被拦（消息含探针建议）→测试 failed 记 red→编辑放行→passed→satisfied→final allow。
- **真实装配 e2e**（evidence-gate.e2e.ts，真实 Loader 子进程 + mock LLM）：`str_replace_editor create` 被 L1 门拦截（tool/result isError 文本含 evidence gate）；无义务路径不误拦；keyless-smoke 基线无回归。
- 测试驱动修正的问题：blocked 归账状态（attempted 非 open）、无关 failed 不归账、extractResultText 传参错位、once latch 与多命令测试的期望冲突（独立义务避开）、词干过短（'a'）防误判跳过。
- **Cordis 4 注入代理已三实例**（T4 任务窗格 `17e5129`、/compact、evidence-gate tools）：可选服务属性访问抛 "without inject" → `ctx.reflect.get(name, false)`；**服务就绪时序问题用 `ctx.inject([...])` 声明依赖**（tui-runner 同款）。

## 验证命令

```sh
pnpm vitest run packages/guard/evidence-gate/tests/                     # 7 文件 77 测试全绿
npx vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/evidence-gate.e2e.ts  # 4 测试全绿（真实装配）
npx oxlint packages/guard/evidence-gate/                                # 0 错误
npx tsc -p packages/guard/evidence-gate/tsconfig.json                   # 0 错误
```

## 曾考虑的替代方案

**编辑门走 `tools/pre-execute` waterfall**。否决：pre-execute 的决定可被其他 listener 覆盖，而 guard 是单调的、无人能翻案；并且 guard 还携带执行参数，门禁正需要它来提取路径。

**为验证归账新增事件类型（或与测试框架集成）**。否决：在既有 `session/event` 流上配对 tool/call→tool/result，零新事件类型、零测试框架耦合，由命令文本识别 vitest/pytest/node --test/npm test。

**照天枢那样用 turn-step-producer 边界创建义务**。否决：dsh 没有这样的边界，因此义务经显式服务面 `ctx.evidence.createObligation` 创建，由宿主在任务开始处调用，并用 `supersedeAll()` 作废仍然未决的义务。

**TDD 门默认强制拦截**。否决：门禁默认 suggest，只有 `{ tddMode: 'enforce' }` 才拦截——与天枢 `RIVET_TDD_GATE=enforce` 的取舍一致。

**义务未决期间拦下每一次编辑**。否决，这会死锁：once latch 对同一义务只拦一次编辑，原样重发即放行。

**把测试通过本身当作证据**。否决：passed 只能满足此前已记录 RED 的义务，因为 pass-without-red 不是证据；对称地，`blocked` 只记一次 attempt，永远不算 satisfied。

**单路径注册 guard**。否决，两个方向都不成立：只用同步 `reflect.get('tools', false)`，在真实装配尚未加载 tools 服务时会返回 undefined 并静默跳过注册；只用 `ctx.inject(['tools'])`，则丢掉 provide 已就绪的测试环境。两条路径注册的是同一个 guard 函数引用，Set 天然去重。

**EDIT_TOOLS 只保留天枢的 edit_file 工具名**。否决：dsh 原生编辑工具是 `str_replace_editor`，它排在首位，天枢风格的名字只为兼容宿主而保留。

## 后果

这套内核换来的是一条不动 core 的独立边界：不新增事件类型，不耦合任何测试框架，并且在两个层级都有端到端钉子——跑在真实 Context 上的包级集成用例，以及经 Loader 子进程、使用原生 `str_replace_editor` 的真实装配 e2e。增量精简付出的代价是覆盖面：L3 worker 交付门、CMV、prediction-error、virtue-signals 都不在其中，因此这套纪律止于编辑与 final gate，永远够不到 worker 交付。

精简的选择也各自带着边界。归账是启发式的——它从命令与输出文本识别验证，识别不出的 runner 就不会被归账；once latch 用严格性换取不死锁，因为原样重发即放行；TDD 门在宿主主动选择 enforce 之前只建议、不拦截。guard 注册需要同步兜底与 `ctx.inject(['tools'])` 两条路径，因为单条路径总会在两种环境之一里悄悄出错；而该包携带的是空的 invariant companion，因为义务是内存态，没有可断言的持久关系。
