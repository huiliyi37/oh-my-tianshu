/**
 * Package-owned invariant companion for `@huiliyi37/dsh-credentials-local`.
 * @module @huiliyi37/dsh-credentials-local/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-credentials-local'

/** Cordis companion plugin name. */
export const name = 'credentials-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the Service Definition companion (`dsh-credentials/invariant`) owns the
 * `credentials/reference-updated` lifecycle contract; this provider's file/environment layering is
 * asynchronous I/O pinned by its unit suite.
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
