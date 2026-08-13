# @deepseek-ai/dsh-pheromone

[English](README.md) | 中文

文件级信息素存储：经指数衰减信号（fragile/entry-point 等）的会话级空间记忆，原子 JSON 持久化 + 防抖写入与指数退避重试。信号源由消费插件接线（见 `dsh-tool-file-info`）。

## Model Experience

### 间接——库面

#### What the model sees

无模型可见面；信息素经 `file_info` 工具结果（衰减强度）或其他插件消费。

#### Token effect

无直接成本。

#### KV Cache effect

不贡献提示结构；存储带外进行。

## Known Limitations and Deferred Work

- **衰减与容量固定**（默认 7 天半衰期、200 条 LRU）——可调项是存储选项，非配置字段。
- **同步冲刷尽力而为**（非原子）——进程退出路径可能丢失最后防抖窗口。
- **无跨会话持久化契约**——格式内部化；升级可能拒绝旧文件。
