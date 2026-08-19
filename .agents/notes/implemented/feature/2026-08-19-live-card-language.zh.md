# Agent Note: live-area card language

Status: implemented

[English](2026-08-19-live-card-language.md) | 中文

## Problem

活区把「进程类」行画成了三套 chrome：工具卡用 `›`/`⠋`/`✗` 加 `⎿` 正文；委派树把活动、token、工具计数、终态词和耗时挤进一行 `●`/`○`；后台任务快照用 `⏳`/`✓`/`✗` 再拼 `· detail`。正在跑的子代理和正在跑的 `pnpm build`，看起来不像同一类进行中工具卡。grok-build 的 `tasks_pane` 保持一种列表语言（运行态鲜明、终态后退、活动后缀），但架在这块 live 区没有的鼠标 overlay 上。

## Decision

[`format/live-card.ts`](../../../../packages/tui/tui/src/format/live-card.ts) 是进程类 live 行的唯一 chrome。状态形与 `formatToolCardHeader` 对齐：进行中 `⠋`（ASCII `-`）、成功 `›`、失败 `✗`（ASCII `x`）、待答 `?`。正文首行 `⎿  `，续行三空格。header suffix 从右往左丢，title 最后截。进行中且有活动时画第二行 `⎿`。空闲或已结束只留标题行（耗时与终态词在 header）；传入 theme 时终态 title 涂 muted。不新增 session 事件，不新增投影字段，无行选中，无鼠标 hit-rect，`/tasks` 与 `/subagents` 仍是两套开关。

### Tool cards

`formatToolCard` / `formatToolCardHeader` / `indentToolBody` / `formatToolCardLive` 消费共享前缀和 `liveCardGlyph`。无 tick 的进行中工具标题用 `⠋`（有 `tick` 时走 ASCII/盲文 spinner），不再用 `●`。diff / read / compact / Enter 展开行为不变。

### Delegation tree

[`projectDelegationTree`](../../../../packages/tui/tui/src/delegation-panel.ts) 仍读条目自带的 `progress` / `timing`，事实源见[运行态投影 note](2026-08-19-subagent-progress-projection-and-delegation-panel.md)。title 保留 `↻`/`▶`（可续 vs 一次性）。仅 `toolInFlight` 时状态形为 `⠋`；`lastTurnEnd` 为 `error` / `aborted` / `interrupted` 时用 `✗`；其余 `›`。子代理未结束时，activity / token / 工具计数落到 `⎿` 行。存在 `lastTurnEnd` 或 `activity === 'inactive'` 即为已结束：无 body，终态词与耗时留在 header。`/subagents kill` 不变。

### Background tasks and todos

[`renderTasksPanel`](../../../../packages/tui/tui/src/render/live-panels.ts) 用同一张卡画 `taskSnapshots`（`running` → `⠋` 加可选 `⎿ detail`；`completed` → `›`；其余 → `✗`）。[`projectTaskPanel`](../../../../packages/tui/tui/src/format/task-panel.ts) 的 todo 仍是 `[ ]` / `⏳` / `[x]`：清单不是进程卡。`/tasks kill` 仍走 slash。

## Alternatives considered

**Port grok-build's unified overlay with per-row kill/view hit-rects.** 否决：live 区无行选中、无鼠标处理（[运行态投影 D5](2026-08-19-subagent-progress-projection-and-delegation-panel.md)）。行内终止会是新的输入原语，不是涂色改动。

**Interleave `/tasks` and `/subagents` into one list.** 否决：会改排序、空态和 slash 命令故事。本改动只统一行 chrome。

**Paint todo rows with `›`/`⠋`.** 否决：checkbox 语义（`[ ]` / `[x]`）才是对象；grok-build 也把 todo 和正在跑的进程分开。

**Keep three glyph sets and only add a second delegation line.** 否决：不一致本身就是产品缺陷；再留一套本地方言关不上它。

## Consequences

进行中的委派子代或后台任务现在占两行，活动出现或消失时输入框可能上下移一行。终态行后退（单行；有 theme 时 title muted），不做颜色混合算法。终止仍只走 slash。`contextPct` 仍需要 live 的 `contextWindow` 查询，继续留在进度投影之外。

## Testing

- `packages/tui/tui/tests/live-card.spec.ts` — 状态形、两行 vs 一行、suffix 丢弃、终态 muted title、ASCII 回退。
- `packages/tui/tui/tests/delegation-panel.spec.ts` — 进行中 header `⠋` + `⎿` body；终态仅 header 加终态词；失败形 `✗`。
- `packages/tui/tui/tests/live-panels.spec.ts` — 后台任务快照走卡片；todo 仍经 `projectTaskPanel`。
- `packages/tui/tui/tests/tool-card.spec.ts` — 无 tick 的 live 标题是 `⠋`。
- `packages/tui/tui/tests/task-panel.spec.ts` — checklist 标记不变。

## Related

- [subagent progress projection and delegation-panel richness](2026-08-19-subagent-progress-projection-and-delegation-panel.md) — 这套 chrome 消费的事实；终止仍只走 slash。
