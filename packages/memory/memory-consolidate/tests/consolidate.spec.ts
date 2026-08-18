/**
 * memory-consolidate 组合测试（REAL composition：真 SessionStore + 真
 * SqliteMemoryStore + 真 session/disposed 生命周期）。
 *
 * 行为契约：
 * - 门控通过的会话 dispose 后：候选写入 LTM（global scope、source 'auto'、
 *   结构化三元组物化为可检索事实），退役能力被调用一次。
 * - 门控未通过的会话：只写 failure-pattern 经验，成功候选（remember 信号）
 *   绝不混入。
 * - 同一次巩固内同 (subject, predicate) 不同 value 的冲突候选 →
 *   markUncertain 被调用（不替模型二选一）。
 * - 子代理会话（header.parentSession 存在）缺省不巩固。
 * - 巩固失败 log-only，不阻断拆除（memory 缺失时 dispose 正常完成）。
 *
 * @module @huiliyi37/dsh-memory-consolidate/tests/consolidate
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import LlmService, { CallId, LlmAdapter, createAssistantMessage, createToolResultMessage, createUserMessage } from '@huiliyi37/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@huiliyi37/dsh-llm'
import SessionStore, { Session, SessionId } from '@huiliyi37/dsh-session'
import { SqliteMemoryStore } from '@huiliyi37/dsh-memory-sqlite'
import * as memoryConsolidate from '../src/index.ts'

const stores: SqliteMemoryStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
})

interface Harness {
  ctx: Context
  store: SqliteMemoryStore
  saveSpy: MockInstance
  uncertainSpy: MockInstance
  retireSpy: MockInstance
}

/** 装配：SessionStore + SqliteMemoryStore（':memory:'）+ memory-consolidate 插件。 */
async function harness(config: memoryConsolidate.Config = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const store = new SqliteMemoryStore({ dbPath: ':memory:', journalMode: 'wal', importMaxFileBytes: 1_048_576 })
  stores.push(store)
  ctx.provide('memory', store)
  await ctx.plugin(memoryConsolidate, config)
  return {
    ctx,
    store,
    saveSpy: vi.spyOn(store, 'save'),
    uncertainSpy: vi.spyOn(store, 'markUncertain'),
    retireSpy: vi.spyOn(store, 'retireStale'),
  }
}

/** 在独立 fiber 里创建会话（dispose fiber = session/disposed）。 */
async function liveSession(h: Harness, id: string, meta: { parentSession?: SessionId } = {}): Promise<{
  session: Session
  dispose: () => Promise<void>
}> {
  let session: Session | undefined
  const fiber = await h.ctx.plugin({
    name: `fixture-${id}`,
    inject: ['sessions'],
    apply(inner: Context) {
      session = inner.sessions.create(SessionId(id), { meta })
    },
  })
  if (session === undefined) throw new Error('fixture session not created')
  return { session, dispose: () => fiber.dispose() }
}

/** 追加一个 completed turn。 */
function appendCompletedTurn(session: Session, turn: number, text: string): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/** 追加一次工具调用与结果。 */
function appendTool(
  session: Session,
  turn: number,
  name: string,
  key: string,
  result: { errorCode?: string },
): void {
  session.append('tool/call', {
    turn, step: 1, callId: CallId(`call-${key}`), name, arguments: '{}',
  })
  session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId: CallId(`call-${key}`),
      content: [{ type: 'text', text: 'ok' }],
      isError: result.errorCode !== undefined,
    }),
    ...(result.errorCode === undefined ? {} : { error: { name: 'ToolError', code: result.errorCode } }),
  }, { surfaceOp: 'append' })
}

/** 等巩固落地（异步 fire-and-forget：退役是巩固的最后一步，作为完成屏障）。 */
async function waitConsolidated(h: Harness): Promise<void> {
  await vi.waitFor(() => {
    expect(h.retireSpy.mock.calls.length).toBeGreaterThan(0)
  }, { timeout: 5000, interval: 20 })
}

