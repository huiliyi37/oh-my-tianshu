import { describe, expect, it } from 'vitest'
import { BM25Index, chunkFileContent, tokenize } from '../src/text-index.ts'

describe('tokenize', () => {
  it('splits identifiers on ASCII word boundaries, lowercased', () => {
    expect(tokenize('RequireAuth Middleware_2')).toEqual(['requireauth', 'middleware_2'])
  })

  it('splits CJK runs into overlapping bigrams so index and query share terms', () => {
    // "前缀缓存" and "前缀缓存命中率" must share 前缀/缀缓/缓存 — the recall
    // empty-turn root cause (2026-07-20) this tokenizer was built to fix.
    expect(tokenize('前缀缓存')).toEqual(['前缀', '缀缓', '缓存'])
    expect(tokenize('前缀缓存命中率')).toContain('前缀')
    expect(tokenize('前缀缓存命中率')).toContain('缓存')
  })

  it('keeps single CJK characters as single tokens', () => {
    expect(tokenize('啊')).toEqual(['啊'])
  })

  it('returns no tokens for punctuation-only input', () => {
    expect(tokenize('!!! ???')).toEqual([])
  })
})

describe('BM25Index', () => {
  it('returns no hits for an empty query or empty index', () => {
    const index = new BM25Index()
    expect(index.search('anything')).toEqual([])
    index.addChunk('a.ts', 1, 5, 'export function foo() {}')
    expect(index.search('')).toEqual([])
  })

  it('ranks the chunk sharing query terms above unrelated chunks', () => {
    const index = new BM25Index()
    index.addChunk('auth.ts', 1, 3, 'function requireAuth(req) { check token }')
    index.addChunk('theme.ts', 1, 3, 'function applyTheme() { colors }')

    const hits = index.search('requireAuth token', 10)
    expect(hits[0]?.file).toBe('auth.ts')
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0)
  })

  it('matches Chinese queries through shared bigrams', () => {
    const index = new BM25Index()
    index.addChunk('cache.ts', 1, 5, '前缀缓存命中率由 prompt 布局决定')
    index.addChunk('theme.ts', 1, 5, '主题色板')

    const hits = index.search('前缀缓存', 10)
    expect(hits[0]?.file).toBe('cache.ts')
  })

  it('keeps a per-file chunk set removable with DF counts updated', () => {
    const index = new BM25Index()
    index.addChunk('a.ts', 1, 3, 'shared term token')
    index.addChunk('a.ts', 5, 8, 'another chunk token')
    index.addChunk('b.ts', 1, 3, 'shared term')

    expect(index.size).toBe(3)
    expect(index.hasFile('a.ts')).toBe(true)

    const removed = index.removeFileChunks('a.ts')
    expect(removed).toBe(2)
    expect(index.size).toBe(1)
    expect(index.hasFile('a.ts')).toBe(false)

    // 'token' no longer appears in any chunk — DF must be fully drained.
    expect(index.search('token')).toEqual([])
  })

  it('serializes lightweight chunk refs without the terms map', () => {
    const index = new BM25Index()
    index.addChunk('a.ts', 1, 3, 'function alpha() {}')
    const refs = index.getChunkRefs()
    expect(refs).toEqual([{ file: 'a.ts', startLine: 1, endLine: 3, text: 'function alpha() {}' }])
  })

  it('recomputes average length after removal', () => {
    const index = new BM25Index()
    index.addChunk('a.ts', 1, 1, 'short')
    index.addChunk('b.ts', 1, 1, 'a much longer chunk of text here')
    index.removeFileChunks('b.ts')
    const hits = index.search('short')
    expect(hits[0]?.file).toBe('a.ts')
  })
})

describe('chunkFileContent', () => {
  it('splits long content into overlapping windows', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`)
    const chunks = chunkFileContent(lines.join('\n'), 40, 8)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]!.split('\n').length).toBeLessThanOrEqual(40)
  })

  it('drops all-blank windows', () => {
    expect(chunkFileContent('\n\n\n\n', 40, 8)).toEqual([])
  })
})
