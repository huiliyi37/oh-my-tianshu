/**
 * Full-loop integration: a scripted mock model drives the REAL task-card
 * plugin through the agent loop — the first-message rewrite at agent/pre-step,
 * the rewritten message landing in the session log, and every short-circuit
 * (non-first, over-long, already-carded, subagent, disabled, resume). Only the
 * model is mocked; the loop, the session log, and the plugin are real. In llm
 * mode the card call consumes the mock script's first entry (it streams
 * through the same llm service) and the main agent takes the second.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import LlmService, { createUserMessage } from '@huiliyi37/dsh-llm'
import type { Message } from '@huiliyi37/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import ToolRegistry, { defineContentToolFixture } from '@huiliyi37/dsh-tools'
import AgentRegistry, { type Agent } from '@huiliyi37/dsh-agent'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import TaskCardService, { type TaskCardConfig } from '@huiliyi37/dsh-task-card'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const ORIGINAL = 'fix the login flow in src/auth.ts'
const ORIGINAL_MARKER = '—— 原始请求 ——'

/** Template mode by default: deterministic, does not touch the mock script. */
const BASE_CONFIG: TaskCardConfig = { mode: 'template' }

async function harness(adapter: MockAdapter, config: TaskCardConfig = BASE_CONFIG): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmService)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TaskCardService, config)
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'probe',
    description: 'test tool probe',
    parameters: {},
    execute: () => Promise.resolve([{ type: 'text', text: 'ran probe' }]),
  }))
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