describe('memory-consolidate（REAL composition）', { timeout: 20_000 }, () => {
  it('成功会话：remember 信号写入 LTM 并可检索；退役能力被调用', async () => {
    const h = await harness()
    const { session, dispose } = await liveSession(h, 'success')
    appendCompletedTurn(session, 1, 'fix the login bug')
    appendCompletedTurn(session, 2, 'remember: the default branch is main')
    await dispose()

    await waitConsolidated(h)
    const entries = await h.store.list({ scope: 'global' })
    expect(entries.some(entry => entry.text.includes('the default branch is main'))).toBe(true)
    expect(entries.every(entry => entry.source === 'auto')).toBe(true)
    expect(h.retireSpy).toHaveBeenCalledTimes(1)
  })

  it('失败会话：只写 failure-pattern 经验，成功候选不混入', async () => {
    const h = await harness()
    const { session, dispose } = await liveSession(h, 'failure')
    // remember 信号存在，但末轮有未解决错误 → 门控否决 → 只记录 failure-pattern。
    appendCompletedTurn(session, 1, 'remember: the api base is https://api.example.com')
    session.append('turn/start', { turn: 2 })
    appendTool(session, 2, 'bash', 'x', { errorCode: 'ENOENT' })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await dispose()

    await waitConsolidated(h)
    const entries = await h.store.list({ scope: 'global' })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.tags).toContain('failure-pattern')
    expect(entries[0]?.text).toContain('ENOENT')
  })

  it('同次巩固冲突：同对不同 value → markUncertain（不二选一）', async () => {
    const h = await harness()
    const { session, dispose } = await liveSession(h, 'conflict')
    appendCompletedTurn(session, 1, 'remember: db is postgres')
    appendCompletedTurn(session, 2, 'remember: db is sqlite')
    await dispose()

    await waitConsolidated(h)
    expect(h.uncertainSpy).toHaveBeenCalledWith('global', 'db', 'stated')
    // 冲突对保持单当前版本（uncertain），两个值都仍在检索里（降权）。
    expect((await h.store.search('postgres')).length).toBeGreaterThan(0)
    expect((await h.store.search('sqlite')).length).toBeGreaterThan(0)
  })

  it('子代理会话缺省不巩固', async () => {
    const h = await harness()
    const { session, dispose } = await liveSession(h, 'child', { parentSession: SessionId('parent') })
    appendCompletedTurn(session, 1, 'remember: db is postgres')
    await dispose()

    // 无巩固发生：给异步错误路径留一个宏观节拍，然后断言零写入。
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(h.saveSpy).not.toHaveBeenCalled()
  })

  it('recordFailures: false 时失败会话完全不写入', async () => {
    const h = await harness({ recordFailures: false })
    const { session, dispose } = await liveSession(h, 'failure-off')
    session.append('turn/start', { turn: 1 })
    appendTool(session, 1, 'bash', 'x', { errorCode: 'ENOENT' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await dispose()

    await waitConsolidated(h)
    expect(h.saveSpy).not.toHaveBeenCalled()
  })

  it('memory 服务缺失：dispose 正常完成（log-only 失败，不阻断拆除）', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(memoryConsolidate, {})
    let session: Session | undefined
    const fiber = await ctx.plugin({
      name: 'fixture-orphan',
      inject: ['sessions'],
      apply(inner: Context) {
        session = inner.sessions.create(SessionId('orphan'), { meta: {} })
      },
    })
    if (session === undefined) throw new Error('fixture session not created')
    appendCompletedTurn(session, 1, 'remember: db is postgres')
    // 拆除不因巩固失败而 reject。
    await fiber.dispose()
  })
})

/** 追加一条 assistant 消息（携带 mock 路由 source，供 LLM 提取器推导路由）。 */
function appendAssistant(session: Session, turn: number, text: string): void {
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'mock', model: 'mock-1' },
    }),
  }, { surfaceOp: 'append' })
}

