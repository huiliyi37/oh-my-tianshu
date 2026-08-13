/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-repository-plugin`.
 * @module @deepseek-ai/dsh-repository-plugin/invariant
 */

/* jscpd:ignore-start */
import type { Context } from 'cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-repository-plugin'

/** Cordis companion plugin name. */
export const name = 'repository-plugin-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns no service state; Loader fibers and the existing skill
 * and MCP owners expose the authoritative lifecycle relationships for its composed children.
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
