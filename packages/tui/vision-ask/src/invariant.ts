/**
 * Runtime invariant companion for @huiliyi37/dsh-vision-ask.
 *
 * The vision co-pilot keeps a session-scoped image registry (package-local
 * state rebuilt from the session stream it consumes) and exposes the
 * `ask_image` tool; registry and tool behavior are asserted by package
 * tests. No cross-plugin event/data relation is owned here.
 *
 * @module @huiliyi37/dsh-vision-ask/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-vision-ask'

/** Cordis companion plugin name. */
export const name = 'vision-ask-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the image registry is package-local session-derived
 * state asserted behaviorally by package tests.
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
