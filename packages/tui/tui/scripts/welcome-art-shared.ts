/**
 * Shared indexed-palette projection for welcome mascot generators.
 *
 * Both mascot generators (fox, whale) median-cut a ≤15-color palette from a
 * 96×72 nearest-neighbor of the cutout, snap each runtime band to palette
 * indexes with no error diffusion, and render a self-contained TypeScript
 * module. Repository-only: runtime code never imports this module.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/**
 * Alpha under which a pixel counts as transparent during band snapping.
 *
 * The hex-nibble encoding caps the palette at fifteen colors plus the
 * transparent index zero.
 */
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

interface WelcomeArtBandAsset {
  width: number
  height: number
  rows: string[]
}

export interface WelcomeArtAsset {
  bands: WelcomeArtBandAsset[]
  palette: readonly (string | null)[]
  finalFrame: 'rest'
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

/**
 * Validates one indexed asset against its expected band geometry.
 *
 * @param asset - Indexed bands and shared palette under validation.
 * @param expectedBands - Required band dimensions in emission order.
 * @param label - Mascot label used in error messages (`welcome fox` …).
 * @throws When the palette, final frame, or any band violates the contract.
 */
function validateIndexedArtAsset(
  asset: WelcomeArtAsset,
  expectedBands: readonly { width: number; height: number }[],
  label: string,
): void {
  if (asset.palette.length > 16 || asset.palette[0] !== null) {
    throw new Error(`${label} palette must contain at most 16 entries with transparent index 0.`)
  }
  if (asset.finalFrame !== 'rest') {
    throw new Error(`${label} final frame must be rest, got ${JSON.stringify(asset.finalFrame)}.`)
  }
  if (asset.bands.length !== expectedBands.length) {
    throw new Error(
      `${label} asset must contain exactly ${expectedBands.length} rest bands, got ${asset.bands.length}.`,
    )
  }
  for (const [index, expected] of expectedBands.entries()) {
    const band = asset.bands[index]
    if (band === undefined || band.width !== expected.width || band.height !== expected.height) {
      throw new Error(
        `${label} rest band ${index} must be ${expected.width}×${expected.height}.`,
      )
    }
    if (band.rows.length !== band.height || band.rows.some(row => row.length !== band.width)) {
      throw new Error(
        `${label} rest band ${band.width}×${band.height} does not have uniform dimensions.`,
      )
    }
    for (const row of band.rows) {
      for (const encoded of row) {
        const paletteIndex = Number.parseInt(encoded, 16)
        if (!Number.isInteger(paletteIndex) || paletteIndex < 0 || paletteIndex >= asset.palette.length) {
          throw new Error(
            `${label} rest band ${band.width}×${band.height} contains palette index ${JSON.stringify(encoded)} outside the palette.`,
          )
        }
      }
    }
  }
}

/** Naming knobs that specialize the emitted module for one mascot. */
export interface IndexedArtModuleIdentity {
  /** Mascot slug used in comments and errors (`welcome-fox`). */
  slug: string
  /** Upper-snake constant prefix (`WELCOME_FOX`). */
  constantPrefix: string
  /** Exported band-width type name (`WelcomeFoxBandWidth`). */
  typeName: string
  /** Generator script name credited in the header (`generate-welcome-fox.ts`). */
  generatorScript: string
  /** Tokens the emitted source must never contain (legacy timeline markers). */
  forbiddenTokens: readonly string[]
}

/**
 * Renders the deterministic self-contained TypeScript module for one mascot.
 *
 * @param asset - Validated indexed bands and shared palette.
 * @param identity - Naming and guard knobs for the owning mascot.
 * @returns Module source; only the 28 and 36 rest bands are emittable.
 * @throws When the asset carries other band widths or forbidden tokens would
 * be emitted.
 */
export function renderIndexedArtModule(
  asset: WelcomeArtAsset,
  identity: IndexedArtModuleIdentity,
): string {
  const { slug, constantPrefix, typeName, generatorScript, forbiddenTokens } = identity
  const widths = asset.bands.map(band => band.width)
  const lines = [
    '/**',
    ` * Generated by scripts/${generatorScript} — do not edit by hand.`,
    ' * Runtime rest-band data is self-contained and performs no asset I/O.',
    ' */',
    '',
    '/** Runtime rest-pose widths in columns. */',
    `export const ${constantPrefix}_BAND_WIDTHS = [${widths.join(', ')}] as const`,
    '',
    `/** One runtime ${slug} band width. */`,
    `export type ${typeName} = (typeof ${constantPrefix}_BAND_WIDTHS)[number]`,
    '',
    '/** Fixed colors; index zero is transparent. */',
    `export const ${constantPrefix}_PALETTE = [`,
    ...asset.palette.map(color => `  ${color === null ? 'null' : quote(color)},`),
    '] as const',
    '',
    '/** Palette-index rows for each runtime rest band. */',
    `export const ${constantPrefix}_BANDS = {`,
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
    `export const ${constantPrefix}_FINAL_FRAME = ${quote(asset.finalFrame)}`,
    '',
  )
  const source = lines.join('\n')
  const label = slug.replace('-', ' ')
  if (forbiddenTokens.some(token => source.includes(token))) {
    throw new Error(`${label} generated module must not emit a timeline.`)
  }
  if (widths.length !== 2 || widths.some(width => width !== 28 && width !== 36)) {
    throw new Error(`${label} generated module must emit only the 28 and 36 rest bands.`)
  }
  return source
}

function quote(value: string): string {
  return `'${value}'`
}

/** Decoded RGBA pixel buffer with its geometry. */
export interface RawImage {
  data: Buffer
  width: number
  height: number
}

/** Knobs for PNG decode validation shared by mascot asset pipelines. */
export interface PngDecodeOptions {
  /** Asset subject used in errors (`source`, `cutout`). */
  subject: string
  /** Mascot label used in errors (`welcome fox`). */
  label: string
  /** Whether the decoded PNG must carry an alpha channel. */
  requireAlpha: boolean
  /**
   * Fold the format and alpha requirements into one message (`must be a PNG
   * with an alpha channel`) instead of reporting them separately.
   */
  combinedFormatAlphaMessage?: boolean
}

/**
 * Decodes an encoded PNG buffer to sRGB RGBA pixels with validation.
 *
 * @param source - Complete encoded PNG.
 * @param options - Subject, label, and alpha-policy knobs.
 * @returns Decoded RGBA pixels.
 * @throws Rejects when the source is not a PNG, lacks a required alpha
 * channel, or does not decode to RGBA.
 */
export async function decodePngBuffer(
  source: Buffer,
  options: PngDecodeOptions,
): Promise<RawImage> {
  const { subject, label, requireAlpha } = options
  const image = sharp(source, { failOn: 'error' })
  const metadata = await image.metadata()
  if (metadata.format !== 'png') {
    const got = metadata.format ?? 'unknown format'
    throw new Error(options.combinedFormatAlphaMessage === true
      ? `${label} ${subject} must be a PNG with an alpha channel, got ${got}.`
      : `${label} ${subject} must be a PNG, got ${got}.`)
  }
  if (requireAlpha && metadata.hasAlpha !== true) {
    throw new Error(`${label} ${subject} must have an alpha channel.`)
  }
  const { data, info } = await image
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.channels !== 4) {
    throw new Error(
      `${label} ${subject} must decode to RGBA pixels, got ${info.width}×${info.height} with ${info.channels} channels.`,
    )
  }
  return { data, width: info.width, height: info.height }
}

