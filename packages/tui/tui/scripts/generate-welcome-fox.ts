/**
 * Generate the runtime welcome-fox band module from the authored cutout.
 *
 * The sprite sheet is still validated for provenance. Runtime data is two
 * Lanczos rest bands snapped to a shared plane palette with no error diffusion.
 * `--check` validates in memory and never writes to the repository.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { authorWelcomeFoxAssetBuffers } from './author-welcome-fox-assets.ts'
import {
  WELCOME_FOX_FRAME_HEIGHT,
  WELCOME_FOX_FRAME_IDS,
  WELCOME_FOX_FRAME_WIDTH,
  WELCOME_FOX_RUNTIME_BANDS,
  WELCOME_FOX_SHEET_WIDTH,
} from './welcome-fox-contract.ts'

const ALPHA_THRESHOLD = 128

/**
 * Non-transparent palette colors derived from the cutout at generation time.
 *
 * The hex-nibble encoding below caps the palette at fifteen colors plus the
 * transparent index zero.
 */
const PALETTE_COLOR_COUNT = 15

/** Perceptual channel weights (R:G:B) for nearest-color distance. */
const RGB_WEIGHTS: readonly [number, number, number] = [2, 4, 3]

const packageRoot = resolve(import.meta.dirname, '..')
const sourcePath = resolve(packageRoot, 'assets/welcome-fox-source.jpg')
const cutoutPath = resolve(packageRoot, 'assets/welcome-fox-cutout.png')
const defaultSheetPath = resolve(packageRoot, 'assets/welcome-fox-sprite-sheet.png')
const outputPath = resolve(packageRoot, 'src/format/fox-frames.ts')

interface PaletteEntry {
  /** Canonical `#rrggbb` color written into the generated module. */
  hex: string
  /** Decoded RGB triple used for nearest-color matching. */
  rgb: readonly [number, number, number]
}

/** Opaque pixel color together with its deterministic source order. */
interface OrderedRgb {
  rgb: readonly [number, number, number]
  order: number
}

interface WelcomeFoxBandAsset {
  width: number
  height: number
  rows: string[]
}

interface WelcomeFoxAsset {
  bands: WelcomeFoxBandAsset[]
  palette: readonly (string | null)[]
  finalFrame: 'rest'
}

/** The generated source together with its validated in-memory representation. */
export interface WelcomeFoxGeneration {
  /** Complete deterministic TypeScript source. */
  source: string
  /** Validated indexed rest bands and shared palette. */
  asset: WelcomeFoxAsset
}

/**
 * Validate the provenance sprite sheet, then project the cutout into the two
 * runtime rest bands. The shared 15-color palette is median-cut from the
 * 96×72 Lanczos of the cutout. The input sheet must retain an alpha channel
 * and every 96×72 source frame must have a fully transparent one-pixel
 * boundary.
 * @param sheetPath - Path to the eight-frame horizontal PNG sprite sheet.
 * @returns Deterministic self-contained source and the validated indexed asset.
 * @throws Rejects when the sheet or cutout cannot be read or decoded, has
 * another format or geometry, lacks alpha, or violates a band invariant.
 */
