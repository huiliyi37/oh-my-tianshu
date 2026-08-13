/**
 * Hybrid search: fuse BM25 (lexical) and vector (semantic) rankings (Tianshu
 * `src/search/hybrid-search.ts` port). Reciprocal Rank Fusion (RRF) is used
 * rather than score normalization because BM25 and cosine scores live on
 * incomparable scales — RRF only needs the rank of each item in each list.
 *
 * @module @huiliyi37/dsh-semantic-index/hybrid-search
 */

export interface RankedItem {
  id: string
}

/** One fused hit: item id plus its RRF score. */
export interface FusedHit {
  id: string
  rrfScore: number
}

/**
 * Reciprocal Rank Fusion over any number of ranked lists.
 * @param lists - each list ordered best-first.
 * @param k - damping constant (60 is the canonical default).
 * @returns fused hits ordered by descending RRF score.
 */
export function reciprocalRankFusion(lists: RankedItem[][], k = 60): FusedHit[] {
  const scores = new Map<string, number>()
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank]?.id
      if (id === undefined) continue
      const contribution = 1 / (k + rank + 1)
      scores.set(id, (scores.get(id) ?? 0) + contribution)
    }
  }
  return [...scores.entries()]
    .map(([id, rrfScore]) => ({ id, rrfScore }))
    .sort((a, b) => b.rrfScore - a.rrfScore)
}
