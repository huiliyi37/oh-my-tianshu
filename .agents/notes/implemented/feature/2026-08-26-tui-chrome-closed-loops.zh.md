# Agent Note: TUI chrome 闭环 — Phase 1 钉死

Status: implemented

[English](2026-08-26-tui-chrome-closed-loops.md) | 中文

Scope: `packages/tui/tui`（`ApprovalController` 消费者、`LiveSnapshot`、`render/live-panels`、`TuiApp.attach` / `renderLive`）

## Problem

`0.5.0` 之后，三条 TUI 回路只接了一半。`[p]` 可能在请求已结算为 `cancelled` 之后才写完规则，却没有测试点名磁盘 / 卡片 / outcome 三元组。Shift+Tab 与 `/yolo` 已经按 `allowed-always` 短路，但 `mode-cycle` 仍期望 `allowed-once`。八个 live 段已是 snapshot 纯函数，`formatActivityBand` 却在 `LiveSnapshot` 旁边自己 fold。即便插件未装配或 `disabled`，`attach` 仍订阅 `intent-bridge/handoff`。

## Decision

TUI 保持两平面。主题、tip 与面板显隐仍是进程本地态。凡声称持久或常设授权的人决，必须在卡片、磁盘与状态行上一致。

`[p]` 仍先写入 exact allow，写入期间忽略 y/n/a/esc。若写回时请求已是 `cancelled`，本卡保持 `cancelled`；已落盘的规则可以结算下一次匹配的 ask。`[a]` 与 always-approve 短路仍是进程本地的 `allowed-always`；`dispose` 后再 `attach` 的新 `TuiApp` 必须再问。Web 与 `apiproxy` decide 保持 `allowed-once` | `rejected`。

`LiveSnapshot` 携带 `activityBandEnabled`、`activityItems`、`activityBandMaxRows` 与 `tick`。`renderLive` 只在组装快照时 fold 一次，再经 `renderActivityBand` 画带。`activityBand: false` 逃生门仍从 `subagentRuns` 画每 run 一行 spinner。

仅当 `reflect.get('intentBridge')` 存在且 `enabled` 为 true 时，`attach` 才订阅 `intent-bridge/handoff`。

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

## Consequences

TUI 测试现在钉死：落盘后 abort、重启仍询问、`mode-cycle` / `/yolo` 的 `allowed-always`、由 snapshot 驱动的活动带行，以及桥关闭时无 handoff 监听。行预算与空闲跳过（Phase 2）不在本改动。维护者不得再在 snapshot 旁 fold 活动，也不得在 disabled 插件上订阅 `intent-bridge/handoff`。
