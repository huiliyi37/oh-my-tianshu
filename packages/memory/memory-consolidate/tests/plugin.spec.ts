/**
 * memory-consolidate apply：fail loud、总开关、退役关闭、注入提取器、LLM 调用边角。
 *
 * @module @huiliyi37/dsh-memory-consolidate/tests/plugin
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@huiliyi37/dsh-llm'
import type { FinishReason, GenerateOptions, StreamChunk } from '@huiliyi37/dsh-llm'
import SessionStore, { Session, SessionId } from '@huiliyi37/dsh-session'
import { MarkdownMemoryStore } from '@huiliyi37/dsh-memory'
import { SqliteMemoryStore } from '@huiliyi37/dsh-memory-sqlite'
import { apply, Config, name } from '../src/index.ts'
import type { ExperienceExtractor, ExtractionCandidate } from '../src/extract.ts'

const sqliteStores: SqliteMemoryStore[] = []
let dir: string | undefined
/** coverage 并行下 session/disposed 的 fire-and-forget 巩固可能超过 vitest waitFor 缺省 1s。 */
const CONSOLIDATE_SETTLE_MS = 10_000

async function waitUntil(check: () => void | Promise<void>): Promise<void> {
  await vi.waitFor(check, { timeout: CONSOLIDATE_SETTLE_MS })
}

