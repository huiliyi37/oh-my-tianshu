import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { createUserMessage, CallId  } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as ToolCordis from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { call, REVERSE_TOOL_CODE, setup, text } from './helpers.ts'

/**
 * Full-loop integration: a scripted mock model mounts a plugin that registers
 * a NEW tool, calls that tool on the very next step (tool schemas are
 * reassembled per step — the real loop proves the self-extension contract),
 * and unmounts it again. Only the model is mocked; the sandbox, the fiber
 * tree, and the session log are real.
 */

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolCordis)
  ctx.llm.registerAdapter(['mock'], adapter)
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

describe('cordis tools through the agent loop', () => {
  it('mounts a tool, calls it on the next step, and unmounts it — all as real tool/call events', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'cordis_mount', { code: REVERSE_TOOL_CODE }, 'Extending myself.'),
      toolCallResponse('call-2', 'reverse_text', { text: 'harness' }),
      toolCallResponse('call-3', 'cordis_unmount', { id: 'dyn-1' }),
      textResponse('Done.'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('it-cordis'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'give yourself reverse_text, use it, clean up' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    const calls = log.filter(event => event.type === 'tool/call').map(event => event.data.name)
    expect(calls).toEqual(['cordis_mount', 'reverse_text', 'cordis_unmount'])

    const results = log.filter(event => event.type === 'tool/result')
    expect(results.map(event => event.data.message.content[0].isError)).toEqual([false, false, false])
    const reversed = results[1]!.data.message.content[0].content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    expect(reversed).toBe('ssenrah')

    // After the unmount the self-made tool is gone from the registry.
    expect(ctx.tools.get('reverse_text')).toBeUndefined()
  })

  it('keeps a temporary Plugin across turns, unmounts it, and does not restore it in a new runtime', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('mount-1', 'cordis_mount', { code: 'return { name: \'turn-marker\', apply() {} }' }),
      toolCallResponse('inspect-1', 'cordis_inspect', { what: 'temporary' }),
      textResponse('Turn one complete.'),
      toolCallResponse('inspect-2', 'cordis_inspect', { what: 'temporary' }),
      toolCallResponse('unmount-1', 'cordis_unmount', { id: 'dyn-1' }),
      toolCallResponse('inspect-3', 'cordis_inspect', { what: 'temporary' }),
      textResponse('Turn two complete.'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('it-cordis-turn-lifetime'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Mount the marker and inspect it.' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'On this later turn, inspect the marker, unmount it, then inspect again.' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const resultText = new Map(
      agent.session.events
        .filter(event => event.type === 'tool/result')
        .map(event => [event.data.message.source.callId, event.data.message.content[0].content.filter(block => block.type === 'text').map(block => block.text).join('')]),
    )
    expect(resultText.get(CallId('inspect-1'))).toContain('Temporary Plugin dyn-1: turn-marker [running]')
    expect(resultText.get(CallId('inspect-2'))).toContain('Temporary Plugin dyn-1: turn-marker [running]')
    expect(resultText.get(CallId('unmount-1'))).toBe('Temporary Plugin dyn-1 was unmounted and removed.')
    expect(resultText.get(CallId('inspect-3'))).toContain('No temporary Plugins are running.')

    const restarted = await setup()
    expect(text(await call(restarted, 'cordis_inspect', { what: 'temporary' }))).toContain('No temporary Plugins are running.')
  })
})
