/**
 * Full-loop integration: a scripted mock model drives the REAL intent-bridge
 * through the agent loop — the alignment session (seeded zen-full, restricted
 * to finalize_alignment) clarifies over multiple rounds, finalizes into a
 * task card, and hands off to a fresh main session whose first message is the
 * card: task-card stays idempotent, zen arms, and the main session sees the
 * anchored face. Only the model is mocked; the loop, sessions, zen, task-card,
 * and the bridge are real. The mock adapter registers three provider routes
 * (mock/minimax/deepseek-official) so both agents stream through it.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import LlmService, { CallId, createUserMessage, ReasoningEffortId } from '@huiliyi37/dsh-llm'
import type { UserMessage } from '@huiliyi37/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import ToolRegistry, { defineContentToolFixture } from '@huiliyi37/dsh-tools'
import AgentRegistry, { type Agent } from '@huiliyi37/dsh-agent'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import ZenPhaseService, { foldZenPhase } from '@huiliyi37/dsh-zen'
import TaskCardService from '@huiliyi37/dsh-task-card'
import IntentBridgeService, { type IntentBridgeConfig } from '../src/index.ts'
import { ALIGN_FACE_STATEMENT } from '../src/align.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const BASE_CONFIG: IntentBridgeConfig = {
  alignProvider: 'minimax',
  alignModel: 'MiniMax-M3',
  execProvider: 'deepseek-official',
  execModel: 'deepseek-v4-flash',
}

const testToolSignal = new AbortController().signal

async function harness(adapter: MockAdapter, config: IntentBridgeConfig = BASE_CONFIG): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmService)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ZenPhaseService, { section: 'Zen test guidance.', face: ['probe'] })
  await ctx.plugin(TaskCardService, { mode: 'template' })
  await ctx.plugin(IntentBridgeService, config)
  ctx.llm.registerAdapter(['mock', 'minimax', 'deepseek-official'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'probe',
    description: 'test tool probe',
    parameters: {},
    execute: () => Promise.resolve([{ type: 'text', text: 'ran probe' }]),
  }))
  return ctx
}

function waitForIdle(_ctx: Context, agent: Agent): Promise<void> {
  // whenIdle resolves immediately when already quiescent — unlike an
  // agent/status listener it cannot miss an idle that happened earlier.
  return agent.whenIdle()
}

function ask(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function textOf(message: UserMessage | undefined): string {
  if (message === undefined) return ''
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

function userMessages(log: readonly SessionEvent[]): string[] {
  return log
    .filter(event => event.type === 'user/message')
    .map(event => event.type === 'user/message' ? textOf(event.data) : '')
}

function zenPhases(log: readonly SessionEvent[]): Array<{ phase: string; reason: string }> {
  return log
    .filter(event => event.type === 'zen/phase')
    .map(event => event.type === 'zen/phase' ? event.data : { phase: '', reason: '' })
}

function headerTools(log: readonly SessionEvent[]): string[][] {
  return log
    .filter(event => event.type === 'request/header')
    .map(event => event.type === 'request/header'
      ? (event.data.header.tools ?? []).map(tool => tool.name).sort()
      : [])
}

describe('intent-bridge through the agent loop', () => {
  it('aligns over multiple rounds, hands off a task card, and the main session arms the zen phase', async () => {
    const adapter = new MockAdapter([
      textResponse('你希望具体重构哪些部分？'),
      toolCallResponse('f1', 'finalize_alignment', {
        title: '重构登录逻辑',
        goal: '重写 src/auth.ts 的登录流程，加入 refresh token 轮换。',
        constraints: ['不改变 API 签名'],
        acceptance: ['pnpm test 全绿'],
      }),
      textResponse('任务卡收到，开始执行。'),
    ])
    const ctx = await harness(adapter)
    let handoff: { alignSessionId: string; mainSessionId: string; title: string } | undefined
    ctx.on('intent-bridge/handoff', (payload) => { handoff = payload })

    const align = await ctx.intentBridge.createAlignedSession()
    const alignAgent = align.handle.agent
    ask(alignAgent, '帮我重构 src/auth.ts 的登录逻辑')
    await waitForIdle(ctx, alignAgent)
    ask(alignAgent, '改成支持 refresh token 轮换')
    await waitForIdle(ctx, alignAgent)

    // The alignment session never arms zen (seeded full) and only exposes
    // finalize (plus zen's agent-scoped zen_anchor, harmless outside zen).
    const alignLog = alignAgent.session.events
    expect(zenPhases(alignLog)).toEqual([
      { phase: 'zen', reason: 'arm' },
      { phase: 'full', reason: 'timeout' },
    ])
    expect(foldZenPhase(alignLog)).toBe('full')
    expect(headerTools(alignLog)[0]).toEqual(['finalize_alignment', 'zen_anchor'])

    // Handoff fired with the main session id and the card title.
    expect(handoff).toBeDefined()
    expect(handoff?.alignSessionId).toBe(align.sessionId)
    expect(handoff?.title).toBe('重构登录逻辑')

    // The main session received the rendered task card as its first message.
    const main = ctx.agents.get(SessionId(handoff!.mainSessionId))
    if (main === undefined) throw new Error('intent-bridge: main session missing after handoff')
    expect(main.options.reasoningEffort).toBeUndefined()
    await waitForIdle(ctx, main)
    const mainLog = main.session.events
    const firstUser = userMessages(mainLog)[0]
    expect(firstUser).toContain('# 重构登录逻辑')
    expect(firstUser).toContain('不改变 API 签名')
    expect(firstUser).toContain('—— 原始请求 ——')
    expect(firstUser).toContain('帮我重构 src/auth.ts 的登录逻辑')

    // The main session arms zen (fresh top-level session) on the anchored face.
    expect(zenPhases(mainLog)).toEqual([{ phase: 'zen', reason: 'arm' }])
    expect(headerTools(mainLog)[0]).toEqual(['probe', 'zen_anchor'])
    const lastBlock = adapter.requests.at(-1)?.messages[0]?.content[0]
    expect(lastBlock?.type === 'text' && (lastBlock as { text?: string }).text)
      .toContain('—— 原始请求 ——')
  })

  it('denies non-finalize calls in the alignment session with the face statement, not "unknown tool"', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('a1', 'bash', { command: 'ls' }, 'try bash'),
      toolCallResponse('a2', 'glob', { pattern: '**/*' }, 'try glob'),
      toolCallResponse('a3', 'zen_anchor', { goal: 'x', landmarks: ['a', 'b'], pass: 'fast' }, 'try anchor'),
      toolCallResponse('a4', 'finalize_alignment', { title: 'T', goal: 'G', acceptance: ['ok'] }, 'finalize'),
      textResponse('main response'),
    ])
    const ctx = await harness(adapter)
    const align = await ctx.intentBridge.createAlignedSession()
    const alignAgent = align.handle.agent
    ask(alignAgent, '帮我重构 src/auth.ts 的登录逻辑')
    await waitForIdle(ctx, alignAgent)

    const alignLog = alignAgent.session.events
    const calls = alignLog.filter(event => event.type === 'tool/call')
    const results = alignLog.filter(event => event.type === 'tool/result')
    const byCallId = new Map(
      calls.map(event => event.type === 'tool/call' ? [event.data.callId, event.data.name] : ['', '']),
    )
    const denied = results.filter((event) => {
      const d = event.type === 'tool/result' ? event.data : null
      return d?.message.content[0]?.isError === true && byCallId.get(String(d.message.source.callId)) !== 'finalize_alignment'
    })
    // Every non-finalize call (bash, glob, zen_anchor) is denied with the face statement.
    expect(denied).toHaveLength(3)
    const text = denied.map(event => event.type === 'tool/result' ? JSON.stringify(event.data.message.content) : '').join(' ')
    expect(text).toContain(ALIGN_FACE_STATEMENT)
    expect(text).not.toContain('unknown tool')
    // The contract section declares the same face statement to the model.
    expect(adapter.requests[0]?.system ?? '').toContain(ALIGN_FACE_STATEMENT)
  })

  it('removes the alignment guard when the plugin fiber is disposed (HMR safety)', async () => {
    const ctx = await harness(new MockAdapter([]))
    const align = await ctx.intentBridge.createAlignedSession()
    const alignAgent = align.handle.agent

    const callBash = async (callId: string): Promise<string> => {
      const result = await ctx.tools.execute({
        signal: testToolSignal,
        callId: CallId(callId),
        name: 'bash',
        arguments: { command: 'ls' },
        agent: alignAgent,
      })
      const first = result.content[0]
      return first?.type === 'text' ? first.text : JSON.stringify(result.content)
    }

    // The aligned session's face is locked: bash is denied with the face statement.
    expect(await callBash('hmr-1')).toContain(ALIGN_FACE_STATEMENT)

    const runtime = ctx.registry.get(IntentBridgeService)
    const [fiber] = runtime?.fibers ?? []
    if (fiber === undefined) throw new Error('intent-bridge: plugin fiber missing')
    await fiber.dispose()

    // With the guard disposed, bash falls through to the ordinary unknown-tool error.
    expect(await callBash('hmr-2')).toContain('unknown tool')
  })

  it('forces a template card when the alignment rounds are exhausted', async () => {
    const adapter = new MockAdapter([
      textResponse('问题一：目标范围？'),
      textResponse('问题二：约束？'),
      textResponse('主会话响应。'),
    ])
    const ctx = await harness(adapter, { ...BASE_CONFIG, alignMaxRounds: 2 })
    let handoff: { mainSessionId: string } | undefined
    ctx.on('intent-bridge/handoff', (payload) => { handoff = payload })

    const align = await ctx.intentBridge.createAlignedSession()
    const alignAgent = align.handle.agent
    ask(alignAgent, '帮我重构 src/auth.ts 的登录逻辑')
    await waitForIdle(ctx, alignAgent)
    ask(alignAgent, '支持 refresh token')
    await waitForIdle(ctx, alignAgent)
    ask(alignAgent, '还有问题吗？')
    await waitForIdle(ctx, alignAgent)

    expect(handoff).toBeDefined()
    const main = ctx.agents.get(SessionId(handoff!.mainSessionId))
    if (main === undefined) throw new Error('intent-bridge: main session missing after handoff')
    await waitForIdle(ctx, main)
    const firstUser = userMessages(main.session.events)[0]
    // Template card: title from the original first line, verbatim original kept.
    expect(firstUser).toContain('# 帮我重构 src/auth.ts 的登录逻辑')
    expect(firstUser).toContain('—— 原始请求 ——')
    expect(firstUser).toContain('帮我重构 src/auth.ts 的登录逻辑')
  })

  it('rejects a malformed finalize call back to the model and never creates a main session', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('f1', 'finalize_alignment', { title: '', goal: 'G' }),
      textResponse('我重新确认一下目标。'),
    ])
    const ctx = await harness(adapter)
    let handoff: unknown
    ctx.on('intent-bridge/handoff', (payload) => { handoff = payload })

    const align = await ctx.intentBridge.createAlignedSession()
    ask(align.handle.agent, '帮我重构 src/auth.ts 的登录逻辑')
    await waitForIdle(ctx, align.handle.agent)

    const log = align.handle.agent.session.events
    const result = log.find(event => event.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.message.content[0]?.isError).toBe(true)
    expect(JSON.stringify(result?.type === 'tool/result' ? result.data.message.content[0] : {}))
      .toContain('finalize_alignment: needs a non-empty `title`')
    expect(handoff).toBeUndefined()
  })

  it('honors per-call cwd and exec override on the alignment and main sessions', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('f1', 'finalize_alignment', {
        title: '重构登录逻辑',
        goal: '重写 src/auth.ts 的登录流程。',
        constraints: [],
        acceptance: [],
      }),
      textResponse('对齐完成。'),
      textResponse('主会话收到。'),
    ], {
      efforts: [
        { id: ReasoningEffortId('high'), name: 'High' },
        { id: ReasoningEffortId('max'), name: 'Max' },
      ],
      defaultEffort: ReasoningEffortId('high'),
    })
    const ctx = await harness(adapter)
    let handoff: { mainSessionId: string } | undefined
    ctx.on('intent-bridge/handoff', (payload) => { handoff = payload })

    const align = await ctx.intentBridge.createAlignedSession({
      // A real directory: the session boundary validates cwd existence.
      cwd: process.cwd(),
      // Distinct from the config exec route (deepseek-official/flash) so the
      // override is provable from the request stream.
      exec: { provider: 'mock', model: 'custom-model', reasoningEffort: ReasoningEffortId('max') },
    })
    ask(align.handle.agent, '帮我重构 src/auth.ts 的登录逻辑')
    await waitForIdle(ctx, align.handle.agent)

    // The alignment session's durable header carries the requested cwd.
    expect(align.handle.agent.session.header.cwd).toBe(process.cwd())

    // The main session used the per-call override, not the config exec route.
    expect(handoff).toBeDefined()
    const main = ctx.agents.get(SessionId(handoff!.mainSessionId))
    if (main === undefined) throw new Error('intent-bridge: main session missing after handoff')
    // The main session inherited the alignment's cwd — never `_no-cwd/`.
    expect(main.session.header.cwd).toBe(process.cwd())
    await waitForIdle(ctx, main)
    expect(main.options.reasoningEffort).toBe(ReasoningEffortId('max'))
    const mainRequest = adapter.requests.find(request => request.provider === 'mock')
    expect(mainRequest?.model).toBe('custom-model')
    expect(mainRequest?.reasoningEffort).toBe(ReasoningEffortId('max'))
    const mainHeader = main.session.events.find(event => event.type === 'request/header')
    expect(mainHeader?.type === 'request/header' && mainHeader.data.header.adapterDefaults?.reasoningEffort)
      .not.toBe(true)
    // The alignment request itself still used the config align route.
    expect(adapter.requests[0]?.provider).toBe('minimax')
    expect(adapter.requests[0]?.model).toBe('MiniMax-M3')
  })

  it('disabled: createAlignedSession fails loud and no alignment wiring exists', async () => {
    const adapter = new MockAdapter([])
    const ctx = await harness(adapter, { ...BASE_CONFIG, enabled: false })
    await expect(ctx.intentBridge.createAlignedSession()).rejects.toThrow(/disabled/)
  })

  it('retries a handoff whose main-session create failed', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('f1', 'finalize_alignment', { title: 'T', goal: 'G', constraints: [], acceptance: [] }),
      toolCallResponse('f2', 'finalize_alignment', { title: 'T', goal: 'G', constraints: [], acceptance: [] }),
      textResponse('主会话响应。'),
    ])
    const ctx = await harness(adapter)
    let handoff: { mainSessionId: string } | undefined
    ctx.on('intent-bridge/handoff', (payload) => { handoff = payload })

    const original = ctx.agents.create.bind(ctx.agents)
    let failedOnce = false
    vi.spyOn(ctx.agents, 'create').mockImplementation(async (options) => {
      if (options.sessionId.endsWith('-exec') && !failedOnce) {
        failedOnce = true
        throw new Error('injected create failure')
      }
      return original(options)
    })

    const align = await ctx.intentBridge.createAlignedSession()
    ask(align.handle.agent, '帮我重构 src/auth.ts 的登录逻辑')
    await waitForIdle(ctx, align.handle.agent)

    // The first attempt surfaced as a tool error and the model retried: the
    // alignment session stayed non-finalized until the retry succeeded.
    expect(failedOnce).toBe(true)
    expect(handoff).toBeDefined()
    const main = ctx.agents.get(SessionId(handoff!.mainSessionId))
    if (main === undefined) throw new Error('intent-bridge: main session missing after handoff')
    await waitForIdle(ctx, main)
    expect(userMessages(main.session.events)[0]).toContain('—— 原始请求 ——')
  })

  it('skips the error-fallback handoff while a handoff is already in flight', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('f1', 'finalize_alignment', { title: 'T', goal: 'G', constraints: [], acceptance: [] }),
      textResponse('主会话响应。'),
    ])
    const ctx = await harness(adapter)
    let handoff: { mainSessionId: string } | undefined
    ctx.on('intent-bridge/handoff', (payload) => { handoff = payload })

    const original = ctx.agents.create.bind(ctx.agents)
    const mainCreates: string[] = []
    let gate: { resolve: () => void } | undefined
    vi.spyOn(ctx.agents, 'create').mockImplementation((options) => {
      if (!options.sessionId.endsWith('-exec')) return original(options)
      mainCreates.push(options.sessionId)
      return new Promise((resolve, reject) => {
        gate = {
          resolve: () => { original(options).then(resolve, reject) },
        }
      })
    })

    const align = await ctx.intentBridge.createAlignedSession()
    ask(align.handle.agent, '帮我重构 src/auth.ts 的登录逻辑')
    // The finalize tool call runs while the main-session create is held open.
    await vi.waitFor(() => { expect(mainCreates).toHaveLength(1) })

    // The error fallback fires mid-handoff: the in-flight sentinel must skip it.
    const session = ctx.sessions.get(SessionId(align.sessionId))
    if (session === undefined) throw new Error('intent-bridge: alignment session missing')
    ctx.emit('internal/dispatch', 'emit', 'session/event', [session, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'error' } },
    }], undefined)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mainCreates).toHaveLength(1)

    // Release the held create; the handoff completes exactly once.
    if (gate === undefined) throw new Error('intent-bridge: held create never reached')
    gate.resolve()
    await waitForIdle(ctx, align.handle.agent)
    expect(handoff).toBeDefined()
    expect(mainCreates).toHaveLength(1)
  })

  it('disposes a main session whose card delivery failed and lets the model retry', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('f1', 'finalize_alignment', { title: 'T', goal: 'G', constraints: [], acceptance: [] }),
      toolCallResponse('f2', 'finalize_alignment', { title: 'T', goal: 'G', constraints: [], acceptance: [] }),
      textResponse('主会话响应。'),
    ])
    const ctx = await harness(adapter)
    let handoff: { mainSessionId: string } | undefined
    ctx.on('intent-bridge/handoff', (payload) => { handoff = payload })

    const original = ctx.agents.create.bind(ctx.agents)
    const abandoned: string[] = []
    vi.spyOn(ctx.agents, 'create').mockImplementation(async (options) => {
      const handle = await original(options)
      if (options.sessionId.endsWith('-exec') && abandoned.length === 0) {
        abandoned.push(options.sessionId)
        vi.spyOn(handle.agent, 'followup').mockImplementation(() => {
          throw new Error('injected delivery failure')
        })
      }
      return handle
    })

    const align = await ctx.intentBridge.createAlignedSession()
    ask(align.handle.agent, '帮我重构 src/auth.ts 的登录逻辑')
    await waitForIdle(ctx, align.handle.agent)

    expect(handoff).toBeDefined()
    // The card-less first main session was disposed; the retry minted a fresh one.
    if (abandoned[0] === undefined) throw new Error('intent-bridge: delivery sabotage never triggered')
    expect(ctx.agents.get(SessionId(abandoned[0]))).toBeUndefined()
    const main = ctx.agents.get(SessionId(handoff!.mainSessionId))
    if (main === undefined) throw new Error('intent-bridge: main session missing after handoff')
    await waitForIdle(ctx, main)
    expect(userMessages(main.session.events)[0]).toContain('—— 原始请求 ——')
  })
})
