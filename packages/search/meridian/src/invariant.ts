/**
 * Package-owned invariant companion for `@huiliyi37/dsh-meridian`.
 * @module @huiliyi37/dsh-meridian/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-meridian'

/** Cordis companion plugin name. */
export const name = 'meridian-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the index owns durable SQLite state, but its integrity
 * (files/symbols/edges counts against table contents, upsert→needsParse
 * inversion, GLOB-escaped path queries) is enforced by package unit tests on a
 * real temporary database; the runtime cross-package relationship (tool layer
 * feeding edits/reads into the index, pheromone signal wiring) is asserted by
 * the consuming plugin's invariant companion (`@huiliyi37/dsh-tool-meridian`).
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
