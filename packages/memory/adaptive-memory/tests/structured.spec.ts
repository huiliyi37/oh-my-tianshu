/**
 * adaptive-memory 结构化 provider 组合测试（REAL loop + 真 SqliteMemoryStore）。
 *
 * 行为契约（阶段二b 的能力探测路径）：
 * - memory 服务暴露 topicVersions ⇒ 走结构化检索（BM25 search）+ 按 topic
 *   版本号的门控：相关 topic 的写入推进版本号 ⇒ 'topic-version' 刷新——即使
 *   新条目本身不匹配当前 intent（与 fallback 的 relevanceSignature 区分点）；
 *   无关 topic 的写入不触发刷新（cache-hit）。
 * - 低门阈值下检索命中的条目进入 STM 快照（候选索引形状与 fallback 一致）。
 *
 * @module @huiliyi37/dsh-adaptive-memory/tests/structured
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { LlmAdapter, createUserMessage } from '@huiliyi37/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@huiliyi37/dsh-llm'
import { SessionId } from '@huiliyi37/dsh-session'
import type { Agent } from '@huiliyi37/dsh-agent'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import { SqliteMemoryStore } from '@huiliyi37/dsh-memory-sqlite'
import * as adaptiveMemory from '../src/index.ts'
import type { StmRefreshReason } from '../src/types.ts'

let dir: string | undefined
let store: SqliteMemoryStore | undefined

afterEach(async () => {
  await store?.close()
  store = undefined
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

async function harness(adapter: ScriptedAdapter): Promise<{ ctx: Context; store: SqliteMemoryStore }> {
  dir = await mkdtemp(join(tmpdir(), 'dsh-adaptive-memory-sqlite-'))
  const created = new SqliteMemoryStore({
    dbPath: ':memory:',
    mdRoot: join(dir, '.dsh/memory'),
    journalMode: 'wal',
    importMaxFileBytes: 1_048_576,
  })
  store = created
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  // 阈值放宽：小语料的 BM25 归一化得分天然趋零（IDF 在极小语料退化；README
  // 记录默认阈值为占位调参项），本组合只验证接线路径（门层级映射由
  // gate.spec.ts 的单测覆盖）。
  await ctx.plugin(adaptiveMemory, { confidenceHigh: 0.99, confidenceMedium: 0 })
  ctx.provide('memory', created)
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, store: created }
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

describe('adaptive-memory × sqlite provider（REAL loop composition）', { timeout: 60_000 }, () => {
  it('结构化路径：相关 topic 的版本 bump 触发刷新，无关 topic 的写入保持', async () => {
    const adapter = new ScriptedAdapter([
      textResponse('one'), textResponse('two'), textResponse('three'),
      textResponse('four'), textResponse('five'),
    ])
    const { ctx, store: memory } = await harness(adapter)
    const auth = await memory.save({
      text: '登录页白屏常见原因是 JWT 校验顺序',
      scope: 'global',
      tags: ['auth'],
      source: 'user',
    })
    const agent = ctx.agentLoop.create(SessionId('adaptive-structured'), { provider: 'mock', model: 'mock' })

    // 轮 1：当前轮消息尚未落日志 → 不评估。
    send(agent, 'fix 登录 白屏问题')
    await waitForIdle(ctx, agent)
    expect(contextSnapshots(agent)).toHaveLength(0)

    // 轮 2：initial —— 结构化检索命中的 auth 条目进入 STM 快照。
    send(agent, '继续')
    await waitForIdle(ctx, agent)
    expect(contextSnapshots(agent)).toHaveLength(1)
    expect(contextSnapshots(agent)[0]).toContain(auth.id.slice(0, 8))
    expect(missReasons(agent)).toEqual(['initial'])

    // 轮 3：普通追问 → cache-hit，快照不追加。
    send(agent, '继续')
    await waitForIdle(ctx, agent)
    expect(contextSnapshots(agent)).toHaveLength(1)
    expect(hitCount(agent)).toBe(1)

    // 相关 topic（auth）写入一条与 intent 不匹配的新条目：条目不进候选，
    // 但 topic 版本推进 ⇒ 'topic-version' 刷新（fallback 的 relevanceSignature
    // 在此保持不变——这是结构化门控的区分点）。重渲染文本逐字节不变 ⇒ 不追加
    // 新快照（刷新决策 ≠ 必有新快照，前缀缓存纪律成立）。
    await memory.save({ text: '与当前任务无关的部署笔记', scope: 'global', tags: ['auth'], source: 'agent' })
    send(agent, '继续')
    await waitForIdle(ctx, agent)
    expect(missReasons(agent)).toEqual(['initial', 'topic-version'])
    expect(contextSnapshots(agent)).toHaveLength(1)
    expect(contextSnapshots(agent)[0]).not.toContain('部署笔记')

    // 无关 topic（cooking）的写入：不进检索命中、不推进被跟踪版本 ⇒ cache-hit。
    await memory.save({ text: '红烧肉的做法', scope: 'global', tags: ['cooking'], source: 'user' })
    send(agent, '继续')
    await waitForIdle(ctx, agent)
    expect(missReasons(agent)).toEqual(['initial', 'topic-version'])
    expect(hitCount(agent)).toBe(2)
    expect(contextSnapshots(agent)).toHaveLength(1)
  }, 60_000)
})
