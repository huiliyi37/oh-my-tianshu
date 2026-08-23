/**
 * CacheDiagnosticService — replay-aware prefix-cache health observation.
 *
 * Advances one isolated fold per session from the durable log (same pattern
 * as `@huiliyi37/dsh-token-meter`): `request/header` events feed the
 * three-source prefix fingerprint, `assistant/message` usage feeds per-turn
 * cache snapshots, and `compact/start` marks compaction. Queries fold the
 * latest diagnosis from the accumulated state; there is no live mirror.
 *
 * Pure logic lives in `fingerprint.ts` (drift attribution) and `diagnose.ts`
 * (miss classification, including prefix_truncation on cacheRead regressions)
 * — adapted from the opencode-tui upstream cache telemetry.
 *
 * @module @huiliyi37/dsh-cache-diagnostic
 */

import { Context, Service } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import type { EpochHeader, Session, SessionEvent } from '@huiliyi37/dsh-session'
import { canonicalHeader } from '@huiliyi37/dsh-session'
import { computeFingerprint, detectDrift } from './fingerprint.ts'
import type { DriftEvent, PrefixFingerprint } from './fingerprint.ts'
import { diagnoseCacheMiss } from './diagnose.ts'
import type { CacheDiagnostic, TurnCacheSnapshot } from './diagnose.ts'
import { cacheHealthProjectionDefinition } from './projection.ts'
// Type-only edges: resolves the optional projection registry Context
// declaration and the plugin-extended `compact/start` session event.
import type {} from '@huiliyi37/dsh-session-projection'
import type {} from '@huiliyi37/dsh-compact'

export type * from './fingerprint.ts'
export type * from './diagnose.ts'
export type * from './projection.ts'
export { computeFingerprint, detectDrift } from './fingerprint.ts'
export { diagnoseCacheMiss } from './diagnose.ts'
export { foldTurnSnapshots } from './turn-snapshot.ts'
export { cacheHealthProjectionDefinition } from './projection.ts'

declare module '@huiliyi37/cordis' {
  interface Context {
    cacheDiagnostic: CacheDiagnosticService
  }
}

/** Caller-provided overrides for one diagnosis; absent fields fall back to the fold. */
export interface DiagnoseOptions {
  /** Override the drift recorded from header fingerprints. */
  drift?: DriftEvent | null
  /** Override the compaction signal detected from `compact/start` events. */
  wasCompacted?: boolean
}

interface CacheReplayState {
  consumedEvents: number
  snapshots: TurnCacheSnapshot[]
  /** Seq of the latest usage event folded into `snapshots`. */
  snapshotSeq: number
  /** Seq of the previous turn's last usage — the left edge of the current turn's measurement window. */
  prevSnapshotSeq: number
  /** Turn of the latest usage event; a change marks a turn boundary for the window. */
  lastUsageTurn: number
  /** Seq of the header event that produced `drift`; diagnosis attributes it only inside its window. */
  driftSeq: number
  lastHeaderFingerprint: PrefixFingerprint | undefined
  drift: DriftEvent | null
  lastCompactSeq: number
}

/**
 * Serialize the cache-relevant call-config bytes for fingerprinting. The key
 * order is fixed by construction so identical configs hash identically.
 * @param header - a canonical request header.
 * @returns the canonical config text.
 */
function configText(header: EpochHeader): string {
  return JSON.stringify({
    config: header.config,
    adapterDefaults: header.adapterDefaults,
  })
}

/**
 * No settings are supported; any key fails at load. Declared as a named type
 * so the config catalog can render the (empty) shape.
 */
export interface CacheDiagnosticConfig extends Record<string, never> {}

/**
 * `ctx.cacheDiagnostic`: owns per-session prefix fingerprints, per-turn cache
 * snapshots, and miss diagnosis. UIs and logs observe through the query
 * methods; the service folds lazily on `session/event` for sessions it has
 * been asked about.
 */
export class CacheDiagnosticService extends Service {
  private readonly states = new WeakMap<Session, CacheReplayState>()

