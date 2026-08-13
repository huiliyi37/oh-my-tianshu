/**
 * Runtime invariant companion for @huiliyi37/dsh-tui.
 *
 * The TUI is a terminal presentation layer: every stream it renders
 * (session/event, approval/request, subagent/*, workflow/*) is owned and
 * asserted by the emitting package, and the runner's own mutable state
 * (transcript view, live region, pending interaction) is process-local UI
 * state asserted behaviorally by package tests and the real-composition
 * suite. No cross-plugin event/data relation is owned here.
 *
 * @module @huiliyi37/dsh-tui/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-tui'

/** Cordis companion plugin name. */
export const name = 'tui-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the render core only consumes streams owned by other
 * packages; its UI state is process-local and behaviorally tested.
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
