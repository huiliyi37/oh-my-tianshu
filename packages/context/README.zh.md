# context/ — 请求上下文扩展

[English](README.md) | 中文

在不定义工具的情况下添加面向模型请求上下文的产品插件。`workspace-context` 包含在默认 `dsh-agent-spine-demo` 组合包中，可通过组合包配置禁用；`time-context`、`tmux-context` 和 `session-reference` 需主动启用。

| 包 | 职责 | ctx key |
|---|---|---|
| [`session-reference/`](session-reference/README.md) | 其他会话的有界快照 | `ctx.sessionReferences` |
| [`time-context/`](time-context/README.md) | 当前时间与耗时上下文 | — |
| [`spark-anchors/`](spark-anchors/README.md) | spark 截断补偿：排除路径锚点注入（内部能力） | — |
| [`vision-bridge/`](vision-bridge/README.md) | 主控不识图时经独立视觉模型转图片描述注入 | — |
| [`tmux-context/`](tmux-context/README.md) | tmux 位置上下文 | — |
| [`workspace-context/`](workspace-context/README.md) | 工作区指令上下文 | — |

[`workspace-context` 决策记录](../../.agents/notes/implemented/feature/2026-06-24-workspace-context.md)解释其逐 agent（智能体）／会话隔离和生命周期拆分。

会话引用见 [docs/subsystems/session-reference.md](../../docs/subsystems/session-reference.md)；[`workspace-context` 决策记录](../../.agents/notes/implemented/feature/2026-06-24-workspace-context.md)拥有其按 agent/会话隔离与生命周期拆分。
