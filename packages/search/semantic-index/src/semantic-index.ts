/**
 * Semantic index — file-level BM25 index with incremental updates (Tianshu
 * `src/search/semantic-index.ts` port, single-index shape: the lexical BM25
 * and the optional vector RRF fusion live inside one implementation).
 *
 * dsh adjustments over the upstream: no module-level index cache — the owning
 * tool package holds the instance and manages its lifecycle; the embedding
 * provider seam stays injectable with `NullEmbeddingProvider` as the offline
 * default (degradation to BM25 is the documented behavior).
 *
 * @module @huiliyi37/dsh-semantic-index/semantic-index
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { chunkByDefinitions } from './chunker.ts'
import type { EmbeddingProvider } from './embedding-provider.ts'
import { NullEmbeddingProvider } from './embedding-provider.ts'
import { reciprocalRankFusion } from './hybrid-search.ts'
import { rankSearchCandidates } from './search-salience.ts'
import { BM25Index } from './text-index.ts'
import type { SearchHit } from './text-index.ts'
import { VectorIndex } from './vector-index.ts'
import type { VectorIndexSnapshot } from './vector-index.ts'

/** Cap on chunks embedded in one pass to bound first-search latency/cost. */
const MAX_EMBED_CHUNKS = 4000

/** `isStale()` verdict cache window — semantic_search can run at high
 *  frequency on the same event loop; avoid a full-repo rescan per call. */
export const STALE_CHECK_TTL_MS = 30_000

const INDEX_VERSION = 1
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.rivet', 'coverage', 'target', 'vendor', '__pycache__', '.venv', 'venv'])
// Polyglot: index a broad set of source languages, not just the TS/JS family.
const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi',
  '.go',
  '.rs',
  '.java', '.kt', '.scala',
  '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh',
  '.cs',
  '.rb', '.php', '.swift',
  '.lua', '.ex', '.exs', '.sh', '.bash',
  '.vue', '.svelte',
  '.md', '.json', '.yaml', '.yml', '.toml', '.sql',
])

/** Persisted snapshot of a {@link SemanticIndex} (file hashes + chunk refs). */
export interface SemanticIndexSnapshot {
  version: number
  fileHashes: Record<string, string>
  chunkCount: number
  builtAt: number
  /** Lightweight chunk refs for cold-start restore (excludes terms — regenerated from text). */
  chunks?: Array<{ file: string; startLine: number; endLine: number; text: string }>
  /** Total source files seen at last rebuild/incremental update — may exceed
   *  fileHashes.size when the maxFiles cap truncated indexing. Lets isStale()
   *  distinguish "new file" from "file beyond the cap". */
  scannedTotal?: number
}

/** Constructor options for {@link SemanticIndex}. */
export interface SemanticIndexOptions {
  /** `isStale()` verdict cache window in ms. */
  staleTtlMs?: number
}

/** File-level BM25 (and optionally vector) semantic index with JSON persistence. */
export class SemanticIndex {
  private index = new BM25Index()
  private fileHashes = new Map<string, string>()
  private cwd: string
  private provider: EmbeddingProvider
  private vectors = new VectorIndex()
  /** Set when chunks change so the next hybrid search re-embeds lazily. */
  private vectorsDirty = false
  /** Last `isStale()` verdict; reused for staleTtlMs to skip redundant rescans. */
  private staleCache: { at: number; stale: boolean } | null = null
  /** Total source files on disk at the last rebuild/incremental update —
   *  may exceed fileHashes.size when indexing was capped by maxFiles.
   *  undefined = unknown (legacy snapshot): staleness falls back to
   *  hash-only checks, never a permanently-stale verdict. */
  private scannedTotal: number | undefined = undefined
  private readonly staleTtlMs: number

  constructor(cwd: string, provider: EmbeddingProvider = new NullEmbeddingProvider(), opts?: SemanticIndexOptions) {
    this.cwd = cwd
    this.provider = provider
    this.staleTtlMs = opts?.staleTtlMs ?? STALE_CHECK_TTL_MS
    this.loadMeta()
    this.loadVectors()
  }

