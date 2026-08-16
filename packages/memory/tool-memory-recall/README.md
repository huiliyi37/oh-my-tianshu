# @huiliyi37/dsh-tool-memory-recall

English | [中文](README.zh.md)

`memory_deep_recall` — mode-C raw-history recall (phase 3 of the adaptive-memory Agent Note). The model calls the tool with a question; the tool fans out to a **read-only in-process reader subagent** (static persona, a fixed structured-output schema, a tool allow list defaulting to `session_search` / `session_event_search` / `session_event_read`, `maxDepth` 0 so the reader never delegates further) that searches session transcripts through the session-query FTS and returns the fixed distilled shape `{ answer, evidence: [{ sessionId, eventSeqs, quote }], uncertainties, confidence }`. Only the budget-clamped distillation (`maxAnswerChars` 2000, `maxEvidence` 5, `maxQuoteChars` 240 — all Config fields) returns as the tool result; **raw transcript bytes never enter the main context**. Capabilities are probed at execution time: a missing `sessionQuery` service, missing read tools (mount `@huiliyi37/dsh-tool-session-query`), a missing subagent provider (`provider`, default `spawn`), or a provider without the `toolFilter` / `outputSchema` / `persona` / `depthLimit` capabilities surfaces as a plain model-visible error — fail loud, never a silent degradation. The tool schema and the guidance section are static strings (prefix-cache discipline). No shipped composition mounts this plugin.

## Model Experience

### memory_deep_recall tool and static guidance section

#### What the model sees

An order-131 system-prompt section with static guidance, plus the tool schema (generated [tool catalog](../../../docs/tool-catalog.md#huiliyi37dsh-tool-memory-recall)) and its result: the answer text, one evidence line `- [sessionId#seqs] quote` per item, one `（不确定）…` line per uncertainty, and a final confidence line. When a capability is missing, the tool result is a plain error naming the missing capability.

##### Static guidance section (verbatim)

```markdown
深度召回（memory_deep_recall）：需要回答"以前某个会话里具体发生了什么"类问题时使用。
- 它派出只读 reader 子代理检索历史会话转录，只返回蒸馏答案（答案 + 证据引用 + 不确定点 + 置信度）
- 原始转录不会进入本会话上下文；已知条目id/关键词的精确查找仍优先用 memory_search
```

#### Token effect

Fixed section and tool-schema cost; results are bounded by the Config budgets (worst case ~1–2k tokens for answer + evidence + uncertainties).

#### KV Cache effect

Prefix-stable: the section text and tool schema are byte-stable literals. The reader runs in its own child session — an independent model request — whose transcript never enters this session's context.

## Known Limitations and Deferred Work

- **Evidence is trusted, not verified** — the reader's citations are not re-checked against the transcripts before returning; an invented `sessionId` or `quote` passes through (bounded by the budgets).
- **Three opt-in capabilities required** — the `sessionQuery` service, the `dsh-tool-session-query` read tools, and a full-capability in-process subagent provider; absent any of them the tool only reports unavailability.
