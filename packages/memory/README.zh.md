# memory/：项目记忆

[English](README.md) | 中文

跨会话的项目记忆：`memory` 服务背后的 Markdown 文件存储、面向模型的保存/检索工具，以及让召回保持前缀缓存安全的 intent 门控 STM 快照。消费方动态解析服务（`ctx.reflect.get('memory', false)`）；当前发布组合均未装配 `memory` 服务本身，因此发布的 `/remember` 与 `/memory` 命令在组合加入该服务前一直回答不可用文本。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`memory/`](memory/README.md) | 记忆 Service Definition + Markdown provider | `memory`（reflect） |
| [`memory-sqlite/`](memory-sqlite/README.md) | 结构化 LTM provider：SQLite/FTS5 上的 append-only 事件日志 + 物化事实视图 | `memory`（reflect） |
| [`tool-memory/`](tool-memory/README.md) | 面向模型的 `memory_save` / `memory_search` 工具 + 静态指引 section | 无 |
| [`adaptive-memory/`](adaptive-memory/README.md) | 经运行时上下文追加通道的 intent 门控 STM 快照 | 无 |
| [`memory-consolidate/`](memory-consolidate/README.md) | 会话结束巩固：门控经验抽取、冲突不确定性标记、退役驱动 | 无 |
| [`tool-memory-recall/`](tool-memory-recall/README.md) | 基于只读 reader subagent 的面向模型 `memory_deep_recall` 工具 | 无 |
| [`command-memory/`](command-memory/README.md) | 基于可选服务的 `/remember` / `/memory` 用户斜杠命令 | 无 |
