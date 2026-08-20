/**
 * Runtime invariant companion for @huiliyi37/dsh-memory.
 *
 * The memory service owns Markdown files under `.dsh/memory/`; its state is
 * package-local (no other plugin writes those records), and save/search/list
 * /delete behavior is asserted by package tests over the real store. No
 * cross-plugin event/data relation is owned here.
 *
 * @module @huiliyi37/dsh-memory/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-memory'

/** Cordis companion plugin name. */
export const name = 'memory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the memory store is package-local state asserted
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