/**
 * Reads and decodes a PNG file to sRGB RGBA pixels, requiring alpha.
 *
 * @param path - PNG file path.
 * @param label - Mascot label used in errors (`welcome fox`).
 * @param subject - Asset subject used in errors (`cutout`).
 * @returns Decoded RGBA pixels.
 * @throws Rejects when the file cannot be read or fails decode validation.
 */
export async function loadPngRgba(
  path: string,
  label: string,
  subject: string,
): Promise<RawImage> {
  return decodePngBuffer(await readFile(path), { subject, label, requireAlpha: true })
}

/**
 * Crops an RGBA image to its opaque pixel bounds plus a fixed inset.
 *
 * @param source - Decoded RGBA pixels.
 * @param inset - Transparent margin retained around the bounds.
 * @param label - Mascot label used in errors (`welcome fox`).
 * @returns Cropped pixels.
 * @throws When the image contains no opaque pixels.
 */
export function cropToOpaqueBounds(source: RawImage, inset: number, label: string): RawImage {
  let left = source.width
  let top = source.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (source.data[(y * source.width + x) * 4 + 3] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) throw new Error(`${label} cutout contains no opaque pixels.`)
  left = Math.max(0, left - inset)
  top = Math.max(0, top - inset)
  right = Math.min(source.width - 1, right + inset)
  bottom = Math.min(source.height - 1, bottom + inset)
  const width = right - left + 1
  const height = bottom - top + 1
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sourceStart = ((top + y) * source.width + left) * 4
    source.data.copy(data, y * width * 4, sourceStart, sourceStart + width * 4)
  }
  return { data, width, height }
}

