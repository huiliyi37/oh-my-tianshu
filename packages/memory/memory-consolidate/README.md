# @huiliyi37/dsh-memory-consolidate

English | [中文](README.zh.md)

Session-end memory consolidation (phase 3 of the adaptive-memory Agent Note). When a session leaves the store — `session/disposed`, the terminal lifecycle signal (`session/flush` is a per-request durability checkpoint, not task end) — the plugin evaluates a heuristic **success gate** over the event log and only then extracts candidate experiences into the structured LTM. Gate levels: `standard` (default — at least one completed turn, and no unresolved tool error or observable test failure in the last turn) or `strict` (the same checks over the whole session). Extraction is **deterministic in v1** (zero model calls): explicit remember signals (structured `stated` triples when the body parses as `key: value` / `subject is value` / `主体是值`), user corrections, error→resolution pairs, and decision statements. The `ExperienceExtractor` interface (apply's third parameter) is the mount point for a later LLM-backed extractor. Sessions that fail the gate record only `failure-pattern` experience entries — one per unresolved failure, never mixed into success facts.

Candidates land in `global` scope with `source: 'auto'` and provenance (`sourceRefs` = sessionId + event seqs), capped per session (`maxCandidatesPerSession`, default 8). **Conflict handling**: two same-(subject, predicate) different-value candidates within one consolidation have no clear supersession order, so the surviving fact is marked `uncertain` through the store's optional `markUncertain` capability (probed via `typeof === 'function'`, never assumed); cross-session conflicts supersede through the store's normal path. **Retirement**: after each consolidation the store's optional `retireStale` capability retires superseded versions beyond `supersededRetentionDays` (default 30) and facts not surfaced by retrieval for `unusedConsolidations` (default 8) consecutive consolidations — retired facts leave retrieval and `list`; the event log stays append-only. Consolidation failures are log-only (`ctx.logger`) and never break session teardown; subagent child sessions are skipped by default (`consolidateChildSessions`). All thresholds are validated Config fields with schema defaults (see the generated config catalog). No shipped composition mounts this plugin.

## Model Experience

### Indirect — consolidation writes only

#### What the model sees

Nothing at consolidation time: the pass runs after the session is disposed and its decisions are log-only (the session log is already closed, so decisions go to `ctx.logger`, not session events). Extracted facts reach the model only later, through consumers (`memory_search` tool results, the `dsh-adaptive-memory` STM snapshot).

#### Token effect

None directly; consumers render recalled entries at their own budgets.

#### KV Cache effect

No prompt structure contributed. Consolidated content enters the model surface only through the append-on-change STM channel or tool-result tails, never by editing the request prefix.

## Known Limitations and Deferred Work

- **Heuristic extraction only** — v1 recognizes fixed patterns; the LLM-backed extractor (the `ExperienceExtractor` mount point) is deferred, as are embeddings.
- **Global scope only** — consolidated candidates always land in `global`; per-scope consolidation policy is deferred until a consumer needs it.
- **Whole-log re-evaluation on resume** — a resumed session re-runs gate and extraction over its full log at each disposal; the store's same-content idempotency keeps repeat writes free, but the heuristics re-scan everything.
