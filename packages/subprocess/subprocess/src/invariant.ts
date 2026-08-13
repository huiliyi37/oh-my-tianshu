/** Package-owned invariant companion for the subprocess seam. @module @huiliyi37/dsh-subprocess/invariant */

import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-subprocess'

/** Cordis companion plugin name. */
export const name = 'subprocess-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: this stateless Service Definition owns spawn-spec/handle types, while Service providers own observations. */
const install: InvariantInstaller = () => {}

/**
 * Register the subprocess invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
