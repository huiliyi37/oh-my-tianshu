/**
 * Generic-task adaptation for background bash process handles.
 *
 * @module @deepseek-ai/dsh-tool-bash/background
 */

import type { BashProcess } from '@deepseek-ai/dsh-bash'

/**
 * Map a settled background process onto the generic task-outcome vocabulary:
 * `killed` stays `killed` (detail: the signal when one is known), everything
 * else is `completed` with the exit code as detail. A nonzero command exit is
 * reported, not failed, exactly like the foreground rendering.
 * @param proc - the settled process handle.
 * @returns the outcome for the `ctx.tasks` registration.
 */
export function processOutcome(proc: BashProcess): { status: 'completed' | 'killed'; detail: string } {
  // TODO(background-infrastructure-outcome): widen BashProcess with an explicit
  // infrastructure-failure outcome, then map it to task `failed`. Restricted
  // runner failures expose sandbox.runnerFailed, but unconfined spawn failures
  // still alias a signal-less kill; real nonzero command exits must remain
  // `completed`.
  if (proc.status === 'killed') {
    return { status: 'killed', detail: proc.signal !== null ? `signal: ${proc.signal}` : 'killed before exit' }
  }
  return { status: 'completed', detail: `exit code: ${proc.exitCode ?? 0}` }
}
