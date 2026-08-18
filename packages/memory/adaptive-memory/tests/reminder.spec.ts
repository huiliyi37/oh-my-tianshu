/**
 * adaptive-memory 规则兜底提醒组合测试（真 systemPrompt/tools 服务 + 真存储）。
 *
 * 行为契约（阶段二b）：
 * - 工具调用触及 STM 索引外的路径、或结果出现未覆盖的错误码 ⇒ 下一次
 *   assemble 的运行时上下文快照尾部携带 memory:reminder 提醒（append 通道，
 *   绝不编辑 system prompt）；触发决策记 log-only 的 memory/reminder 事件。
 * - 限量：每轮最多 maxRemindersPerTurn 条（缺省 1）——同轮第二次触发被拒绝，
 *   挂起文本保持第一次的主题。
 * - 提醒绝不改写旧快照：新快照在尾部追加，旧快照字节不变。
 *
 * @module @huiliyi37/dsh-adaptive-memory/tests/reminder
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { CallId, createUserMessage } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import { Inbox } from '@huiliyi37/dsh-agent'
import type { Agent } from '@huiliyi37/dsh-agent'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import { MarkdownMemoryStore } from '@huiliyi37/dsh-memory'
import * as adaptiveMemory from '../src/index.ts'

const SIGNAL = new AbortController().signal

let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

/** 挂载最小组合：systemPrompt/tools 服务 + adaptive-memory + memory 服务 + 探测工具。 */
async function harness(): Promise<Context> {
  dir = await mkdtemp(join(tmpdir(), 'dsh-adaptive-memory-reminder-'))
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(adaptiveMemory, {})
  ctx.provide('memory', new MarkdownMemoryStore(join(dir, '.dsh/memory')))
  ctx.tools.register({
    name: 'probe',
    description: '探测工具（测试夹具）',
    parameters: { path: { type: 'string' } },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    },
    async execute(args: { path?: string }) {
      if (args.path === 'fail') throw new Error('open failed: ENOENT')
      return 'ok'
    },
  })
  return ctx
}

/** 最小 Agent 夹具（直接驱动 systemPrompt.assemble 与 tools.execute）。 */
function sessionAgent(session: Session, ctx: Context): Agent {
  return {
    id: SessionId('agent'),
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx,
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('not used') },
    cancel() {},
    runMaintenance: task => task(SIGNAL),
    whenIdle: () => Promise.resolve(),
  }
}

/** 建一个已含首轮用户消息的会话（intent 锚点就绪）。 */
function seededSession(id: string): Session {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'fix the login bug' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return session
}

/** 一次 assemble 的 memory:reminder 贡献文本（空文本 = 无贡献，渲染时被过滤）。 */
async function reminderText(ctx: Context, agent: Agent): Promise<string | undefined> {
  const assembly = await ctx.systemPrompt.assemble({ agent })
  const text = assembly.contexts.find(item => item.name === adaptiveMemory.REMINDER_CONTEXT_NAME)?.text
  return text === '' ? undefined : text
}

describe('adaptive-memory 兜底提醒（组合）', { timeout: 20_000 }, () => {
  it('未覆盖路径触发提醒进下一份快照；同轮第二次触发被限量拒绝', async () => {
    const ctx = await harness()
    const session = seededSession('reminder-path')
    const agent = sessionAgent(session, ctx)

    // 首次 assemble：initial 评估（无相关条目，STM 空），尚无提醒。
    expect(await reminderText(ctx, agent)).toBeUndefined()

    // 工具调用触及 STM 索引外的路径 ⇒ 提醒挂起，下一次 assemble 可见。
    await ctx.tools.execute({
      signal: SIGNAL, callId: CallId('c1'), name: 'probe',
      arguments: { path: 'src/secret/vault.ts' }, agent,
    })
    const first = await reminderText(ctx, agent)
    expect(first).toContain('src/secret/vault.ts')

    // 同轮第二次触发（另一个新路径）被每轮限量拒绝：文本保持第一次的主题。
    await ctx.tools.execute({
      signal: SIGNAL, callId: CallId('c2'), name: 'probe',
      arguments: { path: 'src/other/thing.ts' }, agent,
    })
    expect(await reminderText(ctx, agent)).toBe(first)

    const events = session.events.filter(event => event.type === 'memory/reminder')
    expect(events).toHaveLength(1)
    expect(events[0]?.type === 'memory/reminder' && events[0].data.kind).toBe('unknown-entity')
  }, 60_000)

  it('结果里的未覆盖错误码触发 error-code 提醒', async () => {
    const ctx = await harness()
    const session = seededSession('reminder-error')
    const agent = sessionAgent(session, ctx)
    expect(await reminderText(ctx, agent)).toBeUndefined()

    const result = await ctx.tools.execute({
      signal: SIGNAL, callId: CallId('c1'), name: 'probe', arguments: { path: 'fail' }, agent,
    })
    expect(result.isError).toBe(true)
    expect(await reminderText(ctx, agent)).toContain('ENOENT')

    const events = session.events.filter(event => event.type === 'memory/reminder')
    expect(events).toHaveLength(1)
    expect(events[0]?.type === 'memory/reminder' && events[0].data.kind).toBe('error-code')
  }, 60_000)
})
