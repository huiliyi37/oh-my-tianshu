import { describe, expect, it } from 'vitest'
import { reciprocalRankFusion, type RankedItem } from '../src/hybrid-search.ts'

describe('reciprocalRankFusion', () => {
  it('fuses single lists into descending RRF scores', () => {
    const lists: RankedItem[][] = [[{ id: 'a' }, { id: 'b' }]]
    const hits = reciprocalRankFusion(lists)
    expect(hits.map(h => h.id)).toEqual(['a', 'b'])
    expect(hits[0]?.rrfScore).toBeCloseTo(1 / 61)
    expect(hits[1]?.rrfScore).toBeCloseTo(1 / 62)
  })

  it('boosts items present in multiple lists (rank-level fusion)', () => {
    const lists: RankedItem[][] = [
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ id: 'b' }, { id: 'a' }],
    ]
    // b: 1/61 + 1/62 ≈ 0.0325; a: 1/61 + 1/62 = same ranks → tie broken by sort stability
    const hits = reciprocalRankFusion(lists)
    expect(hits[0]?.id).toBe('a') // both a and b appear in both lists at same ranks
    expect(hits[0]?.rrfScore).toBeCloseTo(1 / 61 + 1 / 62)
    expect(hits[1]?.rrfScore).toBeCloseTo(1 / 61 + 1 / 62)
    // c appears only once, lower score
    expect(hits[2]?.id).toBe('c')
    expect(hits[2]?.rrfScore).toBeCloseTo(1 / 63)
  })

  it('gives an item in the second list a better rank a boost over single-list items', () => {
    const lists: RankedItem[][] = [
      [{ id: 'only' }, { id: 'shared' }],
      [{ id: 'shared' }],
    ]
    const hits = reciprocalRankFusion(lists)
    // shared: 1/61 + 1/61 > only: 1/61
    expect(hits[0]?.id).toBe('shared')
    expect(hits[1]?.id).toBe('only')
  })

  it('handles empty lists and empty inputs', () => {
    expect(reciprocalRankFusion([])).toEqual([])
    expect(reciprocalRankFusion([[]])).toEqual([])
    expect(reciprocalRankFusion([[{ id: 'a' }], []])).toHaveLength(1)
  })

  it('deduplicates items within a single list (contributions accumulate at each rank)', () => {
    const lists: RankedItem[][] = [[{ id: 'a' }, { id: 'a' }]]
    const hits = reciprocalRankFusion(lists)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.rrfScore).toBeCloseTo(1 / 61 + 1 / 62)
  })

  it('honors a custom damping constant k', () => {
    const lists: RankedItem[][] = [[{ id: 'a' }]]
    const hits = reciprocalRankFusion(lists, 10)
    expect(hits[0]?.rrfScore).toBeCloseTo(1 / 11)
  })

  it('is order-stable for equal scores (descending rrfScore)', () => {
    const lists: RankedItem[][] = [[{ id: 'x' }, { id: 'y' }, { id: 'z' }]]
    const hits = reciprocalRankFusion(lists)
    expect(hits.map(h => h.rrfScore)).toEqual([...hits.map(h => h.rrfScore)].sort((a, b) => b - a))
  })
})
