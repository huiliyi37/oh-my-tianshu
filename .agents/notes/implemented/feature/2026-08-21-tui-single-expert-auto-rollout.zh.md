# Agent Note：单专家 Auto 灰度——Shadow 账本、共享预算、有界 Finding

Status: implemented

[English](2026-08-21-tui-single-expert-auto-rollout.md) | 中文

## 问题

agent-router 的 shadow 模式只记录 delegate 决策——合格 turn 分母无法从日志重建，晋升论证无从谈起。晋升关卡在零真实派发时伪造收益 `margin`。派发没有预算强制（seam 预算只记录不执行）、没有单飞锁，取消通道是一个永不触发的 `new AbortController().signal`。子代理以自由文本作答，父可见结论无界且无法对照日志核验。

## 决策

五个面，全部经校验配置驱动：

1. **全量决策账本**（`router/decision`）——每个非 zen 的合格 turn-end 落一条判别联合 `self | delegate`，携带品牌化 `decisionId`（`rtdec-<seq>`，append 时点预测 seq）与完整 `RouterMetrics` 快照。固定观察窗口（`evaluation.windowToolResults`，决策后父会话工具结果）闭合为每条决策恰一条 `router/evaluation`——`recovered | persisted | inconclusive`，阈值出自 `evaluation.*` 配置。每条评估后跟一条 `router/gate`：shadow 记 `resolveShadowReadinessGate`（样本/假绿/范围健康，窗口出自 `readiness.*`），auto 加记 `resolveCanaryHealthGate`（真实派发、adopt/reject 覆盖、预算耗尽占比、收益代理，窗口出自 `canary.*`）。关卡只记录 verdict 与 veto 理由；模式切换始终由人经配置完成。
2. **Seam 强制的运行预算**——`SubagentStartRequest.runBudget { maxSteps, timeoutMs }` + `SubagentCapabilities.runBudget`；无法保证契约的 provider 声明 `false`，服务在启动前拒绝预算请求（`UNSUPPORTED_CAPABILITY`）。进程内 driver 以子作用域 `agent/pre-step` 计数强制步数、以组合信号强制墙钟；两者都以 `budget-exhausted` 收敛——与父取消的 `aborted` 可区分。
3. **Canary 派发门**——`trigger.mode: 'auto'` 要求装配显式声明 `auto.{maxConcurrent, maxTotal, cooldownTurns, maxSteps, timeoutMs}`（apply 期 fail loud：上限是装配值，绝不设插件默认）。每会话状态强制单飞锁、累计帽与合格 turn 冷却；父 dispose 收敛在飞 controller。
4. **有界结构化 finding**——派发请求闭合判别 `outputSchema`（`FINDING_SCHEMA_BY_PROFILE`：scout finding；verify finding + `supported | unsupported | inconclusive`）。completed 捕获在父边界一次性过 `boundFinding`——控制字符折叠、单行化、硬上限（`FINDING_*_MAX`）——逐字持久到 `router/outcome.finding`。错误、取消、预算终态与形状非法都不伪造。`renderSynthesisSection` 逐字引用持久值；行尾短语保留为 cli-mock adopt-marker 契约锚点。
5. **只读角色**——agent-definitions 在 `explore` 旁内置 `verify` 角色；definitions 服务在场时派发按 cwd 解析 `code_scout → explore`、`verifier → verify`，把角色工具集与 `profileTools` 天花板求交，并透传 persona 与 `read-only` sandbox。未知角色或空交集 fail loud。

## 范围守卫

- TUI 保持 `mode: shadow`（`cordis.patch.yml` 未动）。计划中的晋升门需要 ≥30 条来自真实会话的 shadow 决策，目前不存在，故 Phase 5（auto canary）有意不发。
- Web、正式 headless、ACP 不接入；examples/headless-agent 承担 auto 路径证明（`DSH_ROUTER_AUTO=1` e2e：恰好一次 route/outcome/dispatched 决策 + 净化后的 verify finding）。

## 后果

- 任一会话日志现在可重建合格 turn 分母、self/delegate 比例、指标输入、评估与 veto 理由——人工评审所需的 readiness 证据齐备。
- 预算越界与父取消可区分；连续 turn-end 不会重复派发；侦查/复核子代理不能写工作区。
- 验证：agent-router 单元/集成（133）、subagent 全家含新增 run-budget spec（729+）、keyless auto e2e、刷新后的 agent-router-synthesis golden。

## 已考虑的替代方案

- **readiness 关卡保留 margin**——拒绝：无真实派发时伪造收益数字，正是该关卡要防止的虚假信心。
- **插件默认 canary 上限**——拒绝：「安全默认」会诱导不经装配决策就发货 auto；要求显式声明并 fail loud 才是对的。
- **Schema 层长度限界**——seam 的 schema 子集做不到；改在父边界强制，截断同时是持久化前提。
