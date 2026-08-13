/**
 * Focused read — relevant-line selection + structural skeleton for the `read`
 * tool's `focus` parameter (Tianshu `src/tools/focused-read.ts` port).
 *
 * Deliberately deterministic and read-only. It does not claim that unselected
 * code is irrelevant; it makes the omission explicit and lets the caller read
 * an exact range when more evidence is needed.
 *
 * @module @deepseek-ai/dsh-tool-fs/src/focus
 */

/** Max chars of one focus string (normalized). */
const MAX_FOCUS_LENGTH = 240
const DEFAULT_MAX_MATCHES = 8
const DEFAULT_CONTEXT_LINES = 2
/** Max structural lines in the skeleton preview. */
const SKELETON_MAX_LINES = 8

const FOCUS_STOP_WORDS = new Set([
  'a', 'an', 'and', 'for', 'from', 'find', 'file', 'into', 'look', 'read', 'the', 'this', 'with',
  'please', 'show', 'where', 'what', 'which', 'code', 'source', 'implementation',
  '请', '帮我', '查找', '读取', '看看', '文件', '代码', '实现', '相关', '问题', '一下', '里面',
])

const STRUCTURAL_LINE = [
  /^\s*(?:import\b|export\b|(?:async\s+)?function\b|class\b|interface\b|type\b|enum\b)/,
  /^\s*(?:const\b|let\b|var\b|def\b|struct\b|impl\b|trait\b|#{1,6}\s)/,
]

/** 一行聚焦结果：1-based 行号 + 文本。 */
export interface FocusedLine {
  number: number
  text: string
}

/** 聚焦读取结果：命中的行段 + 结构骨架 + 是否命中。 */
export interface FocusedWindow {
  /** Selected high-signal lines (may be non-contiguous; each carries its 1-based number). */
  lines: FocusedLine[]
  totalLines: number
  /** Structural skeleton (top-level definition lines). */
  skeleton: string[]
  /** Whether any line matched the focus. */
  matched: boolean
}

/** Normalize a focus string: collapse whitespace, cap length. */
function normalizeFocus(focus: string): string {
  return focus.replace(/\s+/g, ' ').trim().slice(0, MAX_FOCUS_LENGTH)
}

/**
 * Tokenize a focus string for line scoring. English identifiers ≥2 chars
 * (stop words dropped) and CJK overlapping bigrams (stop-word bigrams
 * dropped) — same shape as the index tokenizer so both sides agree.
 * @param focus - raw focus text.
 * @returns scoring tokens.
 */
export function tokenizeFocus(focus: string): string[] {
  const fragments = normalizeFocus(focus).toLowerCase().match(/[a-z_$][a-z0-9_$-]{1,}|[\u4e00-\u9fff]+/g) ?? []
  const tokens = new Set<string>()
  for (const fragment of fragments) {
    if (/^[a-z_$]/.test(fragment)) {
      if (fragment.length >= 2 && !FOCUS_STOP_WORDS.has(fragment)) tokens.add(fragment)
      continue
    }
    if (fragment.length === 1) {
      if (!FOCUS_STOP_WORDS.has(fragment)) tokens.add(fragment)
      continue
    }
    for (let i = 0; i < fragment.length - 1; i++) {
      const bigram = fragment.slice(i, i + 2)
      if (!FOCUS_STOP_WORDS.has(bigram)) tokens.add(bigram)
    }
  }
  return [...tokens]
}

/** Score one line against the focus: full-phrase match, token hits, structural bonus. */
function scoreLine(line: string, focus: string, tokens: string[]): number {
  const lower = line.toLowerCase()
  const normalizedFocus = normalizeFocus(focus).toLowerCase()
  let score = 0
  if (normalizedFocus.length >= 4 && lower.includes(normalizedFocus)) score += 24
  let matches = 0
  for (const token of tokens) {
    if (!lower.includes(token)) continue
    matches++
    score += token.includes('_') || token.length >= 6 ? 7 : 3
  }
  if (matches > 1) score += matches * 2
  if (matches > 0 && STRUCTURAL_LINE.some(re => re.test(line))) score += 4
  return score
}

/** Merge adjacent/overlapping ranges and keep the max score. */
function mergeRanges(ranges: Array<{ start: number; end: number; score: number }>): Array<{ start: number; end: number; score: number }> {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number; score: number }> = []
  for (const range of sorted) {
    const previous = merged[merged.length - 1]
    if (previous === undefined || range.start > previous.end + 1) {
      merged.push({ ...range })
      continue
    }
    previous.end = Math.max(previous.end, range.end)
    previous.score = Math.max(previous.score, range.score)
  }
  return merged
}

/**
 * Extract the structural skeleton: top-level definition lines, capped.
 * @param content - full file text.
 * @param maxLines - skeleton line cap.
 * @returns definition lines (trimmed, 120 chars each).
 */
export function structuralSkeleton(content: string, maxLines = SKELETON_MAX_LINES): string[] {
  const skeleton: string[] = []
  for (const line of content.split('\n')) {
    if (skeleton.length >= maxLines) break
    if (STRUCTURAL_LINE.some(re => re.test(line))) skeleton.push(line.trim().slice(0, 120))
  }
  return skeleton
}

/**
 * Select high-signal line ranges for a task-oriented read. Deterministic and
 * read-only: rank lines by focus score, expand matches by a context margin,
 * merge adjacent ranges, then cap by an approximate budget.
 * @param content - full file text.
 * @param focus - focus query.
 * @param maxChars - approximate output budget for lines + skeleton.
 * @returns the focused window.
 */
export function focusedWindow(content: string, focus: string, maxChars: number): FocusedWindow {
  const lines = content.split('\n')
  const tokens = tokenizeFocus(focus)
  const normalizedFocus = normalizeFocus(focus)
  const contextLines = Math.max(0, Math.min(8, DEFAULT_CONTEXT_LINES))
  const maxMatches = Math.max(1, Math.min(20, DEFAULT_MAX_MATCHES))
  const budget = Math.max(800, Math.floor(maxChars))

  const ranked = tokens.length === 0
    ? []
    : lines
      .map((line, index) => ({ line, index, score: scoreLine(line, normalizedFocus, tokens) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)

  const selected = ranked.slice(0, maxMatches).map(entry => ({
    start: Math.max(0, entry.index - contextLines),
    end: Math.min(lines.length - 1, entry.index + contextLines),
    score: entry.score,
  }))
  let ranges = mergeRanges(selected)

  // Keep the highest-scoring ranges when broad windows exceed the budget.
  const renderSize = (rs: Array<{ start: number; end: number }>): number =>
    rs.reduce((sum, r) => sum + (r.end - r.start + 1), 0)
  while (ranges.length > 1 && renderSize(ranges) * 80 > Math.max(400, budget - 600)) {
    const lowest = ranges.reduce((index, range, current) => {
      const currentScore = ranges[index]?.score ?? 0
      return range.score < currentScore ? current : index
    }, 0)
    ranges = ranges.filter((_, index) => index !== lowest)
  }

  const windowLines: FocusedLine[] = []
  for (const range of ranges) {
    for (let i = range.start; i <= range.end; i++) {
      const text = lines[i]
      if (text !== undefined) windowLines.push({ number: i + 1, text })
    }
  }

  return {
    lines: windowLines,
    totalLines: lines.length,
    skeleton: structuralSkeleton(content),
    matched: ranges.length > 0,
  }
}
