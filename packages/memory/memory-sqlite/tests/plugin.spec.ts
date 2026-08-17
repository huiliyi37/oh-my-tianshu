/**
 * Plugin apply: default-off embeddings/expansion, half-config fail loud, inject wins.
 *
 * @module @huiliyi37/dsh-memory-sqlite/tests/plugin
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import type { GenerateOptions, StreamChunk } from '@huiliyi37/dsh-llm'
import { MEMORY_KEY } from '@huiliyi37/dsh-memory'
import type { MemoryService } from '@huiliyi37/dsh-memory'
import type { EmbeddingProvider } from '@huiliyi37/dsh-semantic-index'
import { apply, Config, name } from '../src/index.ts'
import type { KeywordExpander } from '../src/expander.ts'

const dirs: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** 独立临时 root。 */
async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-sqlite-plugin-'))
  dirs.push(dir)
  return dir
}

/** 取插件 provide 的 memory 服务。 */
function memoryOf(ctx: Context): MemoryService {
  const memory = ctx.reflect.get(MEMORY_KEY, false) as MemoryService | undefined
  if (memory === undefined) throw new Error('memory service missing')
  return memory
}

/** 结束一条流。 */
function finish(reason: StreamChunk extends { type: 'finish'; reason: infer R } ? R : never): StreamChunk {
  return { type: 'finish', reason }
}

