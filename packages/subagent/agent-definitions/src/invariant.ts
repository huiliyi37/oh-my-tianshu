/**
 * Package-owned invariant companion for `@huiliyi37/dsh-agent-definitions`.
 * @module @huiliyi37/dsh-agent-definitions/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-agent-definitions'

/** Cordis companion plugin name. */
export const name = 'agent-definitions-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this registry's relations (rank ordering, first-wins
 * dedupe, watcher-driven invalidation) are parsing and cache concerns enforced
 * inside the service; it owns no independent event sequence.
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