  private indexPath(): string {
    return join(this.cwd, '.rivet', 'semantic-index.json')
  }

  private vectorIndexPath(): string {
    return join(this.cwd, '.rivet', 'vector-index.json')
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16)
  }

  /** Load persisted snapshot on cold start. Restores fileHashes and chunks so
   *  `isStale()` works immediately and searches succeed without a full rebuild. */
  private loadMeta(): void {
    this.staleCache = null // reloaded state: any cached verdict no longer applies
    const path = this.indexPath()
    if (!existsSync(path)) return
    try {
      const raw = readFileSync(path, 'utf-8')
      const snapshot = JSON.parse(raw) as SemanticIndexSnapshot
      if (snapshot.version === INDEX_VERSION) {
        // Note: a corrupt snapshot missing fileHashes throws in the loop below
        // and is caught — treated the same as a version mismatch.
        this.scannedTotal = snapshot.scannedTotal
        for (const [relPath, hash] of Object.entries(snapshot.fileHashes)) {
          this.fileHashes.set(relPath, hash)
        }
        // Restore chunks so cold-start searches work without rebuild.
        if (snapshot.chunks) {
          for (const c of snapshot.chunks) {
            this.index.addChunk(c.file, c.startLine, c.endLine, c.text)
          }
        }
      }
    } catch {
      // Corrupt snapshot — rebuild on first ensureSemanticIndex call.
    }
  }

  /**
   * Full rebuild of the semantic index from source tree.
   * @param maxFiles - cap on files indexed in one pass (default 500); source
   * files beyond the cap are still counted for staleness accounting.
   * @returns how many files were indexed and how many were skipped.
   */
  rebuild(maxFiles = 500): { indexed: number; skipped: number } {
    this.index.clear()
    this.fileHashes.clear()
    this.vectors.clear()
    this.vectorsDirty = true
    this.scannedTotal = 0
    let indexed = 0
    let skipped = 0

    /* jscpd:ignore-start */
    const walk = (dir: string, depth = 0): void => {
      if (depth > 8) return
      let entries: string[]
      try {
        entries = readdirSync(dir)
      } catch {
        return
      }

      for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue
        const abs = join(dir, entry)
        let st: ReturnType<typeof statSync>
        try {
          st = statSync(abs)
        } catch {
          continue
        }

        if (st.isDirectory()) {
          walk(abs, depth + 1)
        } else if (st.isFile()) {
          const ext = entry.slice(entry.lastIndexOf('.'))
          if (!SOURCE_EXT.has(ext)) {
            /* jscpd:ignore-end */
            skipped++
            continue
          }
          // Count every source file for staleness accounting, even beyond the
          // maxFiles cap — otherwise scanIsStale() would compare diskCount
          // against a truncated fileHashes.size and report the index stale
          // forever (each semantic_search then triggers a full rebuild).
          this.scannedTotal = (this.scannedTotal ?? 0) + 1
          if (indexed >= maxFiles) continue
          const rel = relative(this.cwd, abs)
          let content: string
          try {
            content = readFileSync(abs, 'utf-8')
          } catch {
            skipped++
            continue
          }
          if (content.length > 200_000) {
            skipped++
            continue
          }

          const hash = this.hashContent(content)
          this.fileHashes.set(rel, hash)
          for (const c of chunkByDefinitions(content, ext)) {
            this.index.addChunk(rel, c.startLine, c.endLine, c.text)
          }
          indexed++
        }
      }
    }

    walk(this.cwd)
    this.persistMeta()
    // Index just synced with disk — record an accurate fresh verdict.
    this.staleCache = { at: Date.now(), stale: false }
    return { indexed, skipped }
  }

  /**
   * Check if the index is stale by comparing file hashes against the current
   * filesystem. The verdict is cached for staleTtlMs — callers may run this on
   * every search.
   * @returns true when the index no longer reflects the workspace.
   */
  isStale(): boolean {
    const now = Date.now()
    if (this.staleCache !== null && now - this.staleCache.at < this.staleTtlMs) return this.staleCache.stale
    const stale = this.scanIsStale()
    this.staleCache = { at: now, stale }
    return stale
  }

  /** Full filesystem scan backing isStale() — synchronous, like its caller. */
  private scanIsStale(): boolean {
    // Quick count check: new files added since last index. Compared against
    // scannedTotal (all source files seen at last update) rather than
    // fileHashes.size so a maxFiles-truncated rebuild does not read as
    // permanently stale. Falls back to fileHashes.size on legacy snapshots
    // (self-heals after the next persistMeta) and reads as stale on a fresh
    // instance (baseline 0) so the first search builds the index.
    let diskCount = 0
    const baseline = this.scannedTotal ?? this.fileHashes.size
    try {
      const walk = (dir: string, depth = 0): void => {
        if (depth > 8 || diskCount > baseline + 10) return
        let entries: string[]
        try {
          entries = readdirSync(dir)
        } catch {
          return
        }
        for (const entry of entries) {
          if (SKIP_DIRS.has(entry)) continue
          const abs = join(dir, entry)
          let st: ReturnType<typeof statSync>
          try {
            st = statSync(abs)
          } catch {
            continue
          }
          if (st.isDirectory()) {
            walk(abs, depth + 1)
          } else if (st.isFile()) {
            const ext = entry.slice(entry.lastIndexOf('.'))
            if (SOURCE_EXT.has(ext)) diskCount++
          }
        }
      }
      walk(this.cwd)
    } catch {
      // Count failure → fall through to hash check.
    }
    if (diskCount > baseline) return true

    for (const [relPath, storedHash] of this.fileHashes) {
      const absPath = join(this.cwd, relPath)
      if (!existsSync(absPath)) return true // file deleted
      try {
        const content = readFileSync(absPath, 'utf-8')
        if (this.hashContent(content) !== storedHash) return true
      } catch {
        return true // unreadable
      }
    }
    return false
  }

  /**
   * Incrementally update the index: detect changed/new/deleted files and
   * re-index. Falls back to a full rebuild when more than 20% of files changed.
   * @returns files re-indexed, files removed, and whether a full rebuild was
   * taken instead of the incremental path.
   */
  incrementalUpdate(): { reindexed: number; removed: number; fallbackRebuild: boolean } {
    const currentFiles = new Set<string>()
    const toReindex: string[] = []
    const toRemove: string[] = []

    // Collect current source files. Full traversal — no maxFiles cap here:
    // a truncated scan would miss changes beyond the cap and also record a
    // truncated scannedTotal below, keeping isStale() true forever (each
    // semantic_search then re-runs this update).
    const walk = (dir: string, depth = 0): void => {
      /* jscpd:ignore-start */
      if (depth > 8) return
      let entries: string[]
      try {
        entries = readdirSync(dir)
      } catch {
        return
      }
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue
        const abs = join(dir, entry)
        let st: ReturnType<typeof statSync>
        try {
          st = statSync(abs)
        } catch {
          continue
        }
        if (st.isDirectory()) {
          walk(abs, depth + 1)
        } else if (st.isFile()) {
          const ext = entry.slice(entry.lastIndexOf('.'))
          if (!SOURCE_EXT.has(ext)) continue
          /* jscpd:ignore-end */
          const rel = relative(this.cwd, abs)
          currentFiles.add(rel)
        }
      }
    }
    walk(this.cwd)
    this.scannedTotal = currentFiles.size

    // Find deleted files (in index but not on disk).
    for (const relPath of this.fileHashes.keys()) {
      if (!currentFiles.has(relPath)) toRemove.push(relPath)
    }

    // Find new/modified files.
    for (const relPath of currentFiles) {
      const absPath = join(this.cwd, relPath)
      try {
        const content = readFileSync(absPath, 'utf-8')
        if (content.length > 200_000) continue
        const hash = this.hashContent(content)
        if (this.fileHashes.get(relPath) !== hash) toReindex.push(relPath)
      } catch {
        toRemove.push(relPath)
      }
    }

    // Fallback: if too many files changed, do a full rebuild.
    const totalChanged = toRemove.length + toReindex.length
    const totalIndexed = this.fileHashes.size
    if (totalChanged >= Math.max(2, totalIndexed * 0.2)) {
      const result = this.rebuild()
      return { reindexed: result.indexed, removed: 0, fallbackRebuild: true }
    }

    if (toRemove.length > 0 || toReindex.length > 0) this.vectorsDirty = true

    // Remove deleted files from index.
    for (const relPath of toRemove) {
      this.index.removeFileChunks(relPath)
      this.vectors.removeFile(relPath)
      this.fileHashes.delete(relPath)
    }

    // Re-index changed files.
    let reindexed = 0
    for (const relPath of toReindex) {
      this.index.removeFileChunks(relPath)
      this.vectors.removeFile(relPath)
      this.fileHashes.delete(relPath)

      const absPath = join(this.cwd, relPath)
      try {
        const content = readFileSync(absPath, 'utf-8')
        const hash = this.hashContent(content)
        this.fileHashes.set(relPath, hash)
        const ext = relPath.slice(relPath.lastIndexOf('.'))
        for (const c of chunkByDefinitions(content, ext)) {
          this.index.addChunk(relPath, c.startLine, c.endLine, c.text)
        }
        reindexed++
      } catch {
        // Skip unreadable files.
      }
    }

    this.persistMeta()
    // Index just synced with disk — record an accurate fresh verdict.
    this.staleCache = { at: Date.now(), stale: false }
    return { reindexed, removed: toRemove.length, fallbackRebuild: false }
  }

  /**
   * Rank BM25 hits with path salience.
   * @param query - free text query.
   * @param limit - max hits to return.
   * @returns hits ordered by salience-adjusted score.
   */
  search(query: string, limit = 10): SearchHit[] {
    return rankSearchCandidates(this.index.search(query, Math.max(limit * 3, 20)), query, limit)
  }

  /** True when a usable embedding provider is wired in. */
  get hasEmbeddings(): boolean {
    return this.provider.isAvailable()
  }

  /** Number of indexed chunks. */
  get chunkCount(): number {
    return this.index.size
  }

  /**
   * Workspace-relative paths of indexed files (insertion order).
   * @returns indexed file paths.
   */
  listFiles(): string[] {
    return [...this.fileHashes.keys()]
  }

  /**
   * Embed any chunks missing a vector (lazy, batched, persisted). A provider
   * failure is swallowed — the vector layer simply stays partial and search
   * degrades to BM25. Returns the number of chunks embedded.
   */
  private async ensureVectors(): Promise<number> {
    if (!this.provider.isAvailable()) return 0
    this.vectors.providerId = this.provider.id
    const refs = this.index.getChunkRefs()
    const pending = refs
      .map(r => ({ id: `${r.file}:${r.startLine}-${r.endLine}`, text: r.text }))
      .filter(c => !this.vectors.has(c.id))
      .slice(0, MAX_EMBED_CHUNKS)
    if (pending.length === 0) {
      this.vectorsDirty = false
      return 0
    }
    try {
      const embeddings = await this.provider.embed(pending.map(p => p.text))
      let n = 0
      for (let i = 0; i < pending.length && i < embeddings.length; i++) {
        const item = pending[i]
        const vec = embeddings[i]
        if (item === undefined || vec === undefined || vec.length === 0) continue
        this.vectors.add(item.id, vec)
        n++
      }
      if (n > 0) this.persistVectors()
      this.vectorsDirty = false
      return n
    } catch {
      return 0
    }
  }

  private loadVectors(): void {
    if (!this.provider.isAvailable()) return
    const path = this.vectorIndexPath()
    if (!existsSync(path)) return
    try {
      const snapshot = JSON.parse(readFileSync(path, 'utf-8')) as VectorIndexSnapshot
      // Only adopt vectors produced by the SAME provider/model.
      this.vectors.loadSnapshot(snapshot, this.provider.id)
    } catch {
      // Corrupt → re-embed lazily.
    }
  }

  private persistVectors(): void {
    if (this.vectors.size === 0) return
    const dir = join(this.cwd, '.rivet')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(this.vectorIndexPath(), JSON.stringify(this.vectors.toSnapshot()), 'utf-8')
    } catch {
      // Best-effort.
    }
  }

  /**
   * Hybrid semantic search: fuse BM25 and vector rankings via RRF. Falls back
   * to pure BM25 when no embedding provider is available or embedding fails —
   * so this is always at least as good as the lexical path.
   * @param query - free text query.
   * @param limit - max hits.
   * @returns hits with the backend that produced them.
   */
  async searchHybrid(query: string, limit = 10): Promise<{ hits: SearchHit[]; backend: 'bm25' | 'hybrid' }> {
    const bm25Hits = this.index.search(query, Math.max(limit, 20))
    if (!this.provider.isAvailable()) {
      return { hits: rankSearchCandidates(bm25Hits, query, limit), backend: 'bm25' }
    }

    try {
      // Top up any chunks still missing a vector. The `< index.size` arm
      // matters: ensureVectors caps each pass at MAX_EMBED_CHUNKS and a
      // partial provider response leaves the rest unembedded — without this
      // comparison those chunks would never be embedded (the dirty flag is
      // cleared after the first pass).
      if (this.vectorsDirty || this.vectors.size < this.index.size) await this.ensureVectors()
      const [queryVec] = await this.provider.embed([query])
      if (queryVec === undefined || queryVec.length === 0 || this.vectors.size === 0) {
        return { hits: rankSearchCandidates(bm25Hits, query, limit), backend: 'bm25' }
      }
      const vectorHits = this.vectors.search(queryVec, Math.max(limit, 20))

      // Resolve any fused id back to a SearchHit. BM25 hits carry full
      // metadata; vector-only hits are reconstructed from the chunk ref table.
      const byId = new Map<string, SearchHit>()
      for (const h of bm25Hits) byId.set(h.id, h)
      if (vectorHits.some(v => !byId.has(v.id))) {
        for (const r of this.index.getChunkRefs()) {
          const id = `${r.file}:${r.startLine}-${r.endLine}`
          if (!byId.has(id)) {
            byId.set(id, {
              id,
              file: r.file,
              startLine: r.startLine,
              endLine: r.endLine,
              text: r.text.slice(0, 500),
              score: 0,
            })
          }
        }
      }

      const fused = reciprocalRankFusion([
        bm25Hits.map(h => ({ id: h.id })),
        vectorHits.map(v => ({ id: v.id })),
      ])
      const hits: SearchHit[] = []
      for (const f of fused) {
        const hit = byId.get(f.id)
        if (hit !== undefined) {
          hits.push({ ...hit, score: f.rrfScore })
          if (hits.length >= limit) break
        }
      }
      return { hits: rankSearchCandidates(hits, query, limit), backend: 'hybrid' }
    } catch {
      return { hits: rankSearchCandidates(bm25Hits, query, limit), backend: 'bm25' }
    }
  }

  /** Persist the meta snapshot (file hashes + chunk refs) to `.rivet/semantic-index.json`. */
  persistMeta(): void {
    // Persisted state may differ from a previously cached verdict — invalidate.
    this.staleCache = null
    const dir = join(this.cwd, '.rivet')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const snapshot: SemanticIndexSnapshot = {
      version: INDEX_VERSION,
      fileHashes: Object.fromEntries(this.fileHashes),
      chunkCount: this.index.size,
      builtAt: Date.now(),
      chunks: this.index.getChunkRefs(),
      ...(this.scannedTotal !== undefined ? { scannedTotal: this.scannedTotal } : {}),
    }
    writeFileSync(this.indexPath(), JSON.stringify(snapshot, null, 2), 'utf-8')
  }
}
