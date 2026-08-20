/**
 * adaptive-memory 组合测试（REAL composition：真 AgentLoop + 真 memory 存储）。
 *
 * 行为契约（前缀缓存纪律；评估挂 system-prompt/assemble 瀑布，当前轮用户
 * 消息尚未落日志 → intent 检测滞后一轮，见包 README Known Limitations）：
 * - 首轮无锚点不评估；次轮 initial 刷新，STM 经 context-snapshot 追加
 *   （memory/cache-miss initial + memory/stm-selected 落日志）。
 * - 普通追问：门控保持（memory/cache-hit），快照不追加，system 前缀逐字节不变。
 * - 目标动词消息在下一轮被看到 ⇒ intent-change 刷新，追加新快照（不改写旧快照）。
 * - 相关记忆写入 ⇒ topic-version 刷新，新条目进入下一份快照。
 * - 装配本插件而未装配 dsh-memory：首次评估即 fail loud。
 *
 * @module @huiliyi37/dsh-adaptive-memory/tests/adaptive-memory
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { LlmAdapter, createUserMessage } from '@huiliyi37/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import { Inbox } from '@huiliyi37/dsh-agent'
import type { Agent } from '@huiliyi37/dsh-agent'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import { MarkdownMemoryStore } from '@huiliyi37/dsh-memory'
import * as adaptiveMemory from '../src/index.ts'
import type { StmRefreshReason } from '../src/types.ts'

const SIGNAL = new AbortController().signal

let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.script.shift()
    if (chunks === undefined) throw new Error('ScriptedAdapter: script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

async function harness(adapter: ScriptedAdapter): Promise<{ ctx: Context; store: MarkdownMemoryStore }> {
  dir = await mkdtemp(join(tmpdir(), 'dsh-adaptive-memory-'))
  const store = new MarkdownMemoryStore(join(dir, '.dsh/memory'))
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(adaptiveMemory, {})
  ctx.provide('memory', store)
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, store }
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

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** 会话里的 context-snapshot 文本（RuntimeContextProjection 追加的运行时上下文）。 */
function contextSnapshots(agent: Agent): string[] {
  return agent.session.events.flatMap(event =>
    event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@huiliyi37/dsh-system-prompt'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])
}

/** 历次刷新的原因序列（memory/cache-miss，log-only）。 */
function missReasons(agent: Agent): StmRefreshReason[] {
  return agent.session.events.flatMap(event => event.type === 'memory/cache-miss' ? [event.data.reason] : [])
}

/** memory/cache-hit 次数（log-only）。 */
function hitCount(agent: Agent): number {
  return agent.session.events.filter(event => event.type === 'memory/cache-hit').length
}

/** 历次 STM 选择的完整条目 id（memory/stm-selected，log-only）。 */
function selectedIds(agent: Agent): string[][] {
  return agent.session.events.flatMap(event => event.type === 'memory/stm-selected' ? [event.data.entryIds] : [])
}

/** 最小 Agent 夹具（直接驱动 systemPrompt.assemble）。 */
function sessionAgent(session: Session): Agent {
  return {
    id: SessionId('agent'),
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('not used') },
    cancel() {},
    runMaintenance: task => task(SIGNAL),
    whenIdle: () => Promise.resolve(),
  }
}

describe('adaptive-memory STM（REAL loop composition）', { timeout: 60_000 }, () => {
  it('门控生命周期：initial 刷新 → 追问保持 → 新 intent 刷新 → 相关写入刷新', async () => {
    const adapter = new ScriptedAdapter([
      textResponse('one'), textResponse('two'), textResponse('three'),
      textResponse('four'), textResponse('five'),
    ])
    const { ctx, store } = await harness(adapter)
    const auth = await store.save({
      text: '登录页白屏常见原因是 src/auth/login.ts 的 JWT 校验顺序',
      scope: 'global',
      tags: ['auth'],
      source: 'user',
    })
    await store.save({
      text: 'payment 模块使用 Stripe 沙箱密钥',
      scope: 'global',
      tags: ['payment'],
      source: 'user',
    })
    const agent = ctx.agentLoop.create(SessionId('adaptive-stm'), { provider: 'mock', model: 'mock' })

    // 轮 1：用户消息尚未落日志 → 无锚点、不评估、无快照。
    send(agent, 'fix the login bug in src/auth/login.ts')
    await waitForIdle(ctx, agent)
    expect(contextSnapshots(agent)).toHaveLength(0)
    expect(missReasons(agent)).toEqual([])

    // 轮 2：initial —— 相关 auth 条目进入 STM 快照，payment 条目无关不入选。
    send(agent, 'thanks, that helps')
    await waitForIdle(ctx, agent)
    expect(contextSnapshots(agent)).toHaveLength(1)
    expect(contextSnapshots(agent)[0]).toContain(`${auth.id.slice(0, 8)} | auth |`)
    expect(contextSnapshots(agent)[0]).not.toContain('Stripe')
    expect(missReasons(agent)).toEqual(['initial'])
    expect(selectedIds(agent)[0]).toEqual([auth.id])

    // 轮 3：目标动词消息尚未落日志 → 仍是旧 intent，门控保持（cache-hit）；
    // 不追加新快照，system 前缀逐字节稳定。
    send(agent, 'refactor the payment retry logic')
    await waitForIdle(ctx, agent)
    expect(contextSnapshots(agent)).toHaveLength(1)
    expect(hitCount(agent)).toBe(1)
    expect(adapter.requests[2]?.system).toBe(adapter.requests[0]?.system)

    // 轮 4：轮 3 的消息已落日志 ⇒ intent-change —— 追加新快照（旧快照不改写），
    // 新 intent 下 payment 条目入选、auth 条目退出。
    send(agent, '继续')
    await waitForIdle(ctx, agent)
    expect(contextSnapshots(agent)).toHaveLength(2)
    expect(contextSnapshots(agent)[1]).toContain('| payment |')
    expect(contextSnapshots(agent)[1]).not.toContain('| auth |')
    expect(missReasons(agent)).toEqual(['initial', 'intent-change'])

    // 轮 5 前写入相关记忆 ⇒ topic-version —— 新条目进入下一份快照。
    await store.save({
      text: 'payment 重试策略：指数退避，最多 3 次',
      scope: 'global',
      tags: ['payment'],
      source: 'agent',
    })
    send(agent, '继续')
    await waitForIdle(ctx, agent)
    expect(contextSnapshots(agent)).toHaveLength(3)
    expect(contextSnapshots(agent)[2]).toContain('指数退避')
    expect(missReasons(agent)).toEqual(['initial', 'intent-change', 'topic-version'])
    expect(adapter.requests).toHaveLength(5)
  }, 60_000)

  it('装配 adaptive-memory 而未装配 memory 服务：首次评估 fail loud', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(adaptiveMemory, {})
    const session = Session.create(SessionId('adaptive-no-memory'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'fix anything' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await expect(ctx.systemPrompt.assemble({ agent: sessionAgent(session) }))
      .rejects.toThrow('memory 服务不可用')
  })
})
