# Agent Note：单专家 Auto 灰度——Shadow 账本、共享预算、有界 Finding

Status: implemented

[English](2026-08-21-tui-single-expert-auto-rollout.md) | 中文

## 问题

agent-router 的 shadow 模式只记录 delegate 决策——合格 turn 分母无法从日志重建，晋升论证无从谈起。晋升关卡在零真实派发时伪造收益 `margin`。派发没有预算强制（seam 预算只记录不执行）、没有单飞锁，取消通道是一个永不触发的 `new AbortController().signal`。子代理以自由文本作答，父可见结论无界且无法对照日志核验。

## 决策

五个面，全部经校验配置驱动：

1. **全量决策账本**（`router/decision`）——每个非 zen 的合格 turn-end 落一条判别联合 `self | delegate`，携带品牌化不透明 `decisionId` 与完整 `RouterMetrics` 快照。固定观察窗口（`evaluation.windowToolResults`，决策后不越过更晚决策的父会话工具结果——归属边界，结果不重复归账）闭合为每条决策恰一条 `router/evaluation`——`recovered | persisted | inconclusive`，阈值出自 `evaluation.*` 配置；投影在打开窗口前收集全部既有评估配对，因此后续决策无法把已评估决策再次入队。`agent/disposed` 会先中止并等待该会话已准入的 trigger，再闭合最终未闭合窗口。每条评估后跟一条 `router/gate`：shadow readiness 要求达到 `readiness.minSamples` 且至少存在一条已评估的 delegate；canary health 要求实际派发数与已评估派发数都达到 `canary.minDispatches`，之后才考察声明覆盖、预算占比和收益。关卡只记录 verdict 与 veto 理由；模式切换始终由人完成。
2. **Seam 强制的运行预算**——`SubagentStartRequest.runBudget { maxSteps, timeoutMs }` + `SubagentCapabilities.runBudget`；无法保证该约定的提供方声明 `false`，服务拒绝带预算的启动请求（`UNSUPPORTED_CAPABILITY`）。Service Definition 在提供方启动前拒绝非正数、不安全数值或超过计时器上限的值。进程内 driver 以子作用域 `agent/pre-step` 计数强制步数、以组合信号强制墙钟；任一上限会把原本中止或缺失的终态分类为 `budget-exhausted`，而 `blocked` 等已持久化的非中止 child 终态保持权威。Agent-router auto 始终提供预算；tool-subagent 与 next-workflow 暴露可选部署配置，设置后会在 provider 能力预检阶段 fail loud。
3. **Canary 派发门**——当 `trigger.mode: 'auto'` 且派发已启用时，装配要求显式提供非空 `provider`/`model` 与 `auto.{maxConcurrent, maxTotal, cooldownTurns, maxSteps, timeoutMs}`。准入会在 provider 启动前预留累计帽与冷却容量。已接受 auto route 携带决策身份；配额恢复投影 route 与 decision 的并集，因此接受与决策 append 之间崩溃也无法重置容量。只有活跃 controller 与尚未落 route 的预留保留为进程本地状态。插件释放时先停止接纳、中止活跃 controller、等待活跃触发，再释放 effect 作用域的工具与提示词注册项。
4. **有界结构化 finding**——派发请求闭合判别 `outputSchema`（`FINDING_SCHEMA_BY_PROFILE`：scout finding；verify finding + `supported | unsupported | inconclusive`）。completed 捕获在父边界一次性过 `boundFinding`——控制字符折叠、单行化、硬上限（`FINDING_*_MAX`）——逐字持久到 `router/outcome.finding`。错误、取消、预算终态与形状非法都不伪造。综合内容作为仅解析一次的变量值进入提示词，因此持久化的字面 `{{...}}` 文本不会被解释为另一个提示词引用；行尾短语保留为 cli-mock adopt-marker 约定锚点。
5. **只读角色**——agent-definitions 在 `explore` 旁内置 `verify` 角色；definitions 服务在场时，派发按 cwd 解析 `code_scout → explore`、`verifier → verify`，并把角色工具集与 `profileTools` 天花板求交。persona 来自角色，但 router 自身始终设置 `sandboxMode: 'read-only'`，进程内 seam 还把该请求侧上限与审批策略 `never` 配对，因此缺失或约束较弱的角色元数据无法放宽任一 profile。未知角色或空交集 fail loud。

## 范围守卫

- TUI 保持 `mode: shadow`（`cordis.patch.yml` 未动）。计划中的晋升门需要 ≥30 条来自真实会话的 shadow 决策，目前不存在，故 Phase 5（auto canary）有意不发。
- Web、正式 headless、ACP 不接入；examples/headless-agent 承担 auto 路径证明（`DSH_ROUTER_AUTO=1` e2e：恰好一次 route/outcome/dispatched 决策 + 净化后的 verify finding）。

## 后果

- 任一会话日志现在可重建合格 turn 分母、self/delegate 比例、指标输入、评估与 veto 理由——人工评审所需的 readiness 证据齐备。
- 预算越界与父取消可区分；连续 turn-end 不会重复派发；侦查/复核子代理不能写工作区。
- 验证覆盖聚焦的 agent-router 测试套件、subagent 预算测试套件、keyless auto e2e 与 agent-router-synthesis golden；命令清单保留在仓库脚本中，不写入本决策记录。

## 已考虑的替代方案

- **readiness 关卡保留 margin**——拒绝：无真实派发时伪造收益数字，正是该关卡要防止的虚假信心。
- **插件默认 canary 上限**——拒绝：「安全默认」会诱导不经装配决策就发货 auto；要求显式声明并 fail loud 才是对的。
- **Schema 层长度限界**——seam 的 schema 子集做不到；改在父边界强制，截断同时是持久化前提。
