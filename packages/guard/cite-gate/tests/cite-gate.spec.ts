import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import { SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import { defineContentToolFixture } from '@huiliyi37/dsh-tools'
import type { Agent } from '@huiliyi37/dsh-agent'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import * as CiteGate from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { extractAssistantText, normalizePath, scanText, type Vocabulary } from '../src/scan.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

const VOCAB: Vocabulary = {
  schemaVersion: 1,
  cardIds: ['DSH-0.1.2-A1-25', 'DSH-0.1.2-A2-02'],
  recipeIds: ['R-08'],
  legacyCodes: ['cancelled', 'session-not-found'],
  namespacedCodes: ['gateway/cancelled', 'session/not-found'],
}

const ALL_ON: Parameters<typeof scanText>[3] = { cardCheck: true, legacyCodeCheck: true, namespacedCodeCheck: true, pathCheck: true }

describe('scanText (pure)', () => {
  it('flags fabricated card IDs and passes known ones', () => {
    const findings = scanText('见 DSH-0.1.2-A9-99 与 DSH-0.1.2-A1-25', VOCAB, new Set(), ALL_ON)
    const cards = findings.filter(f => f.kind === 'unknown-card')
    expect(cards).toEqual([{ kind: 'unknown-card', id: 'DSH-0.1.2-A9-99' }])
  })

  it('flags legacy error codes and passes namespaced ones', () => {
    const findings = scanText('老码 cancelled / session-not-found；新码 gateway/cancelled', VOCAB, new Set(), ALL_ON)
    expect(findings.filter(f => f.kind === 'legacy-code').map(f => 'code' in f ? f.code : '')).toEqual(['cancelled', 'session-not-found'])
  })

  it('flags unknown namespaced codes only when the gate is on', () => {
    const on = scanText('错误码 gateway/banana', VOCAB, new Set(), ALL_ON)
    expect(on.filter(f => f.kind === 'unknown-namespaced-code')).toEqual([{ kind: 'unknown-namespaced-code', code: 'gateway/banana' }])
    const off = scanText('错误码 gateway/banana', VOCAB, new Set(), { ...ALL_ON, namespacedCodeCheck: false })
    expect(off).toEqual([])
  })

  it('flags unread paths, passes seen and noise paths', () => {
    const seen = new Set(['notes/read.md'])
    const findings = scanText('见 notes/unread.md 和 notes/read.md，https://x.io/a.md 与 /usr/lib/x.ts', VOCAB, seen, ALL_ON)
    expect(findings.filter(f => f.kind === 'unread-path').map(f => 'path' in f ? f.path : '')).toEqual(['notes/unread.md'])
  })

  it('extracts text from assembled messages and normalizes tool paths', () => {
    const text = extractAssistantText({
      role: 'assistant',
      content: [{ type: 'text', text: '见 DSH-0.1.2-A1-25 迁移。' }],
      source: { kind: 'model' },
    } as never)
    expect(text).toBe('见 DSH-0.1.2-A1-25 迁移。')
    expect(normalizePath('./notes/a.md')).toBe('notes/a.md')
  })
})

describe('cite-gate (harness)', () => {
  async function harness(config: Config = {}): Promise<Context> {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(CiteGate, config)
    ctx.tools.register(defineContentToolFixture({ name: 'read', description: 'r', parameters: { path: { type: 'string' } }, async execute() { return [{ type: 'text', text: 'content of the file' }] } }))
    return ctx
  }

  function guardReminders(agent: Agent): { text: string; source: unknown }[] {
    return [...agent.session.events]
      .filter((e): e is SessionEvent<'user/message'> =>
        e.type === 'user/message' && e.data.source.kind === 'plugin' && e.data.source.plugin === 'cite-gate')
      .map(e => ({
        text: e.data.content.map(block => block.type === 'text' ? block.text : '').join('|'),
        source: e.data.source,
      }))
  }

  async function runAgent(ctx: Context, adapter: MockAdapter, turns = 1): Promise<Agent> {
    ctx.llm.registerAdapter(['mock-provider'], adapter)
    const agent = ctx.agentLoop.create(SessionId(`cite-${Math.random().toString(36).slice(2)}`), { provider: 'mock-provider', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    // Injected notices are claimed at the next pre-step; a second turn makes
    // them durable user/message events the assertion can read.
    for (let i = 1; i < turns; i += 1) {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
    }
    return agent
  }

  it('injects notices for a fabricated card and an unread path', async () => {
    const ctx = await harness()
    const agent = await runAgent(ctx, new MockAdapter([
      textResponse('按 DSH-0.1.2-A9-99 迁移，改动见 notes/never-read.md。'),
      textResponse('ok'),
    ]), 2)

    const reminders = guardReminders(agent)
    expect(reminders).toHaveLength(2)
    expect(reminders.some(r => r.text.includes('DSH-0.1.2-A9-99'))).toBe(true)
    expect(reminders.some(r => r.text.includes('notes/never-read.md'))).toBe(true)
    expect(reminders.every(r => (r.source as { form?: string }).form === 'notice')).toBe(true)
  })

  it('does not remind for a path the session actually read', async () => {
    const ctx = await harness()
    const agent = await runAgent(ctx, new MockAdapter([
      toolCallResponse('r1', 'read', { path: 'notes/read.md' }),
      textResponse('按 DSH-0.1.2-A9-99 迁移，改动见 notes/read.md。'),
      textResponse('ok'),
    ]), 2)

    const reminders = guardReminders(agent)
    expect(reminders).toHaveLength(1)
    expect(reminders[0]!.text).toContain('DSH-0.1.2-A9-99')
  })

  it('respects the reminder budget and stays silent when disabled', async () => {
    const ctx = await harness({ reminderBudget: 1 })
    const agent = await runAgent(ctx, new MockAdapter([
      textResponse('按 DSH-0.1.2-A9-99 迁移，另见 DSH-0.1.2-A8-88 和 notes/a.md、notes/b.md。'),
      textResponse('ok'),
    ]), 2)
    expect(guardReminders(agent)).toHaveLength(1)

    const off = await harness({ enabled: false })
    const quiet = await runAgent(off, new MockAdapter([
      textResponse('按 DSH-0.1.2-A9-99 迁移，改动见 notes/never-read.md。'),
      textResponse('ok'),
    ]), 2)
    expect(guardReminders(quiet)).toHaveLength(0)
  })
})
