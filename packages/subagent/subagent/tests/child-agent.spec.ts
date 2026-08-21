/** Child route layering: parent route, subagent-role pin, request overrides. */

import { describe, expect, it } from 'vitest'
import { type Agent, type AgentOptions } from '@huiliyi37/dsh-agent'
import { resolveChildAgentOptions } from '@huiliyi37/dsh-subagent/src/child-agent.ts'

function parentWith(options: AgentOptions): Agent {
  return { options } as unknown as Agent
}

const PARENT = { provider: 'parent-p', model: 'parent-m', maxTokens: 1024 }
const PIN = { provider: 'pin-p', model: 'pin-m' }

describe('resolveChildAgentOptions', () => {
  it('inherits the parent route when neither a request nor a pin overrides it', () => {
    expect(resolveChildAgentOptions(parentWith(PARENT), undefined, 1))
      .toEqual({ ...PARENT, subagentDepth: 1 })
  })

  it('applies the subagent-role pin above the inherited parent route', () => {
    // The pin carries no maxTokens: the parent cap still inherits.
    expect(resolveChildAgentOptions(parentWith(PARENT), undefined, 1, PIN))
      .toEqual({ provider: 'pin-p', model: 'pin-m', maxTokens: 1024, subagentDepth: 1 })
  })

  it('keeps request overrides above the pin', () => {
    expect(resolveChildAgentOptions(parentWith(PARENT), { model: 'requested-m' }, 1, PIN))
      .toEqual({ provider: 'pin-p', model: 'requested-m', maxTokens: 1024, subagentDepth: 1 })
  })

  it('drops the parent route entirely when the parent carries none', () => {
    expect(resolveChildAgentOptions(parentWith({}), undefined, 2, PIN))
      .toEqual({ provider: 'pin-p', model: 'pin-m', subagentDepth: 2 })
    expect(resolveChildAgentOptions(parentWith({}), undefined, 2))
      .toEqual({ subagentDepth: 2 })
  })
})
