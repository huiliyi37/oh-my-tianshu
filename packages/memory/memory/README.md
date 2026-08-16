# @huiliyi37/dsh-memory

English | [中文](README.zh.md)

Project memory service: a Markdown-file store under `<root>/.dsh/memory/` (one file per scope — `global.md`, `sessions/<id>.md`), exposed as the `memory` service (`ctx.provide`) with `save` / `search` / `list` / `delete`. This package is the Service Definition plus the Markdown provider in one; `@huiliyi37/dsh-memory-sqlite` is the structured second provider (SQLite/FTS, BM25 hybrid retrieval). The seam's `save` input carries optional structured fields (`kind` / `topic` / `entities` / `confidence` / `fact` / `sourceRefs`) that structured providers consume and this provider ignores; `search` additionally accepts exact `entities` / `topic` filters (degraded to tag matching here) and returns `MemorySearchResult` with an optional normalized `score` (unset for this provider's case-insensitive substring scan). `excludeIds` filters entries by id or id prefix so consumers (e.g. `memory_search`) can skip entries already carried by the STM context. `topicVersions()` is an optional seam capability — per-topic monotonic versions for STM gating — implemented only by structured providers; consumers probe with `typeof memory.topicVersions === 'function'`. Two further optional capabilities serve the phase-3 consolidation pass: `markUncertain(scope, subject, predicate)` demotes a conflicted active fact to `uncertain` without deleting or superseding it, and `retireStale(options)` retires stale superseded versions and long-unused facts (retired facts leave retrieval; the log stays append-only) — both probed the same way. Consumers resolve the service dynamically via `ctx.reflect.get('memory', false)`.

## Model Experience

### Indirect — service surface only

#### What the model sees

Nothing directly: memory content reaches the model only through consumers (`memory_save` / `memory_search` tool results, the `dsh-adaptive-memory` STM snapshot).

#### Token effect

None directly; consumers render recalled entries at their own budgets.

#### KV Cache effect

No prompt structure contributed directly; the store's on-disk format is stable and append-agnostic.

## Known Limitations and Deferred Work

- **Substring retrieval** — no ranking, BM25, or FTS; the structured provider is [`@huiliyi37/dsh-memory-sqlite`](../memory-sqlite/README.md) (SQLite/FTS, per the adaptive-memory Agent Note's phase-2 contract).
- **Single-process writes** — concurrent writers from two dsh instances on one cwd are not guarded; the store assumes one event loop.
