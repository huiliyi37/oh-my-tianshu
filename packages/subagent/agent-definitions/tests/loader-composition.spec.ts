import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import Loader from '@huiliyi37/cordis-plugin-loader'
import Include from '@huiliyi37/cordis-plugin-include'
import AgentDefinitionService from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) { await rm(root, { recursive: true, force: true }) }
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-agent-definitions-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@huiliyi37/dsh-agent-definitions', AgentDefinitionService],
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
  it('boots through cordis.yml with schema-validated config and the built-in explore role', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-agent-definitions-home-'))
    const custom = join(home, 'custom-agents')
    await mkdir(custom, { recursive: true })
    await writeFile(
      join(custom, 'scout.md'),
      '---\nname: scout\ndescription: yaml-loaded role\ntools:\n  - grep\n---\n\nScout body.\n',
    )
    const ctx = await loadYaml([
      "- name: '@huiliyi37/dsh-agent-definitions'",
      '  config:',
      `    dshHome: ${JSON.stringify(join(home, '.dsh'))}`,
      `    agentsHome: ${JSON.stringify(join(home, '.agents'))}`,
      `    customAgentDirs: [${JSON.stringify(custom)}]`,
      '    watch: false',
    ])

    expect((await ctx.agentDefinitions.get('explore'))?.sandbox).toBe('read-only')
    const scout = await ctx.agentDefinitions.get('scout')
    expect(scout).toMatchObject({ name: 'scout', tools: ['grep'], content: 'Scout body.' })
    expect((await ctx.agentDefinitions.list()).map(entry => entry.name)).toEqual(['explore', 'scout', 'verify'])
  })

  it('rejects a config violating the schema at load', async () => {
    await expect(loadYaml([
      "- name: '@huiliyi37/dsh-agent-definitions'",
      '  config:',
      '    watchMaxProjects: 0',
    ])).rejects.toThrow()
  })
})