/** 脚本化 LLM 适配器：返回固定文本响应（recorded requests 供断言）。 */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: string[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const text = this.script.shift()
    if (text === undefined) throw new Error('ScriptedAdapter: script exhausted')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** 带真实 llm 服务 + 脚本化适配器的组合 harness（extractor: 'llm' 路径）。 */
async function llmHarness(
  adapter: ScriptedAdapter,
  config: memoryConsolidate.Config = {},
): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(LlmService)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(SessionStore)
  const store = new SqliteMemoryStore({ dbPath: ':memory:', journalMode: 'wal', importMaxFileBytes: 1_048_576 })
  stores.push(store)
  ctx.provide('memory', store)
  await ctx.plugin(memoryConsolidate, config)
  return {
    ctx,
    store,
    saveSpy: vi.spyOn(store, 'save'),
    uncertainSpy: vi.spyOn(store, 'markUncertain'),
    retireSpy: vi.spyOn(store, 'retireStale'),
  }
}

describe('memory-consolidate extractor: "llm"（REAL composition + 脚本化 llm）', { timeout: 20_000 }, () => {
  it('LLM 提取：session-summary + 候选 + procedure 落库；一次有界调用', async () => {
    const adapter = new ScriptedAdapter([JSON.stringify({
      summary: 'Created src/format.ts, found and fixed the padLeft bug, verified via node -e.',
      candidates: [{
        kind: 'observation',
        topic: 'project-layout',
        text: 'String utilities live in src/format.ts',
        keywords: ['format'],
        entities: ['src/format.ts'],
        confidence: 0.9,
      }],
      procedure: {
        name: 'Quick TS module check',
        when: 'Verifying a small TS module',
        steps: ['Run node with strip-types', 'Assert the output'],
      },
    })])
    const h = await llmHarness(adapter, { extractor: 'llm' })
    const { session, dispose } = await liveSession(h, 'llm-success')
    appendCompletedTurn(session, 1, 'create src/format.ts with padLeft and fix its bug')
    appendAssistant(session, 1, 'done, verified')
    await dispose()

    await waitConsolidated(h)
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.provider).toBe('mock')
    expect(adapter.requests[0]?.maxTokens).toBe(2000)
    const entries = await h.store.list({ scope: 'global' })
    const topics = entries.map(entry => entry.tags[0])
    expect(topics).toContain('session-summary')
    expect(topics).toContain('project-layout')
    expect(topics).toContain('procedure')
    expect(entries.find(entry => entry.tags[0] === 'procedure')?.text).toContain('Procedure: Quick TS module check')
  })

  it('LLM 输出非法 → 回退启发式（log-only），remember 信号仍落库', async () => {
    const adapter = new ScriptedAdapter(['not json at all'])
    const h = await llmHarness(adapter, { extractor: 'llm' })
    const { session, dispose } = await liveSession(h, 'llm-invalid')
    appendCompletedTurn(session, 1, 'remember: the default branch is main')
    appendAssistant(session, 1, 'noted')
    await dispose()

    await waitConsolidated(h)
    const entries = await h.store.list({ scope: 'global' })
    expect(entries.some(entry => entry.text.includes('the default branch is main'))).toBe(true)
    expect(entries.every(entry => !entry.tags.includes('session-summary'))).toBe(true)
  })

  it('extractor 缺省 heuristic：不发任何模型调用', async () => {
    const adapter = new ScriptedAdapter([])
    const h = await llmHarness(adapter, {})
    const { session, dispose } = await liveSession(h, 'default-heuristic')
    appendCompletedTurn(session, 1, 'remember: db is postgres')
    await dispose()

    await waitConsolidated(h)
    expect(adapter.requests).toHaveLength(0)
    expect((await h.store.list({ scope: 'global' })).length).toBeGreaterThan(0)
  })

  it('proceduresEnabled: false 时编码方法的纠正只落 correction 条目', async () => {
    const h = await harness({ proceduresEnabled: false })
    const { session, dispose } = await liveSession(h, 'procedure-off')
    appendCompletedTurn(session, 1, 'fix the build')
    appendAssistant(session, 1, 'I will run npm install')
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'No, use pnpm install instead' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await dispose()

    await waitConsolidated(h)
    const entries = await h.store.list({ scope: 'global' })
    expect(entries.some(entry => entry.tags.includes('correction'))).toBe(true)
    expect(entries.every(entry => !entry.tags.includes('procedure'))).toBe(true)
  })
})
