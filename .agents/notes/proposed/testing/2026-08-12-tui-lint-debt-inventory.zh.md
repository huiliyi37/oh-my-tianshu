# Agent Note: TUI 线类型感知 lint 债清单

Status: proposed

[English](2026-08-12-tui-lint-debt-inventory.md) | 中文

## Problem

工作区上 `pnpm run lint` 是红的，183 处类型感知 oxlint 错误，全部来自 TUI 移植线。这笔债之前不可见有个机械原因：`lint` 是 `build:lib:host && lint:contracts-ready`，而 host face 编译失败（`render.spec.ts` 的一个替身缺 `TranscriptView.firstInTurnTime`），oxlint 根本没跑起来。补上那处编译错误后，整个积压一次性浮现。全仓 oxlint `--fix` 已经机械清掉另外 86 处；剩下的每处都要按调用点判断，正是本笔记的对象。

债务分布很集中：74 处在 `packages/tui/tui/src`，109 处在 `packages/tui/tui/tests`，TUI 包之外只有一处（`packages/subagent/subagent/tests/invariant.spec.ts`）。这里没有已知的运行时缺陷——它们是移植代码在上游不必满足的类型安全与契约规则，上游的 lint 配置与本仓不同。

## Proposal

按规则族而不是按文件推进，因为每个族只有一个裁定问题，混着改必然出现口径不一致的修法。按数量降序：

**`unbound-method`（42 处）。** 未绑定就被传递的方法引用。`src/commands/registry.ts`（15 处）是设计问题——命令表存的就是方法引用，要么在注册处绑定，要么改成箭头包装。规格文件里的 27 处几乎都是 `expect(obj.method)` 断言替身，规则在这里是噪声，断言应当直接指向 mock 句柄。

**`no-unnecessary-condition`（22 处）。** 类型判定为不可能触发的守卫。每一处都是真岔路：要么类型诚实、守卫是死代码（删掉），要么该值在那个边界上确实可能缺失、是类型在撒谎（修类型）。`src/mention-parser.ts`（4 处）与 `src/ui/app.ts`（4 处）是最该先定调的两簇。

**`no-floating-promises`（20 处）。** 其中 18 处只在 `tests/commands.spec.ts` 一个文件里，是同一个调用形态重复；一次决策就能修完整个文件。剩下两处（`src/block-stream-writer.ts`、`tests/app.spec.ts`）要逐点看，因为 writer 里丢掉一个 rejection 是真隐患。

**`no-unsafe-*`（member-access/assignment/return/call 合计 27 处）。** `any` 从替身上下文和 `src/adapter/sessions.ts`（10 处）漏出来。adapter 这一簇是唯一触及产品代码的，应当老老实实补类型；规格里的几簇在替身边界上声明一个窄形状即可。

**`no-unnecessary-type-conversion`（16 处）、`restrict-plus-operands`（11 处）、`no-base-to-string`（5 处）、`no-redundant-type-constituents`（5 处）。** 机械修。`src/pi/latex-block.ts` 与 `src/pi/latex-to-unicode.ts` 的 `restrict-plus-operands`（合计 8 处）同源于索引一张返回 `string | undefined` 的表；一个共享的收窄辅助函数很可能一次消掉八处。

**其余（`no-misused-promises` 10 处、`await-thenable` 3 处、`require-await` 2 处、`no-confusing-void-expression` 2 处、`no-non-null-assertion` 1 处）。** 量小，最后一趟扫掉。

复现当前清单：

```sh
pnpm exec tsx scripts/run-oxlint.ts packages/tui packages/subagent
```

### 按文件与规则的清单

