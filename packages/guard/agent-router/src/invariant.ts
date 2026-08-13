/**
 * Runtime invariant companion for @huiliyi37/dsh-agent-router.
 *
 * The router owns no independent durable state: the prediction accumulator is
 * in-memory per-session, and subagent dispatch is a transient lifecycle over
 * `ctx.agents` (owned by the agent registry). The routing discipline itself
 * (metrics → action, native dispatch) is asserted behaviorally by package
 * tests. No separate runtime invariant is needed.
 *
 * @module @huiliyi37/dsh-agent-router/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-agent-router'

/** Cordis companion plugin name. */
export const name = 'agent-router-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: prediction is in-memory per-session; dispatch owns no
 * durable cross-plugin relationship (results flow back via session/event).
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
