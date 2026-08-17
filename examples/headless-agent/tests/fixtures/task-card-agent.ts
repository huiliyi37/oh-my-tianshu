/** Fixture: publish one fresh top-level agent for the task-card snapshot turn. */

import type { Context } from '@huiliyi37/cordis'
import { SessionId } from '@huiliyi37/dsh-session'

/** Fixture plugin name. */
export const name = 'task-card-agent'
/** Services that must exist before the fixture publishes its agent. */
export const inject = ['agents', 'agentLoop']

/**
 * Create the snapshot session and bind its exact handle to this fixture's
 * lifetime. The driver's fixture turn then sends the first user message,
 * which the task-card plugin rewrites at pre-step.
 * @param ctx - settled agent and loop services from the Loader tree.
 * @returns after the agent is published.
 */
export async function apply(ctx: Context): Promise<void> {
  const handle = await ctx.agents.create({
    sessionId: SessionId('task-card-replay'),
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
  ctx.effect(() => () => handle.dispose(), 'task-card-agent.handle')
}