| 文件 | 规则 | 数量 |
| --- | --- | --- |
| packages/subagent/subagent/tests/invariant.spec.ts | unbound-method | 1 |
| packages/tui/tui/src/adapter/sessions.ts | no-unsafe-assignment | 4 |
| packages/tui/tui/src/adapter/sessions.ts | no-unsafe-call | 2 |
| packages/tui/tui/src/adapter/sessions.ts | no-unsafe-member-access | 3 |
| packages/tui/tui/src/adapter/sessions.ts | no-unsafe-return | 1 |
| packages/tui/tui/src/block-stream-writer.ts | no-floating-promises | 1 |
| packages/tui/tui/src/commands/registry.ts | require-await | 2 |
| packages/tui/tui/src/commands/registry.ts | unbound-method | 15 |
| packages/tui/tui/src/engine/ansi.ts | no-unnecessary-type-conversion | 1 |
| packages/tui/tui/src/engine/input-handler.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/engine/input-line.ts | no-unnecessary-condition | 2 |
| packages/tui/tui/src/engine/metrics-glance-controller.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/engine/overlay-engine.ts | no-redundant-type-constituents | 5 |
| packages/tui/tui/src/engine/overlay-engine.ts | restrict-plus-operands | 2 |
| packages/tui/tui/src/engine/resize-handler.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/engine/write-batcher.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/format/fluency-policy.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/format/markdown.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/format/markdown.ts | restrict-plus-operands | 1 |
| packages/tui/tui/src/format/permission-diff.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/format/rewind-overlay.ts | no-non-null-assertion | 1 |
| packages/tui/tui/src/format/tool-meta.ts | no-base-to-string | 5 |
| packages/tui/tui/src/gutter.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/mention-parser.ts | no-unnecessary-condition | 4 |
| packages/tui/tui/src/pi/latex-block.ts | restrict-plus-operands | 4 |
| packages/tui/tui/src/pi/latex-to-unicode.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/pi/latex-to-unicode.ts | restrict-plus-operands | 4 |
| packages/tui/tui/src/ring-buffer.ts | no-unsafe-assignment | 1 |
| packages/tui/tui/src/term-caps.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/ui/app.ts | no-unnecessary-condition | 4 |
| packages/tui/tui/src/ui/render.ts | no-unnecessary-condition | 2 |
| packages/tui/tui/tests/ansi.spec.ts | no-unnecessary-type-conversion | 1 |
| packages/tui/tui/tests/app.spec.ts | no-floating-promises | 1 |
| packages/tui/tui/tests/app.spec.ts | no-misused-promises | 10 |
| packages/tui/tui/tests/app.spec.ts | no-unnecessary-type-conversion | 14 |
| packages/tui/tui/tests/app.spec.ts | no-unsafe-assignment | 5 |
| packages/tui/tui/tests/app.spec.ts | no-unsafe-call | 1 |
| packages/tui/tui/tests/app.spec.ts | no-unsafe-member-access | 9 |
| packages/tui/tui/tests/app.spec.ts | no-unsafe-return | 3 |
| packages/tui/tui/tests/app.spec.ts | unbound-method | 9 |
| packages/tui/tui/tests/batcher-wiring.spec.ts | no-unsafe-return | 1 |
| packages/tui/tui/tests/btw-controller.spec.ts | no-unsafe-assignment | 2 |
| packages/tui/tui/tests/btw-controller.spec.ts | no-unsafe-member-access | 4 |
| packages/tui/tui/tests/btw-controller.spec.ts | unbound-method | 5 |
| packages/tui/tui/tests/commands.spec.ts | no-floating-promises | 18 |
| packages/tui/tui/tests/loader-composition.spec.ts | unbound-method | 1 |
| packages/tui/tui/tests/memory-overlay.spec.ts | await-thenable | 1 |
| packages/tui/tui/tests/mode-cycle.spec.ts | no-unsafe-assignment | 5 |
| packages/tui/tui/tests/mode-cycle.spec.ts | no-unsafe-member-access | 1 |
| packages/tui/tui/tests/overlay-controller.spec.ts | unbound-method | 8 |
| packages/tui/tui/tests/runner.spec.ts | await-thenable | 2 |
| packages/tui/tui/tests/runner.spec.ts | no-confusing-void-expression | 2 |
| packages/tui/tui/tests/runner.spec.ts | unbound-method | 1 |
| packages/tui/tui/tests/session-manager.spec.ts | no-unsafe-return | 1 |
| packages/tui/tui/tests/statusline.spec.ts | unbound-method | 2 |

## Alternatives considered

**在 `.oxlintrc.json` 里对 `packages/tui/**` 关掉这些规则。** 否决：仓规是窄而有据的例外，绝不整包关规则。`no-unnecessary-condition` 与 `no-unsafe-*` 这两簇恰恰落在移植件类型契约最薄的地方，静音等于把薄弱点永久冻结。

**在当前收束工作落地之前，一次性全部修完。** 否决：横跨六个裁定问题的 183 处不是一个可评审的变更，而且其中一半落在 C4 拆分正在重写的 `app.ts` 与 `app.spec.ts` 上。把这趟扫尾排在拆分之后，可以避免同一批调用点被裁定两次。

**像 `scripts/source-budgets.manifest.json` 卡行数那样，把债务记成只降不升的棘轮基线表（逐文件计数）。** 暂时否决：等数量小且稳定下来，棘轮才是对的形态；眼下 183 处散在仍在改动的文件上，只会让每个 C4 提交都带一堆基线表噪声。扫尾落地后重新考虑。

## Acceptance criteria

干净树上 `pnpm run lint` 退出码为 0，且 `.oxlintrc.json` 中没有新增任何按包关规则的条目，`pnpm exec vitest run packages/tui/tui/tests/` 仍全绿。

## Risks

`no-unnecessary-condition` 与 `no-unsafe-*` 这两族恰恰是机械修法可能悄悄改变行为的地方：删掉一个类型判定为不可能的守卫，只有在那个边界上类型确实诚实时才正确，而 TUI 读的是终端能力、环境变量和模型给的工具 JSON——全是仓规明确规定不信任静态类型的边界。这两族的每一次删除都要核对边界，而不是只把规则喂饱。
