/**
 * Deterministic welcome-fox asset generator contract tests.
 *
 * The committed TypeScript module must be a byte-for-byte projection of the
 * authored sprite sheet, while malformed sheets fail before producing data.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { authorWelcomeFoxAssetBuffers } from '../scripts/author-welcome-fox-assets.ts'
import { generateWelcomeFoxModule } from '../scripts/generate-welcome-fox.ts'
import {
  WELCOME_FOX_FRAME_HEIGHT,
  WELCOME_FOX_FRAME_IDS,
  WELCOME_FOX_FRAME_WIDTH,
  WELCOME_FOX_SHEET_WIDTH,
} from '../scripts/welcome-fox-contract.ts'

const packageRoot = resolve(import.meta.dirname, '..')
const sourcePath = join(packageRoot, 'assets/welcome-fox-source.png')
const cutoutPath = join(packageRoot, 'assets/welcome-fox-cutout.png')
const sheetPath = join(packageRoot, 'assets/welcome-fox-sprite-sheet.png')
const outputPath = join(packageRoot, 'src/format/fox-frames.ts')
const frameIds = WELCOME_FOX_FRAME_IDS
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

async function createTemporaryPath(fileName: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-welcome-fox-'))
  temporaryDirectories.push(directory)
  return join(directory, fileName)
}

function findRuntimeDependencies(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    'fox-frames.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const dependencies: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      dependencies.push('ImportDeclaration')
    } else if (ts.isImportEqualsDeclaration(node)) {
      dependencies.push('ImportEqualsDeclaration')
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      dependencies.push('ExportDeclaration')
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      dependencies.push('dynamic import')
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return dependencies
}

function extractFrame(sheet: Buffer, sheetWidth: number, frameIndex: number): Buffer {
  const width = WELCOME_FOX_FRAME_WIDTH
  const height = WELCOME_FOX_FRAME_HEIGHT
  const frame = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sourceStart = (y * sheetWidth + frameIndex * width) * 4
    sheet.copy(frame, y * width * 4, sourceStart, sourceStart + width * 4)
  }
  return frame
}

function expectTransparentBoundary(frameId: string, frame: Buffer): void {
  const width = WELCOME_FOX_FRAME_WIDTH
  const height = WELCOME_FOX_FRAME_HEIGHT
  const alphaAt = (x: number, y: number): number => frame[(y * width + x) * 4 + 3]!
  for (let x = 0; x < width; x++) {
    expect(alphaAt(x, 0), `${frameId} top boundary at x=${x}`).toBe(0)
    expect(alphaAt(x, height - 1), `${frameId} bottom boundary at x=${x}`).toBe(0)
  }
  for (let y = 1; y < height - 1; y++) {
    expect(alphaAt(0, y), `${frameId} left boundary at y=${y}`).toBe(0)
    expect(alphaAt(width - 1, y), `${frameId} right boundary at y=${y}`).toBe(0)
  }
}

describe('welcome fox generator', () => {
  it('rebuilds the committed editable assets as eight identical rest frames', async () => {
    const authored = await authorWelcomeFoxAssetBuffers(await readFile(sourcePath))
    expect(authored.cutout).toEqual(await readFile(cutoutPath))
    expect(authored.sheet).toEqual(await readFile(sheetPath))

    const { data, info } = await sharp(authored.sheet)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(info).toMatchObject({ width: WELCOME_FOX_SHEET_WIDTH, height: WELCOME_FOX_FRAME_HEIGHT, channels: 4 })
    const frames = new Map(frameIds.map((frameId, frameIndex) => [
      frameId,
      extractFrame(data, info.width, frameIndex),
    ]))
    const rest = frames.get('rest')!
    for (const frameId of frameIds) {
      const frame = frames.get(frameId)!
      expectTransparentBoundary(frameId, frame)
      expect(frame.equals(rest), `${frameId} must match the static rest frame`).toBe(true)
    }
    expect(new Set([...frames.values()].map(frame => frame.toString('base64'))).size).toBe(1)
  }, 60_000)

  it('emits only the 28×30 and 36×38 rest bands from the cutout', async () => {
    const generated = await generateWelcomeFoxModule(sheetPath)
    const committed = await readFile(outputPath, 'utf8')
    expect(generated.source).toBe(committed)
    expect(findRuntimeDependencies(generated.source)).toEqual([])
    expect(generated.source).not.toContain('/assets/')
    expect(generated.asset.bands.map(band => [band.width, band.height])).toEqual([
      [28, 30],
      [36, 38],
      [44, 46],
    ])
    expect(generated.asset.finalFrame).toBe('rest')
    expect(generated.source).not.toContain('WELCOME_FOX_TIMELINE')
    expect(generated.source).not.toContain('WELCOME_FOX_TOTAL_DURATION_MS')
    for (const band of generated.asset.bands) {
      expect(band.rows).toHaveLength(band.height)
      for (const row of band.rows) {
        expect(row).toHaveLength(band.width)
        expect(row).toMatch(/^[0-9a-f]+$/)
      }
    }
  }, 60_000)

  it('snaps each opaque pixel without writing error-diffusion neighbors', async () => {
    const generated = await generateWelcomeFoxModule(sheetPath)
    expect(generated.source).not.toMatch(/WELCOME_FOX_TIMELINE/)
    // A dithered 56-wide row would scatter uncommon indexes; the rest pose
    // must use the same palette on both bands and keep index 0 as transparent.
    expect(generated.asset.palette[0]).toBeNull()
    expect(generated.asset.palette.length).toBeLessThanOrEqual(16)
  }, 60_000)

  it('rejects a sprite sheet with the wrong dimensions', async () => {
    const invalidPath = await createTemporaryPath('invalid.png')
    await sharp({
      create: {
        width: WELCOME_FOX_FRAME_WIDTH + 1,
        height: WELCOME_FOX_FRAME_HEIGHT,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).png().toFile(invalidPath)

    await expect(generateWelcomeFoxModule(invalidPath)).rejects.toThrow(
      `welcome fox sheet must be ${WELCOME_FOX_SHEET_WIDTH}×${WELCOME_FOX_FRAME_HEIGHT} pixels`,
    )
  })

  it('rejects a non-PNG sprite sheet before decoding pixels', async () => {
    const invalidPath = await createTemporaryPath('invalid.jpg')
    await sharp({
      create: {
        width: WELCOME_FOX_SHEET_WIDTH,
        height: WELCOME_FOX_FRAME_HEIGHT,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).jpeg().toFile(invalidPath)

    await expect(generateWelcomeFoxModule(invalidPath)).rejects.toThrow(
      'welcome fox sheet must be a PNG',
    )
  })

  it('rejects a same-size RGB PNG without an alpha channel', async () => {
    const invalidPath = await createTemporaryPath('invalid.png')
    await sharp({
      create: {
        width: WELCOME_FOX_SHEET_WIDTH,
        height: WELCOME_FOX_FRAME_HEIGHT,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    }).png().toFile(invalidPath)

    await expect(generateWelcomeFoxModule(invalidPath)).rejects.toThrow(
      'welcome fox sheet must have an alpha channel',
    )
  })

  it('rejects an alpha sheet with an opaque per-frame boundary', async () => {
    const invalidPath = await createTemporaryPath('invalid.png')
    const sheet = Buffer.alloc(WELCOME_FOX_SHEET_WIDTH * WELCOME_FOX_FRAME_HEIGHT * 4)
    const opaqueBoundaryOffset = (15 * WELCOME_FOX_SHEET_WIDTH + WELCOME_FOX_FRAME_WIDTH) * 4
    sheet[opaqueBoundaryOffset] = 255
    sheet[opaqueBoundaryOffset + 3] = 255
    await sharp(sheet, {
      raw: { width: WELCOME_FOX_SHEET_WIDTH, height: WELCOME_FOX_FRAME_HEIGHT, channels: 4 },
    }).png().toFile(invalidPath)

    await expect(generateWelcomeFoxModule(invalidPath)).rejects.toThrow(
      'welcome fox frame tail-left must have a fully transparent boundary',
    )
  })
})
