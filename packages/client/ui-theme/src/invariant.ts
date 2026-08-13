/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-theme`.
 * @module @deepseek-ai/dsh-client-ui-theme/invariant
 */

/* jscpd:ignore-start */
import type { Context } from 'cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-theme'

/** Cordis companion plugin name. */
export const name = 'client-ui-theme-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the theme registry publishes immutable snapshots on
 * its own `theme/change` event synchronously with the setter/registry
 * mutation in the same service — snapshot/event agreement is asserted
 * directly by this package's behavior specs.
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
