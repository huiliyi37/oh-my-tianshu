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
  /** Seq of the previous turn's last usage — the left edge of the current turn's measurement window. */
  prevSnapshotSeq: number
  /** Turn of the latest usage event; a change marks a turn boundary for the window. */
  lastUsageTurn: number
  /** Seq of the header event that produced `drift`; diagnosis attributes it only inside its window. */
  driftSeq: number
  lastHeaderFingerprint?: PrefixFingerprint | undefined
  drift: DriftEvent | null
  lastCompactSeq: number
}

declare module '@huiliyi37/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    cacheHealth: CacheHealthState
  }
}

/** The fold's persisted-state shape: per-turn snapshots plus fold bookkeeping (superset of the view). */
const cacheHealthStateSchema: z.ZodType<CacheHealthState> = z.object({
  snapshots: z.array(z.object({
    turn: z.number().int().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
  }).strict()),
  snapshotSeq: z.number().int().nonnegative(),
  prevSnapshotSeq: z.number().int().nonnegative(),
  lastUsageTurn: z.number().int(),
  driftSeq: z.number().int().nonnegative(),
  lastHeaderFingerprint: z.object({
    systemSha256: z.string(),
    toolsSha256: z.string(),
    configSha256: z.string(),
    combinedSha256: z.string(),
  }).strict().optional(),
  drift: z.object({
    systemChanged: z.boolean(),
    toolsChanged: z.boolean(),
    configChanged: z.boolean(),
    message: z.string(),
  }).strict().nullable(),
  lastCompactSeq: z.number().int().nonnegative(),
}).strict()

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
      return {
        ...state,
        drift,
        ...drift === null ? {} : { driftSeq: event.seq },
        lastHeaderFingerprint: fingerprint,
      }
    }
    case 'assistant/message': {
      const usage = event.data.usage
      if (usage === undefined) return state
      const turn = event.data.turn
      // A new turn opens: the previous turn's end becomes the left edge of
      // the attribution window for drift and compaction.
      const windowed = turn !== state.lastUsageTurn
        ? { prevSnapshotSeq: state.snapshotSeq, lastUsageTurn: turn }
        : {}
      const existing = state.snapshots.find(snapshot => snapshot.turn === turn)
      if (existing === undefined) {
        return {
          ...state,
          ...windowed,
          snapshots: [...state.snapshots, {
            turn,
            cacheRead: usage.cacheReadTokens ?? 0,
            cacheWrite: usage.cacheWriteTokens ?? 0,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          }],
          snapshotSeq: event.seq,
        }
      }
      const updated: TurnCacheSnapshot = {
        ...existing,
        cacheRead: existing.cacheRead + (usage.cacheReadTokens ?? 0),
        cacheWrite: existing.cacheWrite + (usage.cacheWriteTokens ?? 0),
        inputTokens: existing.inputTokens + usage.inputTokens,
        outputTokens: existing.outputTokens + usage.outputTokens,
      }
      return {
        ...state,
        ...windowed,
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
 * The cache-health projection unit. Hit rates are the cached fraction of the
 * billed input — `cacheRead / (inputTokens + cacheRead + cacheWrite)`, the
 * `TokenUsage` counters being disjoint — so a provider that omits write
 * tokens (DeepSeek) stays exact instead of degenerating to 100%.
 */
export const cacheHealthProjectionDefinition = {
  key: 'cacheHealth',
  stateSchema: cacheHealthStateSchema,
  init: () => ({
    snapshots: [],
    snapshotSeq: 0,
    prevSnapshotSeq: 0,
    lastUsageTurn: -1,
    driftSeq: 0,
    lastHeaderFingerprint: undefined,
    drift: null,
    lastCompactSeq: 0,
  }),
  apply: applyEvent,
  wire: {
    viewSchema: projectionSchema,
    view: (state) => {
      let totalRead = 0
      let totalInput = 0
      for (const snapshot of state.snapshots) {
        totalRead += snapshot.cacheRead
        totalInput += snapshot.inputTokens + snapshot.cacheRead + snapshot.cacheWrite
      }
      const hitRate = totalInput > 0 ? Math.min(1, totalRead / totalInput) : undefined

      const latest = state.snapshots[state.snapshots.length - 1]
      const latestTotal = latest === undefined
        ? 0
        : latest.inputTokens + latest.cacheRead + latest.cacheWrite
      const recentTurnHitRate = latest !== undefined && latestTotal > 0
        ? Math.min(1, latest.cacheRead / latestTotal)
        : undefined

      // Drift and compaction attribute only inside the current turn's
      // measurement window — a stale signal must not mislabel later turns.
      const inWindow = (seq: number): boolean => seq > state.prevSnapshotSeq && seq <= state.snapshotSeq
      const diagnosis = totalInput === 0
        ? null
        : diagnoseCacheMiss(
          state.snapshots,
          state.drift !== null && inWindow(state.driftSeq) ? state.drift : null,
          inWindow(state.lastCompactSeq),
        )
      // Only warn/error verdicts are health signals; info verdicts (first turn,
      // ordinary growth) are normal operation and stay out of the summary.
      const lastMissReason = diagnosis !== null && diagnosis.severity !== 'info'
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
  },
  // Bumped for the state/wire split: older rows hold a wire-shaped value that
  // the state schema rejects, so they must refold instead.
  stateVersion: 2,
} satisfies ProjectionDefinition<'cacheHealth', CacheHealthState>

declare module '@huiliyi37/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Read-only cache-health summary (hit rates, miss reason, drift). */
    cacheHealth: CacheHealthProjection
  }
}
