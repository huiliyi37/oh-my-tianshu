# @huiliyi37/dsh-tool-memory

[English](README.md) | 中文

`dsh-memory` 服务之上的模型工具：`memory_save` 写入一条项目级记忆，`memory_search` 按大小写不敏感的子串匹配检索，支持 `excludeIds`（id 或 id 前缀）跳过已进入当前请求上下文的条目，并带单次结果预算（`searchLimit`，缺省 10——模型的 `limit` 参数被钳制到该值）。system prompt section 只含静态能力指引。`digest: true` 保留为调试开关：它追加最近 20 条记忆的摘要，并在每次 save 后刷新，从而重写请求前缀。memory 服务经 `ctx.reflect.get('memory', false)` 动态获取；未装配时工具执行 fail loud。

## Model Experience

### System prompt

#### What the model sees

一个 order-130 的 system prompt section，含何时保存/检索项目记忆的静态指引（含 `excludeIds` 习惯）。`digest: true` 会在这段文字之后追加动态摘要。

##### Memory capability guidance

```markdown
项目记忆（memory）：本项目有持久化记忆服务，可跨会话保存与检索知识。
- 需要历史决策/项目结构/用户偏好时：用 memory_search 检索
- 发现重要事实（决策、偏好、约定）时：用 memory_save 保存（scope 缺省 global）
- 检索时用 excludeIds 排除已在当前上下文出现的条目，避免重复
```

#### Token effect

插件挂载期间 section 为固定成本；`digest: true` 最多追加 20 条一行摘要，并在每次 save 后变化。

#### KV Cache effect

前缀稳定：section 文本缺省为逐字节稳定的字面量，记忆写入不会使请求前缀失效。可选的 `digest: true` 调试模式会在每次保存后刷新摘要，预期会破坏前缀复用——这正是它存在的意义（量化该损耗）。

### Tool schemas

#### What the model sees

生成的 [`memory_save` 与 `memory_search` schema](../../../docs/tool-catalog.md#huiliyi37dsh-tool-memory)。`memory_search` 暴露 `excludeIds`，以及会被插件钳制到 `searchLimit` 的 `limit`。

#### Token effect

工具可见期间 schema 为固定成本；检索结果受单次 `searchLimit` 预算约束。

#### KV Cache effect

工具定义与可见性不变时前缀稳定。

### Tool results

#### What the model sees

`memory_save` 返回落盘的 id 与文本。`memory_search` 将命中条目渲染为 `[短id] 文本 #tags`；无命中时为 `（无匹配记忆）`。

#### Token effect

结果大小随存储文本与被钳制的命中数变化；结果保留在已记录的工具历史中直到 compaction。

#### KV Cache effect

仅追加的结果文本位于可重用请求前缀之后，不会使较早的缓存条目失效。

## Known Limitations and Deferred Work

- **子串召回**——`memory_search` 只做字面子串匹配；排序与带得分的检索属于结构化记忆 provider，不属于本工具。
