/**
 * Runtime invariant companion for @huiliyi37/dsh-memory-consolidate.
 *
 * Consolidation writes flow exclusively through the memory service seam, whose
 * store-level relations (one active fact per pair, append-only log) are
 * enforced by the provider schema and asserted by package tests; the
 * success/failure partition of consolidation is asserted behaviorally by the
 * gate and composition tests. No cross-plugin event/data relation is owned here.
 *
 * @module @huiliyi37/dsh-memory-consolidate/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-memory-consolidate'

/** Cordis companion plugin name. */
export const name = 'memory-consolidate-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: consolidation effects are ordinary memory-service
 * writes checked by package tests, and its log-only decisions are deliberately
 * not model-visible state (the session is already disposed at decision time).
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
