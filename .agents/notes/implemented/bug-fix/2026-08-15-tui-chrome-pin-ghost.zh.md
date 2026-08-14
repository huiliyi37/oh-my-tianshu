# Agent Note: 钉住 TUI 输入轨，消除重影轨线与两行蓝色 metrics

Status: implemented

[English](2026-08-15-tui-chrome-pin-ghost.md) | 中文

## 问题

在一次偏高的 thinking / 工具 overlay 之后，`clearForCommit` 擦掉 live 区，空闲 chrome 随内容高度塌回去。输入框上跳，下方露出黑洞，空隙里还留着上一帧的圆角轨线（`╭─╮`）——LiveEngine 只按 `lastDisplayRows` 回顶，高度一缩，未擦单元格就残留。本 fork 把 Tianshu 的 `padDynamicRegion` 做成了反义：动态段偏短时不垫空行，overlay 高度跟着内容走，每轮都会回缩。窄于 80 列时，`renderLive` 把 metrics 另起一行并用 `theme.primary` 着色，于是 footer 突然折成两行且变蓝；从右往左丢段本来才是既定的窄宽降级。一轮进行中 live 活动面只剩大约三行：状态行、进行中工具标题和 `⎿  …`。那是折叠的工具卡，不是思考全文——`formatReasoningLive` 仍只取最后三行逻辑行，`formatToolCardLive` 被传入 `tailLines: 2` 且没有耗时，卡片 tail 槽也不垫高，overlay 涨缩时输入框跟着跳。会话日志没有工具 stdout 增量，因此 bash/`job_output` 的 live 卡在 `tool/result` 之前无法流式显示命令输出。

## 决策

恢复 Tianshu 的定高视口契约。`padDynamicRegion` 在动态内容与 chrome 之间垫空行，使动态段恰好占 `budget` display rows（超预算仍从顶部丢掉最旧动态行）。`nextDynamicBudget` 维护只涨不缩的高水位，上界为 `liveMaxRowsFor`（下限 4、上限 28，否则 `rows-1`）。欢迎屏 / 首帧空闲（transcript 无消息且 agent 未运行）仍不垫，免得给欢迎英雄图凭空插空白。切会话与 `newSession` 归零高水位。footer 的 metrics 始终合并进模式/快捷键同一行，从右往左丢段，颜色用 `CHROME_INACTIVE_SHIMMER`；不再把 `formatGlanceBar` 追加成 `theme.primary` 的第二行。恰好填满（`pad === 0`）仍合并，不再误丢最后一个右段。live 思考采用 Claude Code 的折叠尾方法：`reasoningTailBudget` 把尾巴按显示行从 3 收到 6。长逻辑行先经 `wrapToDisplayWidth` 切开再取尾，一段没有换行的段落不会把 overlay 顶到天花板后钉死。Ctrl+O 仍在当帧展开全文；`nextDynamicBudget(..., freezeHighWater)` 不把这次峰值写入高水位，收起后回到折叠尾。进行中工具卡遵循 Tianshu 的 live 卡规则：最多 `LIVE_TOOL_CARD_MAX` 张，只有最新一张展开垫高后的 3 行 tail 槽，其余仅标题，头行显示耗时。不为工具 stdout 新增会话事件。

## 备选方案

**空闲帧把 overlay 垫满整个终端高度。** 不予采纳：空白 overlay 会盖住已提交的 transcript，且现有测试要求欢迎帧不得在输入轨前插入整屏空行。

**保留 80 列两行 metrics 回退，只改颜色。** 不予采纳：缺陷就是从一行雾蓝变成两行主色；单行从右丢段已是接受过的窄宽行为。

**空闲时归零高水位。** 不予采纳：Tianshu 已经试过——高度回落就是输入框上跳和重影轨线。

**发明一条工具 stdout 会话事件，让 live 卡能流式显示 bash/`job_output`。** 不予采纳：TUI 不得发明会话词汇；完整输出已在 `tool/result` 落入 scrollback。接一条新的增量是 harness 改动，不是 chrome 修复。

## 影响

一轮偏高的活动结束后，空闲 chrome 停在 live 区峰值高度，输入框不再在屏中与屏底之间弹跳，垫上的空行会盖掉残留轨线。欢迎屏仍自然贴在英雄图下方。窄终端保持一行 footer；随宽度变窄，部分 metrics（包括 `API ✓/✗`）会更早消失，这是预期降级。LiveEngine 的 `maxRows` 改为跟随 `liveMaxRowsFor`，不再用 `rows-1` 加 8 行下限，与垫高上界一致，避免小终端上 cursor-up 越出屏幕。高终端上思考尾巴最多六行（按 wrap 后的显示行计），不再固定三行逻辑行；没有换行的长段落会被切开取尾，不会把 overlay 钉在全高。Ctrl+O 只让当帧变高。进行中工具卡保持稳定的 tail 槽，占位变成实输出时输入框不跳。live 工具卡在 `tool/result` 之前仍显示 `…`，因为会话日志没有 stdout 流。
