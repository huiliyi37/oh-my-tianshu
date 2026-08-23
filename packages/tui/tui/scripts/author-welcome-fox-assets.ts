/**
 * Author the transparent welcome-fox cutout and its eight-frame sprite sheet.
 *
 * This repository-only workflow preserves the dark contour while removing the
 * border-connected peach background. Runtime code never imports this module.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  WELCOME_FOX_FRAME_HEIGHT,
  WELCOME_FOX_FRAME_IDS,
  WELCOME_FOX_FRAME_WIDTH,
  WELCOME_FOX_SHEET_WIDTH,
  type WelcomeFoxFrameId,
} from './welcome-fox-contract.ts'

const SOURCE_SIZE = 1_024
const CUTOUT_INSET = 2
const FRAME_INSET = 1

const packageRoot = resolve(import.meta.dirname, '..')
const sourcePath = resolve(packageRoot, 'assets/welcome-fox-source.jpg')
const cutoutPath = resolve(packageRoot, 'assets/welcome-fox-cutout.png')
const sheetPath = resolve(packageRoot, 'assets/welcome-fox-sprite-sheet.png')

interface RawImage {
  data: Buffer
  width: number
  height: number
}

/** PNG assets produced by the in-memory welcome-fox authoring pipeline. */
export interface WelcomeFoxAuthoredAssets {
  /** Transparent editable cutout encoded as PNG. */
  cutout: Buffer
  /** Eight-frame horizontal sprite sheet encoded as PNG. */
  sheet: Buffer
}

/**
 * Rebuild and overwrite the committed cutout and sprite sheet from the source
 * 1024×1024 JPEG. This filesystem wrapper may replace one output before a later
 * write fails.
 * @returns A promise fulfilled after both PNG files have been overwritten.
 * @throws Rejects when the source cannot be read or authored, or either output
 * cannot be written.
 */
export async function authorWelcomeFoxAssets(): Promise<void> {
  const authored = await authorWelcomeFoxAssetBuffers(await readFile(sourcePath))
  await writeFile(cutoutPath, authored.cutout)
  await writeFile(sheetPath, authored.sheet)
}

/**
 * Author the editable assets in memory from an encoded 1024×1024 JPEG.
 * The function performs no filesystem writes and returns deterministic PNG
 * buffers owned by the caller.
 * @param source - Complete encoded JPEG source image.
 * @returns Transparent cutout and eight-frame sprite-sheet PNG buffers.
 * @throws Rejects when the source is not a decodable 1024×1024 JPEG or contains
 * no foreground pixels.
 */
export async function authorWelcomeFoxAssetBuffers(
  source: Buffer,
): Promise<WelcomeFoxAuthoredAssets> {
  const decoded = await decodeSource(source)
  const transparent = removeBorderConnectedBackground(decoded)
  const cropped = cropToOpaqueBounds(transparent, CUTOUT_INSET)

  const cutout = await sharp(cropped.data, {
    raw: { width: cropped.width, height: cropped.height, channels: 4 },
  }).png({ compressionLevel: 9 }).toBuffer()

  const canonical = await canonicalFrame(cropped)
  const frames = authorFrames(canonical)
  const rawSheet = Buffer.alloc(WELCOME_FOX_SHEET_WIDTH * WELCOME_FOX_FRAME_HEIGHT * 4)
  for (const [frameIndex, frameId] of WELCOME_FOX_FRAME_IDS.entries()) {
    blitFrame(
      rawSheet,
      WELCOME_FOX_SHEET_WIDTH,
      frames[frameId],
      frameIndex * WELCOME_FOX_FRAME_WIDTH,
    )
  }
  const sheet = await sharp(rawSheet, {
    raw: {
      width: WELCOME_FOX_SHEET_WIDTH,
      height: WELCOME_FOX_FRAME_HEIGHT,
      channels: 4,
    },
  }).png({ compressionLevel: 9 }).toBuffer()
  return { cutout, sheet }
}

async function decodeSource(source: Buffer): Promise<RawImage> {
  const image = sharp(source, { failOn: 'error' })
  const metadata = await image.metadata()
  if (
    metadata.format !== 'jpeg'
    || metadata.width !== SOURCE_SIZE
    || metadata.height !== SOURCE_SIZE
  ) {
    throw new Error(
      `welcome fox source must be a ${SOURCE_SIZE}×${SOURCE_SIZE} JPEG, got ${metadata.format ?? 'unknown format'} ${metadata.width ?? 'unknown'}×${metadata.height ?? 'unknown'}.`,
    )
  }
  const { data, info } = await image
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== SOURCE_SIZE || info.height !== SOURCE_SIZE || info.channels !== 4) {
    throw new Error(
      `welcome fox source must decode to ${SOURCE_SIZE}×${SOURCE_SIZE} RGBA pixels, got ${info.width}×${info.height} with ${info.channels} channels.`,
    )
  }
  return { data, width: info.width, height: info.height }
}

