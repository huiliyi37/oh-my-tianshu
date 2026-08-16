# search/ — workspace retrieval

English | [中文](README.zh.md)

Workspace code retrieval: codebase indexes (symbol graph and semantic BM25) plus their model-facing tools, which also contribute bounded dynamic-context index summaries.

| Package | Role | ctx key |
|---|---|---|
| [`meridian/`](meridian/README.md) | MeridianDB codebase index — SQLite symbol/edge graph, lazy incremental indexing | — |
| [`semantic-index/`](semantic-index/README.md) | File-level BM25 incremental index with JSON persistence | — |
| [`tool-meridian/`](tool-meridian/README.md) | `repo_graph` tool over the meridian index + bounded index summary | — |
| [`tool-semantic-search/`](tool-semantic-search/README.md) | `semantic_search` tool over the semantic index + bounded index summary | — |
