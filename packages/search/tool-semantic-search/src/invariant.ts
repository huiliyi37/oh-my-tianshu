/**
 * Package-owned invariant companion for `@huiliyi37/dsh-tool-semantic-search`.
 * @module @huiliyi37/dsh-tool-semantic-search/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-tool-semantic-search'

/** Cordis companion plugin name. */
export const name = 'tool-semantic-search-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the tool↔index assembly is owned by the plugin's own
 * `apply` closure (a missing root fails loud at load, the instance outlives
 * every tool call), and the stale→update→search discipline is asserted
 * behaviorally by package tests. The index library's own algebra is covered by
 * `@huiliyi37/dsh-semantic-index`'s tests.
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
