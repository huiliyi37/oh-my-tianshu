/**
 * Pluggable embedding provider seam for vector (RRF-fused) search (Tianshu
 * `src/search/embedding-provider.ts` interface port). The default
 * `NullEmbeddingProvider` never produces vectors, so `searchHybrid` degrades
 * to BM25 — embeddings are a strict upgrade, never a regression. A remote
 * provider is wired in by the tool package (or a deployment plugin) with
 * validated Config fields; the library itself carries no network code.
 *
 * @module @deepseek-ai/dsh-semantic-index/embedding-provider
 */

export interface EmbeddingProvider {
  /** Stable id for cache invalidation when the model changes. */
  readonly id: string
  /** True when embeddings can actually be produced. */
  isAvailable(): boolean
  /** Embed a batch of texts. Returns one vector per input, in order. */
  embed(texts: string[]): Promise<number[][]>
}

/** A provider that never produces vectors — forces BM25-only search. */
export class NullEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'null'
  isAvailable(): boolean {
    return false
  }
  embed(): Promise<number[][]> {
    return Promise.resolve([])
  }
}
