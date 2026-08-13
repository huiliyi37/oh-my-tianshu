/**
 * Generic-task adaptation for background pwsh process handles — the shell-agnostic
 * twin of `dsh-tool-bash`'s background adaptation.
 *
 * @module @huiliyi37/dsh-tool-pwsh/background
 */

import type { BashProcess } from '@huiliyi37/dsh-bash'

/* jscpd:ignore-start -- deliberate twin of dsh-tool-bash/background.ts (Agent Note). */

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
  // infrastructure-failure outcome, then map spawn failures and
  // sandbox.runnerFailed to task `failed`. The current contract aliases a spawn
  // failure with a signal-less kill and a runner failure with an ordinary
  // wrapper exit; real nonzero command exits must remain `completed`.
  if (proc.status === 'killed') {
    return { status: 'killed', detail: proc.signal === null ? 'killed before exit' : `signal: ${proc.signal}` }
  }
  return { status: 'completed', detail: `exit code: ${proc.exitCode ?? 0}` }
}
/* jscpd:ignore-end */