function removeBorderConnectedBackground(source: RawImage): RawImage {
  const { data, width, height } = source
  const output = Buffer.from(data)
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let read = 0
  let write = 0

  const enqueue = (x: number, y: number): void => {
    const pixel = y * width + x
    if (visited[pixel] === 1 || !isPeachBackground(data, pixel * 4)) return
    visited[pixel] = 1
    queue[write++] = pixel
  }
  for (let x = 0; x < width; x++) {
    enqueue(x, 0)
    enqueue(x, height - 1)
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(0, y)
    enqueue(width - 1, y)
  }

  while (read < write) {
    const pixel = queue[read++]!
    const x = pixel % width
    const y = Math.floor(pixel / width)
    const offset = pixel * 4
    output[offset] = 0
    output[offset + 1] = 0
    output[offset + 2] = 0
    output[offset + 3] = 0
    if (x > 0) enqueue(x - 1, y)
    if (x + 1 < width) enqueue(x + 1, y)
    if (y > 0) enqueue(x, y - 1)
    if (y + 1 < height) enqueue(x, y + 1)
  }

  return { data: output, width, height }
}

function isPeachBackground(data: Buffer, offset: number): boolean {
  const red = data[offset]!
  const green = data[offset + 1]!
  const blue = data[offset + 2]!
  const channelSpread = Math.max(red, green, blue) - Math.min(red, green, blue)
  return red >= 208
    && green >= 180
    && blue >= 160
    && red + green + blue >= 585
    && red >= green - 4
    && green >= blue - 8
    && channelSpread <= 96
}

function cropToOpaqueBounds(source: RawImage, inset: number): RawImage {
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
  if (right < left || bottom < top) throw new Error('welcome fox cutout contains no opaque pixels.')
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

async function canonicalFrame(cutout: RawImage): Promise<Buffer> {
  const { data, info } = await sharp(cutout.data, {
    raw: { width: cutout.width, height: cutout.height, channels: 4 },
  }).resize({
    width: WELCOME_FOX_FRAME_WIDTH - FRAME_INSET * 2,
    height: WELCOME_FOX_FRAME_HEIGHT - FRAME_INSET * 2,
    fit: 'inside',
    kernel: sharp.kernel.lanczos3,
  }).raw().toBuffer({ resolveWithObject: true })
  const frame = Buffer.alloc(WELCOME_FOX_FRAME_WIDTH * WELCOME_FOX_FRAME_HEIGHT * 4)
  const left = Math.floor((WELCOME_FOX_FRAME_WIDTH - info.width) / 2)
  const top = Math.floor((WELCOME_FOX_FRAME_HEIGHT - info.height) / 2)
  for (let y = 0; y < info.height; y++) {
    const sourceStart = y * info.width * 4
    const destinationStart = ((top + y) * WELCOME_FOX_FRAME_WIDTH + left) * 4
    data.copy(frame, destinationStart, sourceStart, sourceStart + info.width * 4)
  }
  return frame
}

/**
 * Scale factor from the legacy 40×30 authoring grid to the current frame grid.
 *
 * The legacy grid was the first authoring pass of the welcome fox; its
 * procedural edit rectangles were hand-placed against a 40×30 frame. Keeping
 * the same rectangles proportional to the current grid preserves the intended
 * tail path, breathing region, eye position, and glint placement.
 */
const GRID_SCALE = WELCOME_FOX_FRAME_WIDTH / 40

/** Scale one legacy horizontal grid coordinate to the current grid. */
function gridX(x: number): number {
  return Math.round(x * GRID_SCALE)
}

/** Scale one legacy vertical grid coordinate to the current grid. */
function gridY(y: number): number {
  return Math.round(y * GRID_SCALE)
}

function authorFrames(rest: Buffer): Record<WelcomeFoxFrameId, Buffer> {
  const tailShift = Math.max(1, gridX(1))
  return {
    rest,
    'tail-left': shiftRectangle(
      rest, gridX(1), gridY(23), gridX(38), gridY(28), -tailShift, 0,
    ),
    'tail-right': shiftRectangle(
      rest, gridX(1), gridY(23), gridX(38), gridY(28), tailShift, 0,
    ),
    'breathe-in': swellRegion(
      rest, gridX(23), gridY(10), gridX(37), gridY(20), 0, -tailShift,
    ),
    'breathe-out': swellRegion(
      rest, gridX(23), gridY(10), gridX(37), gridY(20), 0, tailShift,
    ),
    blink: blinkRightEye(rest),
    'glint-a': addGlint(rest, gridX(15), gridY(11), Math.max(1, gridX(1))),
    'glint-b': addGlint(rest, gridX(15), gridY(11), Math.max(1, gridX(2))),
  }
}

function shiftRectangle(
  source: Buffer,
  left: number,
  top: number,
  right: number,
  bottom: number,
  dx: number,
  dy: number,
): Buffer {
  const output = Buffer.from(source)
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) writePixel(output, x, y, [0, 0, 0, 0])
  }
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      writePixel(output, x + dx, y + dy, readPixel(source, x, y))
    }
  }
  return output
}

