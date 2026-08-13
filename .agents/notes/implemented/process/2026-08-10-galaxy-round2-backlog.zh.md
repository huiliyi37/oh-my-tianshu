# Agent Note: Galaxy 第二轮 backlog——四层计划与剩余工作

Status: implemented

[English](2026-08-10-galaxy-round2-backlog.md) | 中文

> 2026-08-10 · test-huiliyi37 工作区 · snapshots/20260809T140917Z-a6bb5a95ba 分支关联：第一轮错误日志见 2026-08-10-galaxy-round1-error-log.md（commit 52debaf）参照基准：~/checkouts/opencode-tui/src/tui/（Apache 2.0，DSH 移植源）

## Problem

第一轮星河集群（四层落地）RED 阶段产出已提交（commit 0ccb2d5，30 文件），但**全部实现与验证未完成**。本文档记录四层计划内容与未完成缺口，作为第二轮续写的对账基准。反目标（dsh-tui-next-phase.md）：不做 council/team/worker 多agent 面板、不做 updater/桌面端、不改 core/agent/session 包、不发明新事件类型。

### 计划内容（四层）

1. **controller-layer（渲染控制器层）** — 把 `ui/app.ts` 的 renderLive() 手写装配拆成独立控制器：stream-render-controller（流式提交/尾部控制）、overlay-controller（overlay 生命周期 + CPR suppress/resume 协调）、metrics-glance-controller（底部glance 数据与刷新节流）、tool-accumulator / tool-group-controller（进行中工具卡聚合）。ui/app.ts 是唯一装配点持有人。
2. **format-layer（格式化渲染层）** — 纯渲染函数（数据+宽度+主题→LiveRegionLine[]）：glance-bar、activity-labels、spinner-status、welcome、separator、collapsed-bash、collapsed-read-search、turn-summary。
3. **projection-layer（状态投影层）** — 数据模型与订阅分离，只消费已有 session/event与 agent/* 事件：activity-status / activity-store（实时活动标签）、summary-state + turn-summary 模型（工具调用统计）、cache-panel-source + cache-telemetry（token/缓存指标）、history-replay（历史回放投影）。
4. **interaction-layer（交互增强层）** — command-palette（Ctrl+P，复用既有SlashCommandRegistry）、mention-parser（纯函数 @ 解析）、restore-session（可恢复会话投影）、tool-elapsed / tool-label / tool-status（工具卡辅助）。**明确排除 6.4 外部编辑器与 6.5 Vim 模式**（另一会话的 Phase 候选）。

### 已完成（commit 0ccb2d5）

- 23 个 RED 测试 spec（四层各自，含 app.spec.ts 追加的 Ctrl+P 集成测试）
- 3 个控制器实现已落盘：engine/metrics-glance-controller.ts、engine/overlay-controller.ts、engine/stream-render-controller.ts（其中 metrics 未回读复核）
- 2 份设计文档：docs/tui-render-controllers.md、packages/tui/tui/docs/projection-layer.md
- mention 语义 Agent Note（2026-08-10-tui-mention-semantics.*，合规格式）

### 未完成（第二轮必须补齐）

| 维度 | 缺失实现 | 装配 | 验证 |
|---|---|---|---|
| controller | engine/tool-group-controller.ts 未落盘（三次 write 被拦）；metrics 实现未复核 | ui/app.ts 未装配任何控制器（renderLive 仍手写） | vitest GREEN、typecheck、lint 未跑 |
| format | 8 个实现全缺：glance-bar / activity-labels / spinner-status / welcome / separator / collapsed-bash / collapsed-read-search / turn-summary（.ts） | 无（纯函数，装配由上层投影器） | vitest GREEN 未跑（7/8 spec 已落盘） |
| projection | src 下 8 个实现全缺：activity-status / activity-store / summary-state / turn-summary（模型）/ cache-panel-source / cache-telemetry / history-replay + adapter 接线 | 无 | vitest GREEN 未跑（4 个 spec 已落盘） |
| interaction | 6 个实现全缺：command-palette / mention-parser / restore-session / tool-elapsed / tool-label / tool-status | app.ts 未接线（Ctrl+P 测试已追加） | vitest GREEN 未跑（7 个 spec 已落盘） |

第一轮失败根因（详见 error log）：worker 预算耗尽在 RED 阶段 + write_file 指针化误判；本 backlog 不再重写测试，直接续写实现。

## Decision

第二轮集群（GREEN 续写）执行纪律：

- **预算一次性给足**：maxTurns ≥60、timeout ≥25min；worker 目标明确"续写实现，不重写既有测试"。
- **每写完一个文件 read_file 回读确认落盘**（不信 auto-recovered 声明）。
- **验证门禁**：每层跑 vitest（对应 spec 全绿）→ 全量 typecheck（`pnpm run typecheck`）→ staged lint（oxlint）→ 通过后再交付。
- **装配协调**：ui/app.ts 只由 controller 维度持有；其他维度纯新增文件，不碰装配。
- 提交前本地跑全 lefthook job；deliver_task 报失败先查 git log/status 确认真实状态（Scoped commit failed 常为提交成功后的误报）。
- 反目标保持：不做多 agent 面板 / updater / 桌面端；不改 core 包；不发明事件。

## Alternatives considered

**第一轮"设计+实现+测试"一轮做完** —— 失败。预算不足以走完全程，四层全部断在实现前。改为第二轮只做实现（测试已在仓库），预算放大。

**按层拆多轮集群** —— 备选。若第二轮仍超预算，降级为逐层（controller → projection → format → interaction）串行推进，每层一轮集群。

## Consequences

- 第二轮目标态：四层实现全部落盘、对应 vitest 全绿、typecheck/lint 通过、ui/app.ts装配完成（controller 维度）、交付一个新 commit。
- 每层完成后可单独提交（files 子集），避免一次性大提交跨区域触发 cohesion gate。
- 本文档与 error log 共同构成第二轮启动前的完整上下文；完成后本 backlog 标注已闭环或归档。
