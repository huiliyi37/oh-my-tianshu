/**
 * Pure ANSI renderer for generated indexed welcome-fox frames.
 *
 * Runtime rendering consumes only generated palette indexes. It performs no
 * asset or filesystem I/O.
 */

import chalk from 'chalk'
import { ANSI, hexToRgb, rgbToXterm256 } from '../engine/ansi.js'
import { ambiguousWidthMode } from '../width.js'
import {
  WELCOME_FOX_BANDS,
  WELCOME_FOX_PALETTE,
} from './fox-frames.js'

type Ansi16Foreground = 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37
  | 90 | 91 | 92 | 93 | 94 | 95 | 96 | 97

/**
 * One non-transparent indexed color with its stable low-color approximation.
 *
 * Palette entries carry the canonical hex used by truecolor/xterm-256 plus a
 * fixed ANSI16 SGR code for level-1 terminals.
 */
export interface IndexedHalfBlockPaletteEntry {
  /** Canonical `#rrggbb` color used by truecolor and xterm-256 output. */
  rgb: `#${string}`
  /** Fixed ANSI16 foreground SGR code (`30–37` or `90–97`). */
  ansi16: Ansi16Foreground
}

/** Input for {@link renderIndexedHalfBlocks}. */
export interface RenderIndexedHalfBlocksInput {
  /** Pixel width represented by each indexed row. */
  width: number
  /** Hexadecimal palette-index rows; each pair becomes one terminal row. */
  rows: readonly string[]
  /** Palette whose null entries are transparent. */
  palette: readonly (IndexedHalfBlockPaletteEntry | null)[]
  /** Explicit terminal color level: 0, ANSI16, xterm-256, or truecolor. */
  colorLevel: number
  /**
   * Optional target terminal columns. When narrower than `width`, indexed
   * pixels are area-averaged to the target grid so the art scales down
   * proportionally instead of clipping.
   */
  targetWidth?: number
  /**
   * Optional sub-pixel glyph mode. `half` (default) maps one terminal cell
   * to 1×2 source pixels with two colors; `braille` maps one cell to 2×4
   * source pixels as an eight-dot braille cell with two colors, quadrupling
   * the effective pixel density at the same column and row footprint.
   */
  glyphs?: 'half' | 'braille'
}

/** Numeric per-cell color resolved from a palette entry before emission. */
interface CellColor {
  rgb: readonly [number, number, number]
  ansi16: Ansi16Foreground
}

interface ColorSequences {
  foreground: string
  background: string
}

const BG_DEFAULT = '\x1B[49m'

/** Standard ANSI16 palette RGB values in SGR code order (30–37, 90–97). */
const ANSI16_RGB: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0],
  [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
]

/**
 * Maps a cell RGB to the nearest standard ANSI16 SGR foreground code.
 *
 * Color distance uses the same perceptual R:G:B weighting as palette
 * quantization, so level-1 terminals approximate the generated palette in a
 * stable, palette-independent way.
 */
function nearestAnsi16(rgb: readonly [number, number, number]): Ansi16Foreground {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (const [code, candidate] of ANSI16_RGB.entries()) {
    const redDistance = rgb[0] - candidate[0]
    const greenDistance = rgb[1] - candidate[1]
    const blueDistance = rgb[2] - candidate[2]
    const distance = 2 * redDistance * redDistance
      + 4 * greenDistance * greenDistance
      + 3 * blueDistance * blueDistance
    if (distance < bestDistance) {
      bestDistance = distance
      best = code
    }
  }
  return (best < 8 ? 30 + best : 90 + best - 8) as Ansi16Foreground
}

function colorSequences(
  cell: CellColor,
  colorLevel: number,
): ColorSequences {
  if (colorLevel === 1) {
    return {
      foreground: `\x1B[${cell.ansi16}m`,
      background: `\x1B[${cell.ansi16 + 10}m`,
    }
  }
  const [red, green, blue] = cell.rgb
  if (colorLevel === 2) {
    const index = rgbToXterm256(red, green, blue)
    return {
      foreground: `\x1B[38;5;${index}m`,
      background: `\x1B[48;5;${index}m`,
    }
  }
  return {
    foreground: `\x1B[38;2;${red};${green};${blue}m`,
    background: `\x1B[48;2;${red};${green};${blue}m`,
  }
}

