# @deepseek-ai/dsh-tool-file-info

[English](README.md) | 中文

`file_info` 工具：单文件大小/行数/结构骨架 + 信息素召回，外加两个会话事件信号源——`read_file` 调用沉积 entry-point 信号、失败验证命令在命名测试文件上沉积 fragile 信号。所有文件访问走 `ctx.fs` 服务接缝。

## Model Experience

### file_info 工具

#### What the model sees

`file_info` 工具 schema（path）与其结果（大小、骨架行、信息素强度）。不贡献提示文本。

#### Token effect

每次请求的固定工具 schema 成本；结果文本有界（骨架 ≤5 行）。

#### KV Cache effect

工具视图不变时前缀稳定；信息素衰减只改变结果内容。

## Known Limitations and Deferred Work

- **信号启发式保守**——fragile 沉积依赖命令输出的失败标记；可能误判。
- **turn:step 关联有界**于会话轮次；长会话累积映射条目直至 GC。
- **不展示 mtime**——fs 服务版本 token 不透明（设计使然）。
