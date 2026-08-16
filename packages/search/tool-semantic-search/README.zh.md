# @huiliyi37/dsh-tool-semantic-search

[English](README.md) | 中文

`semantic_search` 工具：单飞刷新（陈旧检查 → 增量更新，全异步 IO）→ 混合（BM25+向量）检索，外加有界动态上下文索引摘要（order 120，仅内容变化时注入）。摘要只渲染内存中的索引状态——新鲜度来自挂载时预热刷新与每次执行前刷新，prompt 组装不触碰文件系统。

## Model Experience

### semantic_search 工具 + semantic:index 上下文块

#### What the model sees

`semantic_search` 工具 schema（query/limit）与 `<semantic:index>` 摘要块（文件/分块计数）。命中内容仅作为工具结果出现。

#### Token effect

每次请求的固定工具 schema 成本；摘要块有界（约 1KB）且仅在索引形态变化时 diff 注入。

#### KV Cache effect

工具定义与摘要文本不变时前缀稳定；索引增长从摘要块首个变化字节起失效复用。

## Known Limitations and Deferred Work

- **不随包附带 embedding provider**——未接入时混合搜索降级为 BM25（文档化接缝）。
- **冷工作区首次搜索承担全量扫描的墙钟时间**——扫描已异步（绝不阻塞事件循环），但命中反映工作区前必须完成。
- **摘要可能滞后于磁盘**——渲染的是最近一次刷新的索引状态；编辑在下一次刷新（挂载预热或工具执行）后可见。
- **首批最多嵌入 4000 分块**——更大索引在后续搜索中分批补全。
