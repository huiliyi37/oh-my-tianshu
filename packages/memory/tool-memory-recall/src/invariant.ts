/**
 * Runtime invariant companion for @huiliyi37/dsh-tool-memory-recall.
 *
 * The distillation boundary (shape validation + budgets) is asserted by package
 * tests over scripted providers; availability probing has no cross-plugin
 * event/data relation to check at runtime.
 *
 * @module @huiliyi37/dsh-tool-memory-recall/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-tool-memory-recall'

/** Cordis companion plugin name. */
export const name = 'tool-memory-recall-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the raw-transcript containment property (reader output
 * returns only as a bounded tool result) is structural — the tool returns the
 * clamped distillation and nothing else — and is asserted by package tests.
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
