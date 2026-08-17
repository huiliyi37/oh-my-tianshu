# @huiliyi37/dsh-memory

English | [中文](README.zh.md)

Project memory service: a Markdown-file store under `<root>/.dsh/memory/` (one file per scope — `global.md`, `sessions/<id>.md`), exposed as the `memory` service (`ctx.provide`) with `save` / `search` / `list` / `delete`. This package is the Service Definition plus the Markdown provider in one. The seam's `save` input carries optional structured fields (`kind` / `topic` / `entities` / `confidence` / `fact` / `sourceRefs`) that a structured provider may consume and this provider ignores; `search` additionally accepts exact `entities` / `topic` filters (degraded to tag matching here) and returns `MemorySearchResult` with an optional normalized `score` (unset for this provider's case-insensitive substring scan). `excludeIds` filters entries by id or id prefix so consumers (for example `memory_search`) can skip entries already in the current request context. `topicVersions()`, `markUncertain()`, and `retireStale()` are optional seam methods implemented only by structured providers; consumers probe with `typeof memory.topicVersions === 'function'` (and the same for the other two). Consumers resolve the service dynamically via `ctx.reflect.get('memory', false)`.

## Model Experience

### Indirect — service surface only

#### What the model sees

Nothing directly: memory content reaches the model only through consumers (`memory_save` / `memory_search` tool results, `/remember` and `/memory` command output).

#### Token effect

None directly; consumers render recalled entries at their own budgets.

#### KV Cache effect

No prompt structure contributed directly; the store's on-disk format is stable and append-agnostic.

## Known Limitations and Deferred Work

- **Substring retrieval** — no ranking, BM25, or FTS; this Markdown provider does not set `score`.
- **Structured save fields are ignored** — `kind` / `topic` / `entities` / `confidence` / `fact` / `sourceRefs` do not land in the Markdown file; `entities` / `topic` search filters match `tags` exactly.
- **Optional seam methods are absent** — `topicVersions` / `markUncertain` / `retireStale` stay unimplemented so consumers must probe.
- **Single-process writes** — concurrent writers from two dsh instances on one cwd are not guarded; the store assumes one event loop.
- **No per-user isolation** — the store is workspace-scoped.
