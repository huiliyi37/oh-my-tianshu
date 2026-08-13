/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-jsonrpc`.
 * @module @deepseek-ai/dsh-jsonrpc/invariant
 */

/* jscpd:ignore-start */
import type { Context } from 'cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-jsonrpc'

/** Cordis companion plugin name. */
export const name = 'jsonrpc-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this presentation adapter owns no durable package-local event stream;
 * boundary and replay tests cover its protocol mapping.
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
