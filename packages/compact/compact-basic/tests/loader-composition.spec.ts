import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import Include from '@cordisjs/plugin-include'
import LlmService from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import TokenMeterService from '@deepseek-ai/dsh-token-meter'
import BasicCompactService from '@deepseek-ai/dsh-compact-basic'
import ToolResultPruneService from '@deepseek-ai/dsh-compact-tool-result-prune'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) { await rm(root, { recursive: true, force: true }) }
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-token-meter-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmService],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-token-meter', TokenMeterService],
    ['@deepseek-ai/dsh-compact-tool-result-prune', ToolResultPruneService],
    ['@deepseek-ai/dsh-compact-basic', BasicCompactService],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads the shipped token-meter, pruning, and compact-basic YAML order', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-token-meter'",
      "- name: '@deepseek-ai/dsh-compact-tool-result-prune'",
      '  config:',
      '    thresholdChars: 100',
      '    headChars: 20',
      '    tailChars: 10',
      "- name: '@deepseek-ai/dsh-compact-basic'",
      '  config:',
      '    thresholdRatio: 0.5',
      '    retainRatio: 0.125',
      '    auto: false',
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(loaded.get('toolResultPrune')).toBeInstanceOf(ToolResultPruneService)
    expect(loaded.get('compact')).toBeInstanceOf(BasicCompactService)
    expect((loaded.compact as unknown as BasicCompactService).config).toMatchObject({
      thresholdRatio: 0.5,
      retainRatio: 0.125,
      auto: false,
    })
  })

  it('rejects stale token-meter config after Schemastery normalization', async () => {
    context = new Context()
    await expect(context.plugin(TokenMeterService, {
      contextWindow: 4096,
    } as never)).rejects.toThrow(/TokenMeterConfig: unknown key "contextWindow"/)
  })

  it('rejects stale compact-basic config after Schemastery normalization', async () => {
    context = new Context()
    await context.plugin(LlmService)
    await context.plugin(SessionStore)
    await context.plugin(TokenMeterService)
    await expect(context.plugin(BasicCompactService, {
      models: { legacy: { thresholdRatio: 0.5 } },
    } as never)).rejects.toThrow(/BasicCompactConfig: unknown key "models"/)
  })

  it('rejects a capacity-independent merged ratio conflict during plugin load', async () => {
    context = new Context()
    await context.plugin(LlmService)
    await context.plugin(SessionStore)
    await context.plugin(TokenMeterService)
    await expect(context.plugin(BasicCompactService, {
      retainRatio: 0.2,
      modelPolicies: [{
        provider: 'test-provider',
        model: 'test-model',
        thresholdRatio: 0.1,
      }],
    })).rejects.toThrow(/modelPolicies\[0\]: retainRatio \(0.2\).*thresholdRatio \(0.1\)/)
  })

  it('rejects an incomplete model-policy summarization pair during plugin load', async () => {
    context = new Context()
    await context.plugin(LlmService)
    await context.plugin(SessionStore)
    await context.plugin(TokenMeterService)
    await expect(context.plugin(BasicCompactService, {
      summarizationProvider: 'default-provider',
      summarizationModel: 'default-model',
      modelPolicies: [{
        provider: 'test-provider',
        model: 'test-model',
        summarizationModel: '',
      }],
    })).rejects.toThrow(/modelPolicies\[0\].*must be set together/)
  })
})
