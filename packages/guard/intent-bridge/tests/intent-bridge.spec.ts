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

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import LlmService, { createUserMessage } from '@huiliyi37/dsh-llm'
import type { UserMessage } from '@huiliyi37/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import ToolRegistry, { defineContentToolFixture } from '@huiliyi37/dsh-tools'
import AgentRegistry, { type Agent } from '@huiliyi37/dsh-agent'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import ZenPhaseService, { foldZenPhase } from '@huiliyi37/dsh-zen'
import TaskCardService from '@huiliyi37/dsh-task-card'
import IntentBridgeService, { type IntentBridgeConfig } from '@huiliyi37/dsh-intent-bridge'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const BASE_CONFIG: IntentBridgeConfig = {
  alignProvider: 'minimax',
  alignModel: 'MiniMax-M3',
  execProvider: 'deepseek-official',
  execModel: 'deepseek-v4-flash',
}

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
    expect(adapter.requests.at(-1)?.messages[0].content[0].type === 'text'
      && adapter.requests.at(-1)!.messages[0].content[0].text).toContain('—— 原始请求 ——')
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

  it('disabled: createAlignedSession fails loud and no alignment wiring exists', async () => {
    const adapter = new MockAdapter([])
    const ctx = await harness(adapter, { ...BASE_CONFIG, enabled: false })
    await expect(ctx.intentBridge.createAlignedSession()).rejects.toThrow(/disabled/)
  })
})
