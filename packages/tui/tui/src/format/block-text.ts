/**
 * Pixel block-letter brand text for the welcome hero.
 *
 * A hand-authored 10-row mixed-case pixel font for the wordmark glyph set,
 * rendered as half-block rows (two pixel rows per terminal cell) for twice
 * the vertical resolution of a plain full-block font — the difference between
 * mushy and crisp letterforms at terminal scale. Pure functions, no I/O.
 *
 * @module @huiliyi37/dsh-tui/format/block-text
 */

/** Ten pixel rows of one glyph; `#` marks an inked cell. */
type BlockGlyph = readonly [
  string, string, string, string, string,
  string, string, string, string, string,
]

const SPACE_GLYPH: BlockGlyph = [
  '  ', '  ', '  ', '  ', '  ',
  '  ', '  ', '  ', '  ', '  ',
]

/**
 * The wordmark glyph inventory: cap/ascender letters occupy rows 1–10,
 * x-height letters rows 4–10, and the `i` dot rows 1–2. Every row of a glyph
 * is exactly its advance width long, so layout never misaligns columns.
 */
const GLYPHS: Readonly<Record<string, BlockGlyph>> = {
  T: [
    '######',
    '  ##  ',
    '  ##  ',
    '  ##  ',
    '  ##  ',
    '  ##  ',
    '  ##  ',
    '  ##  ',
    '  ##  ',
    '  ##  ',
  ],
  i: [
    '## ',
    '## ',
    '   ',
    '## ',
    '## ',
    '## ',
    '## ',
    '## ',
    '## ',
    '## ',
  ],
  a: [
    '     ',
    '     ',
    '     ',
    ' ### ',
    '   ##',
    ' ####',
    '## ##',
    '## ##',
    '## ##',
    ' ####',
  ],
  n: [
    '     ',
    '     ',
    '     ',
    '#### ',
    '##  #',
    '##  #',
    '##  #',
    '##  #',
    '##  #',
    '##  #',
  ],
  s: [
    '     ',
    '     ',
    '     ',
    ' ####',
    '##   ',
    '##   ',
    ' ### ',
    '   ##',
    '##  #',
    '#### ',
  ],
  h: [
    '##   ',
    '##   ',
    '##   ',
    '#### ',
    '##  #',
    '##  #',
    '##  #',
    '##  #',
    '##  #',
    '##  #',
  ],
  u: [
    '     ',
    '     ',
    '     ',
    '##  #',
    '##  #',
    '##  #',
    '##  #',
    '##  #',
    '##  #',
    ' ####',
  ],
  ' ': SPACE_GLYPH,
}

/** Pixel rows of one laid-out block-text line. */
const BLOCK_TEXT_PIXEL_ROWS = 10

/**
 * Measures the block-text rendering width of a wordmark string in columns.
 *
 * @param text - Wordmark characters (unknown glyphs render as spaces).
 * @returns Column count including inter-glyph gaps, trailing gap excluded.
 */
export function measureBlockText(text: string): number {
  if (text.length === 0) return 0
  let width = 0
  // 字标字形集为纯 ASCII，split('') 与码点展开等价。
  for (const ch of text.split('')) width += (GLYPHS[ch]?.[0].length ?? SPACE_GLYPH[0].length) + 1
  return width - 1
}

/**
 * Lays out one wordmark string as ten pixel rows of `#` and spaces.
 *
 * @param text - Wordmark characters (unknown glyphs render as spaces).
 * @returns Ten rows; each row's trailing blanks are trimmed.
 */
export function layoutBlockText(text: string): string[] {
  const glyphs = text.split('').map(ch => GLYPHS[ch] ?? SPACE_GLYPH)
  const rows: string[] = []
  for (let row = 0; row < BLOCK_TEXT_PIXEL_ROWS; row++) {
    rows.push(glyphs.map(glyph => glyph[row] ?? '').join(' ').replace(/ +$/g, ''))
  }
  return rows
}

/**
 * Renders one wordmark string as five half-block terminal rows: each cell
 * holds two vertically stacked pixels (`█` both, `▀` top, `▄` bottom).
 *
 * @param text - Wordmark characters (unknown glyphs render as spaces).
 * @returns Five terminal rows; each row's trailing blanks are trimmed.
 */
export function formatBlockLines(text: string): string[] {
  const pixelRows = layoutBlockText(text)
  const lines: string[] = []
  for (let row = 0; row < BLOCK_TEXT_PIXEL_ROWS; row += 2) {
    const top = pixelRows[row] ?? ''
    const bottom = pixelRows[row + 1] ?? ''
    const width = Math.max(top.length, bottom.length)
    let line = ''
    for (let column = 0; column < width; column++) {
      const upper = top[column] === '#'
      const lower = bottom[column] === '#'
      line += upper && lower ? '█' : upper ? '▀' : lower ? '▄' : ' '
    }
    lines.push(line.replace(/ +$/g, ''))
  }
  return lines
}
