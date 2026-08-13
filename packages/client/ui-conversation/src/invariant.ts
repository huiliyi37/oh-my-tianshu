/**
 * Package-owned invariant companion for `@huiliyi37/dsh-client-ui-conversation`.
 * @module @huiliyi37/dsh-client-ui-conversation/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-client-ui-conversation'

/** Cordis companion plugin name. */
export const name = 'client-ui-conversation-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the conversation service emits no cordis events, and
 * both rings this package owns (the 'conversation.view' tab ring and the
 * 'conversation.chat.node' business renderer seat) ride the slot system, whose ledger
 * invariants live with the runtime slots package.
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