describe('memory-sqlite plugin', () => {
  it('named export 与 Config schema 存在', () => {
    expect(name).toBe('memory-sqlite')
    expect(Config).toBeDefined()
  })

  it('缺省 apply：provide memory，嵌入与扩展关闭', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    apply(ctx, { root, dbPath: ':memory:' })
    const memory = memoryOf(ctx)
    const saved = await memory.save({ text: 'pnpm workspace', scope: 'global', tags: ['tooling'], source: 'user' })
    const hits = await memory.search('workspace')
    expect(hits.map(hit => hit.id)).toEqual([saved.id])
    expect(typeof memory.topicVersions).toBe('function')
    await ctx.fiber.dispose()
  })

  it('dbPath 空串回落到 root/.dsh/memory/ltm.sqlite', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    apply(ctx, { root, dbPath: '' })
    const memory = memoryOf(ctx)
    await memory.save({ text: 'on disk', scope: 'global', tags: ['disk'], source: 'user' })
    await ctx.fiber.dispose()
    const again = new Context()
    apply(again, { root, dbPath: '' })
    expect(await memoryOf(again).list()).toHaveLength(1)
    await again.fiber.dispose()
  })

  it('半配 embeddingProvider http fail loud', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, { embeddingProvider: 'http' }) }).toThrow(/embeddingUrl and embeddingModel/)
    expect(() => { apply(ctx, { embeddingProvider: 'http', embeddingUrl: '', embeddingModel: 'm' }) })
      .toThrow(/embeddingUrl and embeddingModel/)
    expect(() => { apply(ctx, { embeddingProvider: 'http', embeddingUrl: 'https://example.test', embeddingModel: '' }) })
      .toThrow(/embeddingUrl and embeddingModel/)
  })

  it('半配 keywordExpansion llm fail loud；路由必须成对', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, { keywordExpansion: 'llm' }) })
      .toThrow(/keywordExpansionProvider and keywordExpansionModel/)
    expect(() => { apply(ctx, { keywordExpansionProvider: 'p' }) })
      .toThrow(/必须成对配置/)
    expect(() => { apply(ctx, { keywordExpansionModel: 'm' }) })
      .toThrow(/必须成对配置/)
  })

  it('keywordExpansion off 仍可携带成对路由（不启用）', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    apply(ctx, {
      root,
      dbPath: ':memory:',
      keywordExpansion: 'off',
      keywordExpansionProvider: 'p',
      keywordExpansionModel: 'm',
    })
    const saved = await memoryOf(ctx).save({ text: 'plain', scope: 'global', tags: ['note'], source: 'user' })
    expect(saved.tags).toEqual(['note'])
    await ctx.fiber.dispose()
  })

  it('第三参数 embedder 优先于 Config', async () => {
    const root = await tempRoot()
    const calls: string[][] = []
    const embedder: EmbeddingProvider = {
      id: 'inject-v1',
      isAvailable: () => true,
      embed(texts) {
        calls.push([...texts])
        return Promise.resolve(texts.map(() => [1, 0, 0, 0]))
      },
    }
    const ctx = new Context()
    apply(ctx, { root, dbPath: ':memory:', embeddingProvider: '' }, embedder)
    await memoryOf(ctx).save({ text: 'injected', scope: 'global', tags: ['x'], source: 'agent' })
    expect(calls).toEqual([['injected']])
    await ctx.fiber.dispose()
  })

  it('第四参数 expander 优先于 Config', async () => {
    const root = await tempRoot()
    const expander: KeywordExpander = () => Promise.resolve(['extra'])
    const ctx = new Context()
    apply(ctx, { root, dbPath: ':memory:', keywordExpansion: 'off' }, undefined, expander)
    const saved = await memoryOf(ctx).save({ text: 'body', scope: 'global', tags: ['note'], source: 'user' })
    expect(saved.tags).toEqual(['note', 'extra'])
    await ctx.fiber.dispose()
  })

  it('keywordExpansion llm 未装配 llm：save 按未扩展落库并 warn', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    apply(ctx, {
      root,
      dbPath: ':memory:',
      keywordExpansion: 'llm',
      keywordExpansionProvider: 'p',
      keywordExpansionModel: 'm',
    })
    const saved = await memoryOf(ctx).save({ text: 'body', scope: 'global', tags: ['note'], source: 'user' })
    expect(saved.tags).toEqual(['note'])
    expect(warn.mock.calls.some(call => String(call[0]).includes('关键词扩展失败'))).toBe(true)
    await ctx.fiber.dispose()
  })

  it('keywordExpansion llm：stop 产出扩展词', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    ctx.provide('llm', {
      stream: async function* (): AsyncIterable<StreamChunk> {
        yield { type: 'text-delta', index: 0, text: '["synonym"]' }
        yield finish({ kind: 'stop' })
      },
    })
    apply(ctx, {
      root,
      dbPath: ':memory:',
      keywordExpansion: 'llm',
      keywordExpansionProvider: 'p',
      keywordExpansionModel: 'm',
      keywordExpansionEffort: 'off',
      keywordExpansionMaxInputChars: 4000,
      keywordExpansionMaxOutputTokens: 300,
      keywordExpansionTimeoutMs: 5_000,
    })
    const saved = await memoryOf(ctx).save({ text: 'body', scope: 'global', tags: ['note'], source: 'user' })
    expect(saved.tags).toEqual(['note', 'synonym'])
    await ctx.fiber.dispose()
  })

  it('keywordExpansion llm：UNSUPPORTED_REASONING_EFFORT 后去掉 effort 重试', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    const efforts: Array<string | undefined> = []
    ctx.provide('llm', {
      stream: async function* (options: GenerateOptions): AsyncIterable<StreamChunk> {
        efforts.push(options.reasoningEffort)
        if (options.reasoningEffort !== undefined) {
          yield finish({ kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT', message: 'no' } })
          return
        }
        yield { type: 'text-delta', index: 0, text: '["retry-ok"]' }
        yield finish({ kind: 'stop' })
      },
    })
    apply(ctx, {
      root,
      dbPath: ':memory:',
      keywordExpansion: 'llm',
      keywordExpansionProvider: 'p',
      keywordExpansionModel: 'm',
      keywordExpansionEffort: 'high',
    })
    const saved = await memoryOf(ctx).save({ text: 'body', scope: 'global', tags: ['note'], source: 'user' })
    expect(efforts[0]).toBeDefined()
    expect(efforts[1]).toBeUndefined()
    expect(saved.tags).toEqual(['note', 'retry-ok'])
    await ctx.fiber.dispose()
  })

  it('keywordExpansion llm：error / aborted / 非 stop / 空文本 都按未扩展落库', async () => {
    const root = await tempRoot()
    const cases: StreamChunk[][] = [
      [finish({ kind: 'error', failure: { code: 'RATE_LIMIT', message: 'slow' } })],
      [finish({ kind: 'aborted', failure: { code: 'TIMEOUT', message: 'deadline' } })],
      [finish({ kind: 'max-tokens' })],
      [{ type: 'text-delta', index: 0, text: '   ' }, finish({ kind: 'stop' })],
      [{ type: 'reasoning-delta', index: 0, text: 'think' }, finish({ kind: 'stop' })],
    ]
    for (const chunks of cases) {
      const ctx = new Context()
      vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
      ctx.provide('llm', {
        stream: async function* (): AsyncIterable<StreamChunk> {
          yield* chunks
        },
      })
      apply(ctx, {
        root,
        dbPath: ':memory:',
        keywordExpansion: 'llm',
        keywordExpansionProvider: 'p',
        keywordExpansionModel: 'm',
      })
      const saved = await memoryOf(ctx).save({ text: 'body', scope: 'global', tags: ['note'], source: 'user' })
      expect(saved.tags).toEqual(['note'])
      await ctx.fiber.dispose()
    }
  })

  it('Config http embedder 走 fetch；注入优先', async () => {
    const root = await tempRoot()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ embedding: [1, 0] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const ctx = new Context()
    apply(ctx, {
      root,
      dbPath: ':memory:',
      embeddingProvider: 'http',
      embeddingUrl: 'https://example.test/v1/embeddings',
      embeddingModel: 'm1',
      embeddingApiKey: 'k',
      embeddingTimeoutMs: 1000,
    })
    await memoryOf(ctx).save({ text: 'via http', scope: 'global', tags: ['x'], source: 'agent' })
    expect(vi.mocked(fetch)).toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
