/**
 * Runtime invariant companion for @huiliyi37/dsh-git.
 *
 * The git service is a thin typed seam over the external `git` CLI: all
 * mutable state lives in the repository on disk, owned by git itself, and
 * every result surface is asserted behaviorally by package tests (including
 * real-repository smoke compositions). No cross-plugin event/data relation
 * is owned here.
 *
 * @module @huiliyi37/dsh-git/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-git'

/** Cordis companion plugin name. */
export const name = 'git-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: repository state is owned by the external git CLI;
 * the service surface is behaviorally tested.
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