function paletteIndexAt(row: string, column: number): number {
  return Number.parseInt(row[column] ?? '0', 16)
}

function paletteCellAt(
  palette: readonly (CellColor | null)[],
  row: string,
  column: number,
): CellColor | null {
  return palette[paletteIndexAt(row, column)] ?? null
}

/** Resolves one 1:1 grid: every indexed cell becomes its palette color. */
function indexCells(
  rows: readonly string[],
  width: number,
  palette: readonly (CellColor | null)[],
): (CellColor | null)[][] {
  return rows.map(row =>
    Array.from({ length: width }, (_, column) => paletteCellAt(palette, row, column)))
}

/**
 * Area-averages the indexed grid onto a proportionally smaller target grid.
 *
 * Every target cell averages the RGB of the opaque source cells it covers;
 * cells whose whole source region is transparent stay transparent. Target
 * height preserves the source aspect ratio, so the fox is never stretched.
 */
function resampleCells(
  rows: readonly string[],
  sourceWidth: number,
  sourceHeight: number,
  palette: readonly (CellColor | null)[],
  targetWidth: number,
  targetHeight: number,
): (CellColor | null)[][] {
  const cells: (CellColor | null)[][] = []
  for (let targetY = 0; targetY < targetHeight; targetY++) {
    const y0 = Math.floor(targetY * sourceHeight / targetHeight)
    const y1 = Math.max(y0 + 1, Math.floor((targetY + 1) * sourceHeight / targetHeight))
    const rowCells: (CellColor | null)[] = []
    for (let targetX = 0; targetX < targetWidth; targetX++) {
      const x0 = Math.floor(targetX * sourceWidth / targetWidth)
      const x1 = Math.max(x0 + 1, Math.floor((targetX + 1) * sourceWidth / targetWidth))
      let red = 0
      let green = 0
      let blue = 0
      let count = 0
      for (let sourceY = y0; sourceY < y1; sourceY++) {
        const sourceRow = rows[sourceY] as string
        for (let sourceX = x0; sourceX < x1; sourceX++) {
          const cell = paletteCellAt(palette, sourceRow, sourceX)
          if (cell === null) continue
          red += cell.rgb[0]
          green += cell.rgb[1]
          blue += cell.rgb[2]
          count++
        }
      }
      if (count === 0) {
        rowCells.push(null)
        continue
      }
      const rgb = [
        Math.round(red / count),
        Math.round(green / count),
        Math.round(blue / count),
      ] as const
      rowCells.push({ rgb, ansi16: nearestAnsi16(rgb) })
    }
    cells.push(rowCells)
  }
  return cells
}

/**
 * Renders one color cell per half-block cell (two vertical pixels each).
 *
 * Transparent runs retain the terminal background, mixed cells use `▀` with
 * explicit foreground and background colors, and every emitted row ends in a
 * full SGR reset.
 *
 * @param cells - Color grid in source resolution; null cells are transparent.
 * @param colorLevel - Clamped terminal color level (1–3).
 * @returns Half-block ANSI rows.
 */
function renderHalfBlockCells(
  cells: readonly (readonly (CellColor | null)[])[],
  colorLevel: number,
): string[] {
  const output: string[] = []
  for (let rowIndex = 0; rowIndex < cells.length; rowIndex += 2) {
    const upper = cells[rowIndex] as readonly (CellColor | null)[]
    const lower = cells[rowIndex + 1] as readonly (CellColor | null)[]
    let line = ''
    let currentForeground: string | null = null
    let currentBackground: string | null = null
    let pendingSpaces = 0

    for (let column = 0; column < upper.length; column++) {
      const upperCell = upper[column] ?? null
      const lowerCell = lower[column] ?? null
      const upperColor = upperCell === null ? null : colorSequences(upperCell, colorLevel)
      const lowerColor = lowerCell === null ? null : colorSequences(lowerCell, colorLevel)
      if (upperColor === null && lowerColor === null) {
        pendingSpaces++
        continue
      }

      if (pendingSpaces > 0) {
        if (currentBackground !== null) {
          line += BG_DEFAULT
          currentBackground = null
        }
        line += ' '.repeat(pendingSpaces)
        pendingSpaces = 0
      }

      const glyph = upperColor === null ? '▄' : '▀'
      const foreground = upperColor ?? lowerColor
      const background = upperColor !== null && lowerColor !== null
        ? lowerColor.background
        : null
      if (background !== currentBackground) {
        line += background ?? BG_DEFAULT
        currentBackground = background
      }
      if (foreground !== null && foreground.foreground !== currentForeground) {
        line += foreground.foreground
        currentForeground = foreground.foreground
      }
      line += glyph
    }

    output.push(`${line}${ANSI.RESET}`)
  }
  return output
}

