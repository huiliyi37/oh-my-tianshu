/**
 * Typed failures shared by subagent service and provider operations.
 *
 * @module @huiliyi37/dsh-subagent
 */

import { HarnessError } from '@huiliyi37/dsh-llm'

/** Typed failure for the subagent seam. */
export class SubagentError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'SubagentError'
  }
}
