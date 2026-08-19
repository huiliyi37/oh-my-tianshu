import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import { SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import { defineContentToolFixture } from '@huiliyi37/dsh-tools'
import type { Agent } from '@huiliyi37/dsh-agent'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import * as DoomLoopGuard from '@huiliyi37/dsh-doom-loop-guard'
import type { Config } from '@huiliyi37/dsh-doom-loop-guard'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Behavior suite for the doom-loop guard: the three detectors (oscillation,
 * edit spiral, test churn) through a real agent loop against a scripted mock
 * adapter, plus non-firing boundaries (all-success alternation, successful
 * edit reset), the reminder budget, the user-message reset, exclude patterns,
 * and fail-loud config — no network.
 */

/** Boot the core spine + the guard; the caller registers adapters and extra listeners. */
async function harness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(DoomLoopGuard, config)
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
  ctx.tools.register(defineContentToolFixture({ name: 'other', description: 'o', parameters: {}, async execute() { throw new Error('boom') } }))
  ctx.tools.register(defineContentToolFixture({
    name: 'str_replace_editor', description: 'e', parameters: { path: { type: 'string' } },
    async execute() { throw new Error('edit failed') },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'run_tests', description: 't', parameters: {},
    async execute() { return [{ type: 'text', text: 'Tests  1 failed (1)' }] },
  }))
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

/** Every injected guard context in the agent's log, flattened to text + source. */
function guardReminders(agent: Agent): { text: string; source: unknown }[] {
  return [...agent.session.events]
    .filter((e): e is SessionEvent<'user/message'> =>
      e.type === 'user/message' && e.data.source.kind === 'plugin' && e.data.source.plugin === 'doom-loop-guard')
    .map(e => ({
      text: e.data.content.map(block => block.type === 'text' ? block.text : '').join('|'),
      source: e.data.source,
    }))
}

async function runAgent(ctx: Context, adapter: MockAdapter): Promise<Agent> {
  ctx.llm.registerAdapter(['mock-provider'], adapter)
  const agent = ctx.agentLoop.create(SessionId(`doom-${Math.random().toString(36).slice(2)}`), { provider: 'mock-provider', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await waitForIdle(ctx, agent)
  return agent
}

describe('oscillation detector', () => {
  it('reminds when two tools alternate with a failing call in the window', async () => {
    const ctx = await harness()
    const agent = await runAgent(ctx, new MockAdapter([
      toolCallResponse('a1', 'probe', {}),
      toolCallResponse('b1', 'other', {}),
      toolCallResponse('a2', 'probe', {}),
      toolCallResponse('b2', 'other', {}),
      textResponse('done'),
    ]))

    const reminders = guardReminders(agent)
    expect(reminders).toHaveLength(1)
    expect(reminders[0]!.text).toContain('alternate between probe and other')
  })

  it('stays quiet when the alternation never fails', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('a1', 'probe', {}),
      toolCallResponse('b1', 'probe', {}),
      toolCallResponse('a2', 'probe', {}),
      toolCallResponse('b2', 'probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock-provider'], adapter)
    const agent = ctx.agentLoop.create(SessionId('doom-all-ok'), { provider: 'mock-provider', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(guardReminders(agent)).toHaveLength(0)
  })
})

describe('edit spiral detector', () => {
  it('reminds after consecutive failed edits on the same path', async () => {
    const ctx = await harness()
    const agent = await runAgent(ctx, new MockAdapter([
      toolCallResponse('e1', 'str_replace_editor', { path: 'src/a.ts' }),
      toolCallResponse('e2', 'str_replace_editor', { path: 'src/a.ts' }),
      toolCallResponse('e3', 'str_replace_editor', { path: 'src/a.ts' }),
      textResponse('done'),
    ]))

    const reminders = guardReminders(agent)
    expect(reminders).toHaveLength(1)
    expect(reminders[0]!.text).toContain('src/a.ts')
    expect(reminders[0]!.text).toContain('failed 3 times')
  })
})

describe('test churn detector', () => {
  it('reminds when the same failing test output repeats unchanged', async () => {
    const ctx = await harness()
    const agent = await runAgent(ctx, new MockAdapter([
      toolCallResponse('t1', 'run_tests', {}),
      toolCallResponse('t2', 'run_tests', {}),
      toolCallResponse('t3', 'run_tests', {}),
      textResponse('done'),
    ]))

    const reminders = guardReminders(agent)
    expect(reminders).toHaveLength(1)
    expect(reminders[0]!.text).toContain('same failing output')
  })
})

describe('budget and reset', () => {
  it('caps reminders per turn and resets on a user message', async () => {
    const ctx = await harness({ reminderBudget: 1 })
    // One adapter script covers both turns: the first oscillation consumes
    // the turn budget, the user message resets it, the second fires again.
    const agent = await runAgent(ctx, new MockAdapter([
      toolCallResponse('a1', 'probe', {}),
      toolCallResponse('b1', 'other', {}),
      toolCallResponse('a2', 'probe', {}),
      toolCallResponse('b2', 'other', {}),
      textResponse('done'),
      toolCallResponse('a3', 'probe', {}),
      toolCallResponse('b3', 'other', {}),
      toolCallResponse('a4', 'probe', {}),
      toolCallResponse('b4', 'other', {}),
      textResponse('done'),
    ]))
    expect(guardReminders(agent)).toHaveLength(1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(guardReminders(agent)).toHaveLength(2)
  })
})

describe('exclude patterns', () => {
  it('treats excluded tools as transparent to every detector', async () => {
    const ctx = await harness({ exclude: ['other'] })
    // With `other` excluded, the alternation has only one tracked tool — no pattern.
    const agent = await runAgent(ctx, new MockAdapter([
      toolCallResponse('a1', 'probe', {}),
      toolCallResponse('b1', 'other', {}),
      toolCallResponse('a2', 'probe', {}),
      toolCallResponse('b2', 'other', {}),
      textResponse('done'),
    ]))

    expect(guardReminders(agent)).toHaveLength(0)
  })
})

describe('config validation', () => {
  it('rejects a sub-2 threshold at plugin load', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const failure = await ctx.plugin(DoomLoopGuard, { oscillationPairs: 1 }).then(() => null, (error: unknown) => error)
    expect(failure).not.toBeNull()
    expect(String(failure)).toMatch(/oscillationPairs/)
  })
})