function swellRegion(
  source: Buffer,
  left: number,
  top: number,
  right: number,
  bottom: number,
  dx: number,
  dy: number,
): Buffer {
  const output = Buffer.from(source)
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const pixel = readPixel(source, x, y)
      if (pixel[3] !== 0) writePixel(output, x + dx, y + dy, pixel)
    }
  }
  return output
}

function blinkRightEye(source: Buffer): Buffer {
  const output = Buffer.from(source)
  const fur: readonly [number, number, number, number] = [244, 225, 211, 255]
  const shadow: readonly [number, number, number, number] = [207, 183, 181, 255]
  const outline: readonly [number, number, number, number] = [26, 76, 103, 255]
  const left = gridX(18)
  const right = gridX(21)
  const top = gridY(12)
  const bottom = gridY(15)
  const lidRow = Math.round(top + (bottom - top) * 0.6)
  for (let y = top; y <= bottom; y++) {
    const color = y > lidRow ? shadow : fur
    for (let x = left; x <= right; x++) writePixel(output, x, y, color)
  }
  // Closed-lid arc: the legacy 4×4 blink pattern (edges one row above the
  // center, center on the shadow boundary) scaled to the current grid.
  for (let x = left; x <= right; x++) {
    const t = (x - left) / Math.max(1, right - left)
    const y = Math.min(bottom, Math.max(top, lidRow - 1 + Math.round(t * 2)))
    writePixel(output, x, y, outline)
  }
  return output
}

function addGlint(source: Buffer, centerX: number, centerY: number, radius: number): Buffer {
  const output = Buffer.from(source)
  const gold: readonly [number, number, number, number] = [231, 177, 61, 255]
  const light: readonly [number, number, number, number] = [255, 244, 174, 255]
  writePixel(output, centerX, centerY, light)
  for (let distance = 1; distance <= radius; distance++) {
    const color = distance === radius ? gold : light
    writePixel(output, centerX - distance, centerY, color)
    writePixel(output, centerX + distance, centerY, color)
    writePixel(output, centerX, centerY - distance, color)
    writePixel(output, centerX, centerY + distance, color)
  }
  if (radius > 1) {
    writePixel(output, centerX - 1, centerY - 1, gold)
    writePixel(output, centerX + 1, centerY - 1, gold)
    writePixel(output, centerX - 1, centerY + 1, gold)
    writePixel(output, centerX + 1, centerY + 1, gold)
  }
  return output
}

function readPixel(source: Buffer, x: number, y: number): readonly [number, number, number, number] {
  if (
    x < 0
    || x >= WELCOME_FOX_FRAME_WIDTH
    || y < 0
    || y >= WELCOME_FOX_FRAME_HEIGHT
  ) return [0, 0, 0, 0]
  const offset = (y * WELCOME_FOX_FRAME_WIDTH + x) * 4
  return [
    source[offset]!,
    source[offset + 1]!,
    source[offset + 2]!,
    source[offset + 3]!,
  ]
}

function writePixel(
  target: Buffer,
  x: number,
  y: number,
  pixel: readonly [number, number, number, number],
): void {
  if (
    x < 0
    || x >= WELCOME_FOX_FRAME_WIDTH
    || y < 0
    || y >= WELCOME_FOX_FRAME_HEIGHT
  ) return
  const offset = (y * WELCOME_FOX_FRAME_WIDTH + x) * 4
  target[offset] = pixel[0]
  target[offset + 1] = pixel[1]
  target[offset + 2] = pixel[2]
  target[offset + 3] = pixel[3]
}

function blitFrame(sheet: Buffer, sheetWidth: number, frame: Buffer, left: number): void {
  for (let y = 0; y < WELCOME_FOX_FRAME_HEIGHT; y++) {
    const sourceStart = y * WELCOME_FOX_FRAME_WIDTH * 4
    const destinationStart = (y * sheetWidth + left) * 4
    frame.copy(
      sheet,
      destinationStart,
      sourceStart,
      sourceStart + WELCOME_FOX_FRAME_WIDTH * 4,
    )
  }
}

function isEntryPoint(argv1: string | undefined, moduleUrl: string): boolean {
  return argv1 !== undefined && resolve(argv1) === fileURLToPath(moduleUrl)
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  await authorWelcomeFoxAssets()
}
