import { displayWidth, ambiguousWideEnabled } from './width.js'

/** Display rows a single logical line occupies at the given width (wrapping-aware). */
function rowsFor(line: string, width: number): number {
  if (width <= 0) return 1
  // 与 LiveEngine.rowsForLine 同口径：ambiguous 符号在 CJK 终端按 2 列换行。
  return Math.max(1, Math.ceil(displayWidth(line, { ambiguousAsWide: ambiguousWideEnabled() }) / width))
}

/**
 * 多行文本在给定宽度下占的显示行总数（折行感知；空行也计 1 行）。
 * @param text - 待度量文本（按 `\n` 分行）。
 * @param width - 终端宽度（<=0 时每逻辑行按 1 行计）。
 * @returns 显示行总数。
 */
export function displayRowsForText(text: string, width: number): number {
  return text.split('\n').reduce((total, line) => total + rowsFor(line, width), 0)
}

const OMITTED_PREFIX = '… '
const OMITTED_PREFIX_NARROW = '…'

function charWidth(ch: string): number {
  return displayWidth(ch, { ambiguousAsWide: ambiguousWideEnabled() })
}

function takeTailByDisplayWidth(line: string, maxDisplayWidth: number): string {
  if (maxDisplayWidth <= 0) return ''

  const chars = Array.from(line)
  let width = 0
  let start = chars.length

  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i]
    /* v8 ignore next -- Array.from 结果无稀疏位；noUncheckedIndexedAccess 收窄防御 */
    if (ch === undefined) continue
    const nextWidth = width + charWidth(ch)
    if (nextWidth > maxDisplayWidth) break
    width = nextWidth
    start = i
  }

  return chars.slice(start).join('')
}

function takeTailByDisplayRows(line: string, width: number, rows: number): string {
  /* v8 ignore next -- 唯一调用方 capLiveTail 保证 remaining>0 才进入，此分支不可达 */
  if (rows <= 0) return ''
  /* v8 ignore next -- width<=0 时 rowsFor 恒 1、remaining 恒 0，partial-fit 永不发生 */
  if (width <= 0) return line
  return takeTailByDisplayWidth(line, rows * width)
}

function markOmittedHead(line: string, width: number): string {
  if (width <= 0) return `${OMITTED_PREFIX}${line}`

  const prefix = width > charWidth(OMITTED_PREFIX) ? OMITTED_PREFIX : OMITTED_PREFIX_NARROW
  const available = Math.max(0, rowsFor(line, width) * width - charWidth(prefix))
  return `${prefix}${takeTailByDisplayWidth(line, available)}`
}

/**
 * Cap the live tail to the last `maxRows` DISPLAY rows (wrapping-aware).
 *
 * The live (redrawn) region must never exceed the viewport, or Ink's relative
 * cursor-up erase clamps at the viewport top and the terminal scrolls/duplicates
 * every frame (真凶②). The bound must be in DISPLAY rows, not logical lines or
 * chars (R6): a line wider than the terminal wraps to multiple rows.
 *
 * This only trims the redrawn live region. Committed content already lives in
 * native scrollback (full, scrollable, searchable) — nothing here hides it.
 *
 * @param text - live 区全文（按 `\n` 分行）。
 * @param width - 终端宽度（折行成本按此计算）。
 * @param maxRows - 显示行上限（<=0 返回空串）。
 * @returns 裁到上限内的尾部文本；发生裁剪时首行加省略号前缀。
 */
export function capLiveTail(text: string, width: number, maxRows: number): string {
  if (maxRows <= 0) return ''
  const lines = text.split('\n')
  let rows = 0
  let omitted = false
  const kept: string[] = []

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    /* v8 ignore next -- split 结果无稀疏位；noUncheckedIndexedAccess 收窄防御 */
    if (line === undefined) continue
    const cost = rowsFor(line, width)
    if (rows + cost > maxRows) {
      // Partial-fit the oldest kept line by trimming its head to the remaining rows.
      const remaining = maxRows - rows
      if (remaining > 0) {
        kept.unshift(takeTailByDisplayRows(line, width, remaining))
      }
      omitted = true
      break
    }
    rows += cost
    kept.unshift(line)
  }

  if (omitted && kept.length > 0) {
    const first = kept[0]
    /* v8 ignore next -- kept.length>0 保证 kept[0] 必有值；noUncheckedIndexedAccess 收窄防御 */
    if (first !== undefined) kept[0] = markOmittedHead(first, width)
  }

  return kept.join('\n')
}

/** A line that opens/closes a fenced code block (``` at column 0). */
function isFenceLine(line: string): boolean {
  return line.startsWith('```')
}

/**
 * Like capLiveTail, but markdown-fence-aware for the LIVE streaming tail.
 *
 * The live view renders the tail through the markdown block parser, which pairs
 * ``` fences greedily (1st = open, 2nd = close, …). A raw tail slice can begin
 * INSIDE a code block — then the tail's first ``` is really the block's CLOSER,
 * but the parser reads it as an OPENER and boxes the following PROSE in a stray
 * "code" frame (real code ends up outside the box; the offset is the tell). It
 * flickers as the window slides each delta → "occasional code box around prose".
 *
 * Fix: count fences in the dropped head (everything above the visible tail). If
 * odd, the tail starts inside a code block, so prepend a synthetic ``` opener
 * that pairs with the inherited closer and realigns every fence after it. We
 * reserve one row for that opener so the result still fits maxRows.
 *
 * Operates on the FULL accumulated text (not a pre-slice) so the fence count is
 * correct; it only walks the trailing maxRows worth of lines for the visible
 * region, so cost stays bounded regardless of total reply length.
 *
 * @param fullText - 累积的完整流式文本（不能是预切片，否则围栏计数会错）。
 * @param width - 终端宽度。
 * @param maxRows - 显示行上限（<=0 返回空串；需补合成开栏时为其保留一行）。
 * @returns 裁剪后的尾部文本，必要时前置合成 ``` 开栏。
 */
export function capLiveTailMarkdownSafe(fullText: string, width: number, maxRows: number): string {
  if (maxRows <= 0) return ''
  const lines = fullText.split('\n')

  // Find the first line index that fits within maxRows display rows from the end.
  let rows = 0
  let firstKept = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    /* v8 ignore next -- split 结果无稀疏位；noUncheckedIndexedAccess 收窄防御 */
    if (line === undefined) continue
    const cost = rowsFor(line, width)
    if (rows + cost > maxRows) break
    rows += cost
    firstKept = i
  }

  // Fence parity of the dropped head. A partial mid-line cut at firstKept-1
  // can't be a fence start, so counting lines[0..firstKept) is correct.
  let fences = 0
  for (let i = 0; i < firstKept; i++) {
    const line = lines[i]
    /* v8 ignore next -- split 结果无稀疏位；noUncheckedIndexedAccess 收窄防御 */
    if (line === undefined) continue
    if (isFenceLine(line)) fences++
  }
  const startsInsideCode = fences % 2 === 1

  const tail = lines.slice(firstKept >= lines.length ? lines.length - 1 : firstKept).join('\n')
  // Reserve a row for the synthetic opener when we'll prepend one.
  const capped = capLiveTail(tail, width, startsInsideCode ? Math.max(1, maxRows - 1) : maxRows)
  return startsInsideCode ? '```\n' + capped : capped
}
