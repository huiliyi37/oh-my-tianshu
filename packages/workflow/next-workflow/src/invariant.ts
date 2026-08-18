/**
 * Package-owned invariant companion for `@huiliyi37/dsh-next-workflow`.
 * @module @huiliyi37/dsh-next-workflow/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-next-workflow'

/** Cordis companion plugin name. */
export const name = 'next-workflow-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the command handler appends its own `next-workflow/*`
 * log-only events from the same fiber that owns the run, so no independent
 * event stream exists to cross-check; the session and commands owners validate
 * append and lifecycle pairing, and the subagent/bash seams validate the runs
 * and executions it starts.
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
