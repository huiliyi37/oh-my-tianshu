import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EmbeddingProvider } from '../src/embedding-provider.ts'
import { SemanticIndex } from '../src/semantic-index.ts'

/** Deterministic fake embeddings: term-fingerprint vectors, always available. */
class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'fake'
  isAvailable(): boolean {
    return true
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vec = new Array<number>(8).fill(0)
      for (let i = 0; i < text.length; i++) {
        vec[i % 8] = (vec[i % 8] ?? 0) + text.charCodeAt(i)
      }
      return vec
    })
  }
}

interface Fixture {
  root: string
  cleanup(): void
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'semantic-index-'))
  const cleanup = (): void => { rmSync(root, { recursive: true, force: true }) }
  return { root, cleanup }
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf-8')
  }
}

describe('SemanticIndex rebuild', () => {
  let fx: Fixture

  beforeEach(() => { fx = makeFixture() })
  afterEach(() => { fx.cleanup() })

  it('indexes source files and skips noise (node_modules, non-source, oversized)', () => {
    writeTree(fx.root, {
      'src/a.ts': 'export function alpha() { return 1 }',
      'src/b.py': 'def helper():\n    return 2',
      'node_modules/pkg/index.js': 'ignore me',
      'dist/out.js': 'ignore me too',
      'README.md': '# readme',
      'notes.txt': 'not a source ext',
      'huge.py': `x = ${'y'.repeat(200_001)}`,
    })
    const index = new SemanticIndex(fx.root)
    const result = index.rebuild()
    // a.ts + b.py + README.md (md is in SOURCE_EXT); node_modules/dist/txt/oversized skipped.
    expect(result.indexed).toBe(3)
    expect(result.skipped).toBeGreaterThanOrEqual(1)
    expect(index.chunkCount).toBeGreaterThan(0)
    const hits = index.search('alpha')
    expect(hits[0]?.file).toBe('src/a.ts')
  })

  it('stays fresh: isStale detects file edits, additions, and deletions', () => {
    writeTree(fx.root, { 'src/a.ts': 'export function alpha() { return 1 }' })
    const index = new SemanticIndex(fx.root, undefined, { staleTtlMs: 0 })
    index.rebuild()
    expect(index.isStale()).toBe(false)

    writeFileSync(join(fx.root, 'src/a.ts'), 'export function alpha() { return 2 }', 'utf-8')
    expect(index.isStale()).toBe(true)

    index.incrementalUpdate()
    expect(index.isStale()).toBe(false)
    expect(index.search('alpha')[0]?.text).toContain('return 2')

    writeTree(fx.root, { 'src/new.ts': 'export const added = 1' })
    expect(index.isStale()).toBe(true)
    index.incrementalUpdate()
    expect(index.search('added').length).toBeGreaterThan(0)

    rmSync(join(fx.root, 'src/a.ts'))
    expect(index.isStale()).toBe(true)
    index.incrementalUpdate()
    expect(index.search('alpha')).toEqual([])
  })

  it('falls back to a full rebuild when more than 20% of files changed', () => {
    writeTree(fx.root, {
      'src/a.ts': 'export const a = 1',
      'src/b.ts': 'export const b = 2',
      'src/c.ts': 'export const c = 3',
      'src/d.ts': 'export const d = 4',
      'src/e.ts': 'export const e = 5',
    })
    const index = new SemanticIndex(fx.root, undefined, { staleTtlMs: 0 })
    index.rebuild()
    // Rewrite every file except one: 4/5 changed ≥ 20% → fallback rebuild.
    for (const name of ['a', 'b', 'c', 'd']) {
      writeFileSync(join(fx.root, `src/${name}.ts`), `export const ${name} = ${Math.random()}`, 'utf-8')
    }
    const result = index.incrementalUpdate()
    expect(result.fallbackRebuild).toBe(true)
  })

  it('persists meta and restores chunks on cold start', () => {
    writeTree(fx.root, { 'src/a.ts': 'export function alpha() { return 1 }' })
    const first = new SemanticIndex(fx.root)
    first.rebuild()
    expect(first.search('alpha').length).toBeGreaterThan(0)

    // A second instance cold-starts from the persisted snapshot — searches work without a rebuild.
    const second = new SemanticIndex(fx.root)
    expect(second.search('alpha').length).toBeGreaterThan(0)
    expect(second.isStale()).toBe(false)
  })

  it('ignores a corrupt snapshot and rebuilds on demand', () => {
    writeTree(fx.root, { 'src/a.ts': 'export function alpha() { return 1 }' })
    mkdirSync(join(fx.root, '.rivet'), { recursive: true })
    writeFileSync(join(fx.root, '.rivet', 'semantic-index.json'), '{ not json', 'utf-8')
    const index = new SemanticIndex(fx.root)
    expect(index.chunkCount).toBe(0)
    index.rebuild()
    expect(index.search('alpha').length).toBeGreaterThan(0)
  })
})

