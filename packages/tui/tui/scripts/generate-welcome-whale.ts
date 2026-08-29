/**
 * Generate the runtime welcome-whale band module from the authored cutout.
 *
 * The whale is a single static pose (no sprite sheet): the transparent cutout
 * authored by `./author-welcome-whale-assets.ts` is projected into the two
 * runtime rest bands shared with the fox. `--check` re-authors the cutout
 * from the archived source and validates everything in memory without
 * writing to the repository.
 */

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { authorWelcomeWhaleCutoutBuffer } from './author-welcome-whale-assets.ts'
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
  WELCOME_WHALE_PALETTE_SOURCE_HEIGHT,
  WELCOME_WHALE_PALETTE_SOURCE_WIDTH,
  WELCOME_WHALE_RUNTIME_BANDS,
} from './welcome-whale-contract.ts'

const LABEL = 'welcome whale'

const packageRoot = resolve(import.meta.dirname, '..')
const sourcePath = resolve(packageRoot, 'assets/welcome-whale-source.png')
const defaultCutoutPath = resolve(packageRoot, 'assets/welcome-whale-cutout.png')
const outputPath = resolve(packageRoot, 'src/format/whale-frames.ts')

const WHALE_MODULE_IDENTITY: IndexedArtModuleIdentity = {
  slug: 'welcome-whale',
  constantPrefix: 'WELCOME_WHALE',
  typeName: 'WelcomeWhaleBandWidth',
  generatorScript: 'generate-welcome-whale.ts',
  forbiddenTokens: ['WELCOME_WHALE_TIMELINE', 'WELCOME_WHALE_TOTAL_DURATION_MS'],
}

/** The generated source together with its validated in-memory representation. */
export interface WelcomeWhaleGeneration {
  /** Complete deterministic TypeScript source. */
  source: string
  /** Validated indexed rest bands and shared palette. */
  asset: WelcomeArtAsset
}

/**
 * Project the authored whale cutout into the two runtime rest bands. The
 * shared 15-color palette is median-cut from the 96×72 nearest-neighbor of
 * the cutout.
 * @param cutoutPath - Path to the transparent whale cutout PNG.
 * @returns Deterministic self-contained source and the validated indexed asset.
 * @throws Rejects when the cutout cannot be read or decoded, has another
 * format, lacks alpha, or violates a band invariant.
 */
export async function generateWelcomeWhaleModule(
  cutoutPath = defaultCutoutPath,
): Promise<WelcomeWhaleGeneration> {
  const cutout = await loadPngRgba(cutoutPath, LABEL, 'cutout')
  const asset = await projectCutoutToBands({
    cutout,
    paletteSource: {
      width: WELCOME_WHALE_PALETTE_SOURCE_WIDTH,
      height: WELCOME_WHALE_PALETTE_SOURCE_HEIGHT,
    },
    bands: WELCOME_WHALE_RUNTIME_BANDS,
    label: LABEL,
  })
  return { source: renderIndexedArtModule(asset, WHALE_MODULE_IDENTITY), asset }
}

async function checkGeneratedSource(): Promise<void> {
  const authorCommand = 'run pnpm exec tsx packages/tui/tui/scripts/author-welcome-whale-assets.ts'
  const source = await readCheckFile(
    sourcePath,
    'source image',
    'restore assets/welcome-whale-source.png',
    LABEL,
  )
  const authored = await authorWelcomeWhaleCutoutBuffer(source)
  const committedCutout = await readCheckFile(defaultCutoutPath, 'cutout', authorCommand, LABEL)
  if (!authored.equals(committedCutout)) {
    throw new Error(`welcome whale cutout is stale; ${authorCommand}.`)
  }

  const generated = await generateWelcomeWhaleModule()
  const committed = (
    await readCheckFile(
      outputPath,
      'generated module',
      'run pnpm run generate-welcome-whale',
      LABEL,
    )
  ).toString('utf8')
  if (committed !== generated.source) {
    throw new Error('welcome whale generated module is stale; run pnpm run generate-welcome-whale.')
  }
}

await runGeneratorEntry(process.argv[1], import.meta.url, {
  name: 'generate-welcome-whale',
  write: async () => {
    const generated = await generateWelcomeWhaleModule()
    await writeFile(outputPath, generated.source, 'utf8')
  },
  check: checkGeneratedSource,
})
