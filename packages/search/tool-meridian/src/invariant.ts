/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-meridian`.
 * @module @deepseek-ai/dsh-tool-meridian/invariant
 */

/* jscpd:ignore-start */
import type { Context } from 'cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-meridian'

/** Cordis companion plugin name. */
export const name = 'tool-meridian-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the tool owns no independent durable state — the
 * MeridianIndexer instance is owned by the plugin's `apply` closure, and the
 * index's durable SQLite integrity is covered by `@deepseek-ai/dsh-meridian`
 * package tests. The tool→index assembly (defineTool wiring, backfill
 * scheduling, dynamic-context summary) is asserted behaviorally by package
 * tests.
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