/**
 * Renders indexed pixels with one half-block cell per two vertical pixels.
 *
 * Transparent runs retain the terminal background, mixed cells use `▀` with
 * explicit foreground and background colors, and every emitted row ends in a
 * full SGR reset. Unsupported color or full-width block-glyph terminals return
 * no rows.
 *
 * @param input - Indexed rows, palette, width, color level, and optional target width.
 * @returns Half-block ANSI rows, or an empty array when art is unsupported.
 * @throws {TypeError} When a non-transparent palette RGB value is malformed.
 */

/** Eight-dot braille offsets: (dot column, dot row) -> bit in U+2800-U+28FF. */
const BRAILLE_DOTS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0x01], [1, 0, 0x10],
  [0, 1, 0x02], [1, 1, 0x20],
  [0, 2, 0x04], [1, 2, 0x40],
  [0, 3, 0x08], [1, 3, 0x80],
]

/** One opaque source pixel inside a braille cell with its dot bit. */
interface BrailleDot {
  color: CellColor
  bit: number
}

/** Perceived luminance used to assign braille dots to foreground/background. */
function cellLuminance(cell: CellColor): number {
  return 0.2126 * cell.rgb[0] + 0.7152 * cell.rgb[1] + 0.0722 * cell.rgb[2]
}

/** Averages colors into one cell color with its ANSI16 approximation. */
function averageCell(colors: readonly CellColor[]): CellColor {
  let red = 0
  let green = 0
  let blue = 0
  for (const color of colors) {
    red += color.rgb[0]
    green += color.rgb[1]
    blue += color.rgb[2]
  }
  const count = Math.max(1, colors.length)
  const rgb = [
    Math.round(red / count),
    Math.round(green / count),
    Math.round(blue / count),
  ] as const
  return { rgb, ansi16: nearestAnsi16(rgb) }
}

/**
 * Partitions one braille cell into foreground dots and background fill.
 *
 * Dots take the brighter half of the cell's opaque pixels (by luminance, ties
 * broken by dot bit), so outlines and eyes stay on the foreground; the darker
 * half becomes the cell background, or transparent when the cell holds a
 * single opaque pixel.
 */
function partitionBrailleCell(dots: readonly BrailleDot[]): {
  bitMask: number
  foreground: CellColor
  background: CellColor | null
} {
  const sorted = dots.slice().sort((left, right) =>
    cellLuminance(left.color) - cellLuminance(right.color) || left.bit - right.bit)
  const midpoint = Math.floor(sorted.length / 2)
  const bright = sorted.slice(midpoint)
  const dark = sorted.slice(0, midpoint)
  let bitMask = 0
  for (const dot of bright) bitMask |= dot.bit
  return {
    bitMask,
    foreground: averageCell(bright.map(dot => dot.color)),
    background: dark.length === 0 ? null : averageCell(dark.map(dot => dot.color)),
  }
}

/**
 * Renders a color grid as eight-dot braille: one cell holds 2x4 source pixels.
 *
 * The dot mask plus one foreground and one background color encode the
 * sub-pixels; partially transparent cells keep the terminal background, and
 * every emitted row ends in a full SGR reset.
 *
 * @param pixels - Color grid in source resolution; null cells are transparent.
 * @param colorLevel - Clamped terminal color level (1-3).
 * @returns Braille ANSI rows with one cell per two grid columns and four rows.
 */
