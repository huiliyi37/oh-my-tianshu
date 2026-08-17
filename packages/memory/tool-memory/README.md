# @huiliyi37/dsh-tool-memory

English | [中文](README.zh.md)

Model-facing memory tools over the `dsh-memory` service: `memory_save` writes a project-level memory entry, `memory_search` recalls entries by case-insensitive substring match with `excludeIds` (id or id-prefix) to skip entries already in the current request context and a per-call result budget (`searchLimit`, default 10 — the model's `limit` is clamped to it). The system-prompt section is static capability guidance only. `digest: true` remains as a debug switch: it appends a digest of the 20 most recent entries and refreshes it after every save, which rewrites the request prefix. The memory service is resolved dynamically via `ctx.reflect.get('memory', false)`; tool execution fails loud when it is absent.

## Model Experience

### System prompt

#### What the model sees

An order-130 system-prompt section with static guidance on when to save or search project memory (including the `excludeIds` habit). `digest: true` appends a dynamic digest after this text.

##### Memory capability guidance

```markdown
项目记忆（memory）：本项目有持久化记忆服务，可跨会话保存与检索知识。
- 需要历史决策/项目结构/用户偏好时：用 memory_search 检索
- 发现重要事实（决策、偏好、约定）时：用 memory_save 保存（scope 缺省 global）
- 检索时用 excludeIds 排除已在当前上下文出现的条目，避免重复
```

#### Token effect

Fixed section cost while the plugin is mounted; `digest: true` adds up to 20 one-line summaries that change after each save.

#### KV Cache effect

Prefix-stable: the section text is a byte-stable literal by default, so memory writes do not invalidate the request prefix. The optional `digest: true` debug mode appends a digest refreshed after every save and is expected to break prefix reuse — that is exactly what it exists to measure.

### Tool schemas

#### What the model sees

The generated [`memory_save` and `memory_search` schemas](../../../docs/tool-catalog.md#huiliyi37dsh-tool-memory). `memory_search` exposes `excludeIds` and a `limit` that the plugin clamps to `searchLimit`.

#### Token effect

Fixed schema cost while the tools are visible; search results are bounded by the per-call `searchLimit` budget.

#### KV Cache effect

Prefix-stable while the tool definitions and visibility are unchanged.

### Tool results

#### What the model sees

`memory_save` returns the stored id and text. `memory_search` returns matching entries rendered as `[short-id] text #tags`, or `（无匹配记忆）` when empty.

#### Token effect

Result size follows stored text and the clamped hit count; results remain in logged tool history until compaction.

#### KV Cache effect

Append-only result text follows the reusable request prefix and does not invalidate earlier cache entries.

## Known Limitations and Deferred Work

- **Substring recall** — `memory_search` matches literal substrings only; ranking and scored retrieval belong to a structured memory provider, not this tool.
