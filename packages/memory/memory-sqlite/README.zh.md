# @huiliyi37/dsh-memory-sqlite

[English](README.md) | 中文

`memory` 服务（`@huiliyi37/dsh-memory`）的结构化长期记忆 provider，与 Markdown provider 注册在同一个 `memory` 键下——组合里二选一挂载。存储遵循 adaptive-memory Agent Note 的阶段二 LTM 契约：**append-only 事件日志**（`events`：kind 为 fact/experience/observation/tombstone，含 keywords、entities、topic、confidence、sourceRefs）加**物化事实视图**（`facts`：subject/predicate/value、validFrom/validTo、confidence、status 为 active/superseded/uncertain、supersedes、sourceEventId）。同一 (scope, subject, predicate) 写入不同 value 会让旧版本 superseded——只失效、不删除；部分唯一索引保证同一对至多一条 active。`delete` 落 tombstone（superseded + tombstone 事件）；日志永不擦除。

检索是混合式：FTS5 BM25 跑 text + keywords（CJK 连续段在索引与查询两侧都做二元组化，子串查询可命中），`entities`/`topic` 精确过滤，scope 与 `excludeIds` 过滤，时序有效性是硬排序——结果先按状态分层（active > uncertain > superseded），层内按归一化 score 降序：`relevance = -bm25 / (1 + -bm25)`（空查询为 1），`score = relevance × statusWeight`（active 1.0 / uncertain 0.6 / superseded 0.3）。每次写入或废止只 bump 对应 topic 的单调版本号；`topicVersions()` 暴露整张版本表供 STM 门控消费。`<root>/.dsh/memory/` 下的 Phase-1 Markdown 文件仍是人类可编辑源，在每个操作前按文件内容哈希幂等导入（`imports` 表）：编辑与移除会传播为新版本与 tombstone；经 API 删除的条目在文件未变时不复活。磁盘 schema 带单调 `SCHEMA_VERSION`；旧格式 fail loud 拒绝，不做迁移。

可选的嵌入层（阶段二c，schema v3）把检索升级为名次融合。配置 embedder——Config 字段族 `embeddingProvider: 'http'` + `embeddingUrl`/`embeddingModel`/`embeddingApiKey`/`embeddingTimeoutMs`（OpenAI 兼容 embeddings 端点），或经插件 `apply` 第三参数注入任意 `@huiliyi37/dsh-semantic-index` 的 `EmbeddingProvider`（注入优先于 Config）——之后 `save` 为每个新版本的文本取一次向量（每个事实版本一行 Float32 BLOB 存进 `embeddings` 表，带 embedder 戳记），`search` 把 BM25 名次与全量过滤候选的暴力余弦名次做 Reciprocal Rank Fusion（k=60），词面零交叠的释义由此可达。融合分归一化——`fused = rrfScore / (2/(k+1))`：两榜双顶 = 1，单榜居首 = 0.5——再按 `score = fused × statusWeight` 流入同一个 `score` 字段，adaptive-memory 的置信度门与 `topicBoosts` 无感消费；状态分层仍排在融合分之前。查询向量每次 `search` 至多取一次（空查询或无候选不取）；向量行缺失（Markdown 导入与无 embedder 时期的写入从不嵌入）或戳记不符（换模型）的候选在检索时按批惰性重嵌——这是文档化的重建路径，不需要单独的重建命令。缺省不配置 embedder，行为与纯 BM25 逐字节一致、零额外调用；嵌入调用由构造保证不在请求路径上：写时在 `save` 内，查询时在 `search` 内。

阶段三加入了巩固 pass 消费的冲突与退役能力。`markUncertain(scope, subject, predicate)` 把该对当前的 active 事实降级为 `uncertain`——不删除、不 supersede，检索以较低权重保留——并追加一条 observation 事件，让审计轨迹记录这次冲突；之后对 uncertain 头的保存会将其 supersede（新证据消解不确定性，每对保持一个当前版本）。`retireStale(options)` 每次调用计一次巩固，退役早于调用方给定保留期限的 superseded 版本，以及连续指定次数巩固未被检索命中的 active/uncertain 事实（使用信号是 `used_at_consolidation`，每当 `search` 命中某版本时刷新为 `meta` 表的巩固计数）。`retired` 事实完全离开 `search` 与 `list`；行与 append-only 日志保留，退役会追加 tombstone 事件并 bump 所属 topic 的版本。两者都是 seam 的可选能力——消费方以 `typeof memory.markUncertain === 'function'` / `typeof memory.retireStale === 'function'` 探测。

## Model Experience

### Indirect — 仅服务面

#### What the model sees

不直接可见：本 provider 自身从不注入任何内容。记忆内容只经消费方到达模型（`memory_save` / `memory_search` 的工具结果、`dsh-adaptive-memory` 的 STM 快照）。

#### Token effect

无直接成本；消费方按各自预算渲染召回条目。配置 embedder 后，每次 `save` 花一次嵌入调用（幂等重保存会花掉这次调用但丢弃向量），每次 `search` 花一次查询嵌入调用，至多追加一次惰性重嵌批量调用（向量缺失或戳记不符时）。

#### KV Cache effect

不贡献 prompt 结构。按 topic 分区的版本号让 STM 门控只在被召回 topic 真正变化时刷新，保护 provider 前缀缓存。

## Known Limitations and Deferred Work

- **暴力向量扫描**——配置 embedder 后余弦名次要扫全部过滤通过的候选；记忆规模（数百条）下没有问题，ANN 索引推迟。融合还改变了 score 语义：单榜居首的命中约 0.5 分，而纯 BM25 可达 1.0——启用嵌入时 adaptive-memory 的置信度门阈值（本就是文档化的占位值）需要重新调参。词法通道不变：CJK 召回依赖二元组分词，单字 CJK 查询不命中。
- **单进程写入**——两个 dsh 实例在同一 cwd 并发写不受保护；存储假定单事件循环。
- **退役需要驱动方**——`retireStale` 只在消费方（目前是 `@huiliyi37/dsh-memory-consolidate`）调用时运行；store 自身从不主动退役，而检索期的使用信号让检索成为对视图（而非日志）的一次写入。
