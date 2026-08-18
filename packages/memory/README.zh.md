# memory/：项目记忆

[English](README.md) | 中文

跨会话的项目记忆，挂在 `memory` 服务后面。发货 TUI bundle 挂 Markdown provider 加上 `dsh-tool-memory`。`dsh-memory-sqlite` 是同一 `memory` 键的另一 provider，不进入任何发货组合——主机二选一挂载，不能同时挂。`dsh-adaptive-memory` 与 `dsh-memory-consolidate` 是该键的按需消费方，已上树，同样不进发货组合。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`memory/`](memory/README.md) | Service Definition + Markdown 文件 provider | `memory`（reflect） |
| [`memory-sqlite/`](memory-sqlite/README.md) | 结构化 LTM provider（SQLite/FTS5） | `memory`（reflect） |
| [`tool-memory/`](tool-memory/README.md) | 面向模型的 `memory_save` / `memory_search` | 注册到 `ctx.tools` |
| [`adaptive-memory/`](adaptive-memory/README.md) | intent 门控的 STM 快照（append-on-change） | 注入 `systemPrompt` |
| [`memory-consolidate/`](memory-consolidate/README.md) | 成功门控之后的会话结束提取 | 监听 `session/disposed` |
