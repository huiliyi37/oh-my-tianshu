/**
 * Cache-health telemetry for the TUI — the pure formatting and gating layer
 * over the `cacheHealth` session projection (`@huiliyi37/dsh-cache-diagnostic`).
 *
 * Two responsibilities, both dependency-free:
 * 1. `formatCacheMissReason` — map a projection `lastMissReason` to a short
 *    status-bar label and a one-line diagnostic detail.
 * 2. `isReportableMiss` — decide whether a reason deserves a scrollback
 *    warning. Only warn/error-grade verdicts (truncation, drift, eviction)
 *    report; expected-operation verdicts (first turn, ordinary growth) and
 *    compaction (a deliberate restructure) stay silent.
 *
 * The wire shape is declared locally so the TUI does not import the
 * cache-diagnostic package (same minimal-facet pattern as the projection
 * bus's other keys).
 *
 * @module dsh-tui/cache-telemetry
 */

/** Minimal wire shape of the `cacheHealth` projection. */
export interface CacheHealthWire {
  /** Cumulative hit rate over the whole session; absent until usage lands. */
  hitRate?: number
  /** Hit rate of the most recent turn; absent until usage lands. */
  recentTurnHitRate?: number
  /** Latest cache-miss diagnosis reason; absent when the turn was healthy. */
  lastMissReason?: string
  /** Latest prefix drift attribution; absent when the header never changed. */
  drift?: {
    systemChanged: boolean
    toolsChanged: boolean
    configChanged: boolean
  }
}

interface MissInfo {
  label: string
  detail: string
}

/** Reportable miss reasons and their human-readable forms. */
const MISS_INFO: Record<string, MissInfo> = {
  prefix_truncation: {
    label: '截断',
    detail: '前缀截断：cacheRead 回退，中段分叉',
  },
  prefix_drift: {
    label: '漂移',
    detail: '前缀漂移：system/工具/配置变更',
  },
  cache_eviction: {
    label: '驱逐',
    detail: '低命中：前缀可能被缓存驱逐',
  },
}

/**
 * Map a cache-miss reason to its status-bar label and diagnostic detail.
 * Expected-operation reasons (`first_turn`, `normal_growth`, `compaction`)
 * and unknown reasons return undefined — nothing worth surfacing.
 * @param reason - the projection's `lastMissReason`.
 * @returns the label/detail pair, or undefined when the reason is not reportable.
 */
export function formatCacheMissReason(reason: string): MissInfo | undefined {
  return MISS_INFO[reason]
}

/**
 * Whether a miss reason deserves a scrollback warning.
 * @param reason - the projection's `lastMissReason`.
 * @returns true for warn/error-grade reasons (truncation, drift, eviction).
 */
export function isReportableMiss(reason: string): boolean {
  return MISS_INFO[reason] !== undefined
}
