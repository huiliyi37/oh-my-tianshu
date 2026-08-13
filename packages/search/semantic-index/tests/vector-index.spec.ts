import { describe, expect, it } from 'vitest'
import { cosineSimilarity, VectorIndex } from '../src/vector-index.ts'

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1)
  })

  it('scales with vector magnitude (cosine is magnitude-invariant)', () => {
    expect(cosineSimilarity([2, 4], [1, 2])).toBeCloseTo(1)
  })

  it('returns 0 for degenerate input (zero norms, empty, length mismatch)', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0)
  })
})

describe('VectorIndex', () => {
  it('stores and retrieves vectors by id', () => {
    const v = new VectorIndex()
    v.add('a.ts:1-10', [1, 0])
    expect(v.has('a.ts:1-10')).toBe(true)
    expect(v.size).toBe(1)
    v.remove('a.ts:1-10')
    expect(v.has('a.ts:1-10')).toBe(false)
    expect(v.size).toBe(0)
  })

  it('searches nearest neighbours by cosine similarity, best first', () => {
    const v = new VectorIndex()
    v.add('query-adjacent', [0.9, 0.1])
    v.add('orthogonal', [0.1, 0.9])
    v.add('opposite', [-0.9, -0.1])
    const hits = v.search([1, 0], 10)
    expect(hits[0]?.id).toBe('query-adjacent')
    expect(hits[1]?.id).toBe('orthogonal')
    // Negative-similarity hits are excluded entirely.
    expect(hits.some(h => h.id === 'opposite')).toBe(false)
  })

  it('respects the limit and skips zero-similarity vectors', () => {
    const v = new VectorIndex()
    v.add('a', [1, 0])
    v.add('b', [0, 1]) // orthogonal → similarity 0 → excluded
    v.add('c', [0.5, 0.5])
    expect(v.search([1, 0], 1).map(h => h.id)).toEqual(['a'])
    expect(v.search([1, 0], 10)).toHaveLength(2)
  })

  it('returns empty for an empty index or empty query vector', () => {
    const v = new VectorIndex()
    expect(v.search([1, 0])).toEqual([])
    v.add('a', [1, 0])
    expect(v.search([])).toEqual([])
  })

  it('removeFile drops every id with the file prefix', () => {
    const v = new VectorIndex()
    v.add('src/a.ts:1-10', [1, 0])
    v.add('src/a.ts:20-30', [0, 1])
    v.add('src/b.ts:1-10', [1, 1])
    v.removeFile('src/a.ts')
    expect(v.has('src/a.ts:1-10')).toBe(false)
    expect(v.has('src/a.ts:20-30')).toBe(false)
    expect(v.has('src/b.ts:1-10')).toBe(true)
    // Prefix collision safety: a file named `src/a` must not match `src/a.ts:*`.
    v.removeFile('src/a')
    expect(v.has('src/b.ts:1-10')).toBe(true)
  })

  it('clear drops everything', () => {
    const v = new VectorIndex()
    v.add('a', [1, 0])
    v.clear()
    expect(v.size).toBe(0)
  })

  it('round-trips through a snapshot with providerId and dim', () => {
    const v = new VectorIndex()
    v.providerId = 'fake'
    v.add('a.ts:1-10', [1, 0, 0])
    const snap = v.toSnapshot()
    expect(snap.version).toBe(1)
    expect(snap.providerId).toBe('fake')
    expect(snap.dim).toBe(3)
    expect(snap.entries).toHaveLength(1)

    const w = new VectorIndex()
    expect(w.loadSnapshot(snap, 'fake')).toBe(true)
    expect(w.size).toBe(1)
    expect(w.providerId).toBe('fake')
    expect(w.search([1, 0, 0])[0]?.id).toBe('a.ts:1-10')
  })

  it('rejects snapshots from a different provider or version', () => {
    const v = new VectorIndex()
    v.add('a', [1, 0])
    const snap = v.toSnapshot()

    const w = new VectorIndex()
    w.add('keep', [1, 1])
    expect(w.loadSnapshot(snap, 'other-provider')).toBe(false)
    expect(w.size).toBe(1) // untouched
    expect(w.loadSnapshot({ ...snap, version: 99 }, 'fake')).toBe(false)
    expect(w.size).toBe(1)
  })
})
