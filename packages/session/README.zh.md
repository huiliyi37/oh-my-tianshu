# session/：持久会话数据平面

[English](README.md) | 中文

围绕 `core/session` 常驻内存实时服务的持久家族：持久化 seam 连同其存储后端与检查点策略、供出日志派生全量值的投影 seam、日志支持的标题，以及外发会话遥测。全部都是**产品**包（package）。`session-query/` 仍是同级独立组：读取／工具面的消费不依赖持久化内部实现。

## 持久化

持久会话数据的持久化机制、语义检查点策略以及随产品交付的存储后端。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`session-persistence/`](session-persistence/README.md) | 定义持久化服务和共享写入协调机制 | `ctx.sessionPersistence` |
| [`session-checkpoint-policy/`](session-checkpoint-policy/README.md) | 应用语义持久性检查点 | 包装 `ctx.llm` 和 `ctx.tools` |
| [`session-persistence-jsonl/`](session-persistence-jsonl/README.md) | 将会话持久化到 JSONL 文件 | 注册到 `ctx.sessionPersistence` |
| [`session-persistence-sqlite/`](session-persistence-sqlite/README.md) | 将会话持久化到 SQLite | 注册到 `ctx.sessionPersistence` |

[会话持久化决策](../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)记录了持久化设计。

## 投影

向客户端载体提供从日志派生的当前逐会话状态。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`session-projection/`](session-projection/README.md) | 定义并驱动会话投影单元 | `ctx.sessionProjections` |
| [`session-projection-cache/`](session-projection-cache/README.md) | 持久化并恢复投影检查点 | `ctx.sessionProjectionCache` |

## 标题

从会话日志派生持久会话标题，并支持可选的模型后端 provider。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`session-title/`](session-title/README.md) | 负责标题状态、回退行为、provider 注册与刷新 | `ctx.sessionTitle` |
| [`session-title-llm/`](session-title-llm/README.md) | 提供共享的模型标题生成能力 | — |
| [`session-title-first-message-llm/`](session-title-first-message-llm/README.md) | 根据第一条合格的人类消息生成会话标题 | 注册到 `ctx.sessionTitle` |
| [`session-title-all-messages-llm/`](session-title-all-messages-llm/README.md) | 根据所有合格的人类消息生成会话标题 | 注册到 `ctx.sessionTitle` |

部署可注册一个模型后端 provider；未注册时，服务仍提供确定性回退。

## 遥测

将会话活动投影为外发遥测，并将投递委派给配置的上报后端。[遥测决策](../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md)记录上报边界；[模式决策](../../.agents/notes/implemented/feature/2026-08-05-feedback-gated-session-telemetry.md)记录即时、反馈门控与禁用投递。

| 包 | 职责 |
|---|---|
| [`session-telemetry/`](session-telemetry/README.md) | 定义捕获、脱敏、投影，以及实时或按需后端投递。 |
| [`session-telemetry-otel/`](session-telemetry-otel/README.md) | 通过 OpenTelemetry 日志以 `FULL`、`FEEDBACK_ONLY` 或 `DISABLED` 模式投递遥测。 |

子系统参考：[persistence.md](../../docs/subsystems/persistence.md)、[session-projection.md](../../docs/subsystems/session-projection.md)、[session-title.md](../../docs/subsystems/session-title.md) 与 [telemetry.md](../../docs/subsystems/telemetry.md)。同一时间只允许一个标题提供方注册；demo 主干挂载回退服务，两个模型提供方都留在默认组合之外。
