/**
 * Web question plugin, node half: enabling this UI feature also exposes the
 * model-facing ask_user_question tool on the host composition.
 */
import type { Context } from 'cordis'
import * as toolAskUser from '@deepseek-ai/dsh-tool-ask-user'

/** Host services required by the model-facing tool. */
export const inject = ['tools', 'userInteraction']

/**
 * Mount ask_user_question for hosts that selected the Web question plugin.
 * @param ctx - Host plugin context carrying tools and userInteraction.
 */
export function apply(ctx: Context): void {
  toolAskUser.apply(ctx)
}
