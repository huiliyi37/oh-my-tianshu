/**
 * Runtime invariant companion for @deepseek-ai/dsh-fs-snapshot.
 *
 * The snapshot hook is a pass-through waterfall step over `tools/execute`
 * owned by dsh-tools; its per-session FileHistory index and on-disk backups
 * are process-local caches asserted behaviorally by package tests. No
 * cross-plugin event/data relation is owned here.
 *
 * @module @deepseek-ai/dsh-fs-snapshot/invariant
 */
/* jscpd:ignore-start */
import type { Context } from 'cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fs-snapshot'

/** Cordis companion plugin name. */
export const name = 'fs-snapshot-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the pre-write snapshot is a pass-through hook whose
 * backup index is in-memory per-session state; rewind correctness is asserted
 * behaviorally by package tests.
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
