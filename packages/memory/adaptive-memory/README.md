# @huiliyi37/dsh-adaptive-memory

English | [中文](README.zh.md)

Adaptive memory: per-session intent state plus an intent-gated STM (short-term memory) snapshot of the `dsh-memory` store, injected through the append-on-change runtime-context channel. Phase 1 landed the cache-safe skeleton; phase 2b wires the structured provider (BM25 retrieval, confidence gate, per-topic version invalidation) and rule-based fallback reminders. Design contract: [Agent Note](../../../.agents/notes/implemented/feature/2026-08-18-adaptive-memory-stm.md).

## Behavior

- Intent state per session (`{ intentId, intentKey, startedAtTurn, lastReviewedTurn, entities, topicVersions }`) is derived heuristically from the session log — the first user message, or a later one containing a goal verb, is the intent anchor; file paths and error codes seen in tool calls become entities. No extra model calls.
- Once per turn (on the `system-prompt/assemble` waterfall) the plugin re-evaluates a gate: it re-renders the STM only when the intentKey changed, a relevant topic version changed, a new entity appeared, or `reviewIntervalTurns` turns passed since the last refresh. Otherwise the cached text is kept byte-identical. Each decision is logged as a log-only session event (`memory/cache-hit`, `memory/cache-miss`, `memory/stm-selected` — never model-visible).
- **Capability detection, never assumption**: when the mounted `memory` service exposes `topicVersions()` (the `dsh-memory-sqlite` provider), retrieval runs through `search` with the anchor text as BM25 query plus a conjunctive entity-filter pass, and the refresh gate compares per-topic versions from `topicVersions()` over the retrieved topics — a write in an unrelated topic no longer refreshes the STM. With the plain Markdown provider the phase-1 fallback stays: full `list` + keyword substring selection + relevance-signature gating.
- **Confidence gate (scored providers only)**: a hit with `score ≥ confidenceHigh` injects the entry body into the snapshot; `≥ confidenceMedium` injects an index line only; below that the entry is left out and the model keeps `memory_search`. Entries pinned via `alwaysIncludeTags` keep at least an index line regardless of score. The Markdown fallback produces no scores, so it keeps the phase-1 behavior (index lines only).
- **Topic boosts (phase 3b)**: `topicBoosts` maps a topic to an additive score lift (0..1, capped at 1) applied before the confidence gate. BM25 normalized scores sit near zero on tiny corpora, so high-value topics such as `procedure` (reusable-method entries written by consolidation) would otherwise never reach a tier; e.g. `{ procedure: 0.2 }` lets them rank into the STM candidate set like other entries. The boost only lifts hits that already carry a score — it never manufactures one (pinned semantics unchanged). Procedure entries are suggestions with provenance (`sourceRefs`), never auto-executed playbooks.
- **Rule-based fallback reminders**: a `tools/result` observer fires when a tool call touches a path absent from the current STM snapshot text, or a result carries an uncovered error code (`error.info.code` or `E[A-Z]{3,}` tokens in the result text). The reminder is a `memory:reminder` runtime-context contribution — appended at the conversation tail like the STM, never a system-prompt edit — capped by `maxRemindersPerTurn` and `maxRemindersPerIntent`, cleared on intent change, and logged as a log-only `memory/reminder` event.
- Rendering is canonicalized: deterministic, no timestamps/random ids/access counters; a byte-identical re-render appends nothing (the agent loop's `RuntimeContextProjection` compares retained text).
- Mounting this plugin without `@huiliyi37/dsh-memory` is a configuration error and fails loud at the first evaluation; `confidenceHigh < confidenceMedium` fails loud at load. No shipped composition mounts this plugin.

All thresholds are Config fields with schema defaults: `stmTokenBudget` (600), `maxEntries` (12), `maxIntentTokens` (6), `maxEntities` (24), `reviewIntervalTurns` (8), `goalVerbs`, `alwaysIncludeTags` (`['safety', 'constraint', 'preference']`), `summaryMaxChars` (120), `maxKeywords` (5), `confidenceHigh` (0.82), `confidenceMedium` (0.55), `retrievalLimit` (24), `topicBoosts` (`{}`), `maxRemindersPerTurn` (1), `maxRemindersPerIntent` (3).

## Model Experience

### STM runtime-context snapshot

#### What the model sees

When the gate refreshes and at least one entry is relevant, a user-role runtime-context snapshot carrying one `memory:stm` section: a fixed header, then per entry either a full-text block (`- short-id | topic（全文）` followed by the indented body — high-confidence tier) or one index line (`short-id | topic | one-line summary | keywords` — medium tier and pinned entries). Between refreshes the snapshot bytes are unchanged. Retrieval decisions (`memory/cache-hit` and friends) never reach the model; the snapshot itself is logged by the normal context-snapshot mechanism. A second `memory:reminder` section appears in the snapshot when a fallback reminder fires: one line naming the uncovered path or error code and suggesting `memory_search` — append-only tail content that never rewrites earlier messages.

##### STM snapshot header

```markdown
相关项目记忆（按当前任务筛选；用 memory_search 检索全文，excludeIds 传下列短 id 可排除已载条目）：
```

#### Token effect

Conditional and capped: zero when nothing is relevant; otherwise one snapshot bounded by `stmTokenBudget` (estimated tokens, bodies included — an over-budget body degrades to its index line) and `maxEntries`, re-appended only on a gated refresh. Reminders add one line each, capped per turn and per intent.

#### KV Cache effect

Append-only. Both contributions live on the runtime-context channel, never in a system-prompt section, so a refresh or reminder appends one snapshot at the history tail and leaves the earlier prefix byte-stable; a gate hold reuses the previous snapshot verbatim. Compaction may clear the retained snapshot, after which the identical text is re-projected.

## Known Limitations and Deferred Work

- **One-turn intent-detection lag** — the loop claims the current turn's user message before assembly, so a goal-changing message is only visible to the gate at the next turn's evaluation; the STM of the turn that introduces a new intent still reflects the previous intent.
- **Placeholder confidence thresholds** — the 0.82/0.55 defaults are uncalibrated. Score semantics are provider-defined (`dsh-memory-sqlite`: normalized BM25 × status weight), and BM25 normalized scores on tiny corpora sit near zero (IDF degenerates), so the defaults inject very little until tuned on real task sets — phase-2 exit work on the A–E baseline arms.
- **Reminder heuristics are deliberately simple** — "uncovered" means "not a substring of the current STM snapshot text"; the entity-filter retrieval pass is conjunctive (all entities must match), so it is a precision backstop, not recall.
- **Uncalibrated heuristics** — goal-verb anchoring may be too sticky or too jumpy on real task sets; every knob is a Config field pending tuning.
