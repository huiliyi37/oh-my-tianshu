/**
 * Runtime invariant companion for @huiliyi37/dsh-memory-pipeline.
 *
 * Pipeline effects are ordinary memory-service writes (save/delete) whose
 * store-level relations are enforced by the provider schema and asserted by
 * package tests; sweep and consolidation decisions are log-only background
 * state, deliberately never model-visible. The ledger is a durable file
 * validated at its boundary (version + shape) on every load. No cross-plugin
 * event/data relation is owned here.
 *
 * @module @huiliyi37/dsh-memory-pipeline/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-memory-pipeline'

/** Cordis companion plugin name. */
export const name = 'memory-pipeline-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: pipeline writes flow exclusively through the memory
 * service seam checked by package tests, and its scheduling decisions are
 * log-only background state that no other plugin consumes.
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
