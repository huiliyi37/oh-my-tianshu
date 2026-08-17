# @huiliyi37/dsh-memory

[English](README.md) | 中文

项目记忆服务：`<root>/.dsh/memory/` 下的 Markdown 文件存储（按 scope 分文件——`global.md`、`sessions/<id>.md`），经 `ctx.provide` 暴露为 `memory` 服务，提供 `save` / `search` / `list` / `delete`。本包集 Service Definition 与 Markdown provider 于一体。seam 的 `save` 输入携带可选结构化字段（`kind` / `topic` / `entities` / `confidence` / `fact` / `sourceRefs`），由结构化 provider 消费、本 provider 忽略；`search` 另接受 `entities` / `topic` 精确过滤（此处退化为 tags 匹配），返回带可选归一化 `score` 的 `MemorySearchResult`（本 provider 的大小写不敏感子串扫描不产出得分）。`excludeIds` 按 id 或 id 前缀过滤条目，供消费方（如 `memory_search`）跳过已进入当前请求上下文的条目。`topicVersions()`、`markUncertain()` 与 `retireStale()` 是 seam 的可选方法，仅结构化 provider 实现；消费方以 `typeof memory.topicVersions === 'function'` 探测（另两个方法同理）。消费方经 `ctx.reflect.get('memory', false)` 动态获取服务。

## Model Experience

### Indirect — 仅服务面

#### What the model sees

不直接可见：记忆内容只经消费方到达模型（`memory_save` / `memory_search` 的工具结果、`/remember` 与 `/memory` 的命令输出）。

#### Token effect

无直接成本；消费方按各自预算渲染召回条目。

#### KV Cache effect

不直接贡献 prompt 结构；存储的磁盘格式稳定、与追加无关。

## Known Limitations and Deferred Work

- **子串检索**——无排序、BM25 或 FTS；本 Markdown provider 不设置 `score`。
- **结构化 save 字段被忽略**——`kind` / `topic` / `entities` / `confidence` / `fact` / `sourceRefs` 不落入 Markdown 文件；`entities` / `topic` 检索过滤按 `tags` 精确匹配。
- **可选 seam 方法缺席**——`topicVersions` / `markUncertain` / `retireStale` 未实现，消费方必须探测。
- **单进程写入**——两个 dsh 实例在同一 cwd 并发写不受保护；存储假定单事件循环。
- **无按用户隔离**——存储按工作区作用域。