describe('SemanticIndex searchHybrid', () => {
  let fx: Fixture

  beforeEach(() => { fx = makeFixture() })
  afterEach(() => { fx.cleanup() })

  it('degrades to BM25 when no embedding provider is available', async () => {
    writeTree(fx.root, { 'src/a.ts': 'export function alpha() { return 1 }' })
    const index = new SemanticIndex(fx.root)
    index.rebuild()
    const result = await index.searchHybrid('alpha')
    expect(result.backend).toBe('bm25')
    expect(result.hits[0]?.file).toBe('src/a.ts')
  })

  it('fuses BM25 and vector rankings through RRF when a provider is wired in', async () => {
    writeTree(fx.root, {
      'src/a.ts': 'export function alpha() { return 1 }',
      'src/b.ts': 'export function beta() { return 2 }',
    })
    const index = new SemanticIndex(fx.root, new FakeEmbeddingProvider())
    index.rebuild()
    expect(index.hasEmbeddings).toBe(true)
    const result = await index.searchHybrid('alpha', 10)
    expect(result.backend).toBe('hybrid')
    expect(result.hits[0]?.file).toBe('src/a.ts')
    // The hybrid path embeds chunks lazily and persists the vector snapshot.
    expect(result.hits.length).toBeGreaterThan(0)
  })

  it('limits hits and re-ranks by path salience', () => {
    writeTree(fx.root, {
      'src/impl.ts': 'export function auth() {}',
      'src/impl.test.ts': 'describe("auth", () => {})',
    })
    const index = new SemanticIndex(fx.root)
    index.rebuild()
    const hits = index.search('auth', 1)
    expect(hits.length).toBeLessThanOrEqual(1)
    expect(hits[0]?.file).toBe('src/impl.ts')
  })
})

describe('SemanticIndex vector top-up (regression: partial embeddings must be refilled)', () => {
  /** Provider that fails to embed the tail of its first batch (simulates a
   *  truncated batch — MAX_EMBED_CHUNKS cap or a partial provider failure) —
   *  then recovers, so the next search must top up the missing vectors. */
  class PartialEmbeddingProvider implements EmbeddingProvider {
    readonly id = 'partial'
    private calls = 0
    isAvailable(): boolean {
      return true
    }
    async embed(texts: string[]): Promise<number[][]> {
      this.calls++
      const partial = this.calls === 1
      return texts.map((_text, i) => (partial && i >= 2 ? [] : [1, 2, 3, 4]))
    }
  }

  let fx: Fixture

  beforeEach(() => { fx = makeFixture() })
  afterEach(() => { fx.cleanup() })

  it('refills chunks that missed a vector on the next hybrid search', async () => {
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      writeTree(fx.root, { [`src/${name}.ts`]: `export function ${name}() { return ${name} }` })
    }
    const index = new SemanticIndex(fx.root, new PartialEmbeddingProvider())
    index.rebuild()
    expect(index.chunkCount).toBe(5)

    // First search embeds only the first 2 chunks; the rest stay unembedded.
    await index.searchHybrid('alpha')
    const first = JSON.parse(readFileSync(join(fx.root, '.rivet', 'vector-index.json'), 'utf-8')) as { entries: unknown[] }
    expect(first.entries).toHaveLength(2)

    // A later search must top up the missing vectors (was: never refilled).
    await index.searchHybrid('epsilon')
    const second = JSON.parse(readFileSync(join(fx.root, '.rivet', 'vector-index.json'), 'utf-8')) as { entries: unknown[] }
    expect(second.entries).toHaveLength(5)
  })
})

describe('SemanticIndex staleness under maxFiles truncation (regression)', () => {
  let fx: Fixture

  beforeEach(() => { fx = makeFixture() })
  afterEach(() => { fx.cleanup() })

  it('is not permanently stale when the rebuild was truncated by maxFiles', () => {
    writeTree(fx.root, {
      'src/a.ts': 'export function alpha() { return 1 }',
      'src/b.ts': 'export function beta() { return 2 }',
      'src/c.ts': 'export function gamma() { return 3 }',
    })
    const index = new SemanticIndex(fx.root, undefined, { staleTtlMs: 0 })
    index.rebuild(2) // truncated: only 2 of 3 files indexed
    expect(index.listFiles()).toHaveLength(2)

    // Was: diskCount(3) > fileHashes.size(2) → isStale() forever true.
    expect(index.isStale()).toBe(false)
    expect(index.isStale()).toBe(false)
  })

  it('still detects new files after a truncated rebuild', () => {
    writeTree(fx.root, {
      'src/a.ts': 'export function alpha() { return 1 }',
      'src/b.ts': 'export function beta() { return 2 }',
      'src/c.ts': 'export function gamma() { return 3 }',
    })
    const index = new SemanticIndex(fx.root, undefined, { staleTtlMs: 0 })
    index.rebuild(2)
    expect(index.isStale()).toBe(false)

    writeTree(fx.root, { 'src/new.ts': 'export const added = 1' })
    expect(index.isStale()).toBe(true)
    index.incrementalUpdate()
    expect(index.isStale()).toBe(false)
  })

  it('reads as stale on a fresh instance so the first search builds the index', () => {
    writeTree(fx.root, { 'src/a.ts': 'export function alpha() { return 1 }' })
    const index = new SemanticIndex(fx.root, undefined, { staleTtlMs: 0 })
    // No snapshot yet, no files indexed — the count baseline is 0.
    expect(index.isStale()).toBe(true)
  })
})
