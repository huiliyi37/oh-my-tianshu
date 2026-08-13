/**
 * Runtime invariant companion for @huiliyi37/dsh-evidence-gate.
 *
 * The evidence tracker owns no independent durable state (obligations live in
 * memory for the session and are superseded at task boundaries) — the owned
 * relationship here is the RED→GREEN discipline itself, which the package
 * tests assert behaviorally (obligation state machine, L1 edit gate, final
 * once latch). No separate runtime invariant is needed.
 *
 * @module @huiliyi37/dsh-evidence-gate/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-evidence-gate'

/** Cordis companion plugin name. */
export const name = 'evidence-gate-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: obligations are in-memory per-session state with no
 * durable cross-plugin relationships; the discipline semantics (RED before
 * GREEN, blocked ≠ satisfied, once latch) are asserted by package tests.
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
