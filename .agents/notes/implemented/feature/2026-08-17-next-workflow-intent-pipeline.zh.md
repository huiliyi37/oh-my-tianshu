# Agent Note: `/next-workflow` —— 固定意图流水线，不是禅的替代品

Status: implemented

[English](2026-08-17-next-workflow-intent-pipeline.md) | 中文

## Problem

harness 已经有 plan-mode、子代理角色、按请求的 effort 转向、工作流引擎和 hook 瀑布，但没有把它们组成「理解 → 规划 → 批评 → 实现 → 验证 → 评审」。想要这条环的人只能每次手写提示词。批评发生在写出计划的同一上下文里。验证是自评。effort 全程同一档。[plan-mode](../../../../docs/subsystems/plan.md)、[`tool-ralph`](../../../../packages/workflow/tool-ralph/README.md) 与 [禅](2026-08-17-tui-bundle-tianshu-capability-roster.md) 是另外三条编排产品，都不是这条流水线。

## Decision

`@huiliyi37/dsh-next-workflow` 在 `ctx.commands` 上注册 `/next-workflow [candidates] <objective>`。一次运行是 harness 持有的状态机：INTENT → PLAN → CRITIQUE → IMPLEMENT → VERIFY → REVIEW。`planCandidates` 大于 1 时 PLAN 扇出，SELECT 裁判（全新上下文，绝不是规划者）写出 `SELECTION.md` 和胜出的 `PLAN.md`。缺省 `planCandidates` 为 1。

INTENT、PLAN、CRITIQUE、SELECT、REVIEW 是一次性结构化输出子代理。IMPLEMENT steer 调用方会话。VERIFY 经 `ctx.bash` 跑 `verifyCommand`；未配置则报告 `unverified` 并继续。重试耗尽以 `failed-verification` 结算。产物落 `$DSH_HOME/workflows/<run-id>/`。相位转移是纯日志事件 `next-workflow/phase` 与 `next-workflow/end`。`agent/request` 监听器在相位边界按 `phaseEfforts` 改写 `reasoningEffort`，之后恢复运行前的 header。

插件只注入 `commands`，其余在处理器时探测。缺 subagents、provider 能力不足或继承父上下文、或配置了闸门却没有 bash，都 fail loud。每个会话同时只有一次运行。

[基础组合包启用决策](2026-08-20-next-workflow-base-bundle-activation.md)负责插件的发货位置。IMPLEMENT 使用当前会话的工具面，因此 TUI 用户应在禅相位晋升后调用该命令；该命令本身不会晋升会话。plan-mode 与 `tool-ralph` 不动。

## Alternatives considered

**保持命令按需挂载。** 已被[基础组合包启用决策](2026-08-20-next-workflow-base-bundle-activation.md)取代；该决策负责发货挂载策略，同时保留如实的 `unverified` 处置和禅晋升约束。

**用 `tool-workflow` 让模型写动态工作流。** 否决：模型拿着编排脚本，正是本功能要去掉的不确定性。

**扩展 plan-mode，或把 IMPLEMENT 放进全新子代理。** 否决：plan-mode 是一轮交互式规划加批准。子代理实现会藏起现场工作区。steer 调用方会话让实现保持可见。

**把 `guard/evidence-gate` 当验证器。** 延后：v1 的闸门是配置的 bash 命令。

## Consequences

流水线提供可重建的运行（会话日志加产物文件）和诚实的 verify 处置。[基础组合包启用决策](2026-08-20-next-workflow-base-bundle-activation.md)负责 profile 可用性。覆盖：`packages/workflow/next-workflow/tests/*.spec.ts`（成功路径、批评回环、verify 重试 / `failed-verification`、能力探测、effort 改写与恢复、多方案 SELECT、Loader 组合、真实 spawn 集成、空 invariant 伴侣）。
