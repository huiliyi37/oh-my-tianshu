# @huiliyi37/dsh-memory-pipeline

English | [中文](README.zh.md)

Automatic memory pipeline over the `memory` service: a startup **backfill sweep** plus an opt-in **global consolidation** pass, closing the loop that `dsh-memory-consolidate` (live-session disposal extraction) and `dsh-adaptive-memory` (STM injection) leave open — sessions whose process died before disposal are extracted on a later boot, and accumulated auto entries get deduplicated into canonical facts. Everything is background work off the request path; the plugin is **off by default** (`enabled: false`).

## Behavior

- **Trigger** — the first root session start (`agent/session-start` where the header has no `parentSession`; the same lineage rule as `dsh-memory-consolidate`, so forks and subagent sessions never trigger) schedules a sweep after `startDelayMs` (default 30 s). `rescanIntervalMs > 0` additionally re-sweeps periodically while the host lives. Jobs register on `ctx.tasks` under kind `memory-pipeline` (visible in `/tasks`, cancellable); when no tasks service is mounted they degrade to inline background execution with a log-only warning.
- **Backfill sweep** — `SessionPersistence.list()` enumerates durable sessions cheaply; metadata filters drop derived sessions, other-workspace sessions (header `cwd` resolves to the same directory as `workspaceCwd` — literal match first, then `realpath` so symlinked launch paths like `/var` vs `/private/var` still match), ledger-terminal sessions (`ok`/`expired`), and failed sessions past `maxRetriesPerSession`. Before inspecting, a provenance check skips sessions that already have `auto` entries citing them (`MemoryEntry.sourceRefs` carries `sessionId`; this is what prevents re-extracting sessions `dsh-memory-consolidate` already handled at live disposal — that package does not write this ledger). The capped shortlist (`scanLimit`) is read through `inspect()` (immutable logical view, no recovery publication), checked against the time windows (`minIdleHours` idle before processing, `maxAgeDays` beyond which the session is terminal-expired), passed through `dsh-memory-consolidate`'s success gate, and extracted with its extractors — the heuristic one by default or the LLM one (`extractor: 'llm'`, which requires the `llmProvider`/`llmModel` pair at load). Candidates land in `global` scope with `source: 'auto'` and provenance (`sourceRefs` = sessionId + event seqs), capped per session. Each session is processed **at most once** (`ok` is terminal); failures record `failed` with retry backoff.
- **Global consolidation** — after sweeps accumulate `phase2MinNewEntries` saved candidates (the running count persists in the ledger's `pendingCount`, so slow drips across several boots eventually trigger), one bounded LLM call groups duplicate/near-duplicate `auto` entries in `global` scope and emits merge groups; each group saves a canonical entry and deletes the absorbed ids (validated against the input snapshot, so hallucinated ids fail loud before any write). A parse or LLM failure aborts before the counter reset and keeps `pendingCount` for retry on the next sweep that saves anything. `phase2Enabled` requires the `llmProvider`/`llmModel` pair at load regardless of the backfill extractor. Retirement cadence stays owned by `dsh-memory-consolidate`'s `retireStale`.
- **Ledger** — machine state lives at `ledgerPath` (default `<cwd>/.dsh/memory/pipeline/ledger.json`, co-located with the memory store root): versioned JSON written atomically (tmp + rename), holding per-session watermarks/outcomes, per-job-kind leases, and phase2 counters. Leases are advisory cross-process coordination with stale-lease takeover; the single-process assumption matches the memory store's own boundary. Corrupt or future-version ledgers reject loud instead of being guessed around.

All thresholds are validated Config fields with schema defaults; misconfiguration (route half-pair, inverted time windows, negative caps) fails loud at load. All decisions are log-only — nothing here touches the request path or contributes prompt structure.

## Model Experience

### Indirect — pipeline writes only

#### What the model sees

Nothing at pipeline time: sweeps run outside any live turn and write only through the memory service. Extracted content reaches the model later through consumers (`memory_search` tool results, the `dsh-adaptive-memory` STM snapshot).

#### Token effect

None directly; consumers render recalled entries at their own budgets. The optional LLM calls (extraction, consolidation) are bounded offline requests (`llmMaxInputChars` / `llmMaxOutputTokens`, `llmEffort` defaulting to `off`) that never touch a live request path.

#### KV Cache effect

No prompt structure contributed. Pipeline output enters the model surface only through consumer channels, never by editing the request prefix.

## Known Limitations and Deferred Work

- **One-shot per session** — a session marked `ok` is never reprocessed even if it grows afterward; live-session extraction is `dsh-memory-consolidate`'s job, but a session that keeps changing across host restarts only gets its final pre-restart shape extracted.
- **Provenance dedup is provider-dependent** — the pre-extract skip reads `MemoryEntry.sourceRefs`, which only structured providers (SQLite) return; the Markdown provider stores plain text by contract and carries no refs, so there the dedup degenerates to ledger-only idempotency (pipeline-own runs stay duplicate-free; a consolidate-extracted session could be re-extracted after a ledger loss).
- **Provenance loss through consolidation** — absorbed entries are deleted and their source refs do not carry into the canonical entry because the `MemoryEntry` seam does not expose structured fields; SQLite providers keep tombstone events as audit trail, Markdown deletions are unrecoverable.
- **Advisory lease only** — two concurrent hosts on one workspace are unsupported by the memory store itself; the lease coordinates polite neighbors, not hostile concurrency.
- **Manual root alignment** — a host mounting a memory provider with a custom root must set `ledgerPath`/`workspaceCwd` to match; the seam does not expose the provider's root.
