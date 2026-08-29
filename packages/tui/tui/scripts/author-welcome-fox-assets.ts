/**
 * Author the transparent welcome-fox cutout and its eight-frame sprite sheet.
 *
 * The sitting-fox source is already a transparent PNG. This repository-only
 * workflow crops to opaque bounds and projects one rest frame eight times so
 * the provenance sheet keeps its 768×72 geometry. Runtime code never imports
 * this module.
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
import {
  WELCOME_FOX_FRAME_HEIGHT,
  WELCOME_FOX_FRAME_IDS,
  WELCOME_FOX_FRAME_WIDTH,
  WELCOME_FOX_SHEET_WIDTH,
} from './welcome-fox-contract.ts'

const LABEL = 'welcome fox'

const CUTOUT_INSET = 2
const FRAME_INSET = 1

const packageRoot = resolve(import.meta.dirname, '..')
const sourcePath = resolve(packageRoot, 'assets/welcome-fox-source.png')
const cutoutPath = resolve(packageRoot, 'assets/welcome-fox-cutout.png')
const sheetPath = resolve(packageRoot, 'assets/welcome-fox-sprite-sheet.png')

/** PNG assets produced by the in-memory welcome-fox authoring pipeline. */
export interface WelcomeFoxAuthoredAssets {
  /** Transparent editable cutout encoded as PNG. */
  cutout: Buffer
  /** Eight-frame horizontal sprite sheet encoded as PNG. */
  sheet: Buffer
}

/**
 * Rebuild and overwrite the committed cutout and sprite sheet from the source
 * PNG. This filesystem wrapper may replace one output before a later write
 * fails.
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
 * Author the editable assets in memory from an encoded transparent PNG.
 * The function performs no filesystem writes and returns deterministic PNG
 * buffers owned by the caller.
 * @param source - Complete encoded PNG source image with an alpha channel.
 * @returns Transparent cutout and eight-frame sprite-sheet PNG buffers.
 * @throws Rejects when the source is not a decodable RGBA PNG or contains no
 * foreground pixels.
 */
export async function authorWelcomeFoxAssetBuffers(
  source: Buffer,
): Promise<WelcomeFoxAuthoredAssets> {
  const cropped = cropToOpaqueBounds(await decodeSource(source), CUTOUT_INSET, LABEL)

  const cutout = await sharp(cropped.data, {
    raw: { width: cropped.width, height: cropped.height, channels: 4 },
  }).png({ compressionLevel: 9 }).toBuffer()

  const rest = await canonicalFrame(cropped)
  const rawSheet = Buffer.alloc(WELCOME_FOX_SHEET_WIDTH * WELCOME_FOX_FRAME_HEIGHT * 4)
  for (const [frameIndex] of WELCOME_FOX_FRAME_IDS.entries()) {
    blitFrame(rawSheet, WELCOME_FOX_SHEET_WIDTH, rest, frameIndex * WELCOME_FOX_FRAME_WIDTH)
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
  return decodePngBuffer(source, {
    subject: 'source',
    label: LABEL,
    requireAlpha: true,
    combinedFormatAlphaMessage: true,
  })
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

if (isEntryPoint(process.argv[1], import.meta.url)) {
  await authorWelcomeFoxAssets()
}
