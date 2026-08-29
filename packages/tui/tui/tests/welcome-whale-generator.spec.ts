/**
 * Deterministic welcome-whale asset generator contract tests.
 *
 * The committed cutout must be a byte-for-byte authoring of the archived
 * source, and the committed TypeScript module a byte-for-byte projection of
 * the cutout, while malformed cutouts fail before producing data.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { authorWelcomeWhaleCutoutBuffer } from '../scripts/author-welcome-whale-assets.ts'
import { generateWelcomeWhaleModule } from '../scripts/generate-welcome-whale.ts'
import { WELCOME_WHALE_RUNTIME_BANDS } from '../scripts/welcome-whale-contract.ts'

const packageRoot = resolve(import.meta.dirname, '..')
const sourcePath = join(packageRoot, 'assets/welcome-whale-source.png')
const cutoutPath = join(packageRoot, 'assets/welcome-whale-cutout.png')
const outputPath = join(packageRoot, 'src/format/whale-frames.ts')
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

async function createTemporaryPath(fileName: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-welcome-whale-'))
  temporaryDirectories.push(directory)
  return join(directory, fileName)
}

function findRuntimeDependencies(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    'whale-frames.ts',
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

describe('welcome whale generator', () => {
  it('rebuilds the committed cutout from the archived source', async () => {
    const cutout = await authorWelcomeWhaleCutoutBuffer(await readFile(sourcePath))
    expect(cutout).toEqual(await readFile(cutoutPath))

    const { data, info } = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(4)
    // 透明边界：洪水填充从四边进入，外圈一周必须全透明。
    const alphaAt = (x: number, y: number): number => data[(y * info.width + x) * 4 + 3]!
    for (let x = 0; x < info.width; x++) {
      expect(alphaAt(x, 0), `top boundary at x=${x}`).toBe(0)
      expect(alphaAt(x, info.height - 1), `bottom boundary at x=${x}`).toBe(0)
    }
    for (let y = 1; y < info.height - 1; y++) {
      expect(alphaAt(0, y), `left boundary at y=${y}`).toBe(0)
      expect(alphaAt(info.width - 1, y), `right boundary at y=${y}`).toBe(0)
    }
  }, 60_000)

  it('emits only the 28×30 and 36×38 rest bands from the cutout', async () => {
    const generated = await generateWelcomeWhaleModule()
    const committed = await readFile(outputPath, 'utf8')
    expect(generated.source).toBe(committed)
    expect(findRuntimeDependencies(generated.source)).toEqual([])
    expect(generated.source).not.toContain('/assets/')
    expect(generated.asset.bands.map(band => [band.width, band.height])).toEqual(
      WELCOME_WHALE_RUNTIME_BANDS.map(band => [band.width, band.height]),
    )
    expect(generated.asset.finalFrame).toBe('rest')
    expect(generated.source).not.toContain('WELCOME_WHALE_TIMELINE')
    expect(generated.source).not.toContain('WELCOME_WHALE_TOTAL_DURATION_MS')
    for (const band of generated.asset.bands) {
      expect(band.rows).toHaveLength(band.height)
      for (const row of band.rows) {
        expect(row).toHaveLength(band.width)
        expect(row).toMatch(/^[0-9a-f]+$/)
      }
    }
  }, 60_000)

  it('keeps index 0 transparent and caps the palette at 16 entries', async () => {
    const generated = await generateWelcomeWhaleModule()
    expect(generated.asset.palette[0]).toBeNull()
    expect(generated.asset.palette.length).toBeLessThanOrEqual(16)
  }, 60_000)

  it('rejects a non-PNG cutout before decoding pixels', async () => {
    const invalidPath = await createTemporaryPath('invalid.jpg')
    await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).jpeg().toFile(invalidPath)

    await expect(generateWelcomeWhaleModule(invalidPath)).rejects.toThrow(
      'welcome whale cutout must be a PNG',
    )
  })

  it('rejects an RGB cutout without an alpha channel', async () => {
    const invalidPath = await createTemporaryPath('invalid.png')
    await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    }).png().toFile(invalidPath)

    await expect(generateWelcomeWhaleModule(invalidPath)).rejects.toThrow(
      'welcome whale cutout must have an alpha channel',
    )
  })

  it('rejects a fully transparent cutout during authoring', async () => {
    const empty = await sharp({
      create: {
        width: 1254,
        height: 1254,
        channels: 4,
        background: { r: 25, g: 27, b: 49, alpha: 1 },
      },
    }).png().toBuffer()

    await expect(authorWelcomeWhaleCutoutBuffer(empty)).rejects.toThrow(
      'welcome whale cutout contains no opaque pixels',
    )
  }, 60_000)
})
