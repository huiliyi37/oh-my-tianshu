# memory/ — project memory

English | [中文](README.zh.md)

Cross-session project memory behind the `memory` service. The shipped TUI bundle mounts the Markdown provider plus `dsh-tool-memory`. `dsh-memory-sqlite` is an alternate provider of the same `memory` key and is not mounted in any shipped composition — a host mounts one provider, never both. `dsh-adaptive-memory` and `dsh-memory-consolidate` are opt-in consumers of that key; they are on the tree and also stay off shipped compositions.

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Service Definition + Markdown-file provider | `memory` (reflect) |
| [`memory-sqlite/`](memory-sqlite/README.md) | Structured LTM provider (SQLite/FTS5) | `memory` (reflect) |
| [`tool-memory/`](tool-memory/README.md) | Model-facing `memory_save` / `memory_search` | registers on `ctx.tools` |
| [`adaptive-memory/`](adaptive-memory/README.md) | Intent-gated STM snapshot (append-on-change) | injects `systemPrompt` |
| [`memory-consolidate/`](memory-consolidate/README.md) | Session-end extraction behind a success gate | listens on `session/disposed` |
