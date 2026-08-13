# @deepseek-ai/dsh-semantic-index

[English](README.md) | 中文

语义工作区索引：文件级 BM25（中文 bigram 感知）作用于定义对齐分块，可选向量层经 RRF 融合，支持增量更新与 `.rivet/` 下 JSON 持久化。供 `semantic_search` 工具使用，也可被其他检索插件消费。

## Model Experience

### 间接——库面

#### What the model sees

此处不产生工具定义或提示文本。索引仅通过 `semantic_search` 工具包（`dsh-tool-semantic-search`）向模型可见上下文贡献内容——以 file:line 范围与片段文本渲染命中结果。

#### Token effect

无直接成本；工具渲染命中结果承担 token 成本（每条片段上限 500 字符）。

#### KV Cache effect

工具视图不变时前缀稳定；索引新鲜度影响命中内容，不影响提示结构。

## Known Limitations and Deferred Work

- **无异步/tree-sitter 分块**——同步正则启发式是基线；精确 tree-sitter 分块在 `dsh-meridian`。
- **暴力向量搜索**——数千分块可行；更大语料需要 ANN 索引（延后）。
- **索引按进程、非常驻守护**——陈旧检测在工具调用时运行；长驻编辑器无后台刷新。
- **maxFiles 限制单次重建（默认 500）**——更大树通过增量更新渐进索引。
