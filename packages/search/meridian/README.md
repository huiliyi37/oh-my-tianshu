# @deepseek-ai/dsh-meridian

English | [中文](README.zh.md)

Codebase graph index: node:sqlite (WAL) symbol/edge store fed by tree-sitter parsing (TS/Python/Go), with repo_map spreading activation, impact analysis, flow queries, behavior signals (co-edit/access heat/pheromone), and background backfill. Consumed by the `repo_graph` tool.

## Model Experience

### Indirect — library surface

#### What the model sees

No tool definitions or prompt text originate here. Model-visible output flows through `dsh-tool-meridian` (repo_graph renders) and the `<codebase-index>` summary block.

#### Token effect

None directly; query rendering in the tool package carries the token cost (repo_map respects a maxTokens budget).

#### KV Cache effect

Prefix-stable while the tool view is unchanged; index/backfill growth affects result content, not prompt structure.

## Known Limitations and Deferred Work

- **Three languages only** (TS/Python/Go) — other source languages are not parsed.
- **Call edges are name-matched heuristics** — overloads degrade to `ambiguous`, dynamic callees are dropped.
- **SQLite is single-writer** — concurrent indexer instances serialize on the DB file.
- **Schema v1, monotonic** — older on-disk formats are rejected (fails loud).
