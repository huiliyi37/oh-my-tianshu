# @huiliyi37/dsh-memory-sqlite

English | [中文](README.zh.md)

Structured long-term-memory provider for the `memory` service (`@huiliyi37/dsh-memory`), registered under the same `memory` key as the Markdown provider — a composition mounts one or the other. Storage follows the adaptive-memory Agent Note's phase-2 LTM contract: an **append-only event log** (`events`: kind fact/experience/observation/tombstone, keywords, entities, topic, confidence, sourceRefs) plus a **materialized fact view** (`facts`: subject/predicate/value, validFrom/validTo, confidence, status active/superseded/uncertain, supersedes, sourceEventId). Saving a different value under the same (scope, subject, predicate) supersedes the old version — invalidate, never delete; a partial unique index enforces one active fact per pair. `delete` tombstones (superseded + a tombstone event); nothing erases the log.

Retrieval is hybrid: FTS5 BM25 over text + keywords (CJK runs are bigrammed at index and query time so substring queries hit), exact `entities`/`topic` filters, scope and `excludeIds` filters, and temporal validity as a hard ordering — results sort by status tier (active > uncertain > superseded), then by normalized score: `relevance = -bm25 / (1 + -bm25)` (empty query: 1), `score = relevance × statusWeight` (active 1.0 / uncertain 0.6 / superseded 0.3). Every write or tombstone bumps only its topic's monotonic version; `topicVersions()` exposes the table for STM gating. The Phase-1 Markdown files under `<root>/.dsh/memory/` remain the human-edited source and are imported idempotently (per-file content hashes in the `imports` table) before every operation: edits and removals propagate as new versions and tombstones, and entries tombstoned via the API are not resurrected while the file is unchanged. The on-disk schema carries a monotonic `SCHEMA_VERSION`; old formats are rejected loud, not migrated.

Phase 3 adds the conflict and retirement capabilities the consolidation pass consumes. `markUncertain(scope, subject, predicate)` demotes the pair's current active fact to `uncertain` — no deletion, no supersession, retrieval keeps it at the lower weight — and appends an observation event so the audit trail records the conflict; a later save over an uncertain head supersedes it (fresh evidence resolves the uncertainty, one current version per pair). `retireStale(options)` counts one consolidation per call and retires superseded versions older than the caller-supplied retention horizon plus active/uncertain facts not surfaced by retrieval for the supplied number of consecutive consolidations (the use signal is `used_at_consolidation`, refreshed to the `meta`-table consolidation counter whenever `search` surfaces a version). `retired` facts leave `search` and `list` entirely; the rows and the append-only log stay, and retirement appends tombstone events and bumps the owning topic versions. Both are optional seam capabilities — consumers probe with `typeof memory.markUncertain === 'function'` / `typeof memory.retireStale === 'function'`.

## Model Experience

### Indirect — service surface only

#### What the model sees

Nothing directly: this provider never injects anything by itself. Memory content reaches the model only through consumers (`memory_save` / `memory_search` tool results, the `dsh-adaptive-memory` STM snapshot).

#### Token effect

None directly; consumers render recalled entries at their own budgets.

#### KV Cache effect

No prompt structure contributed. Topic-partitioned versions let the STM gate refresh only when a recalled topic actually changed, protecting the provider prefix cache.

## Known Limitations and Deferred Work

- **BM25-only ranking** — no embeddings yet (the semantic-index provider remains deferred beyond phase 3); CJK recall relies on bigram tokenization, so single-CJK-character queries do not match.
- **Single-process writes** — concurrent writers from two dsh instances on one cwd are not guarded; the store assumes one event loop.
- **Retirement needs a driver** — `retireStale` only runs when a consumer (today `@huiliyi37/dsh-memory-consolidate`) calls it; the store never retires on its own, and the search-time use signal makes retrieval a write on the view (not on the log).
