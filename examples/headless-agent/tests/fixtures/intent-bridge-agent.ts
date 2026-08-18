/** Fixture: publish the alignment session for the intent-bridge snapshot turn. */

import type { Context } from '@huiliyi37/cordis'

/** Fixture plugin name. */
export const name = 'intent-bridge-agent'
/** Services that must exist before the fixture publishes the alignment session. */
export const inject = ['agents', 'agentLoop', 'intentBridge']

/**
 * Create the alignment session and bind its handle to this fixture's
 * lifetime. The driver's fixture turn then sends the user's first message to
 * the alignment agent, which (per the replay script) finalizes immediately;
 * the bridge creates the main session and feeds it the task card.
 * @param ctx - settled services from the Loader tree.
 * @returns after the alignment session is published.
 */
export async function apply(ctx: Context): Promise<void> {
  const { handle } = await ctx.intentBridge.createAlignedSession()
  ctx.effect(() => () => handle.dispose(), 'intent-bridge-agent.handle')
}