  constructor(ctx: Context, config: CacheDiagnosticConfig = {}) {
    super(ctx, 'cacheDiagnostic')
    if (Object.keys(config).length > 0) {
      throw new Error(`CacheDiagnosticService: unknown config key(s) ${Object.keys(config).join(', ')} (no settings are supported)`)
    }

    // Readers catch up independently: eager observation bounds read latency
    // without creating state for sessions no consumer has read.
    ctx.on('session/event', (session) => {
      if (this.states.has(session)) this._sync(session)
    })

    // Projection registration is an optional child: compositions without the
    // generic registry keep the service's standalone read shape.
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register(cacheHealthProjectionDefinition)
    })
  }

  static Config = z.object({})

  /**
   * Diagnose the latest turn's cache miss, or null when the turn is healthy.
   * Drift and compaction are attributed only when their event landed inside
   * the current turn's measurement window (after the previous turn's last
   * usage, at or before the latest usage) — a stale signal must not mislabel
   * later turns.
   * @param session - the session to diagnose.
   * @param options - optional overrides for drift and compaction signals.
   * @returns the diagnosis, or null when there is nothing to explain.
   */
  diagnose(session: Session, options: DiagnoseOptions = {}): CacheDiagnostic | null {
    const state = this._sync(session)
    const inWindow = (seq: number): boolean => seq > state.prevSnapshotSeq && seq <= state.snapshotSeq
    const drift = options.drift !== undefined
      ? options.drift
      : state.drift !== null && inWindow(state.driftSeq) ? state.drift : null
    const wasCompacted = options.wasCompacted ?? inWindow(state.lastCompactSeq)
    return diagnoseCacheMiss(state.snapshots, drift, wasCompacted)
  }

  /**
   * Per-turn cache snapshots folded from the durable log, in turn order.
   * @param session - the session to fold.
   * @returns a detached list of snapshots.
   */
  turnHistory(session: Session): readonly TurnCacheSnapshot[] {
    const state = this._sync(session)
    return state.snapshots.map(snapshot => ({ ...snapshot }))
  }

  /**
   * Cumulative cache hit rate over the whole session: the cached fraction of
   * the billed input, `cacheRead / (inputTokens + cacheRead + cacheWrite)`
   * (`TokenUsage` counts are disjoint — `inputTokens` is the uncached share).
   * @param session - the session to measure.
   * @returns the rate in [0, 1], or null when no usage has been reported.
   */
  hitRate(session: Session): number | null {
    const state = this._sync(session)
    let totalRead = 0
    let totalInput = 0
    for (const snapshot of state.snapshots) {
      totalRead += snapshot.cacheRead
      totalInput += snapshot.inputTokens + snapshot.cacheRead + snapshot.cacheWrite
    }
    return totalInput > 0 ? Math.min(1, totalRead / totalInput) : null
  }

  /**
   * Cache hit rate over the last N turns, same denominator as {@link hitRate}.
   * @param session - the session to measure.
   * @param lastN - how many recent turns to include.
   * @returns the rate in [0, 1], or null when no usage has been reported.
   */
  recentHitRate(session: Session, lastN: number): number | null {
    const state = this._sync(session)
    const slice = state.snapshots.slice(-lastN)
    let totalRead = 0
    let totalInput = 0
    for (const snapshot of slice) {
      totalRead += snapshot.cacheRead
      totalInput += snapshot.inputTokens + snapshot.cacheRead + snapshot.cacheWrite
    }
    return totalInput > 0 ? Math.min(1, totalRead / totalInput) : null
  }

  /** Catch one session's fold up to the current durable tail. */
  private _sync(session: Session): CacheReplayState {
    let state = this.states.get(session)
    if (state === undefined) {
      state = {
        consumedEvents: 0,
        snapshots: [],
        snapshotSeq: 0,
        prevSnapshotSeq: 0,
        lastUsageTurn: -1,
        driftSeq: 0,
        lastHeaderFingerprint: undefined,
        drift: null,
        lastCompactSeq: 0,
      }
      this.states.set(session, state)
    }
    while (state.consumedEvents < session.events.length) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- contiguous session seqs index the durable log.
      const event = session.events[state.consumedEvents]!
      this._foldEvent(state, event)
      state.consumedEvents += 1
    }
    return state
  }

  private _foldEvent(state: CacheReplayState, event: SessionEvent): void {
    switch (event.type) {
      case 'request/header': {
        const header = canonicalHeader(event.data.header)
        const fingerprint = computeFingerprint(
          header.system ?? '',
          header.tools,
          configText(header),
        )
        state.drift = state.lastHeaderFingerprint === undefined
          ? null
          : detectDrift(state.lastHeaderFingerprint, fingerprint)
        if (state.drift !== null) state.driftSeq = event.seq
        state.lastHeaderFingerprint = fingerprint
        break
      }
      case 'assistant/message': {
        const usage = event.data.usage
        if (usage === undefined) break
        const turn = event.data.turn
        if (turn !== state.lastUsageTurn) {
          // A new turn opens: the previous turn's end becomes the left edge of
          // the attribution window for drift and compaction.
          state.prevSnapshotSeq = state.snapshotSeq
          state.lastUsageTurn = turn
        }
        const existing = state.snapshots.find(snapshot => snapshot.turn === turn)
        if (existing === undefined) {
          state.snapshots.push({
            turn,
            cacheRead: usage.cacheReadTokens ?? 0,
            cacheWrite: usage.cacheWriteTokens ?? 0,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          })
        } else {
          existing.cacheRead += usage.cacheReadTokens ?? 0
          existing.cacheWrite += usage.cacheWriteTokens ?? 0
          existing.inputTokens += usage.inputTokens
          existing.outputTokens += usage.outputTokens
        }
        state.snapshotSeq = event.seq
        break
      }
      case 'compact/start':
        state.lastCompactSeq = event.seq
        break
      default:
        break
    }
  }
}

export default CacheDiagnosticService
