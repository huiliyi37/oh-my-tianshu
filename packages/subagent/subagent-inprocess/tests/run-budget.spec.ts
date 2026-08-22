/**
 * run-budget.spec.ts — seam runBudget 强制面：步数越界与墙钟越界都以可区分的
 * `budget-exhausted` 终态收敛（区别于父取消的 `aborted`），预算内正常完成不受
 * 影响。步数经子作用域 agent/pre-step 计数强制；墙钟经组合信号计时器强制。
 */
import { createUserMessage } from '@huiliyi37/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { type Agent } from '@huiliyi37/dsh-agent'
import { SessionId } from '@huiliyi37/dsh-session'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import InvariantService from '@huiliyi37/dsh-invariants'
import * as SessionInvariant from '@huiliyi37/dsh-session/invariant'
import * as AgentInvariant from '@huiliyi37/dsh-agent/invariant'
import * as AgentLoopInvariant from '@huiliyi37/dsh-agent-loop/invariant'
import SubagentService, { snapshotSubagentDescriptor } from '@huiliyi37/dsh-subagent'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { startInProcessRun } from '../src/index.ts'

type Script = ConstructorParameters<typeof MockAdapter>[0]

async function setup(script: Script) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await mountInvariants(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  // 步数预算需要一个可反复调用的真实工具（每次调用推进一个 step）。
  ctx.tools.register({
    name: 'noop',
    description: 'no-op probe tool',
    parameters: {},
    execute: () => Promise.resolve([{ type: 'text' as const, text: 'ok' }]),
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {} },
      render: () => [{ type: 'text' as const, text: 'ok' }],
    },
  })
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent }
}

async function mountInvariants(ctx: Context): Promise<void> {
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
}

function request(parent: Agent, runBudget?: { maxSteps: number; timeoutMs: number }) {
  return {
    label: 'budgeted child',
    prompt: [{ type: 'text' as const, text: 'child task' }],
    parent,
    signal: new AbortController().signal,
    ...runBudget !== undefined ? { runBudget } : {},
    descriptor: snapshotSubagentDescriptor({
      mode: 'one-shot',
      provider: 'test',
      label: 'budgeted child',
    }),
  }
}

describe('runBudget enforcement', () => {
  it('步数越界 → budget-exhausted（区别于 aborted）', async () => {
    // maxSteps 2：step1/step2 各调一次 noop，step3 的 pre-step 触发越界。
    const { parent } = await setup([
      toolCallResponse('c1', 'noop', {}),
      toolCallResponse('c2', 'noop', {}),
      toolCallResponse('c3', 'noop', {}),
    ])
    const run = await startInProcessRun(request(parent, { maxSteps: 2, timeoutMs: 60_000 }), {})
    try {
      const result = await run.result
      expect(result.stopReason).toBe('budget-exhausted')
    } finally {
      await run.dispose()
    }
  })

  it('墙钟越界 → budget-exhausted（挂起脚本被计时器收敛）', async () => {
    const { parent } = await setup(['hang'])
    const run = await startInProcessRun(request(parent, { maxSteps: 100, timeoutMs: 80 }), {})
    try {
      const result = await run.result
      expect(result.stopReason).toBe('budget-exhausted')
    } finally {
      await run.dispose()
    }
  })

  it('预算内正常完成不受影响（stopReason 仍 completed）', async () => {
    const { parent } = await setup([textResponse('done early')])
    const run = await startInProcessRun(request(parent, { maxSteps: 8, timeoutMs: 60_000 }), {})
    try {
      const result = await run.result
      expect(result.stopReason).toBe('completed')
    } finally {
      await run.dispose()
    }
  })

  it('无预算的父取消仍是 aborted（可区分性回归锚）', async () => {
    const { parent } = await setup(['hang'])
    const signalController = new AbortController()
    const run = await startInProcessRun({
      ...request(parent),
      signal: signalController.signal,
      prompt: createUserMessage({ content: [{ type: 'text', text: 'child task' }], source: { kind: 'user' } }).content,
    }, {})
    const settled = run.result
    signalController.abort()
    try {
      const result = await settled
      expect(result.stopReason).toBe('aborted')
    } finally {
      await run.dispose()
    }
  })
})
