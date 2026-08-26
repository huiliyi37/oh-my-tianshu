# Agent Note: TUI chrome 闭环

Status: implemented

[English](2026-08-26-tui-chrome-closed-loops.md) | 中文

Scope: `packages/tui/tui`（`ApprovalController` 消费者、`LiveSnapshot`、`render/live-panels`、`TuiApp.attach` / `renderLive`、`live-engine` 行预算）

## Problem

`0.5.0` 之后，三条 TUI 回路只接了一半。`[p]` 可能在请求已结算为 `cancelled` 之后才写完规则，却没有测试点名磁盘 / 卡片 / outcome 三元组。Shift+Tab 与 `/yolo` 已经按 `allowed-always` 短路，但 `mode-cycle` 仍期望 `allowed-once`。八个 live 段已是 snapshot 纯函数，`formatActivityBand` 却在 `LiveSnapshot` 旁边自己 fold。即便插件未装配或 `disabled`，`attach` 仍订阅 `intent-bridge/handoff`。

欢迎首帧的 `skipPad` 把预算打成 0，Working 行因此不被裁。24 行窗口上的满活动带可能把审批卡和输入轨挤出 live 区。snapshot 与 chrome 都没变的空闲帧上，120 ms ticker 仍整段跑 `renderLive` 组装。

## Decision

TUI 保持两平面。主题、tip 与面板显隐仍是进程本地态。凡声称持久或常设授权的人决，必须在卡片、磁盘与状态行上一致。

`[p]` 仍先写入 exact allow，写入期间忽略 y/n/a/esc。若写回时请求已是 `cancelled`，本卡保持 `cancelled`；已落盘的规则可以结算下一次匹配的 ask。`[a]` 与 always-approve 短路仍是进程本地的 `allowed-always`；`dispose` 后再 `attach` 的新 `TuiApp` 必须再问。Web 与 `apiproxy` decide 保持 `allowed-once` | `rejected`。

`LiveSnapshot` 携带 `activityBandEnabled`、`activityItems`、`activityBandMaxRows` 与 `tick`。`renderLive` 只在组装快照时 fold 一次，再经 `renderActivityBand` 画带。`activityBand: false` 逃生门仍从 `subagentRuns` 画每 run 一行 spinner。

仅当 `reflect.get('intentBridge')` 存在且 `enabled` 为 true 时，`attach` 才订阅 `intent-bridge/handoff`。

Working（动态）行有文档化上限：`workingRowsCap(terminalRows, chromeRows)` = `liveMaxRowsFor(terminalRows) - chromeRows`。`chromeStart` 之后的 chrome（提问、审批、输入、footer）从不从顶部被裁。`skipPad` 仍拒绝在欢迎首帧垫空，但按该上限裁 Working 行（`pad: false`），满活动带不能把 chrome 挤出。每次 `renderLive` 还按当前终端高度刷新 `LiveEngine.setMaxRows`。

120 ms ticker 在 `liveIdleKey({ snapshotKey, chromeKey })` 未变且 `liveHasSpinner` 为假时跳过组装。按键、审批与流式事件仍组装（batcher / `flushLiveRender`）。ticker 只在有转圈行时递增 `tick`（running agent、running 活动、进行中工具或 live 推理）。overlay 停写仍是 A6 约定：激活中的 overlay 跳过 live 写屏并清空 `lastIdleKey`，以免退出时的 `flushLiveRender` 误跳过主屏重铺。

坐姿狐狸欢迎页（`28` / `36` 档）是另一条线，不在本改动内。已发布欢迎档保持 `56` / `72`。

## Alternatives considered

### Why not widen Web decide to `allowed-always`?

standing-grant 注记已把远端 / Web decide 并集写成一次性人工通道。本改动只钉 TTY 诚实性，不打开该通道。

### Why not rebuild `renderLive` as a bottom-pane framework?

`LiveSnapshot` 已经存在。把活动带放上去就能收掉残余 live 段，不必再做第二套组合器。

### Why not treat overlay pause or every local flag as a second authority?

overlay 停写 live 是 A6 约定。主题、tip 与面板开关属于 live 控制平面。范围内只有决策泄漏和死订阅。

### Why not land the sitting-fox welcome here?

已发布的 rest 网格是 `56` / `72`。把 `28` / `36` 混进这次诚实性改动会撞上两套契约。

### Why not keep skipPad as budget 0 and unclipped?

预算 0 本意是「不垫」，但 `padDynamicRegion` 把它当成「不裁」。欢迎首帧加上满活动带就会把 chrome 溢出。只裁不垫把「欢迎不垫空白」和「24 行保住 chrome」放在同一条规则里。

### Why not skip assemble while a spinner is visible?

转圈行靠 tick 驱动。那些帧若跳过，字形会冻住。ticker 仍在跑；只对有转圈行的帧推进 `tick`。

## Consequences

TUI 测试现在钉死：落盘后 abort、重启仍询问、`mode-cycle` / `/yolo` 的 `allowed-always`、由 snapshot 驱动的活动带行、桥关闭时无 handoff 监听、`workingRowsCap` 以及 skipPad 只裁不垫、24 行满活动带仍保住 chrome，以及空闲 ticker 跳过组装。维护者不得再在 snapshot 旁 fold 活动，不得在 disabled 插件上订阅 `intent-bridge/handoff`，也不得让 Working 行从顶部裁掉 chrome。坐姿狐狸欢迎页（`28` / `36`）仍是另一条线。
