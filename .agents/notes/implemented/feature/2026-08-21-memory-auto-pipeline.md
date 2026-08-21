# Agent Note: Automatic memory pipeline (backfill sweep + global consolidation)

Status: implemented

English | [中文](2026-08-21-memory-auto-pipeline.zh.md)

## Problem

`dsh-memory-consolidate` extracts experiences only when a session is disposed inside a live host: a process killed before disposal — or any session that ended while the plugin was not mounted — never contributes to LTM, and nothing ever revisits accumulated `auto` entries for cross-session duplicates. OpenAI's Codex solves both with a two-phase memory pipeline (startup stage-1 jobs claiming stale rollouts from a state DB; a global consolidation job merging their outputs). Tianshu has no state DB and already owns half the loop.

## Decision

`@huiliyi37/dsh-memory-pipeline` adds the missing two phases as an opt-in background plugin over existing seams:

- **Backfill sweep** on the first root session start (debounced; optional periodic rescan): `SessionPersistence.list()` → metadata filters (lineage, workspace cwd, ledger state) → capped `inspect()` reads → consolidate's success gate and extractors (reused via its exported implementations; injectable through the apply third parameter) → `memory.save(source: 'auto', sourceRefs)` → per-session watermark in a JSON ledger co-located with the store root (`<cwd>/.dsh/memory/pipeline/ledger.json`, versioned, atomic rename). Each session is processed at most once; failures back off by retry count; idle sessions recheck; expired sessions terminate.
- **Global consolidation** after a sweep saves ≥ `phase2MinNewEntries`: one bounded LLM call groups duplicate `auto` entries; each group saves a canonical entry and deletes absorbed ids validated against the input snapshot. Parse failure aborts before any write.
- Jobs register on `ctx.tasks` (kind `memory-pipeline`) when mounted, degrading to inline execution otherwise; every decision is log-only and nothing touches the request path.

Cross-process coordination is an advisory lease in the ledger with stale takeover — not a state-DB claim protocol — because the memory store itself already assumes one writer per workspace; the ledger only extends that same boundary. Misconfiguration fails loud at load (route half-pairs regardless of state, `'llm'` route requirement only when enabled so the default-off config stays mountable). No shipped composition mounts this plugin, consistent with the [STM snapshot note](2026-08-18-adaptive-memory-stm.md) rejecting uncalibrated product defaults.

## Alternatives considered

**A state-DB claim protocol like Codex.** Rejected: it would introduce a second durable store next to the memory store; the file ledger inherits the store's own single-process assumption instead of inventing a stronger one the seam cannot honor anyway.

**Provenance-preserving merges.** Rejected for now: `MemoryEntry` does not expose structured fields, so canonical entries cannot carry absorbed source refs without widening the seam; SQLite tombstones keep the audit trail, and the Markdown provider has no history to lose.

**Reprocessing grown sessions.** Rejected: live disposal belongs to `dsh-memory-consolidate`; re-extracting a grown log would duplicate candidates through the LLM path where same-content idempotency does not hold.

## Consequences

Hosts that opt in get crash-proof memory coverage for past sessions plus deduplicated long-term facts, with zero request-path cost and visible/cancellable jobs in `/tasks`. The pipeline never calls `retireStale` — retirement cadence remains owned by `dsh-memory-consolidate`. Coverage: `packages/memory/memory-pipeline/tests/*.spec.ts` (ledger load/lease semantics, eligibility windows, retry backoff, conflict marking via probes, consolidation parse/apply guards, fail-loud config matrix, real-assembly backfill through JSONL persistence + Markdown store with idempotent second run).
