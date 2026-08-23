/**
 * Cache-miss diagnosis over per-turn cache snapshots. Adapted from the
 * opencode-tui upstream `src/prompt/cache-diagnostic.ts` with the harness
 * field vocabulary (`cacheWriteTokens` for upstream `cache_creation`).
 *
 * Pure module: takes turn history, an optional drift event, and a compaction
 * flag; returns one diagnosis or null when there is nothing to explain.
 *
 * @module @huiliyi37/dsh-cache-diagnostic/diagnose
 */

/** One turn's provider-reported cache accounting. */
export interface TurnCacheSnapshot {
  turn: number
  cacheRead: number
  cacheWrite: number
  inputTokens: number
  outputTokens: number
}

/** Why the provider's cached prefix did not fully cover the request. */
export type CacheMissReason =
  | 'first_turn'
  | 'prefix_drift'
  | 'prefix_truncation'
  | 'compaction'
  | 'cache_eviction'
  | 'normal_growth'
  | 'no_data'

/** A single diagnostic verdict with its severity and observed hit rate. */
export interface CacheDiagnostic {
  reason: CacheMissReason
  message: string
  severity: 'info' | 'warn' | 'error'
  turnHitRate: number
}

/** Drift event shape consumed by diagnosis (satisfied by fingerprint.detectDrift). */
export interface DriftEventLike {
  systemChanged: boolean
  toolsChanged: boolean
  configChanged: boolean
  message: string
}

/**
 * Diagnose the latest turn's cache miss, or return null when nothing is wrong.
 *
 * Order of attribution: no snapshots → first turn (nothing cached yet) →
 * provider reports no cache counters on any turn (unmeasurable) → high hit
 * rate (≥ 0.8, nothing to explain) → prefix drift (invalidates the whole
 * prefix) → compaction (restructured history) → prefix truncation (cacheRead
 * regressed vs the previous turn — mid-history divergence, categorically
 * different from tail growth) → low hit rate without a cause (eviction) →
 * ordinary growth.
 *
 * Hit-rate math honors the `TokenUsage` disjoint contract: `inputTokens` is
 * the uncached share only, so the turn total is
 * `inputTokens + cacheRead + cacheWrite` and the rate is the cached fraction
 * of it. A provider that never reports write tokens (DeepSeek) is exact here;
 * computing the rate over cache counters alone would degenerate to 100%.
 *
 * @param history - per-turn snapshots in chronological order.
 * @param drift - a detected prefix drift event, or null.
 * @param wasCompacted - whether compaction ran since the previous turn's last usage.
 * @returns a diagnosis, or null when the turn is healthy or unmeasurable.
 */
export function diagnoseCacheMiss(
  history: readonly TurnCacheSnapshot[],
  drift: DriftEventLike | null,
  wasCompacted: boolean,
): CacheDiagnostic | null {
  if (history.length === 0) return null

  // oxlint-disable-next-line typescript/no-non-null-assertion -- non-empty check above bounds the index.
  const current = history[history.length - 1]!

  // First turn — no cache to hit yet, whatever the provider reports.
  if (history.length === 1) {
    return {
      reason: 'first_turn',
      message: 'First turn — building prefix cache',
      severity: 'info',
      turnHitRate: 0,
    }
  }

  // The provider never reported a cache counter on any turn — nothing to
  // diagnose. (A genuinely missed turn still reports cacheRead: 0 while an
  // earlier turn reported a hit, which the fold keeps distinguishable.)
  const anyCacheCounters = history.some(snapshot => snapshot.cacheRead + snapshot.cacheWrite > 0)
  if (!anyCacheCounters) return null

  const turnTotal = current.inputTokens + current.cacheRead + current.cacheWrite
  const turnHitRate = turnTotal > 0 ? current.cacheRead / turnTotal : 0

  // High hit rate — nothing to explain.
  if (turnHitRate >= 0.8) return null

  // Fingerprint drift invalidates the entire prefix.
  if (drift !== null) {
    const parts: string[] = []
    if (drift.systemChanged) parts.push('system prompt')
    if (drift.toolsChanged) parts.push('tool definitions')
    if (drift.configChanged) parts.push('call config')
    return {
      reason: 'prefix_drift',
      message: `Cache drift: ${parts.join(' + ')} changed — prefix invalidated`,
      severity: 'error',
      turnHitRate,
    }
  }

  // Compaction restructured the message history this turn.
  if (wasCompacted) {
    return {
      reason: 'compaction',
      message: 'Compaction ran — message history restructured, partial cache miss expected',
      severity: 'warn',
      turnHitRate,
    }
  }

  // Prefix truncation: cacheRead REGRESSED vs the previous turn. On an
  // append-only conversation cacheRead is monotonic — a drop means the shared
  // prefix stopped matching mid-history (client byte churn or provider-side
  // re-rendering), which is categorically different from tail growth. The
  // upstream 8396ac51 investigation (2026-07-06) found these were mislabeled
  // normal_growth, hiding ~30K-token rebuild events.
  // oxlint-disable-next-line typescript/no-non-null-assertion -- history.length >= 2 is checked above the index.
  const prev = history[history.length - 2]!
  if (current.cacheRead < prev.cacheRead) {
    const lost = prev.cacheRead - current.cacheRead
    return {
      reason: 'prefix_truncation',
      message: `Prefix truncation: cacheRead dropped ${lost} tokens (${prev.cacheRead} → ${current.cacheRead}) — mid-history divergence`,
      severity: 'error',
      turnHitRate,
    }
  }

  // Low hit rate with no obvious cause — likely cache eviction from long context.
  if (turnHitRate < 0.4) {
    return {
      reason: 'cache_eviction',
      message: `Low cache hit (${(turnHitRate * 100).toFixed(0)}%) — prefix may have been evicted from cache due to context length`,
      severity: 'warn',
      turnHitRate,
    }
  }

  // Moderate miss — normal new messages growing.
  return {
    reason: 'normal_growth',
    message: `Cache hit ${(turnHitRate * 100).toFixed(0)}% — new messages partially outside cached prefix`,
    severity: 'info',
    turnHitRate,
  }
}
