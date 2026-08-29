/**
 * Generate the runtime welcome-fox band module from the authored cutout.
 *
 * The sprite sheet is still validated for provenance. Runtime data is two
 * nearest-neighbor rest bands snapped to a shared plane palette with no
 * error diffusion. `--check` validates in memory and never writes to the
 * repository. Decode, projection, palette, and module rendering are shared
 * with the whale generator in `./welcome-art-shared.ts`.
 */

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { authorWelcomeFoxAssetBuffers } from './author-welcome-fox-assets.ts'
import {
  loadPngRgba,
  projectCutoutToBands,
  readCheckFile,
  renderIndexedArtModule,
  runGeneratorEntry,
  type IndexedArtModuleIdentity,
  type WelcomeArtAsset,
} from './welcome-art-shared.ts'
import {
  WELCOME_FOX_FRAME_HEIGHT,
  WELCOME_FOX_FRAME_IDS,
  WELCOME_FOX_FRAME_WIDTH,
  WELCOME_FOX_RUNTIME_BANDS,
  WELCOME_FOX_SHEET_WIDTH,
} from './welcome-fox-contract.ts'

const LABEL = 'welcome fox'

const packageRoot = resolve(import.meta.dirname, '..')
const sourcePath = resolve(packageRoot, 'assets/welcome-fox-source.png')
const cutoutPath = resolve(packageRoot, 'assets/welcome-fox-cutout.png')
const defaultSheetPath = resolve(packageRoot, 'assets/welcome-fox-sprite-sheet.png')
const outputPath = resolve(packageRoot, 'src/format/fox-frames.ts')

const FOX_MODULE_IDENTITY: IndexedArtModuleIdentity = {
  slug: 'welcome-fox',
  constantPrefix: 'WELCOME_FOX',
  typeName: 'WelcomeFoxBandWidth',
  generatorScript: 'generate-welcome-fox.ts',
  forbiddenTokens: ['WELCOME_FOX_TIMELINE', 'WELCOME_FOX_TOTAL_DURATION_MS'],
}

/** The generated source together with its validated in-memory representation. */
export interface WelcomeFoxGeneration {
  /** Complete deterministic TypeScript source. */
  source: string
  /** Validated indexed rest bands and shared palette. */
  asset: WelcomeArtAsset
}

/**
 * Validate the provenance sprite sheet, then project the cutout into the two
 * runtime rest bands. The shared 15-color palette is median-cut from the
 * 96×72 nearest-neighbor of the cutout. The input sheet must retain an
 * alpha channel
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
  const cutout = await loadPngRgba(cutoutPath, LABEL, 'cutout')
  const asset = await projectCutoutToBands({
    cutout,
    paletteSource: { width: WELCOME_FOX_FRAME_WIDTH, height: WELCOME_FOX_FRAME_HEIGHT },
    bands: WELCOME_FOX_RUNTIME_BANDS,
    label: LABEL,
  })
  return { source: renderIndexedArtModule(asset, FOX_MODULE_IDENTITY), asset }
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

async function checkGeneratedSource(): Promise<void> {
  const authorCommand = 'run pnpm exec tsx packages/tui/tui/scripts/author-welcome-fox-assets.ts'
  const source = await readCheckFile(
    sourcePath,
    'source image',
    'restore assets/welcome-fox-source.png',
    LABEL,
  )
  const authored = await authorWelcomeFoxAssetBuffers(source)
  const committedCutout = await readCheckFile(cutoutPath, 'cutout', authorCommand, LABEL)
  if (!authored.cutout.equals(committedCutout)) {
    throw new Error(`welcome fox cutout is stale; ${authorCommand}.`)
  }
  const committedSheet = await readCheckFile(defaultSheetPath, 'sprite sheet', authorCommand, LABEL)
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
      LABEL,
    )
  ).toString('utf8')
  if (committed !== generated.source) {
    throw new Error('welcome fox generated module is stale; run pnpm run generate-welcome-fox.')
  }
}

await runGeneratorEntry(process.argv[1], import.meta.url, {
  name: 'generate-welcome-fox',
  write: async () => {
    const generated = await generateWelcomeFoxModule()
    await writeFile(outputPath, generated.source, 'utf8')
  },
  check: checkGeneratedSource,
})