afterEach(async () => {
  for (const store of sqliteStores.splice(0)) await store.close()
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

function finish(reason: FinishReason): StreamChunk {
  return { type: 'finish', reason }
}

async function liveSession(ctx: Context, id: string, meta: { parentSession?: SessionId } = {}): Promise<{
  session: Session
  dispose: () => Promise<void>
}> {
  let session: Session | undefined
  const fiber = await ctx.plugin({
    name: `fixture-${id}`,
    inject: ['sessions'],
    apply(inner: Context) {
      session = inner.sessions.create(SessionId(id), { meta })
    },
  })
  if (session === undefined) throw new Error('fixture session not created')
  return { session, dispose: () => fiber.dispose() }
}

function appendCompletedTurn(session: Session, turn: number, text: string): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'done' }],
      source: { provider: 'mock', model: 'mock-1' },
    }),
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('memory-consolidate plugin apply', { timeout: 20_000 }, () => {
  it('named export 与 Config schema 存在', () => {
    expect(name).toBe('memory-consolidate')
    expect(Config).toBeDefined()
  })

  it('llmProvider / llmModel 必须成对', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, { llmProvider: 'p' }) }).toThrow(/必须成对配置/)
    expect(() => { apply(ctx, { llmModel: 'm' }) }).toThrow(/必须成对配置/)
  })

  it('enabled: false 完全不监听', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const store = new SqliteMemoryStore({ dbPath: ':memory:', journalMode: 'wal', importMaxFileBytes: 1_048_576 })
    sqliteStores.push(store)
    ctx.provide('memory', store)
    const saveSpy = vi.spyOn(store, 'save')
    apply(ctx, { enabled: false })
    const { session, dispose } = await liveSession(ctx, 'disabled')
    appendCompletedTurn(session, 1, 'remember: db is postgres')
    await dispose()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('显式 Config + retirementEnabled false：写入但不退役', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const store = new SqliteMemoryStore({ dbPath: ':memory:', journalMode: 'wal', importMaxFileBytes: 1_048_576 })
    sqliteStores.push(store)
    ctx.provide('memory', store)
    const retireSpy = vi.spyOn(store, 'retireStale')
    apply(ctx, {
      enabled: true,
      gate: 'strict',
      recordFailures: true,
      consolidateChildSessions: false,
      maxCandidatesPerSession: 8,
      maxTextChars: 280,
      maxEntities: 8,
      retirementEnabled: false,
      supersededRetentionDays: 30,
      unusedConsolidations: 8,
      extractor: 'heuristic',
      llmMaxInputChars: 20_000,
      llmMaxOutputTokens: 2000,
      llmEffort: 'off',
      llmTimeoutMs: 30_000,
      maxSummaryChars: 600,
      proceduresEnabled: true,
    })
    const { session, dispose } = await liveSession(ctx, 'no-retire')
    appendCompletedTurn(session, 1, 'remember: db is postgres')
    await dispose()
    await waitUntil(async () => {
      expect((await store.list({ scope: 'global' })).length).toBeGreaterThan(0)
    })
    expect(retireSpy).not.toHaveBeenCalled()
  })

  it('consolidateChildSessions: true 巩固子会话', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const store = new SqliteMemoryStore({ dbPath: ':memory:', journalMode: 'wal', importMaxFileBytes: 1_048_576 })
    sqliteStores.push(store)
    ctx.provide('memory', store)
    apply(ctx, { consolidateChildSessions: true })
    const { session, dispose } = await liveSession(ctx, 'child-on', { parentSession: SessionId('parent') })
    appendCompletedTurn(session, 1, 'remember: db is postgres')
    await dispose()
    await waitUntil(async () => {
      expect((await store.list({ scope: 'global' })).length).toBeGreaterThan(0)
    })
  })

  it('第三参数提取器优先于 Config', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const store = new SqliteMemoryStore({ dbPath: ':memory:', journalMode: 'wal', importMaxFileBytes: 1_048_576 })
    sqliteStores.push(store)
    ctx.provide('memory', store)
    const injected: ExperienceExtractor = {
      extract: () => Promise.resolve([{
        kind: 'observation',
        topic: 'injected',
        text: 'from inject',
        keywords: ['injected'],
        entities: [],
        confidence: 1,
        sourceSeqs: [1],
      } satisfies ExtractionCandidate]),
    }
    apply(ctx, { extractor: 'heuristic' }, injected)
    const { session, dispose } = await liveSession(ctx, 'inject')
    appendCompletedTurn(session, 1, 'fix anything')
    await dispose()
    await waitUntil(async () => {
      expect((await store.list({ scope: 'global' })).some(entry => entry.text === 'from inject')).toBe(true)
    })
  })

  it('Markdown provider 无 retireStale：走无退役日志分支', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-memory-consolidate-md-'))
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const store = new MarkdownMemoryStore(join(dir, '.dsh/memory'))
    ctx.provide('memory', store)
    apply(ctx, {})
    const warnings: string[] = []
    vi.spyOn(ctx.logger, 'warn').mockImplementation((message: string) => {
      warnings.push(message)
    })
    const { session, dispose } = await liveSession(ctx, 'markdown')
    appendCompletedTurn(session, 1, 'remember: db is postgres')
    await dispose()
    await waitUntil(async () => {
      expect(warnings, warnings.join('\n')).toEqual([])
      expect((await store.list({ scope: 'global' })).length).toBeGreaterThan(0)
    })
  })

  it('extractor llm 未装配 llm：回退启发式', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const store = new SqliteMemoryStore({ dbPath: ':memory:', journalMode: 'wal', importMaxFileBytes: 1_048_576 })
    sqliteStores.push(store)
    ctx.provide('memory', store)
    vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    apply(ctx, { extractor: 'llm', llmProvider: 'mock', llmModel: 'mock-1' })
    const { session, dispose } = await liveSession(ctx, 'llm-missing')
    appendCompletedTurn(session, 1, 'remember: db is postgres')
    await dispose()
    await waitUntil(async () => {
      expect((await store.list({ scope: 'global' })).some(entry => entry.text.includes('postgres'))).toBe(true)
    })
  })

  it('extractor llm：UNSUPPORTED_REASONING_EFFORT 后去掉 effort 重试', async () => {
    const ctx = new Context()
    const efforts: Array<string | undefined> = []
    ctx.provide('llm', {
      stream: async function* (options: GenerateOptions): AsyncIterable<StreamChunk> {
        efforts.push(options.reasoningEffort)
        if (options.reasoningEffort !== undefined) {
          yield finish({ kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT', message: 'no' } })
          return
        }
        yield { type: 'reasoning-delta', index: 0, text: 'think' }
        yield { type: 'text-delta', index: 1, text: JSON.stringify({
          summary: 'Did a thing in src/x.ts and verified it.',
          candidates: [],
        }) }
        yield finish({ kind: 'stop' })
      },
    })
    await ctx.plugin(SessionStore)
    const store = new SqliteMemoryStore({ dbPath: ':memory:', journalMode: 'wal', importMaxFileBytes: 1_048_576 })
    sqliteStores.push(store)
    ctx.provide('memory', store)
    apply(ctx, {
      extractor: 'llm',
      llmProvider: 'mock',
      llmModel: 'mock-1',
      llmEffort: 'high',
      llmMaxOutputTokens: 2000,
      llmTimeoutMs: 5_000,
    })
    const { session, dispose } = await liveSession(ctx, 'llm-retry')
    appendCompletedTurn(session, 1, 'create src/x.ts')
    await dispose()
    await waitUntil(() => {
      expect(efforts.length).toBe(2)
    })
    expect(efforts[0]).toBeDefined()
    expect(efforts[1]).toBeUndefined()
  })

  it('extractor llm：error / aborted / 非 stop / 空文本回退启发式', async () => {
    const cases: StreamChunk[][] = [
      [finish({ kind: 'error', failure: { code: 'RATE_LIMIT', message: 'slow' } })],
      [finish({ kind: 'aborted', failure: { code: 'TIMEOUT', message: 'deadline' } })],
      [finish({ kind: 'max-tokens' })],
      [{ type: 'text-delta', index: 0, text: '   ' }, finish({ kind: 'stop' })],
    ]
    for (const [index, chunks] of cases.entries()) {
      const ctx = new Context()
      ctx.provide('llm', {
        stream: async function* (): AsyncIterable<StreamChunk> {
          yield* chunks
        },
      })
      await ctx.plugin(SessionStore)
      const store = new SqliteMemoryStore({ dbPath: ':memory:', journalMode: 'wal', importMaxFileBytes: 1_048_576 })
      sqliteStores.push(store)
      ctx.provide('memory', store)
      vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
      apply(ctx, { extractor: 'llm', llmProvider: 'mock', llmModel: 'mock-1' })
      const { session, dispose } = await liveSession(ctx, `llm-fail-${index}`)
      appendCompletedTurn(session, 1, 'remember: db is postgres')
      await dispose()
      await waitUntil(async () => {
        expect((await store.list({ scope: 'global' })).some(entry => entry.text.includes('postgres'))).toBe(true)
      })
    }
  })

  it('失败会话 + retirementEnabled false：写 failure-pattern 且不退役', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const store = new SqliteMemoryStore({ dbPath: ':memory:', journalMode: 'wal', importMaxFileBytes: 1_048_576 })
    sqliteStores.push(store)
    ctx.provide('memory', store)
    const retireSpy = vi.spyOn(store, 'retireStale')
    apply(ctx, { retirementEnabled: false })
    const { session, dispose } = await liveSession(ctx, 'fail-no-retire')
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('call-x'), name: 'bash', arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('call-x'),
        content: [{ type: 'text', text: 'fail' }],
        isError: true,
      }),
      error: { name: 'ToolError', code: 'ENOENT' },
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await dispose()
    await waitUntil(async () => {
      expect((await store.list({ scope: 'global' })).some(entry => entry.tags.includes('failure-pattern'))).toBe(true)
    })
    expect(retireSpy).not.toHaveBeenCalled()
  })

  it('markUncertain 返回 false 时 uncertain 计数不加', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const store = new SqliteMemoryStore({ dbPath: ':memory:', journalMode: 'wal', importMaxFileBytes: 1_048_576 })
    sqliteStores.push(store)
    ctx.provide('memory', store)
    const uncertain = vi.spyOn(store, 'markUncertain').mockResolvedValue(false)
    const injected: ExperienceExtractor = {
      extract: () => Promise.resolve([
        {
          kind: 'observation',
          topic: 'explicit',
          text: 'db is postgres',
          keywords: ['explicit'],
          entities: [],
          confidence: 1,
          fact: { subject: 'db', predicate: 'stated', value: 'postgres' },
          sourceSeqs: [1],
        },
        {
          kind: 'observation',
          topic: 'explicit',
          text: 'db is sqlite',
          keywords: ['explicit'],
          entities: [],
          confidence: 1,
          fact: { subject: 'db', predicate: 'stated', value: 'sqlite' },
          sourceSeqs: [2],
        },
      ] satisfies ExtractionCandidate[]),
    }
    apply(ctx, {}, injected)
    const { session, dispose } = await liveSession(ctx, 'uncertain-false')
    appendCompletedTurn(session, 1, 'fix anything')
    await dispose()
    await waitUntil(() => {
      expect(uncertain).toHaveBeenCalledWith('global', 'db', 'stated')
    })
  })
})
