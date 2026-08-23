# Agent Note: tool-JSON-in-content repair plugin

Status: implemented

[English](2026-08-19-tool-json-repair.md) | 中文

## Problem

DeepSeek 偶尔会把工具调用序列化成 `content` 里的 JSON 文本，而不是放进 `tool_calls` 协议字段（这正是 opencode-tui 用 `RepairPipeline` 修复的故障形态）。omts 的 `dsh-llm-deepseek` 只翻译结构完好的协议层 `tool_calls`，因此 JSON 内嵌 content 的响应会落成一条纯文本消息：主循环什么也不执行，模型白白消耗轮次反复重发该调用。`dsh-tui` 的差距分析把它列为从天枢源码中吸收价值最高的一项。

## Decision

[`packages/llm/tool-json-repair`](../../../../packages/llm/tool-json-repair/README.md) 是一个独立插件，包装 `llm/stream` waterfall（瀑布式事件）。一段文本块若恰好是一个 JSON 对象、且带一个无首尾空白的非空字符串 `name`，就会以 `tool-call` 的 block-start/delta/end 重新发出，带上源块的索引；其余一切按字节原样透传。转换是 fail-closed 的：普通文本、截断的 JSON、数组、多对象块、带填充的 name，以及真正的 tool-call 块之后的块，一律保持为文本。调用 id 是确定性的（由 name 与 arguments 计算出的 `repair-<index>-<hash12>`），因此回放与快照都稳定。解析内部对无效 JSON 转义的修复移植自 opencode-tui 的 `src/api/json-escape-repair.ts`（Apache-2.0，来源注释见 [`detect.ts`](../../../../packages/llm/tool-json-repair/src/detect.ts)），在解析前恢复 Windows 路径反斜杠。

该插件不需要改动主循环：主循环本来就记录 `llm/stream` waterfall 交付的每个 `assistant/chunk`，并据此组装出 `assistant/message`，因此修复后的流就是被记录的流（「模型可见 ⟺ 已记录」依然成立，无需新增事件类型）；既有的 `agent/pre-tool-commit` 校验也会对照工具的参数 schema 复查修复后的 arguments。`dsh-llm` 不变式会在不变式配套插件挂载的任何位置，校验转换后流的协议。配置项：`enabled`（默认 true）、`maxBlockChars`（默认 65536，低于 1 时大声失败）、`allowFenced`（默认 true）。该插件已接入 `dsh-base`（`packages/bundle/base/cordis.patch.yml`），因此每个产品形态都能获得这项修复。

## Alternatives considered

**移植 opencode-tui 的 `RepairPipeline`，并做成可插拔的 pass。** 否决：该流水线修复的是已解析完成的调用（null 省略、数组强制转换、自动链接清理），且位于 opencode-tui 的认知虚拟机（CVM）内部；omts 的失败面恰恰是 JSON-in-content 的提取本身，本插件用一条保守规则就覆盖了它。额外的参数修复 pass 仍属增量插件工作，等真实提供方证明确有此需要再做。

**在 `dsh-llm-deepseek` 的 translate 步骤内部修复。** 否决：这会把修复策略固化进单个适配器的协议约定，不引入适配器配置膨胀就无法按部署禁用，也覆盖不到呈现同样形态的任何其他提供方。

**在 `agent/pre-tool-commit` 处转换。** 否决：该 waterfall 只能重写已存在调用的 `arguments`（调用集合与身份必须一致），因此无法从文本凭空生成一个调用。

**什么都不做，指望模型自行恢复。** 否决：这种失败会白白消耗轮次和 token；opencode-tui 把修复视为常开，而 fail-closed 检测器在普通文本上不会产生误报。

## Consequences

- JSON-in-content 响应现在会执行预期的调用；原始响应的协议文本不再保留（修复后的流就是日志），因此无法对原始提供方载荷做取证式差异比对。
- 流中一旦打开任何真正的 tool-call 块，转换即被跳过：混合响应保留其文本，只执行协议级调用。
- `enabled: false` 不注册任何内容，因此不信任该修复的部署付出的代价恰恰只是插件加载。
- 天枢的探针前提已在无密钥的情况下满足：失败形态由确定性快照后端和组装好的主循环 mock 适配器演练，而不是真实 API 探针（本环境没有 `DEEPSEEK_API_KEY`；真实 API 一档留给持有密钥的 CI）。

## Testing

- `packages/llm/tool-json-repair/tests/tool-json-repair.spec.ts` — 检测矩阵（围栏、转义修复、普通文本/截断/多对象/带填充 name 的拒绝、字符上限）、经真实 `llm/stream` waterfall 的流转换（`dsh-llm` 不变式全程在线）、确定性 id 的稳定性，以及两轮组装好的 agent loop（智能体循环）（修复会执行调用并记录修复后的流；`enabled: false` 则保持文本）。
- `examples/headless-agent/tests/headless.snapshot.ts` — `tool-json-repair` 场景启动组装好的一次性应用，对接一个以该故障形态流式输出的确定性适配器；断言持久化日志中的 `tool/call`/`tool/result`，并对归一化后的 stream-json transcript（文本记录）做快照。

## Related

- dsh-tui 融合演进迭代记录 — 早期从天枢吸收的能力（render core、meridian、pheromone、fs-snapshot）。
- [run_tests 工具](2026-08-19-run-tests-tools.md) 与 [doom-loop guard](2026-08-19-doom-loop-guard.md) — 同一档位下的姊妹吸收。
