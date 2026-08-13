# @deepseek-ai/dsh-memory

[English](README.md) | 中文

项目记忆服务：跨会话召回（结构化声明与知识笔记的 BM25 混合检索）与带质量门禁的声明持久化。提供 agent 与工具使用的 recall/remember 接缝。

## Model Experience

### 间接——库/服务面

#### What the model sees

记忆仅在消费者（工具或插件）将召回声明渲染进上下文时对模型可见；此处不产生提示文本。

#### Token effect

无直接成本；消费者自担召回结果渲染成本。

#### KV Cache effect

不直接贡献提示结构。

## Known Limitations and Deferred Work

- **召回质量依赖已存声明**——稀疏存储回答贫乏。
- **项目级声明在会话结束门控**（pending quality gate）；崩溃会话可能丢弃。
- **无按用户隔离**——存储按工作区作用域。
