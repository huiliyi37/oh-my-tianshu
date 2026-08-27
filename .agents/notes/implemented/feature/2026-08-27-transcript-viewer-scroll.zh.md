# Agent Note：/scroll 全屏转录查看器（T5）

状态：implemented

[English](2026-08-27-transcript-viewer-scroll.md) | 中文

范围：`packages/tui/tui`（新增 `format/transcript-viewer.ts`、`engine/commit-engine.ts` 访问器、`ui/app.ts` overlay 接线、`commands/registry.ts` `/scroll` 命令、`scrollback-transcript.ts` 消费端登记），`examples/tui/tests/interactive-smoke.snapshot.ts`

## 问题

C6 对标记录 T5 为开放缺口——全屏转录查看器，吸收 grok 的 pager 导航（`scrollback/state/nav.rs`：PageUp/Down、半屏、顶/底、上一/下一轮）。`scrollback-transcript.ts` 的解析/搜索/行高 API 一直标注"预留无消费端"，大篇幅会话历史只能靠终端原生滚动区翻看。

## 决策

`/scroll` 打开只读全屏 overlay（`TranscriptViewer`），消费该预留 API。三个承重决策：

**数据源是 scrollback 文本，不是投影层。** `CommitEngine.getContent()`（RingBuffer 封顶的已提交 scrollback）经 `parseScrollbackTranscript` 解析。弃投影层（`renderTranscript`/`TranscriptView`）是因为查看器的价值在屏幕上确切的记录——命令回显、steer 标记、/btw 折叠答案、工具卡——投影层不含这些；且 Ctrl+F（`HistorySearchOverlay`）已拥有投影消息搜索，第二个 overlay 走同源会功能重叠。接受的代价：1000 行环形封顶（经新增 `CommitEngine.size()/capacity()/isFull()` 访问器在顶栏提示截断）；轮次导航定义为 user 消息边界（`▌`/`❯` 角色块）而非精确 `turn` 号。

**打开时快照，不实时推送。** `openTranscriptViewer()` 解析一次；overlay 期间流式提交不推送（alt screen 本就遮住主屏）。重开即重新快照。记为 v1 已知限制。

**显示行平面 + 按宽度重建。** 消息行在宽度变化时经 `wrapToDisplayWidth` 预折行为扁平行平面；`msgStart` 走 `cumulativeRowsToMessage`（同口径），视口按 `scrollRow` 纯切片。帧成本零；折行中间的视口位置渲染出精确的续行。

交互：↑/↓ j/k 行滚动，PageUp/PageDown（Ctrl+U/D）半屏，home/end（g/G）顶/底，`[`/`]` 上一/下一轮（user 块，循环），`/` 进搜索——字符累积 query 实时跳首个匹配，`n`/`N`/Enter 经 `findNext/findPrevMatch` 循环匹配，Esc 清 query 保持打开（app 层经 `isSearchMode()` 区分），再 Esc 或 Ctrl+C 关闭。

## 备选方案

### 为什么不用投影层（renderTranscript）？

保真重渲染被否：上文的屏幕记录论据，加上漂移风险（重渲染用当前主题/宽度而非提交时刻的），以及与 Ctrl+F 数据源重复。scrollback 解析器当初就为此消费端登记；消费端落到别处会让它成为待删的死代码。

### 为什么不把流式更新推进打开的查看器？

alt screen 独占性让实时更新在关闭前不可见；快照语义保持状态机纯净，与 memory 浏览器 overlay 先例一致。重开重快照是诚实的恢复路径。

### 为什么 Esc 是清 query 而不是关闭？

两步 Esc 对齐 pager 惯例（搜索是子状态）；Ctrl+C 恒关闭。app 侧分支咨询 `isSearchMode()`，搜索态 Esc 只重绘不停用。

## 后果

买入：对屏幕确切记录的结构化翻页、轮次跳转、查看器内搜索与匹配循环——纯状态机可 keyless 单测，并经 P0 PTY smoke 端到端驱动。

成本：`/scroll` 内容受环形封顶约束（长会话看到"仅显示最近 N 行"而非全史）；轮次导航是角色启发式而非 `turn` 精确；新增内置命令背负常设义务（面板分组行、footer 提示行、`BUILTIN_COMMAND_NAMES` 登记）。

## 验证

聚焦套件：`transcript-viewer.spec.ts`（滚动 clamp、半屏步长、顶/底、轮次循环、搜索跳转/循环/清除、折行切片、截断提示、未绑定键、状态重置），`commit-engine.spec.ts`（size/capacity/isFull 阈值与 reset），`commands.spec.ts`（/scroll 分派、空 scrollback 回显、前缀解析）。PTY 交互 smoke 第三场景：`/scroll` → `/smoke` 搜索命中 → Esc 清除 → Esc 关闭 → Ctrl+Q 干净退出（100×40 fixture）。
