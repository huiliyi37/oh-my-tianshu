# @huiliyi37/dsh-tool-memory

English | [中文](README.zh.md)

Model-facing memory tools over the `dsh-memory` service: `memory_save` writes a project-level memory entry, `memory_search` recalls entries by case-insensitive substring match with `excludeIds` (id or id-prefix) to skip entries already carried by the STM context and a per-call result budget (`searchLimit`, default 10 — the model's `limit` is clamped to it). The system-prompt section is static capability guidance only; the per-save dynamic digest was removed because every refresh rewrote the request prefix and forfeited the provider prefix cache. `digest: true` remains as a debug switch for cache A/B arms. The memory service is resolved dynamically via `ctx.reflect.get('memory', false)`; tool execution fails loud when it is absent.

## Model Experience

### memory_save / memory_search tools and static guidance section

#### What the model sees

An order-130 system-prompt section with static guidance on when to save or search project memory (including the `excludeIds` habit), plus the two tool schemas and their results: `memory_save` returns the stored id and text; `memory_search` returns matching entries rendered as `[short-id] text #tags`.

#### Token effect

Fixed section and tool-schema cost; search results are bounded by the per-call `searchLimit` budget.

#### KV Cache effect

Prefix-stable: the section text is a byte-stable literal by default, so memory writes no longer invalidate the request prefix. The optional `digest: true` debug mode appends a digest refreshed after every save and is expected to break prefix reuse — that is exactly what it exists to measure.

## Known Limitations and Deferred Work

- **Substring recall** — `memory_search` matches literal substrings only; ranking and BM25/FTS retrieval are deferred to the phase-2 structured store (see the adaptive-memory Agent Note).
