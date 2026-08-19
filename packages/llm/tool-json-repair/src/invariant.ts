/**
 * Package-owned invariant companion for `@huiliyi37/dsh-tool-json-repair`.
 * @module @huiliyi37/dsh-tool-json-repair/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-tool-json-repair'

/** Cordis companion plugin name. */
export const name = 'tool-json-repair-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin emits no owned event type or snapshot.
 * Its only output is a transformed `llm/stream`, whose protocol the
 * `dsh-llm` invariant validates independently whenever it is mounted.
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
