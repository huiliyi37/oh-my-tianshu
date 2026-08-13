/**
 * Vector index for semantic code search (Tianshu `src/search/vector-index.ts`
 * port). Stores one embedding per chunk id and answers nearest-neighbour
 * queries by brute-force cosine similarity — fast enough for a few thousand
 * chunks and keeps the implementation dependency-free. The on-disk snapshot
 * lives beside the BM25 index in `.rivet/`.
 *
 * @module @huiliyi37/dsh-semantic-index/vector-index
 */

export interface VectorHit {
  id: string
  score: number
}

/** On-disk snapshot shape of a {@link VectorIndex}. */
export interface VectorIndexSnapshot {
  version: number
  providerId: string
  dim: number
  entries: Array<{ id: string; vector: number[] }>
}

const VECTOR_INDEX_VERSION = 1

/**
 * Cosine similarity of two equal-length vectors. Returns 0 for degenerate input.
 * @param a - first vector.
 * @param b - second vector.
 * @returns cosine similarity in [0, 1], or 0 when lengths differ or norms vanish.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined || y === undefined) return 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** In-memory vector store keyed by chunk id (`${file}:${startLine}-${endLine}`). */
export class VectorIndex {
  private vectors = new Map<string, number[]>()
  private _providerId = ''

  /** Number of stored vectors. */
  get size(): number {
    return this.vectors.size
  }

  /** Provider id whose embeddings this store holds; set by the owner. */
  get providerId(): string {
    return this._providerId
  }

  set providerId(id: string) {
    this._providerId = id
  }

  /**
   * Whether an id already has a vector.
   * @param id - chunk id to test.
   * @returns true when a vector is stored under the id.
   */
  has(id: string): boolean {
    return this.vectors.has(id)
  }

  /**
   * Store one vector under a chunk id.
   * @param id - chunk id.
   * @param vector - embedding to store.
   */
  add(id: string, vector: number[]): void {
    this.vectors.set(id, vector)
  }

  /**
   * Drop one id.
   * @param id - chunk id to remove.
   */
  remove(id: string): void {
    this.vectors.delete(id)
  }

  /**
   * Remove every vector whose id starts with `${file}:` (chunk id convention).
   * @param file - workspace-relative file path.
   */
  removeFile(file: string): void {
    const prefix = `${file}:`
    for (const id of this.vectors.keys()) {
      if (id.startsWith(prefix)) this.vectors.delete(id)
    }
  }

  /** Drop all vectors. */
  clear(): void {
    this.vectors.clear()
  }

  /**
   * Nearest chunks to a query vector by cosine similarity.
   * @param queryVector - the query embedding.
   * @param limit - max hits to return.
   * @returns hits ordered by descending similarity; zero/negative-similarity
   * vectors are excluded.
   */
  search(queryVector: number[], limit = 10): VectorHit[] {
    if (this.vectors.size === 0 || queryVector.length === 0) return []
    const hits: VectorHit[] = []
    for (const [id, vec] of this.vectors) {
      const score = cosineSimilarity(queryVector, vec)
      if (score > 0) hits.push({ id, score })
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  /**
   * Export a JSON snapshot for persistence.
   * @returns the snapshot (versioned, provider-tagged).
   */
  toSnapshot(): VectorIndexSnapshot {
    const entries = [...this.vectors.entries()].map(([id, vector]) => ({ id, vector }))
    return {
      version: VECTOR_INDEX_VERSION,
      providerId: this._providerId,
      dim: entries[0]?.vector.length ?? 0,
      entries,
    }
  }

  /**
   * Load from a snapshot, but only when the provider matches (dimensions/model).
   * @param snapshot - persisted snapshot.
   * @param expectedProviderId - id of the provider that must have produced it.
   * @returns whether the snapshot was adopted.
   */
  loadSnapshot(snapshot: VectorIndexSnapshot, expectedProviderId: string): boolean {
    if (snapshot.version !== VECTOR_INDEX_VERSION) return false
    if (snapshot.providerId !== expectedProviderId) return false
    this.clear()
    this._providerId = snapshot.providerId
    for (const e of snapshot.entries) this.vectors.set(e.id, e.vector)
    return true
  }
}
