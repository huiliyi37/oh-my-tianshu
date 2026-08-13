/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-deliverables`.
 * @module @deepseek-ai/dsh-client-ui-deliverables/invariant
 */

/* jscpd:ignore-start */
import type { Context } from 'cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-deliverables'

/** Cordis companion plugin name. */
export const name = 'client-ui-deliverables-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: one slot registration and one dictionary
 * registration, both effect-owned with disposal proven by the HMR-safety
 * spec — the plugin emits no cordis events and owns no cross-plugin mutable
 * state.
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
