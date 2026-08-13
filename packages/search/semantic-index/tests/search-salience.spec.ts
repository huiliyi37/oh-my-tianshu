import { describe, expect, it } from 'vitest'
import { reciprocalRankFusion } from '../src/hybrid-search.ts'
import { rankSearchCandidates, searchPathSalience } from '../src/search-salience.ts'

describe('searchPathSalience', () => {
  it('zeroes out generated segments', () => {
    expect(searchPathSalience('node_modules/pkg/index.ts')).toBe(0)
    expect(searchPathSalience('dist/bundle.js')).toBe(0)
    expect(searchPathSalience('packages/foo/build/out.js')).toBe(0)
  })

  it('favors src/ implementations', () => {
    expect(searchPathSalience('src/index.ts')).toBeCloseTo(1.08)
    expect(searchPathSalience('packages/foo/src/index.ts')).toBeCloseTo(1.08)
    expect(searchPathSalience('docs/architecture.md')).toBeCloseTo(0.72)
  })

  it('penalizes tests and fixtures unless the query is test-focused', () => {
    // src/ bonus (1.08) multiplies the test penalty (0.62).
    expect(searchPathSalience('src/foo.test.ts', 'auth logic')).toBeCloseTo(1.08 * 0.62)
    expect(searchPathSalience('src/foo.test.ts', 'test coverage')).toBeCloseTo(1.08)
    expect(searchPathSalience('fixtures/data.json', 'auth')).toBeCloseTo(0.55)
    expect(searchPathSalience('fixtures/data.json', 'test fixture')).toBe(1)
  })

  it('penalizes docs unless the query is doc-focused', () => {
    expect(searchPathSalience('docs/architecture.md', 'auth')).toBeCloseTo(0.72)
    // README is not under src/, so doc focus merely lifts the penalty.
    expect(searchPathSalience('README.md', 'documentation')).toBe(1)
  })
})

describe('rankSearchCandidates', () => {
  it('keeps a per-file quota so one noisy file cannot displace others', () => {
    const candidates = [
      { file: 'src/a.ts', score: 10 },
      { file: 'src/a.ts', score: 9 },
      { file: 'src/a.ts', score: 8 },
      { file: 'src/b.ts', score: 7 },
      { file: 'src/b.ts', score: 6 },
    ]
    const ranked = rankSearchCandidates(candidates, 'auth', 5)
    // With maxPerFile=2, at most two hits per file survive.
    const perFile = new Map<string, number>()
    for (const hit of ranked) perFile.set(hit.file, (perFile.get(hit.file) ?? 0) + 1)
    for (const count of perFile.values()) expect(count).toBeLessThanOrEqual(2)
  })

  it('filters out zero-salience candidates', () => {
    const candidates = [
      { file: 'src/a.ts', score: 10 },
      { file: 'dist/b.js', score: 100 },
    ]
    const ranked = rankSearchCandidates(candidates, 'auth', 5)
    expect(ranked.map(h => h.file)).toEqual(['src/a.ts'])
  })

  it('returns an empty list for empty input', () => {
    expect(rankSearchCandidates([], 'auth', 5)).toEqual([])
  })

  it('stays deterministic under score ties (index order preserved)', () => {
    const candidates = [
      { file: 'src/x.ts', score: 1 },
      { file: 'src/y.ts', score: 1 },
      { file: 'src/z.ts', score: 1 },
    ]
    const ranked = rankSearchCandidates(candidates, 'auth', 5)
    expect(ranked.map(h => h.file)).toEqual(['src/x.ts', 'src/y.ts', 'src/z.ts'])
  })
})

describe('reciprocalRankFusion', () => {
  it('fuses ranked lists by reciprocal rank with k=60', () => {
    const fused = reciprocalRankFusion([
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'b' }, { id: 'c' }],
    ])
    // b appears in both lists: 1/61 + 1/62 > a's 1/61 alone.
    expect(fused[0]!.id).toBe('b')
    expect(fused.map(f => f.id)).toEqual(['b', 'a', 'c'])
    expect(fused[0]!.rrfScore).toBeCloseTo(1 / 61 + 1 / 62)
  })

  it('handles empty lists and single-list input', () => {
    expect(reciprocalRankFusion([])).toEqual([])
    const single = reciprocalRankFusion([[{ id: 'x' }, { id: 'y' }]])
    expect(single.map(f => f.id)).toEqual(['x', 'y'])
  })

  it('respects a custom damping constant', () => {
    const fused = reciprocalRankFusion([[{ id: 'a' }]], 1)
    expect(fused[0]!.rrfScore).toBeCloseTo(1 / 2)
  })
})