/** Inputs for {@link projectCutoutToBands}. */
export interface ProjectCutoutInput {
  /** Decoded transparent cutout. */
  cutout: RawImage
  /** Palette-source projection geometry (`96×72` for both mascots). */
  paletteSource: { width: number; height: number }
  /** Runtime rest bands in emission order. */
  bands: readonly { width: number; height: number }[]
  /** Mascot label used in errors (`welcome fox`). */
  label: string
}

/**
 * Projects one cutout into validated indexed rest bands.
 *
 * The shared palette is median-cut from the nearest-neighbor palette-source
 * projection; every band is then contain-fit with nearest-neighbor and
 * snapped to that palette with no error diffusion.
 *
 * @param input - Cutout, palette-source geometry, band table, and label.
 * @returns The validated indexed asset, ready for {@link renderIndexedArtModule}.
 * @throws Rejects when a band decode violates its geometry or the asset
 * contract fails.
 */
export async function projectCutoutToBands(input: ProjectCutoutInput): Promise<WelcomeArtAsset> {
  const { cutout, bands, label } = input
  const paletteSource = await sharp(cutout.data, {
    raw: { width: cutout.width, height: cutout.height, channels: 4 },
  })
    .resize({
      width: input.paletteSource.width,
      height: input.paletteSource.height,
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const palette = toPalette(derivePalette(collectOpaquePixels(
    paletteSource.data,
    paletteSource.info.width,
    paletteSource.info.height,
  )))
  const projected: WelcomeArtAsset['bands'] = []
  for (const band of bands) {
    const resized = await sharp(cutout.data, {
      raw: { width: cutout.width, height: cutout.height, channels: 4 },
    })
      .resize({
        width: band.width,
        height: band.height,
        fit: 'contain',
        kernel: sharp.kernel.nearest,
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
        `${label} band ${band.width}×${band.height} must decode to RGBA pixels of that size, got ${resized.info.width}×${resized.info.height} with ${resized.info.channels} channels.`,
      )
    }
    projected.push({
      width: band.width,
      height: band.height,
      rows: snapBand(resized.data, band.width, band.height, palette),
    })
  }
  const asset: WelcomeArtAsset = {
    bands: projected,
    palette: palette.map(entry => entry === null ? null : entry.hex),
    finalFrame: 'rest',
  }
  validateIndexedArtAsset(asset, bands, label)
  return asset
}

/** Whether an error is a missing-file failure. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * Reads a file whose absence or unreadability fails a generator check with a
 * remedy hint.
 *
 * @param path - File to read.
 * @param subject - Asset subject used in errors (`source image`).
 * @param remedy - Remedy command fragment (`run pnpm run generate-…`).
 * @param label - Mascot label used in errors (`welcome fox`).
 * @returns The file contents.
 * @throws Rejects with the labeled message and the original cause.
 */
export async function readCheckFile(
  path: string,
  subject: string,
  remedy: string,
  label: string,
): Promise<Buffer> {
  try {
    return await readFile(path)
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(`${label} ${subject} is missing; ${remedy}.`, { cause: error })
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} ${subject} could not be read: ${detail}`, { cause: error })
  }
}

/** Whether the current process runs the given module as its entry point. */
export function isEntryPoint(argv1: string | undefined, moduleUrl: string): boolean {
  return argv1 !== undefined && resolve(argv1) === fileURLToPath(moduleUrl)
}

/** CLI surface of one mascot generator: `--write` emits, `--check` validates. */
export interface WelcomeArtGeneratorCli {
  /** Generator name used in usage errors (`generate-welcome-fox`). */
  name: string
  /** `--write` side effect. */
  write(): Promise<void>
  /** `--check` in-memory validation. */
  check(): Promise<void>
}

/**
 * Runs one mascot generator's entry-point contract: exactly one of `--write`
 * or `--check`, errors reported on stderr with a non-zero exit code.
 *
 * @param argv1 - `process.argv[1]` for entry-point detection.
 * @param moduleUrl - The generator module's `import.meta.url`.
 * @param cli - Generator name and mode handlers.
 * @returns A promise fulfilled after the mode completes; a no-op when the
 * module is imported rather than executed.
 */
export async function runGeneratorEntry(
  argv1: string | undefined,
  moduleUrl: string,
  cli: WelcomeArtGeneratorCli,
): Promise<void> {
  if (!isEntryPoint(argv1, moduleUrl)) return
  try {
    const args = process.argv.slice(2)
    if (args.length !== 1 || (args[0] !== '--write' && args[0] !== '--check')) {
      throw new Error(`${cli.name}: expected exactly one of --write or --check.`)
    }
    if (args[0] === '--write') {
      await cli.write()
      return
    }
    await cli.check()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
