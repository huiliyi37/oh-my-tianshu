/**
 * Package-owned invariant companion for `@huiliyi37/dsh-doom-loop-guard`.
 * @module @huiliyi37/dsh-doom-loop-guard/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-doom-loop-guard'

/** Cordis companion plugin name. */
export const name = 'doom-loop-guard-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the detector windows are private to one post-execute
 * listener and expose no package-owned event or snapshot that an independent
 * companion can observe.
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
