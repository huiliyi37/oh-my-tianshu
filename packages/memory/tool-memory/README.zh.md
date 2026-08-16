# @huiliyi37/dsh-tool-memory

[English](README.md) | 中文

`dsh-memory` 服务之上的模型工具：`memory_save` 写入一条项目级记忆，`memory_search` 按大小写不敏感的子串匹配检索，支持 `excludeIds`（id 或 id 前缀）跳过已进入 STM 上下文的条目，并带单次结果预算（`searchLimit`，缺省 10——模型的 `limit` 参数被钳制到该值）。system prompt section 只含静态能力指引；原先每次保存后刷新的动态摘要已移除——每次刷新都会重写请求前缀、击穿 provider 前缀缓存。`digest: true` 保留为缓存 A/B 对比的调试开关。memory 服务经 `ctx.reflect.get('memory', false)` 动态获取；未装配时工具执行 fail loud。

## Model Experience

### memory_save / memory_search 工具与静态指引 section

#### What the model sees

一个 order-130 的 system prompt section，含何时保存/检索项目记忆的静态指引（含 `excludeIds` 习惯）；两个工具 schema 及其结果：`memory_save` 返回落盘的 id 与文本；`memory_search` 返回渲染为 `[短id] 文本 #tags` 的命中条目。

#### Token effect

section 与工具 schema 为固定成本；检索结果受单次 `searchLimit` 预算约束。

#### KV Cache effect

前缀稳定：section 文本缺省为逐字节稳定的字面量，记忆写入不再使请求前缀失效。可选的 `digest: true` 调试模式会在每次保存后刷新摘要，预期会破坏前缀复用——这正是它存在的意义（量化该损耗）。

## Known Limitations and Deferred Work

- **子串召回**——`memory_search` 只做字面子串匹配；排序与 BM25/FTS 检索推迟到阶段二的结构化存储（见 adaptive-memory 的 Agent Note）。
