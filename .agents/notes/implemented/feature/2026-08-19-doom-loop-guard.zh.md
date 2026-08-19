# Agent Note: doom-loop guard plugin

Status: implemented

[English](2026-08-19-doom-loop-guard.md) | 中文

## Problem

omts 的 guard 家族目前只能打破一种循环形态：repeat-tool-guard 统计相同调用的连续次数。opencode-tui 内置了更丰富的检测器：oscillation（交替调用对）、behavior-mirror（重复模式）与 strategy-shift（doom-loop 退出建议）。因此它们作为 guard 插件落在本仓库：吸收检测器本身，而不是承载它们的认知虚拟机（CVM）。交替使用工具、或反复重跑未变失败测试的循环，能轻松绕过相同调用链。

## Decision

[`packages/guard/doom-loop-guard`](../../../../packages/guard/doom-loop-guard/README.md) 监听 `tools/post-execute` 事件，通过 post-execute 决策的 `additionalContexts` 注入建议性提醒（即 repeat-tool-guard 的交付形态：插件来源的 `notice`、不新增会话事件、「模型可见 ⟺ 已记录」）。三个检测器，覆盖 repeat-tool-guard 不处理的循环形态：

- **振荡**：最近 `2 × oscillationPairs` 次调用恰好由两个工具交替组成，且每个工具侧的规范化身份完全相同；至少一次调用失败。全成功的交替保持安静（这是合法的「先搜索、再行动」节奏）。
- **编辑螺旋**：对同一路径连续调用 `str_replace_editor`/`edit` 且结果均为 `isError`；一次成功的编辑会清除该标记。
- **测试空转**：同一测试命令（`run_tests`，或含 `test` 的 `bash`）的连续运行，其规范化输出哈希不变且失败。哈希规范化会剥离耗时标记，因此完全相同的失败运行会得到相同的哈希。

每个检测器按模式去重，直到模式打破；每个轮次的 `reminderBudget` 在观察持续期间限制提醒总量；每个 agent（智能体）的状态保存在 `WeakMap` 中，在用户的 `agent/pre-step` 消息时重置。内置的 `exclude` 覆盖只读探查工具。所有阈值都在插件加载时校验并大声失败（整数 >= 2，preview/budget >= 1）。已接入 `dsh-base`，与 repeat-tool-guard 并列。

## Alternatives considered

**整体移植 opencode-tui 的 `behavior-mirror` 与 `strategy-shift` 模块。** 否决：两者都与 opencode-tui 的 trajectory 存储和 CVM 建议总线深度耦合；omts 的 post-execute 窗口加上三个纯检测器，用一小部分机制就能覆盖同样的循环形态，而相同调用形态本来就由 repeat-tool-guard 负责。

**改经 `agent/pre-step` 注入，而非 post-execute 的 additionalContexts。** 否决：post-execute 折叠是 repeat-tool-guard 验证过的交付路径：提醒搭载在观察到循环的那次决策上，在紧接着的下一次请求中送达，被拦截的调用也仍能收到提示。

**让检测器在超过阈值后行使否决（`block`）。** 否决：拦截是一种政策升权，归 evidence-gate/agent-router 所有；一个建议型 guard 若悄然变成强制型，就违背了自身的约定。

**把三个检测器并入 repeat-tool-guard。** 否决：相同重复检测与循环模式检测在不同的事件上重置（调用身份 vs 模式打破），独立成包能让各自的配置面名副其实。

## Consequences

- 超出相同重复的循环形态如今也会收到提醒：交替调用对、同一文件上的失败编辑螺旋，以及未变的失败测试重跑。
- 误报面由两重约束框住：振荡要求至少一次调用失败，且内置只读 exclude 清单；超过阈值后，合法轮询仍会收到催促（压力阀就是配置项）。
- 测试空转的哈希是文本级的：规范化只剥离耗时标记，因此时间戳抖动的输出可能绕过检测器。
- guard 家族在仅提醒之外新增了这一建议档；`packages/guard/README.md` 现已列出两个建议档 guard。

## Testing

- `packages/guard/doom-loop-guard/tests/doom-loop-guard.spec.ts` — 组装好的 agent loop 对接脚本化 mock 适配器：振荡在含失败调用时触发、在两次工具均成功的交替上保持安静；编辑螺旋在三次同一路径编辑失败时触发；测试空转在三次完全相同的失败重跑时触发；预算上限与用户消息重置、exclude 透明性，以及配置大声失败。

## Related

- [repeat-tool-guard README](../../../../packages/guard/repeat-tool-guard/README.md) — 本插件刻意不去重复的相同调用链。
- [tool-JSON-in-content repair 插件](2026-08-19-tool-json-repair.md) 与 [run_tests 工具](2026-08-19-run-tests-tools.md) — 同一档位下的姊妹吸收。
