/**
 * Package-owned invariant companion for `@huiliyi37/dsh-mcp-client`.
 * @module @huiliyi37/dsh-mcp-client/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-mcp-client'

/** Cordis companion plugin name. */
export const name = 'mcp-client-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: MCP generations contribute through the tool registry, but the bridge
 * exposes no independent server-to-tool snapshot after an asynchronous resync.
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
