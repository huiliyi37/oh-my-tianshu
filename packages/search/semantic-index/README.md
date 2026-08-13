# @deepseek-ai/dsh-semantic-index

English | [中文](README.zh.md)

Semantic workspace index for code retrieval: file-level BM25 (CJK-bigram aware) over definition-aligned chunks, an optional vector layer fused via Reciprocal Rank Fusion, incremental updates, and JSON persistence under `.rivet/`. Used by the `semantic_search` tool and consumable by other retrieval plugins.

## Model Experience

### Indirect — library surface

#### What the model sees

No tool definitions or prompt text originate here. The index contributes to model-visible context only through the `semantic_search` tool package (`dsh-tool-semantic-search`), which renders hits as file:line ranges and snippet text.

#### Token effect

None directly; tool rendering of hits carries the token cost (per-hit text capped at 500 chars).

#### KV Cache effect

Prefix-stable while the tool view is unchanged; index freshness affects hit content but not prompt structure.

## Known Limitations and Deferred Work

- **No async/tree-sitter chunking** — the synchronous regex heuristic is the baseline; precise tree-sitter chunking lives in `dsh-meridian`.
- **Brute-force vector search** — a few thousand chunks are fine; larger corpora need an ANN index (deferred).
- **Index is per-process, not a daemon** — stale detection runs on tool calls; long-lived editors get no background refresh.
- **maxFiles caps one rebuild pass (default 500)** — larger trees index progressively through incremental updates.
