/**
 * Author the transparent welcome-whale cutout from the flat-background source.
 *
 * The whale source is an AI-generated pixel-art PNG (ChatGPT image,
 * 2026-08-22) with a uniform dark background and a `DeepSeek </>` /
 * `< Harness >` caption band at the bottom. This repository-only workflow
 * crops the caption away, flood-fills the border-connected background into
 * transparency (interior dark pixels such as the eye and outlines survive),
 * and trims to opaque bounds. Runtime code never imports this module.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import {
  cropToOpaqueBounds,
  decodePngBuffer,
  isEntryPoint,
  type RawImage,
} from './welcome-art-shared.ts'

const LABEL = 'welcome whale'

/** Rows at or below this source y are the caption band and are cropped away. */
const CAPTION_CUT_Y = 885

/** Background key color sampled from the source corners. */
const BACKGROUND_RGB = { red: 25, green: 27, blue: 49 } as const

/**
 * Euclidean RGB distance under which a border-connected pixel counts as
 * background. The source background is uniform to ±1; the whale's darkest
 * outline sits beyond this radius, and the star glow well above it.
 */
const BACKGROUND_THRESHOLD = 48

const CUTOUT_INSET = 2

const packageRoot = resolve(import.meta.dirname, '..')
const sourcePath = resolve(packageRoot, 'assets/welcome-whale-source.png')
const cutoutPath = resolve(packageRoot, 'assets/welcome-whale-cutout.png')

/**
 * Rebuild and overwrite the committed whale cutout from the source PNG.
 * @returns A promise fulfilled after the cutout PNG has been overwritten.
 * @throws Rejects when the source cannot be read or authored, or the output
 * cannot be written.
 */
export async function authorWelcomeWhaleAssets(): Promise<void> {
  await writeFile(cutoutPath, await authorWelcomeWhaleCutoutBuffer(await readFile(sourcePath)))
}

/**
 * Author the transparent whale cutout in memory from the encoded source PNG.
 * The function performs no filesystem writes and returns a deterministic PNG
 * buffer owned by the caller.
 * @param source - Complete encoded PNG source image (alpha optional).
 * @returns Transparent cutout PNG buffer cropped to opaque bounds.
 * @throws Rejects when the source is not a decodable PNG or the keyed cutout
 * contains no opaque pixels.
 */
export async function authorWelcomeWhaleCutoutBuffer(source: Buffer): Promise<Buffer> {
  const decoded = await decodePngBuffer(source, {
    subject: 'source',
    label: LABEL,
    requireAlpha: false,
  })
  if (decoded.height <= CAPTION_CUT_Y) {
    throw new Error(
      `welcome whale source must be taller than the caption cut row ${CAPTION_CUT_Y}, got height ${decoded.height}.`,
    )
  }
  const cropped = cropRows(decoded, CAPTION_CUT_Y)
  const keyed = keyBackground(cropped)
  const trimmed = cropToOpaqueBounds(keyed, CUTOUT_INSET, LABEL)
  return await sharp(trimmed.data, {
    raw: { width: trimmed.width, height: trimmed.height, channels: 4 },
  }).png({ compressionLevel: 9 }).toBuffer()
}

/** Drops every row at or below the caption cut. */
function cropRows(source: RawImage, height: number): RawImage {
  const data = Buffer.alloc(source.width * height * 4)
  source.data.copy(data, 0, 0, data.length)
  return { data, width: source.width, height }
}

function backgroundDistance(data: Buffer, offset: number): number {
  const red = data[offset]! - BACKGROUND_RGB.red
  const green = data[offset + 1]! - BACKGROUND_RGB.green
  const blue = data[offset + 2]! - BACKGROUND_RGB.blue
  return Math.sqrt(red * red + green * green + blue * blue)
}

/**
 * Flood-fills border-connected near-background pixels to full transparency.
 * Interior pixels are never reached unless a background-colored path leads to
 * them, so the whale's dark eye and outlines stay opaque.
 */
function keyBackground(source: RawImage): RawImage {
  const { data, width, height } = source
  const visited = new Uint8Array(width * height)
  const queue: number[] = []
  const enqueue = (x: number, y: number): void => {
    const index = y * width + x
    if (visited[index] === 1) return
    if (backgroundDistance(data, index * 4) > BACKGROUND_THRESHOLD) return
    visited[index] = 1
    queue.push(index)
  }
  for (let x = 0; x < width; x++) {
    enqueue(x, 0)
    enqueue(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    enqueue(0, y)
    enqueue(width - 1, y)
  }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!
    data[index * 4 + 3] = 0
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) enqueue(x - 1, y)
    if (x < width - 1) enqueue(x + 1, y)
    if (y > 0) enqueue(x, y - 1)
    if (y < height - 1) enqueue(x, y + 1)
  }
  return source
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  await authorWelcomeWhaleAssets()
}
