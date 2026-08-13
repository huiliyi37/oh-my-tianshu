import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import Include from '@cordisjs/plugin-include'
import TokenMeterService from '@deepseek-ai/dsh-token-meter'
import ToolResultPruneService from '@deepseek-ai/dsh-compact-tool-result-prune'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) { await rm(root, { recursive: true, force: true }) }
  root = undefined
})

describe('compact-tool-result-prune real Loader composition', () => {
  it('loads and resolves the flat YAML plugin shape', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-compact-tool-result-prune-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-token-meter'",
      "- name: '@deepseek-ai/dsh-compact-tool-result-prune'",
      '  config:',
      '    thresholdChars: 100',
      '    headChars: 20',
      '    tailChars: 10',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-token-meter') return TokenMeterService
        if (specifier === '@deepseek-ai/dsh-compact-tool-result-prune') return ToolResultPruneService
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.get('toolResultPrune')).toBeInstanceOf(ToolResultPruneService)
    expect(context.toolResultPrune.config).toEqual({
      thresholdChars: 100,
      headChars: 20,
      tailChars: 10,
    })
  })

  it('rejects stale config after plugin schema normalization', async () => {
    context = new Context()
    // Satisfy the declared injection first: config normalization runs in the
    // service constructor, which a pending fiber never reaches.
    await context.plugin(TokenMeterService)
    await expect(context.plugin(ToolResultPruneService, {
      maxChars: 100,
    } as never)).rejects.toThrow(/unknown key "maxChars"/)
  })
})
