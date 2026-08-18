# @huiliyi37/dsh-memory-consolidate

English | [中文](README.zh.md)

Session-end memory consolidation (phase 3 of the adaptive-memory Agent Note). When a session leaves the store — `session/disposed`, the terminal lifecycle signal (`session/flush` is a per-request durability checkpoint, not task end) — the plugin evaluates a heuristic **success gate** over the event log and only then extracts candidate experiences into the structured LTM. Gate levels: `standard` (default — at least one completed turn, and no unresolved tool error or observable test failure in the last turn) or `strict` (the same checks over the whole session). Two extractors implement the `ExperienceExtractor` interface (also apply's third parameter): the default **heuristic** one (zero model calls: explicit remember signals with structured `stated` triples when the body parses as `key: value` / `subject is value` / `主体是值`, user corrections, error→resolution pairs, decision statements) and the **LLM** one (`extractor: 'llm'`, phase 3b — one bounded structured request after the session ends, off the request path), which produces a **session-summary entry** (`observation`, topic `session-summary`, 3–6 sentences: task, work done, outcome, key files — the "what did we do before" answer), model-quality fact/experience candidates, and an optional **procedure entry** (`experience`, topic `procedure`: name + when-to-use + ordered steps). LLM extraction failures (no route, no llm service, timeout, invalid output) degrade to the heuristic extractor with a log-only note. Without the model, a conservative heuristic variant still distills procedures — but only from explicit user corrections that encode a method (`instead` / `应该` / `改用`). Procedures are suggestions with provenance, never auto-executed playbooks; `proceduresEnabled` gates them on both paths. Sessions that fail the gate record only `failure-pattern` experience entries — one per unresolved failure, never mixed into success facts.

Candidates land in `global` scope with `source: 'auto'` and provenance (`sourceRefs` = sessionId + event seqs), capped per session (`maxCandidatesPerSession`, default 8). **Conflict handling**: two same-(subject, predicate) different-value candidates within one consolidation have no clear supersession order, so the surviving fact is marked `uncertain` through the store's optional `markUncertain` capability (probed via `typeof === 'function'`, never assumed); cross-session conflicts supersede through the store's normal path. **Retirement**: after each consolidation the store's optional `retireStale` capability retires superseded versions beyond `supersededRetentionDays` (default 30) and facts not surfaced by retrieval for `unusedConsolidations` (default 8) consecutive consolidations — retired facts leave retrieval and `list`; the event log stays append-only. Consolidation failures are log-only (`ctx.logger`) and never break session teardown; subagent child sessions are skipped by default (`consolidateChildSessions`). All thresholds are validated Config fields with schema defaults (see the generated config catalog). No shipped composition mounts this plugin.

## Model Experience

### Indirect — consolidation writes only

#### What the model sees

Nothing at consolidation time: the pass runs after the session is disposed and its decisions are log-only (the session log is already closed, so decisions go to `ctx.logger`, not session events). Extracted facts reach the model only later, through consumers (`memory_search` tool results, the `dsh-adaptive-memory` STM snapshot).

#### Token effect

None directly; consumers render recalled entries at their own budgets. The optional LLM extraction (`extractor: 'llm'`) is one bounded request at session end — the input is a transcript rendering capped by `llmMaxInputChars`, the output by `llmMaxOutputTokens` (default 2000), with `llmEffort` defaulting to `off` so reasoning models do not burn the output budget on thinking tokens, and it never touches a live request path.

#### KV Cache effect

No prompt structure contributed. Consolidated content enters the model surface only through the append-on-change STM channel or tool-result tails, never by editing the request prefix.

## Known Limitations and Deferred Work

- **Procedure quality depends on the route** — with `extractor: 'llm'`, summary/candidate/procedure quality follows the configured (or the session's) model route; the heuristic path is deliberately conservative (procedures only from method-encoding user corrections). Embeddings remain deferred.
- **LLM extraction is one best-effort call** — no retry; any failure falls back to the heuristic extractor for that session, so a failed model call loses model-quality detail but never the deterministic candidates.
- **Global scope only** — consolidated candidates always land in `global`; per-scope consolidation policy is deferred until a consumer needs it.
- **Whole-log re-evaluation on resume** — a resumed session re-runs gate and extraction over its full log at each disposal; the store's same-content idempotency keeps repeat writes free, but the heuristics re-scan everything.
