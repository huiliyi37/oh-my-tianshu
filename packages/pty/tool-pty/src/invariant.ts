/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-pty`.
 * @module @deepseek-ai/dsh-tool-pty/invariant
 */

/* jscpd:ignore-start */
import type { Context } from 'cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-pty'

/** Cordis companion plugin name. */
export const name = 'tool-pty-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this stateless adapter contributes tools and prompt guidance, while PTY
 * lifecycle and background-task relationships remain owned by the services it composes.
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
