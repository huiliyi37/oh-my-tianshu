/**
 * Lightweight BM25 text index for semantic-ish code search (Tianshu
 * `src/search/text-index.ts` port). Pure TypeScript — no external embedding
 * models. Good enough for "find code related to authentication" within a
 * project.
 *
 * @module @deepseek-ai/dsh-semantic-index/text-index
 */

export interface IndexedChunk {
  id: string
  file: string
  startLine: number
  endLine: number
  text: string
  terms: Map<string, number>
  length: number
}

/** One ranked search result: chunk metadata plus the BM25 score. */
export interface SearchHit {
  id: string
  file: string
  startLine: number
  endLine: number
  text: string
  score: number
}

const TOKEN_RE = /[a-zA-Z_][a-zA-Z0-9_]{1,}|[\u4e00-\u9fff]+/g

/**
 * Tokenize text for BM25. CJK runs are split into overlapping bigrams so the
 * index and the query share terms ("前缀缓存" vs "前缀缓存命中率" both yield
 * 前缀/缀缓/缓存) — the 2026-07-20 recall empty-turn root cause.
 * @param text - raw text to tokenize.
 * @returns lowercased tokens; CJK bigrams for runs longer than one char.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const match of text.toLowerCase().matchAll(TOKEN_RE)) {
    const tok = match[0]
    if (tok.charCodeAt(0) >= 0x4e00) {
      if (tok.length === 1) tokens.push(tok)
      else for (let i = 0; i < tok.length - 1; i++) tokens.push(tok.slice(i, i + 2))
    } else {
      tokens.push(tok)
    }
  }
  return tokens
}

function termFreq(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>()
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1)
  }
  return freq
}

/** BM25 (k1=1.5, b=0.75) over definition-aligned text chunks. */
export class BM25Index {
  private chunks: IndexedChunk[] = []
  private df = new Map<string, number>()
  private avgLength = 0
  private readonly k1 = 1.5
  private readonly b = 0.75

  /** Number of indexed chunks. */
  get size(): number {
    return this.chunks.length
  }

  /**
   * Index one chunk, updating document-frequency counts and average length.
   * @param file - workspace-relative file path.
   * @param startLine - inclusive 1-based start line.
   * @param endLine - inclusive 1-based end line.
   * @param text - chunk text (also the searchable surface).
   */
  addChunk(file: string, startLine: number, endLine: number, text: string): void {
    const tokens = tokenize(text)
    const terms = termFreq(tokens)
    const id = `${file}:${startLine}-${endLine}`

    for (const term of terms.keys()) {
      this.df.set(term, (this.df.get(term) ?? 0) + 1)
    }

    this.chunks.push({ id, file, startLine, endLine, text, terms, length: tokens.length })
    this.avgLength = this.chunks.reduce((s, c) => s + c.length, 0) / Math.max(1, this.chunks.length)
  }

  /**
   * Rank chunks against a query by BM25.
   * @param query - free text; tokenized with the same bigram rules as indexing.
   * @param limit - max hits to return.
   * @returns hits ordered by descending score, each text preview capped at 500 chars.
   */
  search(query: string, limit = 10): SearchHit[] {
    const qTerms = tokenize(query)
    if (qTerms.length === 0 || this.chunks.length === 0) return []

    const N = this.chunks.length
    const scores: SearchHit[] = []

    for (const chunk of this.chunks) {
      let score = 0
      for (const term of qTerms) {
        const tf = chunk.terms.get(term) ?? 0
        if (tf === 0) continue
        const df = this.df.get(term) ?? 0
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
        const norm = tf * (this.k1 + 1) / (tf + this.k1 * (1 - this.b + this.b * chunk.length / this.avgLength))
        score += idf * norm
      }
      if (score > 0) {
        scores.push({
          id: chunk.id,
          file: chunk.file,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text.slice(0, 500),
          score,
        })
      }
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  /** Drop all chunks and term statistics. */
  clear(): void {
    this.chunks = []
    this.df.clear()
    this.avgLength = 0
  }

  /**
   * Remove all chunks belonging to a file, decrementing DF counts.
   * @param file - workspace-relative file path.
   * @returns the number of chunks removed.
   */
  removeFileChunks(file: string): number {
    const before = this.chunks.length
    const removed: IndexedChunk[] = []

    this.chunks = this.chunks.filter((chunk) => {
      if (chunk.file === file) {
        removed.push(chunk)
        return false
      }
      return true
    })

    for (const chunk of removed) {
      for (const term of chunk.terms.keys()) {
        const current = this.df.get(term)
        if (current !== undefined) {
          if (current <= 1) this.df.delete(term)
          else this.df.set(term, current - 1)
        }
      }
    }

    this.avgLength = this.chunks.length === 0
      ? 0
      : this.chunks.reduce((s, c) => s + c.length, 0) / this.chunks.length

    return before - this.chunks.length
  }

  /**
   * Whether any chunk belongs to the given file.
   * @param file - workspace-relative file path.
   * @returns true when at least one chunk of the file is indexed.
   */
  hasFile(file: string): boolean {
    return this.chunks.some(c => c.file === file)
  }

  /**
   * Export lightweight chunk refs for serialization (excludes the terms map).
   * @returns chunk references in insertion order.
   */
  getChunkRefs(): Array<{ file: string; startLine: number; endLine: number; text: string }> {
    return this.chunks.map(c => ({ file: c.file, startLine: c.startLine, endLine: c.endLine, text: c.text }))
  }
}

/**
 * Split file content into overlapping line windows.
 * @param content - full file text.
 * @param chunkLines - window size in lines.
 * @param overlap - lines shared between adjacent windows.
 * @returns non-blank windows.
 */
export function chunkFileContent(content: string, chunkLines = 40, overlap = 8): string[] {
  const lines = content.split('\n')
  const chunks: string[] = []
  for (let i = 0; i < lines.length; i += chunkLines - overlap) {
    chunks.push(lines.slice(i, i + chunkLines).join('\n'))
    if (i + chunkLines >= lines.length) break
  }
  return chunks.filter(c => c.trim().length > 0)
}
