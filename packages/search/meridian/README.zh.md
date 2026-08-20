# @huiliyi37/dsh-meridian

[English](README.md) | 中文

代码图索引：node:sqlite（WAL）符号/边存储，由 tree-sitter 解析（TS/Python/Go）供给，含 repo_map 激活传播、影响分析、流查询、行为信号（协同编辑/访问热度/信息素）与后台回填。由 `repo_graph` 工具消费。

## Model Experience

### 间接——库面

#### What the model sees

此处不产生工具定义或提示文本。模型可见输出经 `dsh-tool-meridian`（repo_graph 渲染）与 `<codebase-index>` 摘要块流出。

#### Token effect

无直接成本；工具包中的查询渲染承担 token 成本（repo_map 尊重 maxTokens 预算）。

#### KV Cache effect

工具视图不变时前缀稳定；索引/回填增长影响结果内容，不影响提示结构。

## Known Limitations and Deferred Work

- **仅三种语言**（TS/Python/Go）——其他源码语言不解析。
- **调用边是命名匹配启发式**——重载降级为 `ambiguous`，动态 callee 丢弃。
- **SQLite 单写者**——并发索引实例在 DB 文件上串行。
- **schema v1 落在 `.rivet/dsh-meridian.db`**——不是天枢的 `.rivet/meridian.db`（schema 2，含额外生态表）。不匹配的 `dsh-meridian.db` 在查询时被拒绝；动态 context 摘要省略该块，不把错误变成回合失败。