export async function generateWelcomeFoxModule(
  sheetPath = defaultSheetPath,
): Promise<WelcomeFoxGeneration> {
  await validateAuthoredSheet(sheetPath)
  const cutout = await loadCutoutRgba()
  const paletteSource = await sharp(cutout.data, {
    raw: { width: cutout.width, height: cutout.height, channels: 4 },
  })
    .resize({
      width: WELCOME_FOX_FRAME_WIDTH,
      height: WELCOME_FOX_FRAME_HEIGHT,
      fit: 'contain',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const palette = toPalette(derivePalette(collectOpaquePixels(
    paletteSource.data,
    paletteSource.info.width,
    paletteSource.info.height,
  )))
  const bands: WelcomeFoxBandAsset[] = []
  for (const band of WELCOME_FOX_RUNTIME_BANDS) {
    const resized = await sharp(cutout.data, {
      raw: { width: cutout.width, height: cutout.height, channels: 4 },
    })
      .resize({
        width: band.width,
        height: band.height,
        fit: 'contain',
        kernel: sharp.kernel.lanczos3,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (
      resized.info.width !== band.width
      || resized.info.height !== band.height
      || resized.info.channels !== 4
    ) {
      throw new Error(
        `welcome fox band ${band.width}×${band.height} must decode to RGBA pixels of that size, got ${resized.info.width}×${resized.info.height} with ${resized.info.channels} channels.`,
      )
    }
    bands.push({
      width: band.width,
      height: band.height,
      rows: snapBand(resized.data, band.width, band.height, palette),
    })
  }
  const asset: WelcomeFoxAsset = {
    bands,
    palette: palette.map(entry => entry === null ? null : entry.hex),
    finalFrame: 'rest',
  }
  validateAsset(asset)
  return { source: renderModule(asset), asset }
}

async function validateAuthoredSheet(sheetPath: string): Promise<void> {
  const image = sharp(sheetPath, { failOn: 'error' })
  const metadata = await image.metadata()
  if (metadata.format !== 'png') {
    throw new Error(
      `welcome fox sheet must be a PNG, got ${metadata.format ?? 'unknown format'}.`,
    )
  }
  if (
    metadata.width !== WELCOME_FOX_SHEET_WIDTH
    || metadata.height !== WELCOME_FOX_FRAME_HEIGHT
  ) {
    throw new Error(
      `welcome fox sheet must be ${WELCOME_FOX_SHEET_WIDTH}×${WELCOME_FOX_FRAME_HEIGHT} pixels, got ${metadata.width ?? 'unknown'}×${metadata.height ?? 'unknown'}.`,
    )
  }
  if (metadata.hasAlpha !== true) {
    throw new Error('welcome fox sheet must have an alpha channel.')
  }

  const { data, info } = await image
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (
    info.width !== WELCOME_FOX_SHEET_WIDTH
    || info.height !== WELCOME_FOX_FRAME_HEIGHT
    || info.channels !== 4
  ) {
    throw new Error(
      `welcome fox sheet must decode to ${WELCOME_FOX_SHEET_WIDTH}×${WELCOME_FOX_FRAME_HEIGHT} RGBA pixels, got ${info.width}×${info.height} with ${info.channels} channels.`,
    )
  }
  validateTransparentFrameBoundaries(data, info.width)
}

async function loadCutoutRgba(): Promise<{ data: Buffer; width: number; height: number }> {
  const image = sharp(cutoutPath, { failOn: 'error' })
  const metadata = await image.metadata()
  if (metadata.format !== 'png') {
    throw new Error(
      `welcome fox cutout must be a PNG, got ${metadata.format ?? 'unknown format'}.`,
    )
  }
  if (metadata.hasAlpha !== true) {
    throw new Error('welcome fox cutout must have an alpha channel.')
  }
  const { data, info } = await image
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.channels !== 4) {
    throw new Error(
      `welcome fox cutout must decode to RGBA pixels, got ${info.channels} channels.`,
    )
  }
  return { data, width: info.width, height: info.height }
}

function validateTransparentFrameBoundaries(sheet: Buffer, sheetWidth: number): void {
  const alphaAt = (x: number, y: number): number => sheet[(y * sheetWidth + x) * 4 + 3]!
  for (const [frameIndex, frameId] of WELCOME_FOX_FRAME_IDS.entries()) {
    const left = frameIndex * WELCOME_FOX_FRAME_WIDTH
    const right = left + WELCOME_FOX_FRAME_WIDTH - 1
    const bottom = WELCOME_FOX_FRAME_HEIGHT - 1
    let opaqueBoundary = false
    for (let x = left; x <= right && !opaqueBoundary; x++) {
      opaqueBoundary = alphaAt(x, 0) !== 0 || alphaAt(x, bottom) !== 0
    }
    for (let y = 1; y < bottom && !opaqueBoundary; y++) {
      opaqueBoundary = alphaAt(left, y) !== 0 || alphaAt(right, y) !== 0
    }
    if (opaqueBoundary) {
      throw new Error(
        `welcome fox frame ${frameId} must have a fully transparent boundary.`,
      )
    }
  }
}

/**
 * Collects every opaque pixel in deterministic row-major order.
 *
 * @param pixels - Decoded RGBA pixels.
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Opaque pixels tagged with their source order for stable sorting.
 */
function collectOpaquePixels(pixels: Buffer, width: number, height: number): OrderedRgb[] {
  const collected: OrderedRgb[] = []
  let order = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      if (pixels[offset + 3]! >= ALPHA_THRESHOLD) {
        collected.push({ rgb: [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!], order })
      }
      order++
    }
  }
  return collected
}

/**
 * Derives a deterministic median-cut palette from the opaque palette-source pixels.
 *
 * Boxes split on their widest channel until {@link PALETTE_COLOR_COUNT} boxes
 * remain; every split sorts by channel then source order, and ties keep the
 * first splittable box, so repeated runs produce byte-identical palettes.
 *
 * @param pixels - Opaque cutout pixels in deterministic order.
 * @returns One RGB triple per derived palette color.
 */
function derivePalette(pixels: readonly OrderedRgb[]): readonly (readonly [number, number, number])[] {
  const boxes: OrderedRgb[][] = [Array.from(pixels)]
  while (boxes.length < PALETTE_COLOR_COUNT) {
    let bestIndex = -1
    let bestRange = -1
    let bestChannel = 0
    for (const [boxIndex, box] of boxes.entries()) {
      if (box.length < 2) continue
      for (let channel = 0; channel < 3; channel++) {
        let minimum = 255
        let maximum = 0
        for (const pixel of box) {
          const value = pixel.rgb[channel]!
          if (value < minimum) minimum = value
          if (value > maximum) maximum = value
        }
        const range = maximum - minimum
        if (range > bestRange) {
          bestRange = range
          bestIndex = boxIndex
          bestChannel = channel
        }
      }
    }
    if (bestIndex === -1) break
    const box = boxes[bestIndex]!
    box.sort((left, right) =>
      left.rgb[bestChannel]! - right.rgb[bestChannel]! || left.order - right.order)
    const middle = Math.floor(box.length / 2)
    boxes.splice(bestIndex, 1, box.slice(0, middle), box.slice(middle))
  }
  return boxes.map((box) => {
    let red = 0
    let green = 0
    let blue = 0
    for (const pixel of box) {
      red += pixel.rgb[0]!
      green += pixel.rgb[1]!
      blue += pixel.rgb[2]!
    }
    const count = Math.max(1, box.length)
    return [Math.round(red / count), Math.round(green / count), Math.round(blue / count)]
  })
}

function toHexColor(rgb: readonly [number, number, number]): string {
  const channel = (value: number): string => value.toString(16).padStart(2, '0')
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`
}

/**
 * Builds the generated palette: transparent index zero plus derived colors.
 *
 * @param colors - One RGB triple per median-cut box.
 * @returns Palette entries whose first slot is null (transparent).
 */
function toPalette(colors: readonly (readonly [number, number, number])[]): (PaletteEntry | null)[] {
  return [null, ...colors.map(rgb => ({ hex: toHexColor(rgb), rgb }))]
}

function nearestPaletteIndex(
  red: number,
  green: number,
  blue: number,
  palette: readonly (PaletteEntry | null)[],
): number {
  let bestIndex = 1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 1; index < palette.length; index++) {
    const candidate = palette[index]
    if (candidate === null || candidate === undefined) continue
    const [candidateRed, candidateGreen, candidateBlue] = candidate.rgb
    const redDistance = red - candidateRed
    const greenDistance = green - candidateGreen
    const blueDistance = blue - candidateBlue
    const distance = RGB_WEIGHTS[0]! * redDistance * redDistance
      + RGB_WEIGHTS[1]! * greenDistance * greenDistance
      + RGB_WEIGHTS[2]! * blueDistance * blueDistance
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }
  return bestIndex
}

/**
 * Snaps one resized rest band to palette indexes without error diffusion.
 *
 * Transparent pixels emit index zero. Opaque pixels take the nearest palette
 * color and do not write residual error into neighbors.
 *
 * @param pixels - Decoded RGBA band pixels.
 * @param width - Band width in pixels.
 * @param height - Band height in pixels.
 * @param palette - Entries with transparent index zero.
 * @returns Palette-index row strings for the band.
 */
function snapBand(
  pixels: Buffer,
  width: number,
  height: number,
  palette: readonly (PaletteEntry | null)[],
): string[] {
  const rows: string[] = []
  for (let y = 0; y < height; y++) {
    let row = ''
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      if (pixels[offset + 3]! < ALPHA_THRESHOLD) {
        row += '0'
        continue
      }
      row += nearestPaletteIndex(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!, palette)
        .toString(16)
    }
    rows.push(row)
  }
  return rows
}

function validateAsset(asset: WelcomeFoxAsset): void {
  if (asset.palette.length > 16 || asset.palette[0] !== null) {
    throw new Error('welcome fox palette must contain at most 16 entries with transparent index 0.')
  }
  if (asset.finalFrame !== 'rest') {
    throw new Error(`welcome fox final frame must be rest, got ${JSON.stringify(asset.finalFrame)}.`)
  }
  if (asset.bands.length !== WELCOME_FOX_RUNTIME_BANDS.length) {
    throw new Error(
      `welcome fox asset must contain exactly ${WELCOME_FOX_RUNTIME_BANDS.length} rest bands, got ${asset.bands.length}.`,
    )
  }
  for (const [index, expected] of WELCOME_FOX_RUNTIME_BANDS.entries()) {
    const band = asset.bands[index]
    if (band === undefined || band.width !== expected.width || band.height !== expected.height) {
      throw new Error(
        `welcome fox rest band ${index} must be ${expected.width}×${expected.height}.`,
      )
    }
    if (band.rows.length !== band.height || band.rows.some(row => row.length !== band.width)) {
      throw new Error(
        `welcome fox rest band ${band.width}×${band.height} does not have uniform dimensions.`,
      )
    }
    for (const row of band.rows) {
      for (const encoded of row) {
        const paletteIndex = Number.parseInt(encoded, 16)
        if (!Number.isInteger(paletteIndex) || paletteIndex < 0 || paletteIndex >= asset.palette.length) {
          throw new Error(
            `welcome fox rest band ${band.width}×${band.height} contains palette index ${JSON.stringify(encoded)} outside the palette.`,
          )
        }
      }
    }
  }
}

function renderModule(asset: WelcomeFoxAsset): string {
  const widths = asset.bands.map(band => band.width)
  const lines = [
    '/**',
    ' * Generated by scripts/generate-welcome-fox.ts — do not edit by hand.',
    ' * Runtime rest-band data is self-contained and performs no asset I/O.',
    ' */',
    '',
    '/** Runtime rest-pose widths in columns. */',
    `export const WELCOME_FOX_BAND_WIDTHS = [${widths.join(', ')}] as const`,
    '',
    '/** One runtime welcome-fox band width. */',
    'export type WelcomeFoxBandWidth = (typeof WELCOME_FOX_BAND_WIDTHS)[number]',
    '',
    '/** Fixed colors; index zero is transparent. */',
    'export const WELCOME_FOX_PALETTE = [',
    ...asset.palette.map(color => `  ${color === null ? 'null' : quote(color)},`),
    '] as const',
    '',
    '/** Palette-index rows for each runtime rest band. */',
    'export const WELCOME_FOX_BANDS = {',
  ]
  for (const band of asset.bands) {
    lines.push(`  ${band.width}: {`)
    lines.push(`    width: ${band.width},`)
    lines.push(`    height: ${band.height},`)
    lines.push('    rows: [')
    lines.push(...band.rows.map(row => `      ${quote(row)},`))
    lines.push('    ],')
    lines.push('  },')
  }
  lines.push(
    '} as const',
    '',
    '/** Canonical pose retained after attach. */',
    `export const WELCOME_FOX_FINAL_FRAME = ${quote(asset.finalFrame)}`,
    '',
  )
  const source = lines.join('\n')
  if (source.includes('WELCOME_FOX_TIMELINE') || source.includes('WELCOME_FOX_TOTAL_DURATION_MS')) {
    throw new Error('welcome fox generated module must not emit a timeline.')
  }
  if (widths.length !== 2 || widths.some(width => width !== 56 && width !== 72)) {
    throw new Error('welcome fox generated module must emit only the 56 and 72 rest bands.')
  }
  return source
}

function quote(value: string): string {
  return `'${value}'`
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readCheckFile(
  path: string,
  subject: string,
  remedy: string,
): Promise<Buffer> {
  try {
    return await readFile(path)
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(`welcome fox ${subject} is missing; ${remedy}.`, { cause: error })
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`welcome fox ${subject} could not be read: ${detail}`, { cause: error })
  }
}

async function checkGeneratedSource(): Promise<void> {
  const authorCommand = 'run pnpm exec tsx packages/tui/tui/scripts/author-welcome-fox-assets.ts'
  const source = await readCheckFile(
    sourcePath,
    'source image',
    'restore assets/welcome-fox-source.jpg',
  )
  const authored = await authorWelcomeFoxAssetBuffers(source)
  const committedCutout = await readCheckFile(cutoutPath, 'cutout', authorCommand)
  if (!authored.cutout.equals(committedCutout)) {
    throw new Error(`welcome fox cutout is stale; ${authorCommand}.`)
  }
  const committedSheet = await readCheckFile(defaultSheetPath, 'sprite sheet', authorCommand)
  if (!authored.sheet.equals(committedSheet)) {
    throw new Error(`welcome fox sprite sheet is stale; ${authorCommand}.`)
  }

  const generated = await generateWelcomeFoxModule()
  if (generated.source.includes('WELCOME_FOX_TIMELINE')) {
    throw new Error('welcome fox generated module must not emit a dithered timeline encoding.')
  }
  const committed = (
    await readCheckFile(
      outputPath,
      'generated module',
      'run pnpm run generate-welcome-fox',
    )
  ).toString('utf8')
  if (committed !== generated.source) {
    throw new Error('welcome fox generated module is stale; run pnpm run generate-welcome-fox.')
  }
}

async function main(args: string[]): Promise<void> {
  if (args.length !== 1 || (args[0] !== '--write' && args[0] !== '--check')) {
    throw new Error('generate-welcome-fox: expected exactly one of --write or --check.')
  }
  if (args[0] === '--write') {
    const generated = await generateWelcomeFoxModule()
    await writeFile(outputPath, generated.source, 'utf8')
    return
  }
  await checkGeneratedSource()
}

function isEntryPoint(argv1: string | undefined, moduleUrl: string): boolean {
  return argv1 !== undefined && resolve(argv1) === fileURLToPath(moduleUrl)
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
