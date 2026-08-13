/**
 * Language-aware heuristic chunking for the semantic index (Tianshu
 * `src/search/chunker-treesitter.ts` sync path port). Splits file content along
 * definition boundaries (function/class/enum…) with a line-window fallback for
 * languages without a definition pattern. The async tree-sitter path of the
 * upstream is not ported — this synchronous, dependency-free heuristic is the
 * baseline; precise tree-sitter chunking belongs to the Wave 5 Meridian work.
 *
 * Chunks carry 1-based inclusive line ranges.
 *
 * @module @huiliyi37/dsh-semantic-index/chunker
 */

import { chunkFileContent } from './text-index.ts'

/** One chunk: 1-based inclusive line range plus the chunk text. */
export interface Chunk {
  startLine: number
  endLine: number
  text: string
}

/** Per-language regexes that mark the start of a top-level definition. */
const DEFINITION_PATTERNS: Record<string, RegExp[]> = {
  ts: [/^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum)\s/, /^\s*(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/],
  py: [/^\s*(async\s+)?def\s+\w+/, /^\s*class\s+\w+/],
  go: [/^\s*func\s+/, /^\s*type\s+\w+\s+/],
  rs: [/^\s*(pub\s+)?(async\s+)?fn\s+/, /^\s*(pub\s+)?(struct|enum|trait|impl|mod)\s/],
  java: [
    /^\s*(public|private|protected|static|final|abstract|\s)*\s*(class|interface|enum)\s/,
    /^\s*(public|private|protected|static|final|abstract|synchronized|\s)+[\w<>\[\],\s]+\s+\w+\s*\(/,
  ],
  c: [/^\s*[\w*]+\s+[\w*]+\s*\([^;]*\)\s*\{?$/, /^\s*(struct|enum|union|class)\s+\w+/, /^\s*(public|private|protected):/],
  rb: [/^\s*(def|class|module)\s+/],
  php: [/^\s*(public|private|protected|static|abstract|final|\s)*\s*function\s+/, /^\s*(class|interface|trait)\s+/],
}

const EXT_TO_FAMILY: Record<string, keyof typeof DEFINITION_PATTERNS> = {
  '.ts': 'ts', '.tsx': 'ts', '.js': 'ts', '.jsx': 'ts', '.mjs': 'ts', '.cjs': 'ts',
  '.py': 'py', '.pyi': 'py',
  '.go': 'go',
  '.rs': 'rs',
  '.java': 'java', '.kt': 'java', '.scala': 'java',
  '.c': 'c', '.h': 'c', '.cpp': 'c', '.cc': 'c', '.cxx': 'c', '.hpp': 'c', '.hh': 'c', '.cs': 'java',
  '.rb': 'rb',
  '.php': 'php',
}

/** Soft cap: split definition chunks larger than this many lines into windows. */
const MAX_CHUNK_LINES = 120
const MIN_CHUNK_LINES = 4

/**
 * Resolve the definition family for a file extension.
 * @param ext - extension including the leading dot.
 * @returns the family name, or null when no definition pattern exists.
 */
export function familyForExt(ext: string): keyof typeof DEFINITION_PATTERNS | null {
  return EXT_TO_FAMILY[ext] ?? null
}

/**
 * Heuristic, synchronous, language-aware chunking. Splits on definition-start
 * lines so functions/classes land in their own chunk. Falls back to line-window
 * chunking for languages without a definition pattern (markdown, json, etc.).
 * @param content - full file text.
 * @param ext - file extension including the leading dot.
 * @returns chunks with 1-based inclusive line ranges.
 */
export function chunkByDefinitions(content: string, ext: string): Chunk[] {
  const family = familyForExt(ext)
  if (family === null) {
    return windowChunks(content)
  }
  const patterns = DEFINITION_PATTERNS[family]
  if (patterns === undefined) {
    return windowChunks(content)
  }
  const lines = content.split('\n')
  const boundaries: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined && patterns.some(p => p.test(line))) boundaries.push(i)
  }
  if (boundaries.length === 0) return windowChunks(content)

  // Ensure we capture any preamble before the first definition.
  if (boundaries[0] !== undefined && boundaries[0] > 0) boundaries.unshift(0)

  const chunks: Chunk[] = []
  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b]
    if (start === undefined) continue
    const end = b + 1 < boundaries.length ? (boundaries[b + 1] ?? lines.length) - 1 : lines.length - 1
    const slice = lines.slice(start, end + 1)
    const text = slice.join('\n')
    if (text.trim().length === 0) continue
    if (slice.length > MAX_CHUNK_LINES) {
      // Sub-window a very large definition so a single chunk isn't huge.
      for (const sub of windowChunks(text)) {
        chunks.push({ startLine: start + sub.startLine, endLine: start + sub.endLine, text: sub.text })
      }
    } else {
      chunks.push({ startLine: start + 1, endLine: end + 1, text })
    }
  }
  // Fold only a tiny LEADING preamble fragment (imports/blank lines before the
  // first definition) into the following chunk; keep every real definition as
  // its own chunk so search can pinpoint functions/classes.
  return foldLeadingPreamble(chunks)
}

/** If the first chunk is a tiny non-definition preamble, merge it into the next. */
function foldLeadingPreamble(chunks: Chunk[]): Chunk[] {
  if (chunks.length < 2) return chunks
  const first = chunks[0]
  const second = chunks[1]
  if (first === undefined || second === undefined) return chunks
  const size = first.endLine - first.startLine + 1
  if (size < MIN_CHUNK_LINES) {
    const merged: Chunk = {
      startLine: first.startLine,
      endLine: second.endLine,
      text: `${first.text}\n${second.text}`,
    }
    return [merged, ...chunks.slice(2)]
  }
  return chunks
}

/**
 * Line-window chunking with 1-based line ranges.
 * @param content - full file text.
 * @param chunkLines - window size in lines.
 * @param overlap - lines shared between adjacent windows.
 * @returns non-blank chunks; falls back to raw splitting when windows all blank.
 */
export function windowChunks(content: string, chunkLines = 40, overlap = 8): Chunk[] {
  const lines = content.split('\n')
  const chunks: Chunk[] = []
  for (let i = 0; i < lines.length; i += chunkLines - overlap) {
    const slice = lines.slice(i, i + chunkLines)
    const text = slice.join('\n')
    if (text.trim().length > 0) {
      chunks.push({ startLine: i + 1, endLine: i + slice.length, text })
    }
    if (i + chunkLines >= lines.length) break
  }
  // Guard: if nothing produced (e.g. all blank), fall back to the raw splitter.
  if (chunks.length === 0) {
    let offset = 0
    for (const piece of chunkFileContent(content, chunkLines, overlap)) {
      const n = piece.split('\n').length
      chunks.push({ startLine: offset + 1, endLine: offset + n, text: piece })
      offset += n
    }
  }
  return chunks
}
