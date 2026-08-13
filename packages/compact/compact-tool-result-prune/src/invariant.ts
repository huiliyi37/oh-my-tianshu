/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-compact-tool-result-prune`.
 * @module @deepseek-ai/dsh-compact-tool-result-prune/invariant
 */

/* jscpd:ignore-start */
import type { Context } from 'cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-compact-tool-result-prune'

/** Cordis companion plugin name. */
export const name = 'compact-tool-result-prune-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: Session validates each content-only rewrite and its companion owns cross-event enclosure. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
