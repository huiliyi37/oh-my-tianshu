/**
 * Package-owned invariant companion for `@huiliyi37/dsh-tool-file-info`.
 * @module @huiliyi37/dsh-tool-file-info/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-tool-file-info'

/** Cordis companion plugin name. */
export const name = 'tool-file-info-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the tool↔store assembly is owned by the plugin's own
 * `apply` closure, and the event→deposit signal wiring is asserted
 * behaviorally by package tests (simulated `session/event` streams). The
 * store's decay/persistence algebra is covered by `@huiliyi37/dsh-pheromone`.
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
