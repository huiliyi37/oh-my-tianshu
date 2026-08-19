/**
 * Full-loop integration: a scripted mock model drives the REAL zen plugin
 * through the agent loop — arming at agent/created, the anchored first
 * request/header (the model-visible face snapshot), the three promotion
 * predicates, and the fail-loud face misconfiguration veto. Only the model is
 * mocked; the loop, the session log, and the plugin are real.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import LlmService, { createUserMessage } from '@huiliyi37/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import ToolRegistry, { defineContentToolFixture } from '@huiliyi37/dsh-tools'
import AgentRegistry, { type Agent } from '@huiliyi37/dsh-agent'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import ZenPhaseService, { foldZenPhase, type ZenConfig } from '@huiliyi37/dsh-zen'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const SECTION = 'Test zen guidance.'
/** Triage off by default so multi-step scripts stay in the zen phase. */
const BASE_CONFIG: ZenConfig = { section: SECTION, face: ['probe'], triage: { enabled: false } }

async function harness(adapter: MockAdapter, config: ZenConfig = BASE_CONFIG): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmService)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ZenPhaseService, config)
  ctx.llm.registerAdapter(['mock'], adapter)
  for (const name of ['probe', 'hammer']) {
    ctx.tools.register(defineContentToolFixture({
      name,
      description: `test tool ${name}`,
      parameters: {},
      execute: () => Promise.resolve([{ type: 'text', text: `ran ${name}` }]),
    }))
  }
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function ask(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function zenPhases(log: readonly SessionEvent[]): Array<{ phase: string; reason: string }> {
  return log
    .filter(event => event.type === 'zen/phase')
    .map(event => event.type === 'zen/phase' ? event.data : { phase: '', reason: '' })
}

function headerFaces(log: readonly SessionEvent[]): Array<{ reason: string; tools: string[] }> {
  return log
    .filter(event => event.type === 'request/header')
    .map(event => event.type === 'request/header'
      ? { reason: event.data.reason, tools: (event.data.header.tools ?? []).map(tool => tool.name).sort() }
      : { reason: '', tools: [] })
}

describe('zen phase through the agent loop', () => {
  it('arms a fresh session: the FIRST header carries the anchored face and the zen section', async () => {
    const adapter = new MockAdapter([textResponse('thinking on the anchored face')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('zen-first-header'), { provider: 'mock', model: 'mock' })

    ask(agent, 'multi-step task: refactor the thing\nacross files')
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    expect(zenPhases(log)).toEqual([{ phase: 'zen', reason: 'arm' }])
    const headers = headerFaces(log)
    expect(headers).toEqual([{ reason: 'initial', tools: ['probe', 'zen_anchor'] }])
    expect(adapter.requests[0]?.system).toContain(SECTION)
    const arm = log.find(event => event.type === 'zen/phase')
    const header = log.find(event => event.type === 'request/header')
    expect(arm !== undefined && header !== undefined && arm.seq < header.seq).toBe(true)
  })

  it('a verified anchor promotes: restriction lifts, the header changes to the full face, the section unloads', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}, 'Probing a landmark.'),
      toolCallResponse('c2', 'zen_anchor', { goal: 'refactor the thing', landmarks: ['src/a.ts', 'pnpm test'], pass: 'full' }),
      toolCallResponse('c3', 'hammer', {}),
      textResponse('done on the full face'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('zen-anchor-promote'), { provider: 'mock', model: 'mock' })

    ask(agent, 'multi-step task: refactor the thing\nacross files')
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    expect(zenPhases(log)).toEqual([
      { phase: 'zen', reason: 'arm' },
      { phase: 'full', reason: 'anchor' },
    ])
    const headers = headerFaces(log)
    expect(headers[0]).toEqual({ reason: 'initial', tools: ['probe', 'zen_anchor'] })
    expect(headers.at(-1)).toEqual({ reason: 'change', tools: ['hammer', 'probe', 'zen_anchor'] })
    // The anchor result itself succeeded, and the post-promotion hammer ran.
    const results = log.filter(event => event.type === 'tool/result')
    expect(results.map(event => event.type === 'tool/result' ? event.data.message.content[0]?.isError ?? false : true))
      .toEqual([false, false, false])
    expect(adapter.requests.at(-1)?.system).not.toContain(SECTION)
    expect(foldZenPhase(log)).toBe('full')
  })

  it('a bare anchor without evidence is rejected back to the model and the phase stays zen', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'zen_anchor', { goal: 'jump ahead', landmarks: ['a', 'b'], pass: 'fast' }),
      textResponse('acknowledged the rejection'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('zen-bare-anchor'), { provider: 'mock', model: 'mock' })

    ask(agent, 'multi-step task: refactor the thing\nacross files')
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    const result = log.find(event => event.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.message.content[0]?.isError).toBe(true)
    expect(JSON.stringify(result?.type === 'tool/result' ? result.data.message.content[0] : {})).toContain('read-only probe')
    expect(zenPhases(log)).toEqual([{ phase: 'zen', reason: 'arm' }])
    expect(headerFaces(log)).toEqual([{ reason: 'initial', tools: ['probe', 'zen_anchor'] }])
  })

  it('a non-face tool call during the zen phase is denied while the restriction holds', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'hammer', {}),
      textResponse('acknowledged the denial'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('zen-denied-tool'), { provider: 'mock', model: 'mock' })

    ask(agent, 'multi-step task: refactor the thing\nacross files')
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    const result = log.find(event => event.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.message.content[0]?.isError).toBe(true)
    // The denial names the exact callable set so the model knows what to use instead.
    const text = result?.type === 'tool/result' ? JSON.stringify(result.data.message.content) : ''
    expect(text).toContain('Callable now: probe, zen_anchor')
    expect(foldZenPhase(log)).toBe('zen')
  })

  it('the zen section names exactly the callable face while zen is active', async () => {
    const adapter = new MockAdapter([textResponse('reading the section')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('zen-face-inventory'), { provider: 'mock', model: 'mock' })

    ask(agent, 'multi-step task: refactor the thing\nacross files')
    await waitForIdle(ctx, agent)

    const system = adapter.requests[0]?.system ?? ''
    expect(system).toContain(SECTION)
    expect(system).toContain('Zen-phase callable tools: probe, zen_anchor')
  })

  it('the step budget promotes with a narrated notice; the unlock is visible on the following assembly', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      // The budget step itself still runs on the pre-promotion assembly
      // (assemble precedes the pre-step boundary), so the full face lands on
      // the step after it.
      toolCallResponse('c2', 'probe', {}),
      textResponse('continuing after the timeout unlock'),
    ])
    const ctx = await harness(adapter, { ...BASE_CONFIG, timeoutSteps: 2 })
    const agent = ctx.agentLoop.create(SessionId('zen-timeout'), { provider: 'mock', model: 'mock' })

    ask(agent, 'multi-step task: refactor the thing\nacross files')
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    expect(zenPhases(log)).toEqual([
      { phase: 'zen', reason: 'arm' },
      { phase: 'full', reason: 'timeout' },
    ])
    const narration = log.find(event => event.type === 'user/message' && event.data.source.kind === 'plugin')
    expect(narration?.type === 'user/message' && JSON.stringify(narration.data.content)).toContain('step budget')
    const headers = headerFaces(log)
    expect(headers[0]).toEqual({ reason: 'initial', tools: ['probe', 'zen_anchor'] })
    expect(headers.at(-1)).toEqual({ reason: 'change', tools: ['hammer', 'probe', 'zen_anchor'] })
  })

  it('zen_anchor on the final budget step resolves as a no-op success instead of a contradiction', async () => {
    // Promotion fires on the budget's final step, so a model that probes for
    // three steps and anchors on the fourth finds the phase already flipped;
    // the anchor must resolve as a benign success, not a misleading error.
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      toolCallResponse('c2', 'probe', {}),
      toolCallResponse('c3', 'probe', {}),
      toolCallResponse('c4', 'zen_anchor', { goal: 'refactor', landmarks: ['a', 'b'], pass: 'full' }, 'anchoring on the last budget step'),
      textResponse('done'),
    ])
    const ctx = await harness(adapter, { ...BASE_CONFIG, timeoutSteps: 4 })
    const agent = ctx.agentLoop.create(SessionId('zen-budget-anchor'), { provider: 'mock', model: 'mock' })

    ask(agent, 'multi-step task: refactor the thing\nacross files')
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    expect(zenPhases(log)).toEqual([
      { phase: 'zen', reason: 'arm' },
      { phase: 'full', reason: 'timeout' },
    ])
    const anchor = log.find(event => event.type === 'tool/result' && event.data.message.source.callId === 'c4')
    expect(anchor?.type === 'tool/result' && anchor.data.message.content[0]?.isError).toBe(false)
    // The no-op did not re-log a promotion: the timeout flip is the only one.
    expect(zenPhases(log)).toEqual([
      { phase: 'zen', reason: 'arm' },
      { phase: 'full', reason: 'timeout' },
    ])
  })

  it('zen_anchor after triage resolves as a benign no-op success on the full face', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'zen_anchor', { goal: 'late anchor', landmarks: ['a', 'b'], pass: 'fast' }, 'anchoring late'),
      textResponse('proceeding on the full face'),
    ])
    const ctx = await harness(adapter, { section: SECTION, face: ['probe'], triage: { enabled: true, maxChars: 80 } })
    const agent = ctx.agentLoop.create(SessionId('zen-triage-anchor'), { provider: 'mock', model: 'mock' })

    ask(agent, 'quick task')
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    expect(zenPhases(log)).toEqual([
      { phase: 'zen', reason: 'arm' },
      { phase: 'full', reason: 'triage' },
    ])
    const anchor = log.find(event => event.type === 'tool/result')
    expect(anchor?.type === 'tool/result' && anchor.data.message.content[0]?.isError).toBe(false)
    // The anchor stays callable on the promoted face (stable registration).
    expect(headerFaces(log).at(-1)?.tools.includes('zen_anchor')).toBe(true)
  })

  it('triage promotes a trivially short first message before the first request', async () => {
    const adapter = new MockAdapter([textResponse('quick answer on the full face')])
    const ctx = await harness(adapter, { section: SECTION, face: ['probe'], triage: { enabled: true, maxChars: 80 } })
    const agent = ctx.agentLoop.create(SessionId('zen-triage'), { provider: 'mock', model: 'mock' })

    ask(agent, 'what time is it?')
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    expect(zenPhases(log)).toEqual([
      { phase: 'zen', reason: 'arm' },
      { phase: 'full', reason: 'triage' },
    ])
    expect(headerFaces(log)).toEqual([{ reason: 'initial', tools: ['hammer', 'probe', 'zen_anchor'] }])
    expect(adapter.requests[0]?.system).not.toContain(SECTION)
  })

  it('a face naming an unregistered tool vetoes agent creation loud', async () => {
    const adapter = new MockAdapter([])
    const ctx = await harness(adapter, { section: SECTION, face: ['nonexistent_tool'] })
    expect(() => ctx.agentLoop.create(SessionId('zen-misconfig'), { provider: 'mock', model: 'mock' }))
      .toThrow(/unknown global tool/)
  })

  it('promoteDeny naming an unregistered tool vetoes agent creation loud', async () => {
    const adapter = new MockAdapter([])
    const ctx = await harness(adapter, { ...BASE_CONFIG, promoteDeny: ['ghost'] })
    expect(() => ctx.agentLoop.create(SessionId('zen-promote-deny-misconfig'), { provider: 'mock', model: 'mock' }))
      .toThrow(/unknown global tool/)
  })

  it('subagent sessions (parentSession) never arm', async () => {
    const adapter = new MockAdapter([textResponse('subagent reply')])
    const ctx = await harness(adapter)
    const { agent } = await ctx.agents.create({
      sessionId: SessionId('zen-subagent'),
      meta: { parentSession: SessionId('zen-parent'), origin: 'subagent', delegationDepth: 1 },
      agentOptions: { provider: 'mock', model: 'mock' },
    })

    ask(agent, 'delegated multi-step task\nwith detail')
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    expect(zenPhases(log)).toEqual([])
    expect(headerFaces(log)).toEqual([{ reason: 'initial', tools: ['hammer', 'probe'] }])
    expect(adapter.requests[0]?.system).not.toContain(SECTION)
  })

  it('a seed already armed reinstalls the face without re-arming; a promoted seed keeps the full face', async () => {
    const armed = new MockAdapter([textResponse('resumed in zen')])
    const armedCtx = await harness(armed)
    const armedSeed: SessionEvent[] = [
      { type: 'zen/phase', seq: 0, time: 1, data: { phase: 'zen', reason: 'arm' } } as SessionEvent,
    ]
    const { agent: armedAgent } = await armedCtx.agents.create({
      sessionId: SessionId('zen-seed-armed'),
      seed: armedSeed,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    ask(armedAgent, 'continue the multi-step task\nfrom the fork')
    await waitForIdle(armedCtx, armedAgent)
    expect(zenPhases(armedAgent.session.events)).toEqual([{ phase: 'zen', reason: 'arm' }])
    expect(headerFaces(armedAgent.session.events)).toEqual([{ reason: 'initial', tools: ['probe', 'zen_anchor'] }])

    const promoted = new MockAdapter([textResponse('resumed promoted')])
    const promotedCtx = await harness(promoted)
    const promotedSeed: SessionEvent[] = [
      { type: 'zen/phase', seq: 0, time: 1, data: { phase: 'zen', reason: 'arm' } } as SessionEvent,
      { type: 'zen/phase', seq: 1, time: 2, data: { phase: 'full', reason: 'timeout' } } as SessionEvent,
    ]
    const { agent: promotedAgent } = await promotedCtx.agents.create({
      sessionId: SessionId('zen-seed-promoted'),
      seed: promotedSeed,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    ask(promotedAgent, 'continue the multi-step task\nfrom the fork')
    await waitForIdle(promotedCtx, promotedAgent)
    expect(zenPhases(promotedAgent.session.events)).toEqual([
      { phase: 'zen', reason: 'arm' },
      { phase: 'full', reason: 'timeout' },
    ])
    expect(headerFaces(promotedAgent.session.events)).toEqual([{ reason: 'initial', tools: ['hammer', 'probe', 'zen_anchor'] }])
  })

  it('enabled: false mounts the service with no behavior', async () => {
    const adapter = new MockAdapter([textResponse('plain run')])
    const ctx = await harness(adapter, { ...BASE_CONFIG, enabled: false })
    const agent = ctx.agentLoop.create(SessionId('zen-disabled'), { provider: 'mock', model: 'mock' })

    ask(agent, 'multi-step task: refactor the thing\nacross files')
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    expect(zenPhases(log)).toEqual([])
    expect(headerFaces(log)).toEqual([{ reason: 'initial', tools: ['hammer', 'probe'] }])
    expect(adapter.requests[0]?.system).not.toContain(SECTION)
  })

  it('faceSelection freezes extras onto the first header and never promotes', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      toolCallResponse('c2', 'probe', {}),
      textResponse('still on the selected face'),
    ])
    const ctx = await harness(adapter, {
      ...BASE_CONFIG,
      faceSelection: { enabled: true },
      timeoutSteps: 2,
    })
    ctx.tools.register(defineContentToolFixture({
      name: 'subagent',
      description: 'delegate',
      parameters: {},
      execute: () => Promise.resolve([{ type: 'text', text: 'ok' }]),
    }))
    const agent = ctx.agentLoop.create(SessionId('zen-oneshot'), { provider: 'mock', model: 'mock' })

    ask(agent, 'Please delegate this exploration to a subagent.\nIt spans several files.')
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    expect(zenPhases(log)).toEqual([{ phase: 'zen', reason: 'arm' }])
    const headers = headerFaces(log)
    expect(headers[0]).toEqual({ reason: 'initial', tools: ['probe', 'subagent', 'zen_anchor'] })
    expect(headers.every(header => !header.tools.includes('hammer'))).toBe(true)
    expect(foldZenPhase(log)).toBe('zen')
  })

  it('faceSelection drops extras the deployment did not register', async () => {
    const adapter = new MockAdapter([textResponse('no lsp here')])
    const ctx = await harness(adapter, { ...BASE_CONFIG, faceSelection: { enabled: true } })
    const agent = ctx.agentLoop.create(SessionId('zen-oneshot-drop'), { provider: 'mock', model: 'mock' })

    ask(agent, 'Please use the language server to go to definition.\nThen edit the caller.')
    await waitForIdle(ctx, agent)

    expect(headerFaces(agent.session.events)).toEqual([
      { reason: 'initial', tools: ['probe', 'zen_anchor'] },
    ])
  })

  it('diet clips assembled descriptions without changing the registered catalog', async () => {
    const adapter = new MockAdapter([textResponse('dieted')])
    const ctx = await harness(adapter, { ...BASE_CONFIG, diet: { maxDescriptionChars: 8 } })
    const agent = ctx.agentLoop.create(SessionId('zen-diet'), { provider: 'mock', model: 'mock' })

    ask(agent, 'multi-step task: refactor the thing\nacross files')
    await waitForIdle(ctx, agent)

    expect(adapter.requests[0]?.tools?.map(tool => [tool.name, tool.description])).toEqual([
      ['probe', 'test'],
      ['zen_anchor', 'Use'],
    ])
    expect(ctx.tools.schemas().find(schema => schema.name === 'probe')?.description).toBe('test tool probe')
  })

  it('promoteDeny hides the overlapping tool after promotion and on promoted resume', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}, 'Probing a landmark.'),
      toolCallResponse('c2', 'zen_anchor', { goal: 'refactor the thing', landmarks: ['src/a.ts', 'pnpm test'], pass: 'full' }),
      toolCallResponse('c3', 'hammer', {}),
      textResponse('done on the curated face'),
    ])
    const ctx = await harness(adapter, { ...BASE_CONFIG, promoteDeny: ['hammer'] })
    const agent = ctx.agentLoop.create(SessionId('zen-promote-deny'), { provider: 'mock', model: 'mock' })

    ask(agent, 'multi-step task: refactor the thing\nacross files')
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    expect(zenPhases(log)).toEqual([
      { phase: 'zen', reason: 'arm' },
      { phase: 'full', reason: 'anchor' },
    ])
    const headers = headerFaces(log)
    expect(headers[0]).toEqual({ reason: 'initial', tools: ['probe', 'zen_anchor'] })
    expect(headers.at(-1)).toEqual({ reason: 'change', tools: ['probe', 'zen_anchor'] })
    const results = log.filter(event => event.type === 'tool/result')
    expect(results.map(event => event.type === 'tool/result' ? event.data.message.content[0]?.isError ?? false : true))
      .toEqual([false, false, true])

    const resumed = new MockAdapter([textResponse('resumed curated')])
    const resumedCtx = await harness(resumed, { ...BASE_CONFIG, promoteDeny: ['hammer'] })
    const seed: SessionEvent[] = [
      { type: 'zen/phase', seq: 0, time: 1, data: { phase: 'zen', reason: 'arm' } } as SessionEvent,
      { type: 'zen/phase', seq: 1, time: 2, data: { phase: 'full', reason: 'anchor' } } as SessionEvent,
    ]
    const { agent: resumedAgent } = await resumedCtx.agents.create({
      sessionId: SessionId('zen-promote-deny-resume'),
      seed,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    ask(resumedAgent, 'continue the multi-step task\nfrom the fork')
    await waitForIdle(resumedCtx, resumedAgent)
    expect(headerFaces(resumedAgent.session.events)).toEqual([{ reason: 'initial', tools: ['probe', 'zen_anchor'] }])
  })

  it('triage with promoteDeny never exposes the overlapping tool', async () => {
    const adapter = new MockAdapter([textResponse('quick answer on the curated face')])
    const ctx = await harness(adapter, {
      section: SECTION,
      face: ['probe'],
      triage: { enabled: true, maxChars: 80 },
      promoteDeny: ['hammer'],
    })
    const agent = ctx.agentLoop.create(SessionId('zen-triage-deny'), { provider: 'mock', model: 'mock' })

    ask(agent, 'what time is it?')
    await waitForIdle(ctx, agent)

    expect(zenPhases(agent.session.events)).toEqual([
      { phase: 'zen', reason: 'arm' },
      { phase: 'full', reason: 'triage' },
    ])
    expect(headerFaces(agent.session.events)).toEqual([{ reason: 'initial', tools: ['probe', 'zen_anchor'] }])
  })
})
