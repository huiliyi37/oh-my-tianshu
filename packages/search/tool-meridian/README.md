# @deepseek-ai/dsh-tool-meridian

English | [中文](README.zh.md)

`repo_graph` tool (graph/impact/flow modes) over `dsh-meridian`, plus a bounded `<codebase-index>` dynamic-context summary (order 120). First use kicks an on-demand background backfill (config-gated).

## Model Experience

### repo_graph tool + meridian:index context block

#### What the model sees

The `repo_graph` tool schema (from_file/mode/symbol/max_tokens) and the `<codebase-index>` summary block. Query results appear only as tool results.

#### Token effect

Fixed tool-schema cost; the summary block is bounded (≤2000 chars) and diff-injected only on change; repo_map output respects the max_tokens budget.

#### KV Cache effect

Prefix-stable while tool definitions and the summary text are unchanged; backfill growth changes the summary block and invalidates reuse from the first changed byte.

## Known Limitations and Deferred Work

- **Backfill is best-effort** — stopped at process exit; incomplete indexes answer queries with partial graphs.
- **git ls-files enumeration** needs a git tree; non-git workspaces fall back to a bounded readdir walk.
- **Framework edges are regex-based** (Express routes / PascalCase JSX) — framework-specific precision is deferred.
