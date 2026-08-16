# Agent Note: Adaptive memory — intent-gated STM snapshots, append-only LTM, and prefix-cache discipline

Status: proposed

English | [中文](2026-08-16-adaptive-memory-cache-contract.zh.md)

## Problem

The harness's memory today is a manual tool, not an adaptive layer. `MemoryService` (`packages/memory/memory`) is `save`/`search`/`list`/`delete` over a Markdown store where `search()` is a substring scan; the model must choose to call `memory_search`, and nothing prepares task-relevant memory when a task begins. Worse, `tool-memory` injects a digest of the 20 most recent entries as a system-prompt section (order 130) and refreshes it after every `memory_save` — every memory write rewrites the request prefix and forfeits the provider prefix cache for the whole conversation behind it.

Provider prefix caches reward the opposite discipline. DeepSeek's automatic disk cache (hit ≈ 2% of the miss price) requires byte-matching a persisted cache unit; Anthropic explicit/automatic breakpoints and OpenAI's automatic prefix matching both invalidate everything after the first changed byte. The measured baseline (`docs/cache-hit-baseline-20260812.md`, 96.8% over 20-turn sessions) was collected **without memory mounted**, so the digest's damage has never been quantified — and the baseline names compaction and dynamic context as the top future risks.

Two research conclusions frame the design. First, long-context windows are not a memory substitute: recall degrades as a gradient (RULER, NoLiMa, OpenAI's own MRCR 57%@128K → 46%@1M), and re-sending a 1M-token transcript each turn costs 2–3 orders of magnitude more than a hybrid context. A 1M window's correct role is an occasional whole-corpus reader, never the working loop. Second, injected retrieval is a tax as well as a benefit: a single topically-related-but-wrong distractor measurably degrades output (Chroma context-rot), so automatic injection needs a confidence gate and the model needs an on-demand channel.

## Proposal

Build adaptive memory as a plugin-layer capability with a frozen channel contract: **STM (short-term memory) is an append-on-change snapshot generated at intent boundaries; LTM (long-term memory) is an append-only event log with a materialized current view; supplementary reads always enter as tool results at the conversation tail; raw history is only read by a reader subagent; compaction owns cleanup of stale snapshots.**

### Channels

- **Negative-order system-prompt sections**: cross-session-stable content only. No timestamps, random ids, git status, session ids, or per-request memory digests. Enforced by a verify gate.
- **Order 100–199 sections**: task-level quasi-static content; STM is *not* carried here.
- **Runtime-context append channel** (`ctx.systemPrompt.context()` via `RuntimeContextProjection`'s append-on-change semantics): the STM snapshot, environment-change reminders, dynamic task context. A changed contribution appends a new snapshot node; it never edits history mid-prefix. Appending costs one incremental prefill — *zero prefix invalidation*, not zero cost.
- **Tool-result tail**: `memory_search` results and reader-subagent distillations.

### STM contract

- Rendered from a canonicalized form: stable key and entry order, no volatile fields (timestamps, random ids, access counters). Byte-identical re-render ⇒ no append (`renderSTM(x)` is deterministic; `renderSTM(withDifferentAccessCount)` equals `renderSTM(x)`).
- Refreshed only at intent boundaries, gated by `intentKey` + per-topic memory versions + environment epoch — ordinary follow-ups keep the STM byte-stable.
- Carries a **candidate-scoped index**, not a full library catalog: entries relevant to the current intent plus safety/user-constraint entries, one line each (`id | topic | one-line summary | 2–5 keywords`), under a token budget.
- The STM cache is keyed by session + intentKey; the retrieval-result cache is keyed by workspace + normalized query + scope + topicVersion + retrieverVersion and shared across sessions (exclusion applied at read time, not baked into the key). Workspace scope is shared; user/private scopes stay isolated; session scope never crosses sessions.

### LTM contract

- **Append-only event log**: every observation, evidence item, and contradiction is preserved; nothing is overwritten.
- **Materialized current view**: derived, rebuildable, updatable — each fact carries `validFrom`/`validTo`, `confidence`, `sourceRefs` back to session-log events, `supersedes`, and `status: active | superseded | uncertain`. Retrieval and STM read the view; the log stays the audit trail (invalidate-don't-delete, in the spirit of Graphiti's bi-temporal windows).
- New experience is admitted only behind a success signal (test pass / task verifier); raw reflections without verification are not promoted (Voyager's lesson).

### Retrieval

- **Dual channel**: harness-driven pre-step retrieval (saves a round-trip when confident) and model-driven `memory_search` (the floor when the model notices a gap). `memory_search` gains `excludeIds` (the STM's loaded ids) and result budgets.
- **Confidence gate** on the automatic channel: high confidence injects entry bodies; medium injects index lines only; low injects nothing — the model keeps the tool. Thresholds are Config defaults tuned on real task sets, not frozen numbers.
- **Rule-based reminders** (appended, never system-prompt edits): a tool call touching an entity/path absent from the STM index, an unexplained error code, or a high-risk action triggers a tail reminder that `memory_search` may help.
- **Raw history** (mode C) is read only by a reader subagent returning a fixed distilled shape (`answer` / `evidence[]` with sessionId + eventSeqs + short quote / `uncertainties` / `confidence`, ~1–2k tokens). Transcript bytes never enter the main context.
- Per-intent search count, per-result tokens, and per-turn memory token totals are bounded by Config.

### Intent state

`{ intentId, intentKey, startedAtTurn, lastReviewedTurn, entities, topicVersions }`. STM refreshes when the intentKey changes, a relevant topic version changes, the environment epoch changes, or a pressure valve fires (N turns without review, a new entity/path/service/error-code surface). Evaluation is heuristic-first (new goal verbs, entities, paths, tool domains, error codes); a strong model is consulted only at genuinely ambiguous boundaries — the default memory path makes zero extra model requests.

### Cache discipline and metrics

- Tools and system prompt are byte-stable per session; effort/model knobs change only at phase boundaries (they align with cache breakpoints); volatile scalars never enter the prefix.
- Compaction owns deletion of stale STM snapshots via its existing replacement-surface semantics (a cleared seq permits re-projection — the current `RuntimeContextProjection` behavior).
- Metrics are recorded per phase, not just as a global hit rate: `promptTokens`, `cacheReadTokens`, `cacheWriteTokens` where reported, `intentId`, `stmVersion`, `memorySearchCount`, `compactionGeneration`, `toolSchemaHash`, `systemPromptHash`. Retrieval-process events are **log-only**; only the STM snapshot and tool results enter the model-visible surface (the model-visible ⟺ logged invariant).
- The 1M-context reader is a cold path: intent initialization over large corpora, full-text audits, long-trajectory distillation, background consolidation. It never participates in per-turn decisions.

### Packaging

A new package `packages/memory/adaptive-memory` owns intent state, pre-step retrieval, and the STM context contribution, hooking `agent/pre-step` — **no `agent-loop` changes**. `tool-memory` slims to the two tools plus static capability guidance (the dynamic digest is removed; memory is not mounted by shipped compositions today, so this is zero-regression). Structured LTM storage arrives in phase 2 over `ctx.storageDomain` (SQLite/FTS, reusing `session-query` infrastructure); embedding retrieval is an optional later provider over `packages/search/semantic-index`.

### Phases

- **Phase 1 — cache-safe skeleton**: remove the dynamic digest; STM via the append channel with intentKey/version gating and canonicalized rendering; `memory_search` `excludeIds` + budgets; per-phase cache metrics; A–E baseline arms.
- **Phase 2 — retrieval**: SQLite/FTS structured LTM; BM25 + entity + temporal filters; candidate index; confidence gate; topic-partitioned versions; the materialized view with `supersedes`.
- **Phase 3 — consolidation**: experience extraction behind success gates; reader subagent; conflict detection and retirement; optional embeddings.

## Alternatives considered

**In-place STM replacement ("keep only the newest node").** Rejected: editing a mid-prefix message forfeits the whole history cache behind it. Append-on-change pays one incremental prefill; stale-node cleanup rides compaction, which rewrites the prefix anyway.

**STM as a system-prompt section.** Rejected for STM specifically (every refresh rewrites the prefix from the section onward); the order-100–199 band remains for quasi-static task content. The runtime-context append channel gives change-activated snapshots with zero prefix invalidation.

**Full-library index inside STM.** Rejected: an unbounded index becomes another full-context dump. The candidate-scoped, budgeted index follows the repo-map lesson — mounted content is ranked and bounded, never a catalog.

**Pure ADD-only LTM with retrieval-time contradiction resolution (mem0's 2026 direction).** Rejected as the sole mechanism: without strong temporal ranking the model samples stale facts ("PostgreSQL" vs "Neon Postgres"). The event log + materialized view keeps append-only evidence while making current truth deterministic; the view stays rebuildable from the log.

**Automatic retrieval injection every turn.** Rejected: the distractor tax (context-rot evidence) plus a cache write per refresh. The confidence gate plus the model-driven tool channel gets the same coverage without either cost.

**A 1M window as the working context.** Rejected: measured recall cliffs (MRCR, Graphwalks) and 2–3 orders of magnitude in per-turn cost. Big windows serve as readers and auditors, not the loop.

**Implementing the projection inside `agent-loop`.** Rejected: plugins-not-loop-changes. The existing `RuntimeContextProjection` already supplies append-on-change + re-projection-after-compaction semantics to any `ctx.systemPrompt.context()` contribution; the new package only owns *when STM content changes*.

## Acceptance criteria

- **Baseline arms (A–E)**, measured with `examples/headless-agent/baseline-probe.mts` and asserted in the request-cache e2e: **A** no memory mounted — holds the 96.8% baseline; **B** current digest mounted — quantifies its real damage; **C** STM refresh — one bounded incremental cost, allowed; **D** after an STM refresh, `cacheReadTokens` still covers the pre-refresh prefix (never falls toward zero — distinguishes normal incremental prefill from erroneous full-history rewrite); **E** after `memory_search`, the existing prefix keeps hitting.
- **Unit tests**: `renderSTM` determinism; identical input produces no projection; volatile-field counterexample (differing access count renders identically).
- **Verify gates**: negative-order sections carry no volatile scalars; tool-schema hash is session-stable; STM never enters via `systemPrompt.section()`; STM enters the surface only through append projection; `memory_search` supports `excludeIds`; retrieval events are log-only.
- All budgets/thresholds are validated plugin Config fields with schema defaults.
- Keyless snapshot coverage of the assembled memory surface per the testing policy; bilingual docs land with each phase.

## Risks

- **BM25-only recall may fall short** in phase 1–2; the embedding provider is deferred, not cancelled, and `semantic-index` already exists to carry it.
- **intentKey heuristics may miscalibrate** — too sticky starves the STM, too jumpy forfeits cache. Pressure valves and per-topic versions bound the damage; every knob is a Config field pending real-task tuning.
- **DeepSeek cache-unit semantics**: a shared prefix does not guarantee a hit until the provider persists it as a unit, so cold starts read as misses — do not misread them as layout failure. The metrics split (per-phase, not just global) exists precisely to tell these apart.
- **Confidence thresholds are uncalibrated** (initial defaults are placeholders); tuning them on a real task set is phase-2 exit work.
- **Memory is not mounted by default**, so phase 1 is invisible until a composition mounts it — the A/B/C arms must mount deliberately, and the digest-removal benefit only materializes for compositions that do.

## Phase 1 implementation notes

Facts that diverged from the design above when the skeleton landed:

- **The evaluation hook is `system-prompt/assemble`, not `agent/pre-step`.** The concrete loop claims the turn's inbox messages, then assembles the prompt and projects runtime context, and only then dispatches pre-step — a pre-step evaluation can never reach the current step's snapshot. The assemble waterfall is the earliest plugin point before projection; the listener evaluates the gate and rewrites its `memory:stm` entry in the returned (authoritative) assembly.
- **One-turn intent-detection lag.** Because the current turn's user message is claimed before assembly, the gate sees a goal-changing message at the next turn's evaluation; the turn that introduces a new intent still runs with the previous intent's STM. Recorded in the package README's Known Limitations.
- **Evaluation cadence is once per turn** (tracked per session), not per step, so `memory/cache-hit`/`memory/cache-miss` volume is bounded by turn count.
- **The tool-memory digest was kept as a debug flag** (`digest`, schema default off) for cache A/B arms instead of deleting the machinery; the static guidance section is the default surface.
- **A–E baseline arms and the request-cache e2e are not part of the phase-1 code drop**; they land with the baseline probe work tracked separately.

## Phase 1 acceptance (2026-08-16)

The A–E acceptance surface landed ready-to-run; numbers were collected a day later (2026-08-17, real DeepSeek provider): **A 96.8% (reference reproduced) · B 90.7% (digest damage −6.1 points, uncached input ~3–4× A, spikes of 3–5k tokens at each digest refresh) · C 96.7% (STM, within noise of A; refresh bumps of 195–588 tokens) · D/E passed 3/3** — full per-turn data in `docs/cache-hit-baseline-adaptive-memory-20260816.md`. Harness facts:

- **Arms A/B/C**: `examples/headless-agent/baseline-probe.mts` gained an `arm` parameter (A: no memory, the default; B: `dsh-memory` + `dsh-tool-memory` with `digest: true`; C: adds `dsh-adaptive-memory`). B/C seed two task-relevant entries before the session and write one more after turns 5/10/15 — B through the `memory_save` tool (triggering the digest refresh under measurement), C directly into the store (triggering an STM `topic-version` refresh). Without a key the probe prints `skipped` and exits 0; B/C composition wiring (plugin mounting, interleaved writes, per-turn loop) was smoke-verified keylessly. Results land in `docs/cache-hit-baseline-adaptive-memory-20260816.md` once collected on a keyed machine.
- **Arms D/E**: key-gated real-API assertions in `packages/memory/adaptive-memory/tests/request-cache.e2e.ts` — a sibling e2e in the memory packages, because `cacheReadTokens` is only reported by a real provider and `agent-loop` stays free of memory dependencies. D asserts the request after an STM refresh keeps ≥ 90% of the pre-refresh prompt cached (and asserts the `memory/cache-miss` reason sequence first, so the coverage check is never vacuous); E asserts the same coverage across a `memory_search` tool call. Both self-skip without a key; a keyless ScriptedAdapter wiring smoke in the same file verifies the composition and passes.
- **Registration gap closed**: the `packages/memory` group was missing from both `tsconfig.base.json` paths wildcards, so tests resolved the memory packages through built `lib/` instead of `src`; both wildcards now include it.

## Phase 2a implementation notes

Facts that diverged from the design above when the structured store landed (`packages/memory/memory-sqlite`):

- **The store is its own SQLite database, not `ctx.storageDomain`.** The packaging section sketched structured LTM "over `ctx.storageDomain` (SQLite/FTS, reusing `session-query` infrastructure)". `storageDomain` is a typed KV abstraction without FTS5 or joins, so the provider opens a dedicated database (default `<root>/.dsh/memory/ltm.sqlite`) modeled on `session-query-sqlite`'s open/validate discipline (application id, owner-only create, WAL). Old schema versions are rejected loud rather than reset in place — this store is primary, not a derived index.
- **Seam extensions in `@huiliyi37/dsh-memory`.** `save` takes optional structured fields (`kind`/`topic`/`entities`/`confidence`/`fact`/`sourceRefs`); `search` takes exact `entities`/`topic` filters and returns `MemorySearchResult` with an optional normalized `score`; `topicVersions()` is an optional capability consumers probe with `typeof memory.topicVersions === 'function'` (the Markdown provider does not implement it). Unstructured saves derive `subject = entry id`, so update-by-id and structured same-pair writes share one supersede path.
- **Event kinds gained `tombstone`** (the contract listed fact/experience/observation) so `delete` and markdown removals can log without impersonating an observation, and `facts` gained a `source` column so the materialized view renders `MemoryEntry.source` without joining the log.
- **Fact identity is two-level**: `facts.version_id` is the per-version primary key that `supersedes` references; `facts.id` is the stable logical entry id consumers hold, so STM `excludeIds` keep working across a supersede.
- **Temporal validity is a hard ordering, not just a weight.** Search sorts by status tier (active > uncertain > superseded) before the normalized score (`relevance = -bm25/(1 + -bm25)`, `score = relevance × statusWeight` with 1.0/0.6/0.3); BM25 magnitudes alone could otherwise rank a superseded version above the current fact.
- **CJK recall uses bigram tokenization** at index and query time: unicode61 treats a whole CJK run as one token, which would regress Phase-1 substring recall for Chinese entries.
- **Markdown coexistence is import-based**: the Phase-1 files stay the human-edited source and are re-imported by content hash before every operation; entries tombstoned through the API are not resurrected while the file is unchanged.
- **Confidence gate, candidate index, and reminders are not in this drop** — they land with the phase-2b wiring; no shipped composition mounts `memory-sqlite`.

## Phase 2b implementation notes

Facts that diverged from the design above when the wiring landed (`packages/memory/adaptive-memory`):

- **Capability detection drives two retrieval paths.** Each evaluation probes `typeof memory.topicVersions === 'function'` (`asStructuredMemory`): the sqlite provider takes the structured path — BM25 `search` with the intent anchor text as query over global + session scopes, plus one conjunctive entity-filtered `search` when entities exist, plus `alwaysIncludeTags` pinning from `list`; the Markdown provider keeps the phase-1 fallback untouched. Scores are still probed per result, so an unscored hit degrades to "pinned or dropped" rather than breaking the gate.
- **The gate signature is not the contract's "topic versions of candidates" but of all retrieved hits.** Tracking only injected candidates' topics would miss the case where a low-tier entry's content changes and its new score crosses a threshold; the signature covers injected ids + all retrieved ids (including gate-dropped ones) + the versions of every retrieved topic. A write in a topic no retrieved hit touches causes no refresh; a byte-identical re-render after a `topic-version` miss appends no snapshot (the projection compares retained text), so a refresh decision is not necessarily a new snapshot.
- **The confidence thresholds are placeholders with a known calibration trap.** BM25's normalized score on tiny corpora sits near zero (IDF degenerates at N≈1), so the 0.82/0.55 defaults inject almost nothing until tuned; the composition test lowers them and tier mapping is unit-tested against a fake provider instead of real BM25 numbers.
- **The candidate index gained full-text blocks, not a second section.** High-tier entries render as `- short-id | topic（全文）` + indented body inside the same `memory:stm` contribution; an over-budget body degrades to its index line rather than being dropped, keeping the candidate budgeted under the same `stmTokenBudget`/`maxEntries`.
- **Reminders ride a second context contribution (`memory:reminder`), not inbox injection.** Watching `tools/result` (contained observation of the frozen outcome) keeps the pipeline untouched; the reminder text enters through the same append-on-change projection as the STM, so it is model-visible exactly once per change and logged by the context-snapshot mechanism, while the trigger decision is a log-only `memory/reminder` event. Budgets roll per turn and per intent (1/3 by default); an intent change clears any pending reminder text at the next evaluation.
- **Reminder heuristics are deliberately minimal**: "uncovered" is a substring test against the current STM snapshot text; error codes come from `error.info.code` plus `E[A-Z]{3,}` tokens in result text (success results included — a failed grep prints ENOENT without failing); `memory_search`/`memory_save` never trigger.

## Phase 3 implementation notes

Facts that diverged from the design above when consolidation landed (`packages/memory/memory-consolidate`, `packages/memory/tool-memory-recall`, and store capabilities in `packages/memory/memory-sqlite`):

- **Consolidation hooks `session/disposed`, not `session/flush`.** Flush is a per-request durability checkpoint owned by the checkpoint policy; disposed is the terminal once-per-session signal and the earliest point where the event log is complete. The pass is fire-and-forget with log-only failure, and its decisions go to `ctx.logger`, not the session log — the session is already closed at decision time, and extracted content reaches the model only later through surfaces (STM snapshot, tool results) that log themselves, so the model-visible⟺logged invariant holds without consolidation events.
- **The extractor is the plugin's third `apply` parameter.** `ExperienceExtractor` (session log → candidates) ships with the deterministic `HeuristicExtractor` as the default — zero model calls on the default path; a later LLM-backed extractor mounts without plugin changes. v1 heuristics: explicit remember signals (structured `stated` triples when the body parses as `key: value` / `subject is value` / `主体是值`), user corrections, error→resolution pairs, and decision statements.
- **The success gate is two levels.** `standard` (default) requires at least one completed turn and no unresolved tool error or observable test failure in the *last* turn; `strict` widens the failure scan to the whole session. An error counts as resolved when a later result from the same tool succeeds; a test failure counts only when the call's name or arguments match a test-runner pattern. Gate-failed sessions record only `failure-pattern` experiences (one per unresolved failure), never mixed with success facts.
- **Conflict → uncertain applies within one pass.** Two same-(subject, predicate) different-value candidates in a single consolidation have no clear supersession order, so the surviving fact is marked `uncertain` via the new `markUncertain` seam capability; cross-session conflicts keep the store's ordinary supersede because temporal order is the clear supersession. A store-side semantic landed with it: an uncertain head counts as the pair's current version, so a later save supersedes it — fresh evidence resolves uncertainty instead of leaving two current versions.
- **Retirement is a store capability driven by consolidation, schema v2.** `retireStale` retires superseded versions past a caller-supplied retention horizon and active/uncertain facts not surfaced by retrieval for N consecutive consolidations (the use signal is the `used_at_consolidation` view column refreshed inside `search` — a write on the materialized view, never on the append-only log; the `meta` table holds the consolidation counter). `retired` facts leave `search` and `list` entirely; rows and events stay.
- **The reader is a plain one-shot in-process subagent, not a new provider.** `memory_deep_recall` starts the configured provider (default `spawn`) with a static persona, the fixed `{ answer, evidence, uncertainties, confidence }` output schema, a read-only tool allow list (default the three session-query read tools), and `maxDepth: 1` — the seam's `maxDepth` is an ABSOLUTE delegation-depth cap (a top-level session's child sits at depth 1), so the phase-3 default of `0` rejected every start; corrected to `1` (reader allowed, no further delegation) on 2026-08-17 after the next-workflow integration test exposed it live. The returned structure is validated and clamped to Config budgets before becoming the tool result. Capabilities (`sessionQuery` service, the read tools, the provider and its `toolFilter`/`outputSchema`/`persona`/`depthLimit`) are probed at execution time and reported as plain model-visible errors.
- **The contract's Phase-3 scope is fully implemented**: experience extraction behind success gates, the reader subagent, and conflict detection with retirement all landed; the embeddings provider remains deferred, as the contract itself marks it optional (`semantic-index` carries it when scheduled).
