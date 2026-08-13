# @deepseek-ai/dsh-tool-semantic-search

[English](README.md) | 中文

`semantic_search` 工具：陈旧检查 → 增量更新 → 混合（BM25+向量）检索，外加有界动态上下文索引摘要（order 120，仅内容变化时注入）。

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
- **索引重建同步**——冷工作区首次搜索内联承担全量扫描。
- **首批最多嵌入 4000 分块**——更大索引在后续搜索中分批补全。
