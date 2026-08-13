# @huiliyi37/dsh-tool-memory

[English](README.md) | 中文

`memory` 工具：在 `dsh-memory` 服务上暴露 recall 与 remember，摘要缓存绑定 apply 闭包（按实例隔离）。

## Model Experience

### memory 工具

#### What the model sees

`memory` 工具 schema（action/query/text/…）与其召回结果作为工具输出。

#### Token effect

固定工具 schema 成本；召回结果受消费者上限约束。

#### KV Cache effect

工具视图不变时前缀稳定；召回结果只改变内容。

## Known Limitations and Deferred Work

- **召回延迟**取决于存储规模（声明上的 BM25 扫描）。
- **项目级写入**可能延迟到会话结束（质量门禁）。
