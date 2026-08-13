/**
 * Package-owned invariant companion for `@huiliyi37/dsh-pheromone`.
 * @module @huiliyi37/dsh-pheromone/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-pheromone'

/** Cordis companion plugin name. */
export const name = 'pheromone-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this pure library owns no event stream or mutable
 * runtime data — decay algebra, LRU capacity, and persistence round-trips are
 * enforced by unit tests; the signal-source wiring (evidence-gate RED,
 * fs-snapshot read/edit traces) is asserted by the consuming plugin's tests.
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
