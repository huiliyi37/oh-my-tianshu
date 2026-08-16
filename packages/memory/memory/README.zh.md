# @huiliyi37/dsh-memory

[English](README.md) | 中文

项目记忆服务：`<root>/.dsh/memory/` 下的 Markdown 文件存储（按 scope 分文件——`global.md`、`sessions/<id>.md`），经 `ctx.provide` 暴露为 `memory` 服务，提供 `save` / `search` / `list` / `delete`。本包集 Service Definition 与 Markdown provider 于一体；`@huiliyi37/dsh-memory-sqlite` 是结构化的第二 provider（SQLite/FTS，BM25 混合检索）。seam 的 `save` 输入携带可选结构化字段（`kind` / `topic` / `entities` / `confidence` / `fact` / `sourceRefs`），由结构化 provider 消费、本 provider 忽略；`search` 另接受 `entities` / `topic` 精确过滤（此处退化为 tags 匹配），返回带可选归一化 `score` 的 `MemorySearchResult`（本 provider 的大小写不敏感子串扫描不产出得分）。`excludeIds` 按 id 或 id 前缀过滤条目，供消费方（如 `memory_search`）跳过已进入 STM 上下文的条目。`topicVersions()` 是 seam 的可选能力——供 STM 门控使用的按 topic 单调版本号——仅结构化 provider 实现；消费方以 `typeof memory.topicVersions === 'function'` 探测。另有两个可选能力服务阶段三的巩固 pass：`markUncertain(scope, subject, predicate)` 把冲突的 active 事实降级为 `uncertain`（不删除、不 supersede），`retireStale(options)` 退役陈旧的 superseded 版本与长期未用的事实（退役事实离开检索；日志保持 append-only）——探测方式相同。消费方经 `ctx.reflect.get('memory', false)` 动态获取服务。

## Model Experience

### Indirect — 仅服务面

#### What the model sees

不直接可见：记忆内容只经消费方到达模型（`memory_save` / `memory_search` 的工具结果、`dsh-adaptive-memory` 的 STM 快照）。

#### Token effect

无直接成本；消费方按各自预算渲染召回条目。

#### KV Cache effect

不直接贡献 prompt 结构；存储的磁盘格式稳定、与追加无关。

## Known Limitations and Deferred Work

- **子串检索**——无排序、BM25 或 FTS；结构化 provider 是 [`@huiliyi37/dsh-memory-sqlite`](../memory-sqlite/README.md)（SQLite/FTS，遵循 adaptive-memory Agent Note 的阶段二契约）。
- **单进程写入**——两个 dsh 实例在同一 cwd 并发写不受保护；存储假定单事件循环。
