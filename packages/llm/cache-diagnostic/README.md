# @huiliyi37/dsh-cache-diagnostic

English | [中文](README.zh.md)

Prefix-cache health observation through the singleton `ctx.cacheDiagnostic` service. It advances one isolated fold per session from the durable log — the same replay pattern as `@huiliyi37/dsh-token-meter` — and answers three questions: **what changed** in the cached prefix (`request/header` fingerprints), **how well** the provider cache is being hit (per-turn snapshots and hit rates), and **why** a turn missed (classified miss diagnosis). Adapted from the opencode-tui upstream cache telemetry (`src/prompt/fingerprint.ts`, `src/prompt/cache-diagnostic.ts`, `src/agent/context.ts` TurnCacheSnapshot) with the harness field vocabulary.

## Configuration

The service has no settings. Any config key is rejected.

## Service contract

`ctx.cacheDiagnostic` exposes four operations:

- `diagnose(session, options?)` — classify the latest turn's cache miss, or return null when the turn is healthy. `options.drift` and `options.wasCompacted` override the folded signals for callers that know better.
- `turnHistory(session)` — per-turn cache snapshots (`turn`, `cacheRead`, `cacheWrite`, `inputTokens`, `outputTokens`) folded from `assistant/message` usage, one snapshot per turn that reported usage.
- `hitRate(session)` — cumulative cache hit rate over the whole session.
- `recentHitRate(session, lastN)` — the same rate over the last N turns.

Hit rates are the cached fraction of the billed input: `cacheRead / (inputTokens + cacheRead + cacheWrite)`. `TokenUsage` counters are disjoint (`inputTokens` is the uncached share only), so a provider that never reports write tokens (DeepSeek) gets an exact rate instead of a degenerate 100%.

## Prefix fingerprints

`request/header` events feed a three-source SHA256 fingerprint (`src/fingerprint.ts`): the system text, the tool schemas (name-sorted before hashing, so a catalog reorder is not drift), and the serialized call config (provider/model/reasoning effort/max tokens plus adapter defaults). When a header changes, the previous fingerprint is compared against the new one and the drift is attributed per source (`systemChanged` / `toolsChanged` / `configChanged`) — this is the attribution `headerEquals` cannot give: it answers *what* changed, not just *that* something changed.

## Miss diagnosis

`diagnoseCacheMiss` (`src/diagnose.ts`) classifies the latest turn in this order: first turn (nothing cached yet) → provider never reports cache counters (unmeasurable) → hit rate ≥ 0.8 (nothing to explain) → prefix drift → compaction → **prefix truncation** → cache eviction → ordinary growth. Drift and compaction attribute only when their event landed inside the latest turn's measurement window (after the previous turn's last usage), so a stale signal cannot mislabel a later healthy turn.

`prefix_truncation` is the case that matters most: on an append-only conversation `cacheRead` is monotonic, so a *drop* against the previous turn means the shared prefix stopped matching mid-history (client byte churn or provider-side re-rendering) — categorically different from tail growth. The upstream 8396ac51 investigation found these were mislabeled as normal growth, hiding ~30K-token rebuild events; this classifier keeps them distinct.

## Session projections

When the composition provides `ctx.sessionProjections`, the service registers one unit through an optional child fiber:

`cacheHealth` carries cumulative `hitRate`, `recentTurnHitRate`, `lastMissReason` (warn/error verdicts only — first-turn and ordinary-growth info verdicts are normal operation and stay out of the summary), and the latest `drift` attribution.

## Composition

```yaml
- name: '@huiliyi37/dsh-cache-diagnostic'
```

## Model Experience

Indirectly, through consumers such as the TUI status bar; the service itself adds no prompt, message, schema, tool, or model call.

#### KV Cache effect

No direct invalidation; the package measures cache effects and never changes a request.

## Known Limitations and Deferred Work

- **Diagnosis is observational** — it explains misses from provider-reported counters; it does not prevent them. Prefix-stability engineering (plan-mode section moves, zen face narrowing) belongs to the packages that own the prompt.
- **Frozen-prefix persistence is not included** — the upstream `frozen-snapshot.ts` / PromptEngine inheritance (resume with byte-identical prefixes) is a prompt-layer change tracked separately.
- **Usage sampling is per-turn aggregate** — multiple steps of one turn merge into a single snapshot; intra-turn movement is not observable.
- **Provider counters are trusted as reported** — a replica that misreports `cacheRead` (upstream measured a 514K over-report) shows up as drift/truncation noise, not as a corrected figure.
- **The 0.8 / 0.4 thresholds are diagnostic heuristics** — fixed constants, not deployment tunables: they classify a health signal, not a behavior, and the upstream telemetry ships the same values.
