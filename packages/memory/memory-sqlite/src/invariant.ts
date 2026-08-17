/**
 * Runtime invariant companion for @huiliyi37/dsh-memory-sqlite.
 *
 * The structured store's core relations are enforced where they live: the
 * schema's partial unique index guarantees at most one active fact per
 * (scope, subject, predicate), and supersede/BM25/embedding-fusion/markdown-import
 * behavior is asserted by package tests over temp-dir databases. No cross-plugin
 * event/data relation is owned here.
 *
 * @module @huiliyi37/dsh-memory-sqlite/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-memory-sqlite'

/** Cordis companion plugin name. */
export const name = 'memory-sqlite-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: view consistency (one active fact per
 * scope/subject/predicate) is enforced by the schema's partial unique index,
 * and store behavior is asserted behaviorally by package tests.
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
