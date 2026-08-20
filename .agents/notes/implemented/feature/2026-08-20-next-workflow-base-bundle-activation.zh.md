# Agent Note: `/next-workflow` 由基础组合包交付

Status: implemented

[English](2026-08-20-next-workflow-base-bundle-activation.md) | 中文

## Problem

固定意图流水线已经完备，但仅按需挂载的包使每个发货 profile 都不提供 `/next-workflow`。用户必须先找到并维护 profile overlay，才能调用这条由 harness 持有的命令，而该命令所需的 subagent、bash 与 git 能力已经随共享装配交付。不存在独立于具体仓库的验证命令，因此可用性与验证策略必须保持为两项独立决策。

## Decision

`dsh-base` 挂载一条 `next-workflow` 行，并将 `@huiliyi37/dsh-next-workflow` 声明为 workspace 依赖。每个发货 profile 都通过首个组合包层继承该命令；Web 与 TUI 叶子组合包不重复该行。[意图流水线决策](2026-08-17-next-workflow-intent-pipeline.md)继续负责相位机、产物、日志记录、能力探测和模型可见行为。

基础行不含 config，因此包默认值选择 `spawn` 提供方和一个计划候选。`verifyCommand` 保持未设置，所以 VERIFY 报告 `unverified` 并继续进入 REVIEW，而不会声称验证成功。后续 profile 层可以替换该行，配置部署专属的验证命令。

IMPLEMENT steer 调用方会话，并继承其当前工具面。该命令既不会绕过 TUI 的禅相位（zen phase），也不会使会话晋升；当实现需要完整工具集时，用户应在禅晋升后调用。

## Alternatives considered

**保持命令按需挂载。** 否决：共享装配已经提供所需能力，而不易发现的 overlay 前置要求会使发货行为与文档中列出的产品命令不一致。

**在 Web 与 TUI 组合包中分别挂载一行。** 否决：该命令与 profile 无关。由叶子组合包负责会造成配置重复、遗漏其他 profile，并可能让各发货命令集发生漂移。

**在基础行中设置验证命令。** 否决：用户工作区没有统一的包管理器、测试命令或超时策略。报告 `unverified` 才符合事实；声称存在通用门禁则不符合事实。

**在 IMPLEMENT 前自动完成禅晋升。** 否决：禅晋升由相应的已验证谓词负责。命令不得绕过该生命周期边界。

## Consequences

所有发货 profile 都恰好公开一次 `/next-workflow [candidates] <objective>`。中性基础配置提高了可发现性，同时不弱化验证声明，也不改变禅相位的责任归属；代价是需要确定性 VERIFY 门禁的部署必须配置 `verifyCommand`。

测试覆盖固定了基础行唯一且叶子组合包不重复挂载这一约定，并覆盖真实 Web 命令目录与斜杠菜单、生成的 CLI 组合图，以及构建后的默认配置转储。流水线的 Loader、集成与相位机测试仍由 `packages/workflow/next-workflow/tests/` 负责。