function renderBrailleCells(
  pixels: readonly (readonly (CellColor | null)[])[],
  colorLevel: number,
): string[] {
  const cellColumns = Math.floor((pixels[0]?.length ?? 0) / 2)
  const output: string[] = []
  for (let cellRow = 0; cellRow * 4 < pixels.length; cellRow++) {
    let line = ''
    let currentForeground: string | null = null
    let currentBackground: string | null = null
    let pendingSpaces = 0

    for (let cellColumn = 0; cellColumn < cellColumns; cellColumn++) {
      const dots: BrailleDot[] = []
      for (const [dotColumn, dotRow, bit] of BRAILLE_DOTS) {
        const color = pixels[cellRow * 4 + dotRow]?.[cellColumn * 2 + dotColumn] ?? null
        if (color !== null) dots.push({ color, bit })
      }
      if (dots.length === 0) {
        pendingSpaces++
        continue
      }
      if (pendingSpaces > 0) {
        if (currentBackground !== null) {
          line += BG_DEFAULT
          currentBackground = null
        }
        line += ' '.repeat(pendingSpaces)
        pendingSpaces = 0
      }

      const { bitMask, foreground, background } = partitionBrailleCell(dots)
      const foregroundSequences = colorSequences(foreground, colorLevel)
      if (background !== null) {
        const backgroundSequences = colorSequences(background, colorLevel)
        if (backgroundSequences.background !== currentBackground) {
          line += backgroundSequences.background
          currentBackground = backgroundSequences.background
        }
      } else if (currentBackground !== null) {
        line += BG_DEFAULT
        currentBackground = null
      }
      if (foregroundSequences.foreground !== currentForeground) {
        line += foregroundSequences.foreground
        currentForeground = foregroundSequences.foreground
      }
      line += String.fromCodePoint(0x2800 + bitMask)
    }

    output.push(`${line}${ANSI.RESET}`)
  }
  return output
}

/**
 * Render indexed-palette pixel rows as half-block ANSI terminal lines.
 *
 * Each pair of indexed rows becomes one terminal row (upper/lower half
 * blocks); a `targetWidth` narrower than the source width area-averages
 * pixels instead of clipping.
 *
 * @param input - pixel geometry, palette rows, color level, and optional scale target.
 * @returns the rendered lines; empty when color is unsupported or ambiguous-width
 *   mode is full.
 * @throws when a palette entry carries an invalid indexed RGB color.
 */
export function renderIndexedHalfBlocks(input: RenderIndexedHalfBlocksInput): string[] {
  if (input.colorLevel < 1 || ambiguousWidthMode() === 'full') return []
  const colorLevel = input.colorLevel >= 3 ? 3 : input.colorLevel >= 2 ? 2 : 1
  const palette: readonly (CellColor | null)[] = input.palette.map((entry) => {
    if (entry === null) return null
    const rgb = hexToRgb(entry.rgb)
    if (rgb === null) throw new TypeError(`invalid indexed RGB color: ${entry.rgb}`)
    return { rgb, ansi16: entry.ansi16 }
  })
  const sourceHeight = input.rows.length
  const targetWidth = Math.max(1, Math.min(input.targetWidth ?? input.width, input.width))
  const targetHeight = Math.max(
    2,
    Math.round(sourceHeight * targetWidth / input.width / 2) * 2,
  )
  if (input.glyphs === 'braille') {
    const pixelWidth = targetWidth * 2
    const pixelHeight = targetHeight * 2
    const pixels = pixelWidth === input.width && pixelHeight === sourceHeight
      ? indexCells(input.rows, input.width, palette)
      : resampleCells(
        input.rows, input.width, sourceHeight, palette, pixelWidth, pixelHeight,
      )
    return renderBrailleCells(pixels, colorLevel)
  }
  const cells = targetWidth === input.width && targetHeight === sourceHeight
    ? indexCells(input.rows, input.width, palette)
    : resampleCells(
      input.rows, input.width, sourceHeight, palette, targetWidth, targetHeight,
    )
  return renderHalfBlockCells(cells, colorLevel)
}

