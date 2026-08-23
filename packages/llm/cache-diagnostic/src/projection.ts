/**
 * `cacheHealth` session projection: cumulative and per-turn cache hit rates,
 * the latest miss reason, and the latest prefix drift — a read-only health
 * summary for UIs and logs. Replays the same fold as the service (fingerprint
 * on `request/header`, per-turn usage aggregation, `compact/start` signal).
 *
 * @module @huiliyi37/dsh-cache-diagnostic/projection
 */

import { z } from 'zod'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { canonicalHeader } from '@huiliyi37/dsh-session'
import type { ProjectionDefinition } from '@huiliyi37/dsh-session-projection'
import { computeFingerprint, detectDrift } from './fingerprint.ts'
import type { DriftEvent, PrefixFingerprint } from './fingerprint.ts'
import { diagnoseCacheMiss } from './diagnose.ts'
import type { CacheMissReason, TurnCacheSnapshot } from './diagnose.ts'

/** Read-only cache-health summary for one session. */
export interface CacheHealthProjection {
  /** Cumulative hit rate over the whole session; absent until usage lands. */
  hitRate?: number
  /** Hit rate of the most recent turn; absent until usage lands. */
  recentTurnHitRate?: number
  /** Reason of the latest cache-miss diagnosis, when the latest turn was unhealthy. */
  lastMissReason?: CacheMissReason
  /** Latest prefix drift attribution; absent when the header never changed. */
  drift?: {
    systemChanged: boolean
    toolsChanged: boolean
    configChanged: boolean
  }
}

interface CacheHealthState {
  snapshots: TurnCacheSnapshot[]
  /** Seq of the latest usage event folded into `snapshots`. */
  snapshotSeq: number
  lastHeaderFingerprint: PrefixFingerprint | undefined
  drift: DriftEvent | null
  lastCompactSeq: number
}

function configText(header: { config: unknown; adapterDefaults?: unknown }): string {
  return JSON.stringify({
    config: header.config,
    adapterDefaults: header.adapterDefaults,
  })
}

const driftSchema = z.object({
  systemChanged: z.boolean(),
  toolsChanged: z.boolean(),
  configChanged: z.boolean(),
}).strict()

const projectionSchema = z.object({
  hitRate: z.number().min(0).max(1).optional(),
  recentTurnHitRate: z.number().min(0).max(1).optional(),
  lastMissReason: z.string().optional(),
  drift: driftSchema.optional(),
}).strict() as unknown as z.ZodType<CacheHealthProjection>

/**
 * Fold one event into the per-turn cache-health state.
 * @param state - the current state.
 * @param event - the next session event.
 * @returns the next state (same reference when nothing changed).
 */
function applyEvent(state: CacheHealthState, event: SessionEvent): CacheHealthState {
  switch (event.type) {
    case 'request/header': {
      const header = canonicalHeader(event.data.header)
      const fingerprint = computeFingerprint(
        header.system ?? '',
        header.tools,
        configText(header),
      )
      const drift = state.lastHeaderFingerprint === undefined
        ? null
        : detectDrift(state.lastHeaderFingerprint, fingerprint)
      return { ...state, drift, lastHeaderFingerprint: fingerprint }
    }
    case 'assistant/message': {
      const usage = event.data.usage
      if (usage === undefined) return state
      const turn = event.data.turn
      const existing = state.snapshots.find(snapshot => snapshot.turn === turn)
      if (existing === undefined) {
        return {
          ...state,
          snapshots: [...state.snapshots, {
            turn,
            cacheRead: usage.cacheReadTokens ?? 0,
            cacheWrite: usage.cacheWriteTokens ?? 0,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
          }],
          snapshotSeq: event.seq,
        }
      }
      const updated: TurnCacheSnapshot = {
        ...existing,
        cacheRead: existing.cacheRead + (usage.cacheReadTokens ?? 0),
        cacheWrite: existing.cacheWrite + (usage.cacheWriteTokens ?? 0),
        inputTokens: existing.inputTokens + (usage.inputTokens ?? 0),
        outputTokens: existing.outputTokens + (usage.outputTokens ?? 0),
      }
      return {
        ...state,
        snapshots: state.snapshots.map(snapshot => snapshot.turn === turn ? updated : snapshot),
        snapshotSeq: event.seq,
      }
    }
    case 'compact/start':
      return { ...state, lastCompactSeq: event.seq }
    default:
      return state
  }
}

/**
 * The cache-health projection unit. Hit rates use total input tokens as the
 * denominator (cacheRead / inputTokens) so a provider that omits write tokens
 * cannot degenerate the rate to 100%.
 */
export const cacheHealthProjectionDefinition:
ProjectionDefinition<'cacheHealth', CacheHealthState> = {
  key: 'cacheHealth',
  schema: projectionSchema,
  init: () => ({
    snapshots: [],
    snapshotSeq: 0,
    lastHeaderFingerprint: undefined,
    drift: null,
    lastCompactSeq: 0,
  }),
  apply: applyEvent,
  view: (state) => {
    let totalRead = 0
    let totalInput = 0
    for (const snapshot of state.snapshots) {
      totalRead += snapshot.cacheRead
      totalInput += snapshot.inputTokens
    }
    const hitRate = totalInput > 0 ? Math.min(1, totalRead / totalInput) : undefined

    const latest = state.snapshots[state.snapshots.length - 1]
    const recentTurnHitRate = latest !== undefined && latest.inputTokens > 0
      ? Math.min(1, latest.cacheRead / latest.inputTokens)
      : undefined

    const diagnosis = latest === undefined || totalInput === 0
      ? undefined
      : diagnoseCacheMiss(
        state.snapshots,
        latest.turn,
        state.drift,
        state.lastCompactSeq > state.snapshotSeq,
      )
    // Only warn/error verdicts are health signals; info verdicts (first turn,
    // ordinary growth) are normal operation and stay out of the summary.
    const lastMissReason = diagnosis !== undefined && diagnosis !== null && diagnosis.severity !== 'info'
      ? diagnosis.reason
      : undefined

    return {
      ...hitRate === undefined ? {} : { hitRate },
      ...recentTurnHitRate === undefined ? {} : { recentTurnHitRate },
      ...lastMissReason === undefined ? {} : { lastMissReason },
      ...state.drift === null ? {} : {
        drift: {
          systemChanged: state.drift.systemChanged,
          toolsChanged: state.drift.toolsChanged,
          configChanged: state.drift.configChanged,
        },
      },
    }
  },
  stateVersion: 1,
}

declare module '@huiliyi37/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Read-only cache-health summary (hit rates, miss reason, drift). */
    cacheHealth: CacheHealthProjection
  }
}
