# feedback/：记录的人类反馈

[English](README.md) | 中文

反馈家族让人类记录对会话的评价，但不据此采取任何动作。反馈属于持久的会话日志内容，与模型对话以及后续可能读取它的任何策略相互独立。

| 包 | 职责 | ctx 键 |
|---|---|---|
| `command-feedback/` | 与触发方式无关的 `feedback/record` 事件，以及面向用户的 `/feedback` 生产方 | 无 |

被记录的评价仅写入日志：它绝不会进入模型接口或派生历史。挂载后，[`dsh-session-telemetry-otel`](../session/session-telemetry-otel) 会观察 `feedback/record`，以释放待处理的遥测前缀，或在遥测已禁用时警告反馈将留在本地；采集本身与该策略相互独立。
