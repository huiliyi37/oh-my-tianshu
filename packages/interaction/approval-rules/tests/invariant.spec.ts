/** Invariant-companion behavior for the `approval/rule` audit event. */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import SessionStore, { type Session } from '@huiliyi37/dsh-session'
import InvariantService from '@huiliyi37/dsh-invariants'
import { ApprovalRequestId } from '@huiliyi37/dsh-user-approval'
import * as ApprovalRulesInvariant from '../src/invariant.ts'
import type {} from '../src/index.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService)
  await ctx.plugin(ApprovalRulesInvariant)
  return ctx
}

function startTurn(session: Session): void {
  session.append('turn/start', { turn: 1 })
}

function ruleEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { tool: 'bash', pattern: '*', decision: 'deny', ruleIndex: 0, layer: 'user', ...overrides }
}

describe('approval-rules invariants', () => {
  it('accepts a rule event paired with its asked and decided siblings', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    startTurn(session)
    const id = ApprovalRequestId('ask-1')
    session.append('approval/asked', { id, toolName: 'bash' })
    session.append('approval/rule', { tool: 'bash', pattern: '*', decision: 'deny', ruleIndex: 0, layer: 'user' })
    session.append('approval/decided', { id, outcome: 'rejected' })
  })

  it('rejects a rule event with no pending asked for the same tool', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    startTurn(session)
    expect(() => session.append('approval/rule', ruleEvent() as never)).toThrow(/no matching pending approval\/asked/)
  })

  it('rejects a second rule event settling one ask', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    startTurn(session)
    session.append('approval/asked', { id: ApprovalRequestId('ask-1'), toolName: 'bash' })
    session.append('approval/rule', { tool: 'bash', pattern: '*', decision: 'deny', ruleIndex: 0, layer: 'user' })
    expect(() => session.append('approval/rule', ruleEvent() as never)).toThrow(/no matching pending approval\/asked/)
  })

  it('rejects malformed rule payloads', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    startTurn(session)
    session.append('approval/asked', { id: ApprovalRequestId('ask-1'), toolName: 'bash' })
    expect(() => session.append('approval/rule', ruleEvent({ decision: 'maybe' }) as never)).toThrow(/unknown decision/)
    expect(() => session.append('approval/rule', ruleEvent({ ruleIndex: -1 }) as never)).toThrow(/ruleIndex/)
    expect(() => session.append('approval/rule', ruleEvent({ layer: 'cloud' }) as never)).toThrow(/unknown layer/)
  })

  it('rejects an unpaired rule event when replaying an existing session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    startTurn(session)
    session.append('approval/rule', ruleEvent() as never)
    await ctx.plugin(InvariantService)
    await expect(ctx.plugin(ApprovalRulesInvariant).then(() => undefined)).rejects.toThrow(/no matching pending approval\/asked/)
  })
})
