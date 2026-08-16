# @huiliyi37/dsh-tool-memory-recall

[English](README.md) | 中文

`memory_deep_recall`——模式 C 的原始历史召回（adaptive-memory Agent Note 的阶段三）。模型带一个问题调用本工具；工具把问题扇出给一个**只读的进程内 reader subagent**（静态 persona、固定的结构化输出 schema、工具允许列表缺省为 `session_search` / `session_event_search` / `session_event_read`、`maxDepth` 为 1 使 reader 位于深度 1、不得再委托），由它经 session-query FTS 检索会话 transcript，返回固定蒸馏形态 `{ answer, evidence: [{ sessionId, eventSeqs, quote }], uncertainties, confidence }`。只有按预算钳制的蒸馏结果（`maxAnswerChars` 2000、`maxEvidence` 5、`maxQuoteChars` 240——均为 Config 字段）作为工具结果返回；**原始 transcript 字节绝不进入主上下文**。能力在执行时探测：缺 `sessionQuery` 服务、缺只读工具（挂载 `@huiliyi37/dsh-tool-session-query`）、缺 subagent provider（`provider`，缺省 `spawn`）、或 provider 不具备 `toolFilter` / `outputSchema` / `persona` / `depthLimit` 能力时，都以普通的模型可见错误呈现——fail loud，绝不静默降级。工具 schema 与指引 section 都是静态字符串（前缀缓存纪律）。发布组合均不挂载本插件。

## Model Experience

### memory_deep_recall 工具与静态指引 section

#### What the model sees

一个 order-131 的 system prompt 静态指引 section，加上工具 schema（生成的[工具目录](../../../docs/tool-catalog.md#huiliyi37dsh-tool-memory-recall)）及其结果：答案正文、每条证据一行 `- [sessionId#seqs] quote`、每个不确定点一行 `（不确定）…`，以及末尾的置信度行。能力缺失时，工具结果是一条指明所缺能力的普通错误。

##### 静态指引 section（原文）

```markdown
深度召回（memory_deep_recall）：需要回答"以前某个会话里具体发生了什么"类问题时使用。
- 它派出只读 reader 子代理检索历史会话转录，只返回蒸馏答案（答案 + 证据引用 + 不确定点 + 置信度）
- 原始转录不会进入本会话上下文；已知条目id/关键词的精确查找仍优先用 memory_search
```

#### Token effect

固定的 section 与工具 schema 成本；结果受 Config 预算限界（最坏情况答案 + 证据 + 不确定点约 1–2k token）。

#### KV Cache effect

前缀稳定：section 文本与工具 schema 是字节稳定的字面量。reader 在自己的子会话中运行——一次独立的模型请求——其 transcript 绝不进入本会话上下文。

## Known Limitations and Deferred Work

- **证据可信但未核验**——reader 的引用在返回前不会对照 transcript 复核；编造的 `sessionId` 或 `quote` 会原样通过（受预算限界）。
- **需要三项可选能力齐备**——`sessionQuery` 服务、`dsh-tool-session-query` 的只读工具、能力完整的进程内 subagent provider；缺任何一项，工具只能报告不可用。
