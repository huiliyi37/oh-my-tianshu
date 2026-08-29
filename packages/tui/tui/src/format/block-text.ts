/**
 * Pixel block-letter brand text for the welcome hero.
 *
 * A hand-authored 5×5 block font covering the wordmark glyph set. Rendering
 * maps `#` cells to `█` under the caller's color, preserving the pixel-art
 * aesthetic of the mascot bands. Pure functions with no terminal I/O.
 *
 * @module @huiliyi37/dsh-tui/format/block-text
 */

/** Five-row pixel rows of one glyph; `#` marks an inked cell. */
type BlockGlyph = readonly [string, string, string, string, string]

const SPACE_GLYPH: BlockGlyph = ['   ', '   ', '   ', '   ', '   ']

const GLYPHS: Readonly<Record<string, BlockGlyph>> = {
  O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
  H: ['#   #', '#   #', '#####', '#   #', '#   #'],
  M: ['#   #', '## ##', '# # #', '#   #', '#   #'],
  Y: ['#   #', ' # # ', '  #  ', '  #  ', '  #  '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '],
  I: ['#####', '  #  ', '  #  ', '  #  ', '#####'],
  A: [' ### ', '#   #', '#####', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
  S: [' ####', '#    ', ' ### ', '    #', '#### '],
  U: ['#   #', '#   #', '#   #', '#   #', ' ### '],
  R: ['#### ', '#   #', '#### ', '# #  ', '#  # '],
  E: ['#####', '#    ', '#### ', '#    ', '#####'],
  '>': ['#    ', ' #   ', '  #  ', ' #   ', '#    '],
  '<': ['    #', '   # ', '  #  ', '   # ', '    #'],
  ' ': SPACE_GLYPH,
}

/** Terminal rows occupied by one block-text line. */
const BLOCK_TEXT_ROWS = 5

/**
 * Measures the block-text rendering width of a wordmark string in columns.
 *
 * @param text - Wordmark characters (unknown glyphs render as spaces).
 * @returns Column count including inter-glyph gaps, trailing gap excluded.
 */
export function measureBlockText(text: string): number {
  if (text.length === 0) return 0
  let width = 0
  for (const ch of text) width += (GLYPHS[ch]?.[0].length ?? SPACE_GLYPH[0].length) + 1
  return width - 1
}

/**
 * Lays out one wordmark string as five pixel rows of `#` and spaces.
 *
 * @param text - Wordmark characters (unknown glyphs render as spaces).
 * @returns Five rows; each row's trailing blanks are trimmed.
 */
export function layoutBlockText(text: string): string[] {
  // 字标字形集为纯 ASCII，split('') 与码点展开等价。
  const glyphs = text.split('').map(ch => GLYPHS[ch] ?? SPACE_GLYPH)
  const rows: string[] = []
  for (let row = 0; row < BLOCK_TEXT_ROWS; row++) {
    rows.push(glyphs.map(glyph => glyph[row] ?? '').join(' ').replace(/ +$/g, ''))
  }
  return rows
}

/**
 * Renders block-text pixel rows as terminal lines: inked cells become `█`
 * under the given color, blanks stay blank.
 *
 * @param rows - Pixel rows from {@link layoutBlockText}.
 * @param paint - Color applier for one inked run (receives the `█` run).
 * @returns Terminal lines ready for the welcome hero details column.
 */
export function renderBlockRows(
  rows: readonly string[],
  paint: (ink: string) => string,
): string[] {
  return rows.map(row => row.replace(/#+/g, ink => paint(ink.replaceAll('#', '█'))))
}