function textOf(message: Message | undefined): string {
  if (message === undefined) return ''
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

function userMessages(log: readonly SessionEvent[]): string[] {
  return log
    .filter(event => event.type === 'user/message')
    .map(event => event.type === 'user/message' ? textOf(event.data) : '')
}

describe('task-card through the agent loop', () => {
  it('rewrites the first user message: the model sees the card and the log holds it with the verbatim original', async () => {
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('tc-first'), { provider: 'mock', model: 'mock' })

    ask(agent, ORIGINAL)
    await waitForIdle(ctx, agent)

    const modelText = textOf(adapter.requests[0]?.messages[0])
    expect(modelText).toContain('# fix the login flow in src/auth.ts')
    expect(modelText).toContain('## 目标')
    expect(modelText).toContain(ORIGINAL_MARKER)
    expect(modelText).toContain(ORIGINAL)

    const logged = userMessages(agent.session.events)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toBe(modelText)
    expect(logged[0]).toContain(ORIGINAL)
  })

  it('leaves the second message untouched (first-message only)', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('tc-second'), { provider: 'mock', model: 'mock' })

    ask(agent, ORIGINAL)
    await waitForIdle(ctx, agent)
    ask(agent, 'what is the token lifetime?')
    await waitForIdle(ctx, agent)

    const logged = userMessages(agent.session.events)
    expect(logged).toHaveLength(2)
    expect(logged[0]).toContain(ORIGINAL_MARKER)
    expect(logged[1]).toBe('what is the token lifetime?')
  })

  it('leaves an over-long first message untouched', async () => {
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await harness(adapter, { mode: 'template', maxInputChars: 3 })
    const agent = ctx.agentLoop.create(SessionId('tc-long'), { provider: 'mock', model: 'mock' })

    ask(agent, ORIGINAL)
    await waitForIdle(ctx, agent)

    const modelText = textOf(adapter.requests[0]?.messages[0])
    expect(modelText).toBe(ORIGINAL)
    expect(userMessages(agent.session.events)).toEqual([ORIGINAL])
  })

  it('enabled: false mounts the service with no behavior', async () => {
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await harness(adapter, { mode: 'template', enabled: false })
    const agent = ctx.agentLoop.create(SessionId('tc-disabled'), { provider: 'mock', model: 'mock' })

    ask(agent, ORIGINAL)
    await waitForIdle(ctx, agent)

    const modelText = textOf(adapter.requests[0]?.messages[0])
    expect(modelText).toBe(ORIGINAL)
    expect(userMessages(agent.session.events)).toEqual([ORIGINAL])
  })

  it('a resume seed that already holds a user message is never rewritten', async () => {
    const adapter = new MockAdapter([textResponse('resumed')])
    const ctx = await harness(adapter)
    const seed: SessionEvent[] = [
      {
        type: 'user/message',
        seq: 0,
        time: 1,
        surfaceOp: 'append',
        data: createUserMessage({ content: [{ type: 'text', text: 'earlier work' }], source: { kind: 'user' } }),
      },
    ]
    const { agent } = await ctx.agents.create({
      sessionId: SessionId('tc-resume'),
      seed,
      agentOptions: { provider: 'mock', model: 'mock' },
    })

    ask(agent, 'continue the earlier work')
    await waitForIdle(ctx, agent)

    const messages = adapter.requests[0]?.messages ?? []
    // The seed's earlier message is part of the derived history; the new ask
    // is the last message and must NOT carry a card (first-message-only).
    const modelText = textOf(messages.at(-1))
    expect(modelText).toBe('continue the earlier work')
    expect(modelText).not.toContain(ORIGINAL_MARKER)
    expect(messages).toHaveLength(2)
  })

  it('subagent sessions (parentSession) never rewrite', async () => {
    const adapter = new MockAdapter([textResponse('subagent reply')])
    const ctx = await harness(adapter)
    const { agent } = await ctx.agents.create({
      sessionId: SessionId('tc-subagent'),
      meta: { parentSession: SessionId('tc-parent'), origin: 'subagent', delegationDepth: 1 },
      agentOptions: { provider: 'mock', model: 'mock' },
    })

    ask(agent, 'delegated task')
    await waitForIdle(ctx, agent)

    const modelText = textOf(adapter.requests[0]?.messages[0])
    expect(modelText).toBe('delegated task')
  })

  it('llm mode: a contract-valid card from the model is used', async () => {
    const card = [
      '# 修复登录流程',
      '',
      '## 目标',
      '重写 src/auth.ts 的登录逻辑。',
      '',
      '## 约束',
      '- 不改变 API 签名',
    ].join('\n')
    const adapter = new MockAdapter([
      textResponse(card), // card call (consumes script[0])
      textResponse('done'), // main agent (script[1])
    ])
    const ctx = await harness(adapter, { mode: 'llm', provider: 'mock', model: 'mock' })
    const agent = ctx.agentLoop.create(SessionId('tc-llm'), { provider: 'mock', model: 'mock' })

    ask(agent, ORIGINAL)
    await waitForIdle(ctx, agent)

    // The card call carried the contract prompt.
    expect(adapter.requests[0]?.system).toContain('structured task card')
    const cardBlock = adapter.requests[0]?.messages[0]?.content[0]
    expect(cardBlock?.type === 'text' && (cardBlock as { text?: string }).text).toBe(ORIGINAL)

    // The main agent saw the rendered card with the verbatim original.
    const modelText = textOf(adapter.requests[1]?.messages[0])
    expect(modelText).toContain('# 修复登录流程')
    expect(modelText).toContain('不改变 API 签名')
    expect(modelText).toContain(ORIGINAL_MARKER)
    expect(modelText).toContain(ORIGINAL)
    expect(userMessages(agent.session.events)).toEqual([modelText])
  })

  it('llm mode: a contract miss falls back to the semantic template', async () => {
    const adapter = new MockAdapter([
      textResponse('not a card'), // card call → parseLlmCard undefined
      textResponse('done'),
    ])
    const ctx = await harness(adapter, { mode: 'llm', provider: 'mock', model: 'mock' })
    const agent = ctx.agentLoop.create(SessionId('tc-llm-fallback'), { provider: 'mock', model: 'mock' })

    ask(agent, ORIGINAL)
    await waitForIdle(ctx, agent)

    const modelText = textOf(adapter.requests[1]?.messages[0])
    expect(modelText).toContain(`# ${ORIGINAL.split('\n')[0]}`)
    expect(modelText).toContain(ORIGINAL_MARKER)
    expect(modelText).toContain(ORIGINAL)
  })

  it('llm mode without a provider/model pair fails loud at plugin load', async () => {
    const adapter = new MockAdapter([])
    await expect(harness(adapter, { mode: 'llm' })).rejects.toThrow(/provider\/model/)
  })
})
