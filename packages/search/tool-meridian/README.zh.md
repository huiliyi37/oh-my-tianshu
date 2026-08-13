# @deepseek-ai/dsh-tool-meridian

[English](README.md) | 中文

`repo_graph` 工具（graph/impact/flow 三模式）基于 `dsh-meridian`，外加有界 `<codebase-index>` 动态上下文摘要（order 120）。首次使用触发按需后台回填（配置门控）。

## Model Experience

### repo_graph 工具 + meridian:index 上下文块

#### What the model sees

`repo_graph` 工具 schema（from_file/mode/symbol/max_tokens）与 `<codebase-index>` 摘要块。查询结果仅作为工具结果出现。

#### Token effect

固定工具 schema 成本；摘要块有界（≤2000 字符）且仅变化时 diff 注入；repo_map 输出尊重 max_tokens 预算。

#### KV Cache effect

工具定义与摘要文本不变时前缀稳定；回填增长改变摘要块，从首个变化字节起失效复用。

## Known Limitations and Deferred Work

- **回填尽力而为**——进程退出即停；不完整索引以部分图回答查询。
- **git ls-files 枚举需要 git 树**；非 git 工作区回退为有界 readdir 遍历。
- **框架边基于正则**（Express 路由 / PascalCase JSX）——框架级精度延后。
