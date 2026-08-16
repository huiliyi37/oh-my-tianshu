# @huiliyi37/dsh-tool-semantic-search

English | [中文](README.zh.md)

`semantic_search` tool over `dsh-semantic-index`: a single-flight refresh (staleness check → incremental update, all asynchronous IO) → hybrid (BM25+vector) retrieval, plus a bounded dynamic-context index summary (order 120) that injects only on content change. The summary renders in-memory index state — freshness comes from a mount-time warm-up refresh and per-execution refreshes, so prompt assembly never touches the filesystem.

## Model Experience

### semantic_search tool + semantic:index context block

#### What the model sees

The `semantic_search` tool schema (query/limit) and the `<semantic:index>` summary block (file/chunk counts). Hit content appears only as tool results.

#### Token effect

Fixed tool-schema cost on every request in that tool view; the summary block is bounded (~1KB) and diff-injected only when the index shape changes.

#### KV Cache effect

Prefix-stable while tool definitions and the summary text are unchanged; index-growth changes invalidate reuse from the first changed byte of the summary block.

## Known Limitations and Deferred Work

- **No embedding provider ships** — hybrid search degrades to BM25 unless a deployment wires one in (documented seam).
- **A cold workspace pays the first-search scan as wall time** — the scan is asynchronous (never blocks the event loop), but it still has to happen before hits reflect the workspace.
- **The summary may lag disk between refreshes** — it renders the last refreshed index state; edits surface after the next refresh (mount warm-up or tool execution).
- **First batch embeds at most 4000 chunks** — larger indexes top up on subsequent searches.
