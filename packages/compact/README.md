# compact/ — compaction capability family

English | [中文](README.zh.md)

A compaction capability family (see [capability seams](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)): a Service Definition, a summarizing provider, a model-free tool-result pruning companion, and a human command Consumer. All **product** packages.

| Package | Role | ctx key |
|---|---|---|
| [`compact/`](compact/README.md) | Compaction seam and event vocabulary | `ctx.compact` |
| [`compact-basic/`](compact-basic/README.md) | Token-pressure and summarization backend | registers `ctx.compact` |
| [`compact-tool-result-prune/`](compact-tool-result-prune/README.md) | Optional model-free tool-result pruning | `ctx.toolResultPrune` |
| [`command-compact/`](command-compact/README.md) | Human compaction command | registers on `ctx.commands` |

The backend, optional pruner, and human command compose through the seam; token measurement remains a separate LLM-family service. The [compaction capability-seam Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md) owns the dependency rationale.

The subsystem reference — the `compact/*` events, `CompactionResult`, the service, pruning outcomes — is [docs/subsystems/compaction.md](../../docs/subsystems/compaction.md); the seam's deliberate `dsh-session`/`dsh-llm` dependency is recorded in the [compaction capability-seam Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md).
