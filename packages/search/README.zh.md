# search/：工作区检索

[English](README.md) | 中文

工作区代码检索：代码库索引（符号图与语义 BM25）及面向模型的工具——工具同时贡献有上限的动态上下文索引摘要。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`meridian/`](meridian/README.md) | MeridianDB 代码库索引——SQLite 符号/边图，惰性增量索引 | 无 |
| [`semantic-index/`](semantic-index/README.md) | 文件级 BM25 增量索引，JSON 持久化 | 无 |
| [`tool-meridian/`](tool-meridian/README.md) | meridian 索引之上的 `repo_graph` 工具 + 有界索引摘要 | 无 |
| [`tool-semantic-search/`](tool-semantic-search/README.md) | 语义索引之上的 `semantic_search` 工具 + 有界索引摘要 | 无 |
