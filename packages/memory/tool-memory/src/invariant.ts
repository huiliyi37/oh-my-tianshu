/**
 * Runtime invariant companion for @huiliyi37/dsh-tool-memory.
 *
 * The memory tools consume the memory service seam owned by
 * @huiliyi37/dsh-memory; tool result shapes are asserted behaviorally by
 * package tests. No cross-plugin event/data relation is owned here.
 *
 * @module @huiliyi37/dsh-tool-memory/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-tool-memory'

/** Cordis companion plugin name. */
export const name = 'tool-memory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the tools only consume the memory service seam;
 * result shapes are behaviorally tested.
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
