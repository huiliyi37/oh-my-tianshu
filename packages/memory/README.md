# memory/ — project memory

English | [中文](README.zh.md)

Cross-session project memory: a Markdown-file store behind the `memory` service, the model-facing save/search tools, and the intent-gated STM snapshot that keeps recall prefix-cache safe. Consumers resolve the service dynamically (`ctx.reflect.get('memory', false)`); the `memory` service itself is mounted by no shipped composition today, so the shipped `/remember` and `/memory` commands answer their unavailable text until a composition adds it.

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Memory Service Definition + Markdown provider | `memory` (reflect) |
| [`memory-sqlite/`](memory-sqlite/README.md) | Structured LTM provider: append-only event log + materialized fact view on SQLite/FTS5 | `memory` (reflect) |
| [`tool-memory/`](tool-memory/README.md) | Model-facing `memory_save` / `memory_search` tools + static guidance section | — |
| [`adaptive-memory/`](adaptive-memory/README.md) | Intent-gated STM snapshot via the runtime-context append channel | — |
| [`memory-consolidate/`](memory-consolidate/README.md) | Session-end consolidation: gated experience extraction, conflict uncertainty, retirement driver | — |
| [`tool-memory-recall/`](tool-memory-recall/README.md) | Model-facing `memory_deep_recall` tool over a read-only reader subagent | — |
| [`command-memory/`](command-memory/README.md) | Human-facing `/remember` / `/memory` slash commands over the optional service | — |
