/**
 * Semantic index — file-level BM25 incremental index with hash staleness
 * detection and JSON persistence (Tianshu `src/search/` port).
 *
 * The single index implementation carries both the lexical (BM25) and the
 * optional vector (RRF-fused) retrieval paths; with no embedding provider
 * wired in, `searchHybrid` degrades to pure BM25.
 *
 * @module @huiliyi37/dsh-semantic-index
 */

export * from './text-index.ts'
export * from './chunker.ts'
export * from './search-salience.ts'
export * from './hybrid-search.ts'
export * from './embedding-provider.ts'
export * from './semantic-index.ts'
