/**
 * HTTP embedder wire-boundary tests: OpenAI-compatible POST, fail loud on bad payloads.
 *
 * @module @huiliyi37/dsh-memory-sqlite/tests/embedder
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHttpEmbedder } from '../src/embedder.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** JSON embeddings response. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('createHttpEmbedder', () => {
  it('空输入零调用；isAvailable 恒 true；戳记随模型', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const embedder = createHttpEmbedder({
      url: 'https://example.test/v1/embeddings',
      model: 'm1',
      timeoutMs: 1000,
    })
    expect(embedder.id).toBe('http:m1')
    expect(embedder.isAvailable()).toBe(true)
    expect(await embedder.embed([])).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('成功路径：带 bearer、校验向量长度', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe('POST')
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret')
      const raw = init.body
      if (typeof raw !== 'string') throw new Error('expected string body')
      const body = JSON.parse(raw) as { model: string; input: string[] }
      expect(body).toEqual({ model: 'm1', input: ['a', 'b'] })
      return jsonResponse({ data: [{ embedding: [1, 0] }, { embedding: [0, 1] }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const embedder = createHttpEmbedder({
      url: 'https://example.test/v1/embeddings',
      model: 'm1',
      apiKey: 'secret',
      timeoutMs: 1000,
    })
    expect(await embedder.embed(['a', 'b'])).toEqual([[1, 0], [0, 1]])
  })

  it('空 apiKey 不带 authorization', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).has('authorization')).toBe(false)
      return jsonResponse({ data: [{ embedding: [1] }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const embedder = createHttpEmbedder({
      url: 'https://example.test/v1/embeddings',
      model: 'm1',
      apiKey: '',
      timeoutMs: 1000,
    })
    await embedder.embed(['a'])
  })

  it('HTTP 非 2xx fail loud', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)))
    const embedder = createHttpEmbedder({
      url: 'https://example.test/v1/embeddings',
      model: 'm1',
      timeoutMs: 1000,
    })
    await expect(embedder.embed(['a'])).rejects.toThrow(/HTTP 500/)
  })

  it('应答条数不符 fail loud', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [{ embedding: [1] }] })))
    const embedder = createHttpEmbedder({
      url: 'https://example.test/emb',
      model: 'm1',
      timeoutMs: 1000,
    })
    await expect(embedder.embed(['a', 'b'])).rejects.toThrow(/1 vector\(s\) for 2 text/)
  })

  it('缺 data 数组 fail loud', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    const embedder = createHttpEmbedder({
      url: 'https://example.test/emb',
      model: 'm1',
      timeoutMs: 1000,
    })
    await expect(embedder.embed(['a'])).rejects.toThrow(/no vector/)
  })

  it('非数组向量 fail loud', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [{ embedding: 'nope' }] })))
    const embedder = createHttpEmbedder({
      url: 'https://example.test/emb',
      model: 'm1',
      timeoutMs: 1000,
    })
    await expect(embedder.embed(['a'])).rejects.toThrow(/invalid vector at index 0/)
  })

  it('空向量 fail loud', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [{ embedding: [] }] })))
    const embedder = createHttpEmbedder({
      url: 'https://example.test/emb',
      model: 'm1',
      timeoutMs: 1000,
    })
    await expect(embedder.embed(['a'])).rejects.toThrow(/invalid vector at index 0/)
  })

  it('非有限分量 fail loud', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [{ embedding: [1, Number.NaN] }] })))
    const embedder = createHttpEmbedder({
      url: 'https://example.test/emb',
      model: 'm1',
      timeoutMs: 1000,
    })
    await expect(embedder.embed(['a'])).rejects.toThrow(/invalid vector at index 0/)
  })
})
