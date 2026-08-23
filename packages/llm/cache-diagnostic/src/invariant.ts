/**
 * Package-owned invariant companion for `@huiliyi37/dsh-cache-diagnostic`.
 * @module @huiliyi37/dsh-cache-diagnostic/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'
import type { TurnCacheSnapshot } from './diagnose.ts'

const PACKAGE_NAME = '@huiliyi37/dsh-cache-diagnostic'

/** Cordis companion plugin name. */
export const name = 'cache-diagnostic-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate a folded turn-snapshot list: turns strictly ascending, no
 * duplicates, non-negative buckets. A malformed fold (out-of-order usage
 * events, negative provider reports) fails loud instead of silently shaping
 * a wrong diagnosis.
 * @param snapshots - the fold to validate.
 * @returns a human-readable violation, or null when the fold is valid.
 */
export function validateTurnSnapshots(snapshots: readonly TurnCacheSnapshot[]): string | null {
  let previousTurn = -1
  for (const snapshot of snapshots) {
    if (snapshot.turn <= previousTurn) {
      return `snapshots must be strictly turn-ascending: turn ${snapshot.turn} after ${previousTurn}`
    }
    previousTurn = snapshot.turn
    if (snapshot.cacheRead < 0 || snapshot.cacheWrite < 0
      || snapshot.inputTokens < 0 || snapshot.outputTokens < 0) {
      return `snapshot of turn ${snapshot.turn} has a negative bucket`
    }
  }
  return null
}

/**
 * No runtime invariant: the fold tolerates replayed logs (ordering is
 * normalized by `foldTurnSnapshots`), and the schema fixes the projection
 * payload at the durable boundary. {@link validateTurnSnapshots} is the
 * mechanically checkable relation — exercised by the package's invariant
 * spec and available to any caller that wants to gate on fold health.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
