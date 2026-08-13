# Agent Note: /model 当前会话热切（C2 项 4）

Status: implemented

[English](2026-08-11-tui-model-hot-swap.md) | 中文

## Problem

`/model <provider/model>` 只写默认模型（`saveSelection`），影响新会话；当前正在跑的会话不生效，用户切换模型后只能等新会话，或改 cordis.yml。

## Decision

热切完全落在装配层，agent-loop 不动。

1. **可变 ref**：`installModelSelection`（packages/core/agent/src/model-selection.ts L39）接受**可变 `ModelSelectionRef { current, assembled }`**——每次 prompt assembly 快照 `selection.current` 到 assembled，请求路由消费 assembled。改 `ref.current` 在下一次 agent 步进自动生效，不中断当前步骤。验证自实现 L46-58（assembly 快照）+ L60-78（request 路由）。
2. **TuiApp 持有 ref**：`private modelRef: ModelSelectionRef | null`；newSession/switchSession（resume 分支）setup 传 `this.modelRef` 而非字面量，ref 因此在会话内留存；registry 兜底分支中 agent 由其他装配方持有，ref 归 null。
3. **`switchLiveModel(selection): boolean`**：改 `modelRef.current`，返回热切是否成功（false = registry 兜底会话不可热切）。
4. **/model 命令**：saveSelection（默认仍更新）+ `deps.switchLiveModel(next)`；回显区分「当前会话与默认均生效」与「默认生效；当前会话不可热切」。

## Verification facts

- commands.spec.ts：/model 热切 2 用例（switchLiveModel 被调 + 双生效回显；false → 不可热切回显），RED→GREEN。
- app.spec.ts：switchLiveModel 生命周期 4 用例（newSession 后 true、无会话 false、registry 兜底 false、resume 后 true），RED→GREEN；4/4。
- 相关 spec 179/181（2 失败为并行会话 59f655b 提交的 HEAD 既有：statusline 接入、工具卡渲染——git 干净、非未提交 WIP、与本次改动零交集）。
- 类型：scratch 单查 4 文件，本次改动的 48 行 diff 零类型错误；tsc 报错全在 app.spec.ts 并行会话测试区域（resize mock 类型，HEAD 既有）。

## Files

- `packages/tui/tui/src/ui/app.ts`：modelRef 字段 + newSession/switchSession 接线 + switchLiveModel + createBuiltinCommands 注入
- `packages/tui/tui/src/commands/registry.ts`：BuiltinCommandDeps.switchLiveModel + /model 命令热切与回显
- `packages/tui/tui/tests/app.spec.ts`：switchLiveModel 4 用例
- `packages/tui/tui/tests/commands.spec.ts`：/model 热切 2 用例 + deps helper
- `docs/dsh-tui-与grok的功能对比-c2.md`：项 4 标记 ✅

## Alternatives considered

**grok 的 ACP 热切——向运行中的 agent 发 `SetSessionModelRequest`** — 不可用。DSH 没有 ACP，无从发出这类会话模型请求；改动 prompt assembly 本就读取的 `ModelSelectionRef`，只靠装配层即可达到同样效果。

**中断当前步骤以立即生效** — 否决。ref 在下一次 prompt assembly 被读取，所以热切落在下一次 agent 步进，正在流式输出的回复不受打扰；立即切换意味着要动 agent-loop，而本次改动刻意不动它。

**grok 的 effort 参数与 agent-type mismatch modal** — 按 C2 文档判定超出范围而否决。`/model` 只热切模型：不做 effort 热切，DSH 也不区分 agent 类型，因此没有 mismatch modal 可开。

## Consequences

- 运行中的会话跟随 `/model`，默认值也照旧更新，代价是一步延迟：热切落在下一次 agent 步进，因此已在流式输出的回复仍用旧模型收尾——这层语义差别只由命令回显承载，文档与帮助中没有体现。
- registry 兜底会话的 agent 由其他装配方持有，不可热切；switchLiveModel 返回 false，回显说明只有默认生效，限制因此传达到用户，而不是静默失败。
- 整个机制只是一个被持有的 ref、TuiApp 的一个字段和一个命令依赖——48 行 diff，agent-loop 与 model-selection 实现原样不动。
- 证据止于包内测试：装配后的 `dsh --profile tui` 中，下一次用户消息的请求是否落到新模型（transcript/glance 行可见模型名）未验证。
