/**
 * Package-owned invariant companion for `@huiliyi37/dsh-client-ui-permission`.
 * @module @huiliyi37/dsh-client-ui-permission/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-client-ui-permission'

/** Cordis companion plugin name. */
export const name = 'client-ui-permission-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the command and slot contribution lifecycles are
 * proven by the HMR-safety spec, while the browser-only Settings controller
 * owns no host events or cross-plugin mutable state.
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
