/**
 * Package-owned invariant companion for `@huiliyi37/dsh-semantic-index`.
 * @module @huiliyi37/dsh-semantic-index/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-semantic-index'

/** Cordis companion plugin name. */
export const name = 'semantic-index-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this pure library owns no event stream or mutable
 * runtime data — BM25/RRF/salience algebra and the index's own persisted-file
 * state are enforced by unit tests; the tool-side assembly relationship is
 * asserted by `@huiliyi37/dsh-tool-semantic-search`'s invariant.
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
