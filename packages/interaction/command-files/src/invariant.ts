/**
 * Package-owned invariant companion for `@huiliyi37/dsh-command-files`.
 * @module @huiliyi37/dsh-command-files/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-command-files'

/** Cordis companion plugin name. */
export const name = 'command-files-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this plugin owns no durable mutable runtime state or
 * event stream. Its value algebra (per-layer duplicate detection, cross-layer
 * project-shadow de-duplication, name-regex validation, and template
 * rendering) is enforced by load-time fail-loud checks and unit tests; the
 * command registry owns the `command/run` / `command/done` lifecycle, and the
 * agent/session owns the steered user message.
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
