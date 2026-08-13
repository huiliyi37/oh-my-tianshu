import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConsentResolver, DEFAULT_TELEMETRY_PLUGIN_NAME, type ConsentDecision } from '@huiliyi37/dsh-telemetry'

const dirs: Array<string> = []

async function projectDir(cordisYml?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-consent-'))
  dirs.push(dir)
  if (cordisYml !== undefined) await writeFile(join(dir, 'cordis.yml'), cordisYml, 'utf8')
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => import('node:fs/promises').then(fs => fs.rm(dir, { recursive: true, force: true }))))
})

const enabledYml = `- id: telemetry\n  name: '${DEFAULT_TELEMETRY_PLUGIN_NAME}'\n`

describe('ConsentResolver environment opt-out', () => {
  it('denies when DO_NOT_TRACK is set', async () => {
    const decision = await new ConsentResolver({ env: { DO_NOT_TRACK: '1' } }).resolve(await projectDir(enabledYml))
    expect(decision).toEqual<ConsentDecision>({ allowed: false, reason: 'do-not-track' })
  })

  it('denies when CI is set', async () => {
    const decision = await new ConsentResolver({ env: { CI: 'true' } }).resolve(await projectDir(enabledYml))
    expect(decision).toEqual<ConsentDecision>({ allowed: false, reason: 'ci' })
  })

  it('ignores falsy env values and continues to the file', async () => {
    const decision = await new ConsentResolver({ env: { DO_NOT_TRACK: '0', CI: 'false' } })
      .resolve(await projectDir(enabledYml))
    expect(decision).toEqual<ConsentDecision>({ allowed: true, reason: 'enabled' })
  })

  it('can be told to ignore env opt-out signals', async () => {
    const decision = await new ConsentResolver({ env: { DO_NOT_TRACK: '1' }, honorEnvOptOut: false })
      .resolve(await projectDir(enabledYml))
    expect(decision).toEqual<ConsentDecision>({ allowed: true, reason: 'enabled' })
  })

  it('reads process.env by default', async () => {
    const saved = { CI: process.env.CI, DO_NOT_TRACK: process.env.DO_NOT_TRACK }
    delete process.env.CI
    delete process.env.DO_NOT_TRACK
    try {
      const decision = await new ConsentResolver().resolve(await projectDir(enabledYml))
      expect(decision).toEqual<ConsentDecision>({ allowed: true, reason: 'enabled' })
    } finally {
      if (saved.CI !== undefined) process.env.CI = saved.CI
      if (saved.DO_NOT_TRACK !== undefined) process.env.DO_NOT_TRACK = saved.DO_NOT_TRACK
    }
  })
})

describe('ConsentResolver cordis.yml state', () => {
  const resolver = new ConsentResolver({ env: {} })

  it('allows when the telemetry entry is enabled', async () => {
    expect(await resolver.resolve(await projectDir(enabledYml)))
      .toEqual<ConsentDecision>({ allowed: true, reason: 'enabled' })
  })

  it('denies when the telemetry entry is disabled', async () => {
    const yml = `- id: telemetry\n  name: '${DEFAULT_TELEMETRY_PLUGIN_NAME}'\n  disabled: true\n`
    expect(await resolver.resolve(await projectDir(yml)))
      .toEqual<ConsentDecision>({ allowed: false, reason: 'disabled' })
  })

  it('tolerates !!js expression tags while reading plain scalars', async () => {
    const yml = [
      '- id: telemetry',
      `  name: '${DEFAULT_TELEMETRY_PLUGIN_NAME}'`,
      '- id: llm',
      '  name: \'@huiliyi37/dsh-llm-deepseek\'',
      '  config:',
      '    apiKeyEnv: DEEPSEEK_API_KEY',
      '    model: !!js process.env.DEEPSEEK_MODEL',
      '',
    ].join('\n')
    expect(await resolver.resolve(await projectDir(yml)))
      .toEqual<ConsentDecision>({ allowed: true, reason: 'enabled' })
  })

  it('reports (allows) when cordis.yml has no telemetry entry', async () => {
    const yml = '- id: llm\n  name: \'@huiliyi37/dsh-llm-deepseek\'\n'
    expect(await resolver.resolve(await projectDir(yml)))
      .toEqual<ConsentDecision>({ allowed: true, reason: 'absent' })
  })

  it('can be told to deny when the entry is absent', async () => {
    const yml = '- id: llm\n  name: \'@huiliyi37/dsh-llm-deepseek\'\n'
    const decision = await new ConsentResolver({ env: {}, allowWhenEntryAbsent: false }).resolve(await projectDir(yml))
    expect(decision).toEqual<ConsentDecision>({ allowed: false, reason: 'absent' })
  })

  it('skips non-object sequence items and a non-sequence root, still reporting absent', async () => {
    expect(await resolver.resolve(await projectDir('- just-a-string\n- id: x\n  name: y\n')))
      .toEqual<ConsentDecision>({ allowed: true, reason: 'absent' })
    expect(await resolver.resolve(await projectDir('root: not-a-sequence\n')))
      .toEqual<ConsentDecision>({ allowed: true, reason: 'absent' })
  })

  it('honors a custom telemetry plugin name', async () => {
    const yml = '- id: t\n  name: \'my-consent-marker\'\n'
    const decision = await new ConsentResolver({ env: {}, telemetryPluginName: 'my-consent-marker' })
      .resolve(await projectDir(yml))
    expect(decision).toEqual<ConsentDecision>({ allowed: true, reason: 'enabled' })
  })
})

describe('ConsentResolver missing or unreadable cordis.yml', () => {
  it('reports no-config and allows by default on first init', async () => {
    expect(await new ConsentResolver({ env: {} }).resolve(await projectDir()))
      .toEqual<ConsentDecision>({ allowed: true, reason: 'no-config' })
  })

  it('can deny on first init', async () => {
    const decision = await new ConsentResolver({ env: {}, allowWhenNoConfig: false }).resolve(await projectDir())
    expect(decision).toEqual<ConsentDecision>({ allowed: false, reason: 'no-config' })
  })

  it('denies with an unreadable reason when cordis.yml is not a regular file', async () => {
    const dir = await projectDir()
    await mkdir(join(dir, 'cordis.yml')) // a directory where the resolver expects a file
    expect(await new ConsentResolver({ env: {} }).resolve(dir))
      .toEqual<ConsentDecision>({ allowed: false, reason: 'unreadable' })
  })
})
