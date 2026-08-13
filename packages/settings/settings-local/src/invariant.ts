/**
 * Package-owned invariant companion for `@huiliyi37/dsh-settings-local`.
 * @module @huiliyi37/dsh-settings-local/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-settings-local'

/** Cordis companion plugin name. */
export const name = 'settings-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this provider's contracts are file round-trip,
 * watcher timing, and atomic-write behavior — IO effects proven by package
 * tests; the in-process commit relation is owned by `@huiliyi37/dsh-settings`.
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