/**
 * Binds a generated hex palette to runtime entries with ANSI16 approximations.
 *
 * ANSI16 approximations are computed from the RGB value with the same
 * perceptual weighting used during generation, so a regenerated palette needs
 * no hand-maintained SGR table.
 *
 * @param palette - Generated hex colors; null entries stay transparent.
 * @returns Runtime palette in the same index order.
 */
export function bindIndexedPalette(
  palette: readonly (`#${string}` | null)[],
): readonly (IndexedHalfBlockPaletteEntry | null)[] {
  return palette.map((hex) => {
    if (hex === null) return null
    const rgb = hexToRgb(hex) as readonly [number, number, number]
    return { rgb: hex, ansi16: nearestAnsi16(rgb) }
  })
}

/** One generated rest band: pixel geometry plus palette-index rows. */
export interface IndexedMascotBand {
  width: number
  height: number
  rows: readonly string[]
}

/** Generated frame data for one welcome mascot (28-, 36-, and 44-column bands). */
export interface IndexedMascotFrames {
  /** Rest bands keyed by the three supported runtime widths. */
  bands: {
    readonly 28: IndexedMascotBand
    readonly 36: IndexedMascotBand
    readonly 44: IndexedMascotBand
  }
  /** Runtime palette whose null entries are transparent. */
  palette: readonly (IndexedHalfBlockPaletteEntry | null)[]
  /** Mascot label used in validation errors (`welcome fox`). */
  label: string
}

/** Input for {@link formatIndexedMascotFrame}. */
export interface FormatIndexedMascotFrameInput {
  /** Terminal color level; defaults to detected chalk capability. */
  colorLevel?: number
  /**
   * Runtime band width in columns. Only `28`, `36`, and `44` are accepted;
   * omitted width selects the 28-column band.
   */
  width?: number
}

/**
 * Renders one generated mascot rest band without runtime asset access.
 *
 * @param frames - The mascot's generated bands, palette, and error label.
 * @param input - Optional color level and band width.
 * @returns Half-block ANSI rows, or no rows when art is unsupported.
 * @throws {TypeError} When `width` is present and is not `28`, `36`, or `44`.
 */
export function formatIndexedMascotFrame(
  frames: IndexedMascotFrames,
  input: FormatIndexedMascotFrameInput = {},
): string[] {
  const width = input.width ?? 28
  if (width !== 28 && width !== 36 && width !== 44) {
    throw new TypeError(`${frames.label} band width must be 28, 36, or 44, got ${String(input.width)}`)
  }
  const band = frames.bands[width]
  return renderIndexedHalfBlocks({
    width: band.width,
    rows: band.rows,
    palette: frames.palette,
    colorLevel: input.colorLevel ?? chalk.level,
  })
}

/**
 * Runtime palette derived from the generated hex palette; see
 * {@link bindIndexedPalette}.
 */
const FOX_PALETTE: readonly (IndexedHalfBlockPaletteEntry | null)[] =
  bindIndexedPalette(WELCOME_FOX_PALETTE)

/** The fox mascot's generated bands, palette, and error label. */
const FOX_FRAMES: IndexedMascotFrames = {
  bands: WELCOME_FOX_BANDS,
  palette: FOX_PALETTE,
  label: 'welcome fox',
}

/** Input for {@link formatFoxFrame}. */
export interface FormatFoxFrameInput {
  /** Terminal color level; defaults to detected chalk capability. */
  colorLevel?: number
  /**
   * Runtime band width in columns. Only `28` and `36` are accepted; omitted
   * width selects the 28-column band.
   */
  width?: number
}

/**
 * Renders one generated welcome-fox rest band without runtime asset access.
 *
 * @param input - Optional color level and band width.
 * @returns Half-block ANSI rows, or no rows when art is unsupported.
 * @throws {TypeError} When `width` is present and is not `28`, `36`, or `44`.
 */
export function formatFoxFrame(input: FormatFoxFrameInput = {}): string[] {
  return formatIndexedMascotFrame(FOX_FRAMES, input)
}
