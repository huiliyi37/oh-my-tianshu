import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FeatureOption,
  ExclusiveOptionFeature,
  MultiOptionFeature,
  FixedFeature,
  type FeatureProjectView,
} from '../src/features/feature.ts'
import { createBuiltinRegistry } from '../src/features/builtin/index.ts'
import {
  npmCordisConfigEntry,
  cordisConfigEntry,
  environment as environmentResource,
  optionalString,
  ownedTextFile,
  requiredString,
  stringArray,
} from '../src/features/builtin/helpers.ts'
import { defineFeatures, defineFeature } from '../src/features/define-feature.ts'
import { FeatureRegistry } from '../src/features/registry.ts'
import { ProjectContribution } from '../src/features/resources.ts'
import type { CordisConfigEntryResource, ProjectResource } from '../src/features/resources.ts'
import type { CordisConfigEntry } from '../src/documents/cordis-yaml-file.ts'
import { PackageJsonFile } from '../src/documents/package-json-file.ts'
import { TextProjectFile } from '../src/documents/project-file.ts'
import { featureId, resourceKey } from '../src/ids.ts'
import { NpmPackageManager } from '../src/package-managers/package-manager.ts'
import { LocalPluginBlueprint } from '../src/plugins/local-plugin-blueprint.ts'
import { SdkProject } from '../src/project/sdk-project.ts'
import type {
  FeatureSelection,
  ProjectCreationRequest,
  ProjectProfile,
} from '../src/project/types.ts'

const temporary: string[] = []
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function selection(id: string, options: readonly string[], secrets?: Record<string, string>): FeatureSelection {
  return { id: featureId(id), options, ...secrets ? { secrets } : {} }
}

function request(
  extra: readonly FeatureSelection[] = [],
  plugins: readonly LocalPluginBlueprint[] = [],
  app: 'acp' | 'embed' = 'embed',
  bash: 'local' | 'sandbox' = 'local',
): ProjectCreationRequest {
  return {
    name: 'test-agent',
    description: 'test project',
    runtime: { model: 'deepseek-v4-flash' },
    packageManager: new NpmPackageManager('10.0.0'),
    releaseVersion: '0.0.1',
    features: [
      selection('provider', ['deepseek-official'], { apiKey: 'test-key' }),
      selection('bash', [bash]),
      selection('app', [app]),
      selection('persistence', ['jsonl']),
      ...extra,
    ],
    localPlugins: plugins,
  }
}

async function createCommitted(
  extra: readonly FeatureSelection[] = [],
  plugins: readonly LocalPluginBlueprint[] = [],
): Promise<SdkProject> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-domain-'))
  temporary.push(root)
  const creation = request(extra, plugins)
  const project = SdkProject.create(root, creation)
  const registry = createBuiltinRegistry(project.profile)
  const edit = project.edit(registry)
  for (const item of creation.features) edit.installFeature(registry.get(item.id), item)
  for (const plugin of plugins) edit.addPlugin(plugin)
  return (await edit.commit()).project
}

describe('SdkProject and ProjectEditSession', () => {
  it('derives existing-project profiles and tolerates malformed optional documents', async () => {
    const make = async (
      name: string,
      manifest: Record<string, unknown>,
      cordis: string,
      extras: Record<string, string> = {},
    ): Promise<SdkProject> => {
      const root = await mkdtemp(join(tmpdir(), `${name}-`))
      temporary.push(root)
      await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
      await writeFile(join(root, 'cordis.yml'), cordis)
      for (const [path, text] of Object.entries(extras)) await writeFile(join(root, path), text)
      return SdkProject.open(root)
    }
    const acp = await make('dsh-open-acp', {
      name: 'acp', description: 'ACP', packageManager: 'pnpm@10.1.0',
      dependencies: { '@deepseek-ai/dsh-scripts': '^1.2.3' },
    }, `- id: acp
  name: '@deepseek-ai/dsh-acp'
  config: { model: app-model }
`, { '.env': 'KEY=value\n', 'tsconfig.json': '{bad', 'pnpm-workspace.yaml': 'bad' })
    expect(acp.profile).toMatchObject({
      runInterface: 'acp', runtime: { model: 'app-model' }, releaseVersion: '1.2.3', description: 'ACP',
    })
    expect(acp.profile.packageManager.name).toBe('pnpm')
    expect(acp.readEnvironment('.env', 'KEY')).toBe('value')
    expect(() => acp.readEnvironment('.env.example', 'KEY')).not.toThrow()
    expect(acp.document('tsconfig.json')).toBeInstanceOf(TextProjectFile)
    const tui = await make('dsh-open-tui', {}, `- id: provider
  name: '@deepseek-ai/dsh-llm-deepseek'
  config: { models: [provider-model] }
- id: tui
  name: '@deepseek-ai/dsh-tui'
`)
    expect(tui.profile.runInterface).toBe('embed')
    expect(tui.profile.runtime.model).toBe('provider-model')
    const tuiSubpath = await make('dsh-open-tui-subpath', {}, `- id: tui-prompt
  name: '@deepseek-ai/dsh-tui/prompt'
`)
    expect(tuiSubpath.profile.runInterface).toBe('embed')
    const embedded = await make('dsh-open-embed', {}, `- id: provider
  name: '@deepseek-ai/dsh-llm-deepseek'
  config: { models: [provider-model] }
`, { 'yarn.lock': '' })
    expect(embedded.profile.runInterface).toBe('embed')
    expect(embedded.profile.runtime.model).toBe('provider-model')
    expect(embedded.profile.packageManager.name).toBe('yarn')
    expect(embedded.profile.name).toBe(embedded.root.split('/').at(-1))
    const pnpm = await make('dsh-open-pnpm', { name: 'pnpm' }, '[]\n', { 'pnpm-lock.yaml': '' })
    expect(pnpm.profile.packageManager.name).toBe('pnpm')
    const defaults = await make('dsh-open-default', { name: 'default', packageManager: 'npm@10.0.0' }, '[]\n')
    expect(defaults.profile).toMatchObject({
      runInterface: 'embed', runtime: { model: 'deepseek-v4-flash' }, releaseVersion: '0.0.1',
    })
    expect(() => SdkProject.create(defaults.root, { ...request(), features: [] })).toThrow('requires one app')
    await expect(make('dsh-open-invalid-manager', { name: 'bad', packageManager: 'bad' }, '[]\n'))
      .rejects.toThrow('invalid packageManager field')
    const providerFallback = await make('dsh-open-provider-fallback', { name: 'fallback' }, `- id: provider
  name: '@deepseek-ai/dsh-llm-deepseek'
  config: { models: [fallback-model] }
`)
    expect(providerFallback.profile.runtime.model).toBe('fallback-model')
    const pnpmRequest = { ...request(), packageManager: new (await import('../src/package-managers/package-manager.ts')).PnpmPackageManager('10.0.0') }
    expect(SdkProject.create(join(defaults.root, 'pnpm'), pnpmRequest).hasDocument('pnpm-workspace.yaml')).toBe(true)
  })

  it('commits a complete blueprint and round-trips every installed feature', async () => {
    const project = await createCommitted([
      selection('hmr', ['default']),
      selection('fs', ['local']),
      selection('todo', ['default']),
      selection('web', ['exa'], { apiKey: 'exa-key' }),
      selection('subagent', ['fork']),
      selection('workflow', ['workerthread']),
      selection('hooks', ['claude', 'codex']),
    ], [new LocalPluginBlueprint('sample', 'plugin'), new LocalPluginBlueprint('lookup', 'tool')])
    const registry = createBuiltinRegistry(project.profile)
    const inspections = registry.inspect(project)
    expect(inspections.filter(item => item.state === 'enabled').map(item => item.id)).toEqual([
      'provider', 'spine', 'bash', 'app', 'persistence', 'hmr', 'fs', 'todo', 'web', 'subagent', 'workflow', 'hooks',
    ])
    expect(inspections.find(item => item.id === 'subagent')?.options).toEqual(['spawn', 'fork'])
    expect(project.cordisConfigEntries().map(entry => entry.id)).toContain('lookup')
    const index = await readFile(join(project.root, 'index.ts'), 'utf8')
    expect(index).toContain('SdkBootContext')
    expect(index).toContain('agents.create')
    expect(index).not.toContain('boot.args.resume')
    expect(index).not.toContain('AgentId')
    expect(index).toContain('SessionId(`main-session-${randomUUID()}`)')
    expect(project.packageManifest().scripts).toEqual({
      dev: 'dsh-sdk dev index.ts',
      build: 'dsh-sdk build',
      typecheck: 'tsc -b',
      start: 'dsh-sdk start index.js',
      config: 'dsh-sdk config',
    })
    expect(await readFile(join(project.root, '.env.example'), 'utf8')).toContain('EXA_API_KEY=')
    expect(project.cordis.entry('agent-loop')?.config).toEqual({ agents: [] })
    expect(project.cordis.entry('session-invariant')?.name).toBe('@deepseek-ai/dsh-session/invariant')
    expect(project.cordis.entry('agent-invariant')?.name).toBe('@deepseek-ai/dsh-agent/invariant')
    expect(project.cordis.entry('scope-invariant')?.name).toBe('@deepseek-ai/dsh-scope/invariant')
    expect(project.cordis.entry('agent-loop-invariant')?.name).toBe('@deepseek-ai/dsh-agent-loop/invariant')
    expect(project.cordis.entry('system-prompt')?.config?.persona).toContain('{{cwd}}')
    expect(project.packageManifest().dependencies?.['@cordisjs/plugin-timer']).toBe('^1.1.2')
    expect(project.packageManifest().dependencies?.['@cordisjs/plugin-hmr']).toBe('^1.0.15')
    expect(project.packageManifest().dependencies?.['@deepseek-ai/dsh-scope']).toBe('^0.0.1')
    expect(project.packageManifest().dependencies).not.toHaveProperty('@deepseek-ai/dsh-scope/invariant')
    expect(project.packageManifest().dependencies).not.toHaveProperty('node-addon-require-builtin')
    expect(project.cordis.entry('hmr')).toMatchObject({ name: '@cordisjs/plugin-hmr' })
    expect(project.cordis.entry('llm-deepseek')).not.toHaveProperty('config.apiKey')
    expect(project.cordis.entry('llm-deepseek')?.config).not.toHaveProperty('baseURL')
    expect(project.cordis.entry('llm-deepseek')?.config).not.toHaveProperty('models')
  })

  it.each(['spawn', 'fork'] as const)('mounts Task controls for %s subagents', async (option) => {
    const project = await createCommitted([selection('subagent', [option])])
    expect(project.cordis.entry('tasks')?.name).toBe('@deepseek-ai/dsh-tasks-local')
    expect(project.cordis.entry('tool-tasks')?.name).toBe('@deepseek-ai/dsh-tool-tasks')
    expect(project.packageManifest().dependencies).toMatchObject({
      '@deepseek-ai/dsh-tasks-local': '^0.0.1',
      '@deepseek-ai/dsh-tool-tasks': '^0.0.1',
    })
    expect(project.packageManifest().dependencies).not.toHaveProperty('@deepseek-ai/dsh-tasks')
  })

  it('round-trips embed app projects without a front-door Cordis config entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-embed-app-'))
    temporary.push(root)
    const creation = request([], [], 'embed')
    const project = SdkProject.create(root, creation)
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    for (const item of creation.features) edit.installFeature(registry.get(item.id), item)
    const committed = (await edit.commit()).project
    const app = createBuiltinRegistry(committed.profile).get(featureId('app')).inspect(committed)
    expect(app).toMatchObject({ state: 'enabled', options: ['embed'] })
    expect(app.selection).toEqual(selection('app', ['embed']))
    expect(committed.cordis.entry('agent-loop')?.config).toEqual({ agents: [] })
    expect(committed.cordis.entry('acp')).toBeUndefined()
  })

  it('emits the sandbox workspace-write example as inactive Cordis config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-sandbox-bash-'))
    temporary.push(root)
    const creation = request([], [], 'embed', 'sandbox')
    const project = SdkProject.create(root, creation)
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    for (const item of creation.features) edit.installFeature(registry.get(item.id), item)
    await edit.commit()
    const cordis = await readFile(join(root, 'cordis.yml'), 'utf8')
    expect(cordis).toContain(`- id: bash
  name: "@deepseek-ai/dsh-bash-sandbox"
  # Uncomment to allow writes under the project workspace.
  # config:
  #   mode: workspace-write
  #   workspaceRoot: !!js process.cwd()`)
  })

  it('round-trips the custom pi-ai provider with explicit endpoint and default model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-custom-provider-'))
    temporary.push(root)
    const base = request()
    const creation: ProjectCreationRequest = {
      ...base,
      features: [
        {
          id: featureId('provider'),
          options: ['custom'],
          values: { baseURL: 'https://custom.example/v1' },
          secrets: { apiKey: 'custom-key' },
        },
        ...base.features.filter(item => item.id !== 'provider'),
      ],
    }
    const project = SdkProject.create(root, creation)
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    for (const item of creation.features) edit.installFeature(registry.get(item.id), item)
    const committed = (await edit.commit()).project
    expect(committed.cordis.entry('llm-pi-ai')).toMatchObject({
      name: '@deepseek-ai/dsh-llm-pi-ai',
      config: { baseURL: 'https://custom.example/v1' },
    })
    expect(committed.cordis.entry('llm-pi-ai')?.config).not.toHaveProperty('models')
    expect(createBuiltinRegistry(committed.profile).get(featureId('provider')).inspect(committed)).toMatchObject({
      state: 'enabled', options: ['custom'],
    })
  })

  it('switches exclusive options and refuses disabling a required feature', async () => {
    const project = await createCommitted([selection('subagent', ['spawn']), selection('workflow', ['workerthread'])])
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    const persistence = registry.get(featureId('persistence'))
    edit.configureFeature(persistence, selection('persistence', ['sqlite']))
    expect(() => { edit.disableFeature(registry.get(featureId('subagent'))) }).toThrow('required by workflow')
    expect(() => { edit.disableFeature(registry.get(featureId('app'))) }).toThrow('required feature')
    const committed = await edit.commit()
    expect(committed.project.cordis.entry('session-persistence')?.name).toContain('sqlite')
    expect(committed.changes.npmDependenciesChanged).toBe(true)
  })

  it('switches app-owned files and scripts while protecting user edits', async () => {
    const project = await createCommitted()
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    edit.configureFeature(registry.get(featureId('app')), selection('app', ['acp']))
    const acp = (await edit.commit()).project
    expect(acp.profile.runInterface).toBe('acp')
    expect(acp.cordis.entry('commands')).toBeUndefined()
    expect(acp.cordis.entry('user-interaction')).toBeUndefined()
    expect(acp.packageManifest().scripts).toMatchObject({
      dev: 'dsh-sdk dev index.ts',
      start: 'dsh-sdk start index.js',
    })
    expect(await readFile(join(acp.root, 'README.md'), 'utf8')).toContain('Run as an ACP automation server')
    expect(await readFile(join(acp.root, 'index.ts'), 'utf8')).not.toContain('agents.create')

    const acpRegistry = createBuiltinRegistry(acp.profile)
    const embedEdit = acp.edit(acpRegistry)
    embedEdit.configureFeature(acpRegistry.get(featureId('app')), selection('app', ['embed']))
    const embed = (await embedEdit.commit()).project
    expect(embed.profile.runInterface).toBe('embed')
    expect(await readFile(join(embed.root, 'README.md'), 'utf8')).toContain('Embed the harness')
    const embedIndex = await readFile(join(embed.root, 'index.ts'), 'utf8')
    expect(embedIndex).toContain('agents.create')
    expect(embedIndex).toContain("import { SessionId } from '@deepseek-ai/dsh-session'")
    expect(embedIndex).not.toContain('AgentId')

    await writeFile(join(embed.root, 'README.md'), '# Custom README\n')
    const modified = await SdkProject.open(embed.root)
    const modifiedRegistry = createBuiltinRegistry(modified.profile)
    expect(() => { modified.edit(modifiedRegistry).configureFeature(
      modifiedRegistry.get(featureId('app')),
      selection('app', ['acp']),
    ) }).toThrow('feature-owned file was modified: README.md')

    const manifest = PackageJsonFile.parse(await readFile(join(embed.root, 'package.json'), 'utf8'))
    manifest.removeScript('dev')
    await writeFile(join(embed.root, 'package.json'), manifest.serialize())
    const incomplete = await SdkProject.open(embed.root)
    expect(createBuiltinRegistry(incomplete.profile).get(featureId('app')).inspect(incomplete).diagnostics)
      .toContain('missing package.json script dev')
  })

  it('supports disabled feature reconfiguration and rejects invalid state operations', async () => {
    const project = await createCommitted([selection('todo', ['default'])])
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    expect(edit.inspections()).not.toHaveLength(0)
    const todo = registry.get(featureId('todo'))
    edit.configureFeature(registry.get(featureId('web')), selection('web', ['deepseek-official']))
    edit.disableFeature(todo)
    edit.configureFeature(todo, selection('todo', ['default']))
    edit.enableFeature(todo)
    expect(() => { edit.enableFeature(registry.get(featureId('workflow'))) }).toThrow('not installed')
    expect(() => { edit.disableFeature(registry.get(featureId('workflow'))) }).toThrow('not installed')
    expect(() => { edit.setCustomPluginDisabled('missing', true) }).toThrow('does not exist')
    const committed = await edit.commit()
    expect(committed.changes.enabledFeatures).toContain('todo')
    expect(() => { edit.enableFeature(todo) }).toThrow('already committed')
  })

  it('preserves custom entries and toggles only their Loader disabled state', async () => {
    const project = await createCommitted([], [new LocalPluginBlueprint('sample', 'plugin')])
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    edit.setCustomPluginDisabled('sample', true)
    expect(edit.cordisConfigEntries().find(entry => entry.id === 'sample')?.disabled).toBe(true)
    expect(() => { edit.setCustomPluginDisabled('agent-loop', true) }).toThrow('builtin feature')
    const next = (await edit.commit()).project
    const enable = next.edit(createBuiltinRegistry(next.profile))
    enable.setCustomPluginDisabled('sample', false)
    expect((await enable.commit()).project.cordis.entry('sample')?.disabled).toBeUndefined()
  })

  it('rejects local plugin collisions and invalid optional document shapes', async () => {
    const project = await createCommitted([], [new LocalPluginBlueprint('sample', 'plugin')])
    const registry = createBuiltinRegistry(project.profile)
    const npmDependencyConflict = project.edit(registry)
    expect(() => { npmDependencyConflict.addPlugin(new LocalPluginBlueprint('sample', 'plugin')) })
      .toThrow('NPM dependency already exists')
    await writeFile(join(project.root, 'tsconfig.json'), 'not-json\n')
    const malformed = await SdkProject.open(project.root)
    expect(() => { malformed.edit(createBuiltinRegistry(malformed.profile)).addPlugin(
      new LocalPluginBlueprint('other', 'plugin'),
    ) }).toThrow('requires a valid tsconfig')
    const entryProject = await createCommitted()
    const entryEdit = entryProject.edit(createBuiltinRegistry(entryProject.profile))
    ;(entryEdit as unknown as { cordis(): { addEntry(entry: CordisConfigEntry): void } }).cordis()
      .addEntry({ id: 'sample', name: 'manual' })
    expect(() => { entryEdit.addPlugin(new LocalPluginBlueprint('sample', 'plugin')) }).toThrow('entry already exists')
    const fileEdit = entryProject.edit(createBuiltinRegistry(entryProject.profile))
    ;(fileEdit as unknown as { documents: Map<string, TextProjectFile> }).documents
      .set('plugins/other/package.json', new TextProjectFile('plugins/other/package.json', '{}'))
    expect(() => { fileEdit.addPlugin(new LocalPluginBlueprint('other', 'plugin')) }).toThrow('file already exists')
  })

  it('reinstalls existing/disabled features and detects requirement cycles', async () => {
    const project = await createCommitted([selection('todo', ['default']), selection('subagent', ['spawn'])])
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    const todo = registry.get(featureId('todo'))
    edit.installFeature(todo, selection('todo', ['default']))
    edit.disableFeature(todo)
    edit.installFeature(todo, selection('todo', ['default']))
    const subagent = registry.get(featureId('subagent'))
    edit.disableFeature(subagent)
    edit.installFeature(registry.get(featureId('workflow')), selection('workflow', ['workerthread']))
    expect(edit.cordisConfigEntries().find(entry => entry.id === 'subagent-spawn')?.disabled).toBeUndefined()

    class Cyclic extends FixedFeature {
      override readonly summary = 'cyclic'
      override readonly options = [new (class extends FeatureOption {
        override readonly id = 'one'
        override readonly label = 'One'
        override contribution(): ProjectContribution { return new ProjectContribution([]) }
      })()]
      override readonly id
      override readonly requires
      constructor(id: string, required: string) {
        super()
        this.id = featureId(id)
        this.requires = [featureId(required)]
      }
    }
    const one = new Cyclic('cycle-one', 'cycle-two')
    const two = new Cyclic('cycle-two', 'cycle-one')
    const cycleRegistry = new FeatureRegistry([one, two], project.profile)
    expect(() => { project.edit(cycleRegistry).installFeature(one, selection('cycle-one', ['one'])) })
      .toThrow('cyclic feature requirement')
  })

  it('removes clean owned files and detects files disappearing before commit', async () => {
    const project = await createCommitted([selection('hooks', ['claude', 'codex']), selection('todo', ['default'])])
    const registry = createBuiltinRegistry(project.profile)
    const remove = project.edit(registry)
    remove.configureFeature(registry.get(featureId('hooks')), selection('hooks', ['codex']))
    const committed = await remove.commit()
    expect(committed.changes.changedFiles).toContain('hooks.json')
    const edit = committed.project.edit(createBuiltinRegistry(committed.project.profile))
    edit.disableFeature(createBuiltinRegistry(committed.project.profile).get(featureId('todo')))
    await rm(join(committed.project.root, 'cordis.yml'))
    await expect(edit.commit()).rejects.toThrow('cannot verify project file cordis.yml')
  })

  it('guards internal resource collisions and malformed aggregate documents', async () => {
    const project = await createCommitted()
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    type Internals = {
      documents: Map<string, TextProjectFile>
      states: Map<ReturnType<typeof featureId>, unknown>
      applyResource(resource: ProjectResource, previous: ProjectResource | undefined): void
      removeResource(resource: ProjectResource): void
      replaceContribution(previous: ProjectContribution | undefined, next: ProjectContribution): void
      finalProfile(): ProjectProfile
      manifest(): unknown
      cordis(): unknown
      environment(path: '.env' | '.env.example'): unknown
      state(feature: FixedFeature): unknown
    }
    const internals = edit as unknown as Internals
    const collidingEntry: ProjectResource = {
      kind: 'cordis-config-entry', key: resourceKey('cordis-config-entry:agent-loop'),
      entry: { id: 'agent-loop', name: 'other-package' }, ownedConfigKeys: [],
    }
    expect(() => { internals.applyResource(collidingEntry, undefined) }).toThrow('is owned by')
    const existingFile: ProjectResource = {
      kind: 'owned-file', key: resourceKey('file:tsconfig.json'),
      document: new TextProjectFile('tsconfig.json', 'replacement'), removeOnlyWhenUnchanged: true,
    }
    expect(() => { internals.applyResource(existingFile, undefined) }).toThrow('already exists')
    internals.documents.set('owned.txt', new TextProjectFile('owned.txt', 'old'))
    const previousFile: ProjectResource = {
      ...existingFile, key: resourceKey('file:owned.txt'), document: new TextProjectFile('owned.txt', 'old'),
    }
    const nextFile: ProjectResource = {
      ...existingFile, key: resourceKey('file:owned.txt'), document: new TextProjectFile('owned.txt', 'replacement'),
    }
    internals.applyResource(nextFile, previousFile)
    expect(internals.documents.get('owned.txt')?.serialize()).toBe('replacement\n')
    internals.documents.set('owned.txt', new TextProjectFile('owned.txt', 'user edit'))
    expect(() => { internals.applyResource(nextFile, previousFile) }).toThrow('was modified')
    const existingScript: ProjectResource = {
      kind: 'package-script', key: resourceKey('package-script:build'),
      name: 'build', command: 'other build', removeOnlyWhenUnchanged: true,
    }
    expect(() => { internals.applyResource(existingScript, undefined) }).toThrow('script already exists')
    const transientScript: ProjectResource = {
      kind: 'package-script', key: resourceKey('package-script:transient'),
      name: 'transient', command: 'first', removeOnlyWhenUnchanged: true,
    }
    internals.applyResource(transientScript, undefined)
    const nextScript: ProjectResource = { ...transientScript, command: 'second' }
    internals.applyResource(nextScript, transientScript)
    internals.applyResource(nextScript, transientScript)
    ;(internals.manifest() as PackageJsonFile).setScript('transient', 'user edit')
    expect(() => { internals.applyResource(transientScript, nextScript) }).toThrow('script was modified')
    expect(() => { internals.removeResource(nextScript) }).toThrow('script was modified')
    ;(internals.manifest() as PackageJsonFile).setScript('transient', 'second')
    internals.removeResource(nextScript)
    expect(() => { internals.removeResource(nextScript) }).toThrow('script is missing')
    expect(() => { internals.removeResource({
      ...existingFile, key: resourceKey('file:missing.txt'), document: new TextProjectFile('missing.txt', 'missing'),
    }) }).toThrow('owned file is missing')
    expect(() => { internals.removeResource({
      kind: 'cordis-config-entry', key: resourceKey('cordis-config-entry:missing'),
      entry: { id: 'missing', name: 'missing' }, ownedConfigKeys: [],
    }) }).toThrow('cannot confirm old Cordis resource')
    const transient: ProjectResource = {
      kind: 'owned-file', key: resourceKey('file:transient.txt'),
      document: new TextProjectFile('transient.txt', 'transient'), removeOnlyWhenUnchanged: true,
    }
    internals.applyResource(transient, undefined)
    internals.removeResource(transient)
    internals.replaceContribution(
      new ProjectContribution([{ kind: 'npm-dependency', key: resourceKey('shared'), name: 'cordis', section: 'dependencies' }]),
      new ProjectContribution([{
        kind: 'cordis-config-entry', key: resourceKey('shared'), entry: { id: 'new', name: 'new' }, ownedConfigKeys: [],
      }]),
    )
    internals.replaceContribution(
      new ProjectContribution([{
        kind: 'environment', key: resourceKey('environment:SAME'), name: 'SAME', value: 'old', exampleValue: '',
      }]),
      new ProjectContribution([{
        kind: 'environment', key: resourceKey('environment:SAME'), name: 'SAME', value: 'new', exampleValue: '',
      }]),
    )
    internals.documents.set('.env', new TextProjectFile('.env', 'bad'))
    expect(() => edit.readEnvironment('.env', 'KEY')).toThrow('not an environment document')
    expect(() => { internals.environment('.env') }).toThrow('not an environment document')
    internals.documents.delete('package.json')
    expect(() => { internals.manifest() }).toThrow('package.json is missing')
    internals.documents.delete('cordis.yml')
    expect(() => { internals.cordis() }).toThrow('cordis.yml is missing')
    class Foreign extends FixedFeature {
      override readonly id = featureId('foreign')
      override readonly summary = 'foreign'
      override readonly options = []
    }
    expect(() => { internals.state(new Foreign()) }).toThrow('not applicable')
    internals.states.delete(featureId('app'))
    expect(internals.finalProfile()).toBe(project.profile)
    const sourceDocuments = (project as unknown as { documents: Map<string, TextProjectFile> }).documents
    sourceDocuments.set('.env', new TextProjectFile('.env', 'bad'))
    expect(() => project.readEnvironment('.env', 'KEY')).toThrow('not an environment document')
    sourceDocuments.delete('package.json')
    expect(() => project.packageJson).toThrow('package.json is missing or invalid')
    sourceDocuments.delete('cordis.yml')
    expect(() => project.cordis).toThrow('cordis.yml is missing or invalid')
  })

  it('rejects external edits before writing any affected file', async () => {
    const project = await createCommitted([selection('todo', ['default'])])
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    edit.disableFeature(registry.get(featureId('todo')))
    const manifestBefore = await readFile(join(project.root, 'package.json'), 'utf8')
    await writeFile(join(project.root, 'cordis.yml'), '# external\n[]\n')
    await expect(edit.commit()).rejects.toThrow('changed outside this edit session')
    expect(await readFile(join(project.root, 'package.json'), 'utf8')).toBe(manifestBefore)
  })

  it('rejects a create target file that appeared after the edit session opened', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-create-conflict-'))
    temporary.push(root)
    const creation = request()
    const project = SdkProject.create(root, creation)
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    for (const item of creation.features) edit.installFeature(registry.get(item.id), item)
    await writeFile(join(root, 'README.md'), 'external\n')
    await expect(edit.commit()).rejects.toThrow('changed outside this edit session: README.md')
  })

  it('uses Cordis config entries as the installation anchor and rejects partial resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-inconsistent-'))
    temporary.push(root)
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'partial', dependencies: { '@deepseek-ai/dsh-llm-deepseek': '^0.0.1' },
    }))
    await writeFile(join(root, 'cordis.yml'), '[]\n')
    const project = await SdkProject.open(root)
    const registry = createBuiltinRegistry(project.profile)
    expect(registry.get(featureId('provider')).inspect(project)).toMatchObject({
      state: 'absent', diagnostics: [],
    })

    const partialRoot = await mkdtemp(join(tmpdir(), 'dsh-entry-partial-'))
    temporary.push(partialRoot)
    await writeFile(join(partialRoot, 'package.json'), JSON.stringify({ name: 'partial-entry' }))
    await writeFile(join(partialRoot, 'cordis.yml'), `- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
`)
    const partial = await SdkProject.open(partialRoot)
    const installation = createBuiltinRegistry(partial.profile)
      .get(featureId('provider')).inspect(partial)
    expect(installation.state).toBe('inconsistent')
    expect(installation.diagnostics).toContain('missing package.json dependencies entry @deepseek-ai/dsh-llm-deepseek')
    const partialEdit = partial.edit(createBuiltinRegistry(partial.profile))
    const provider = createBuiltinRegistry(partial.profile).get(featureId('provider'))
    expect(() => { partialEdit.configureFeature(provider, selection('provider', ['deepseek-official'])) }).toThrow('inconsistent')
    expect(() => { partialEdit.enableFeature(provider) }).toThrow('inconsistent')
    expect(() => { partialEdit.disableFeature(provider) }).toThrow('required feature')
  })

  it('rejects inconsistent optional features and incompatible requirement options', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-optional-inconsistent-'))
    temporary.push(root)
    await writeFile(join(root, 'package.json'), '{"name":"partial"}')
    await writeFile(join(root, 'cordis.yml'), `- id: web-search-exa
  name: '@deepseek-ai/dsh-web-search-exa'
`)
    const project = await SdkProject.open(root)
    const builtin = createBuiltinRegistry(project.profile)
    const edit = project.edit(builtin)
    const web = builtin.get(featureId('web'))
    expect(() => { edit.disableFeature(web) }).toThrow('inconsistent')
    expect(() => { edit.installFeature(web, selection('web', ['deepseek-official'])) }).toThrow('inconsistent')

    class RequiresWeb extends FixedFeature {
      override readonly id = featureId('requires-web')
      override readonly summary = 'requires web'
      override readonly requires = [featureId('web')]
      override readonly options = [new (class extends FeatureOption {
        override readonly id = 'one'
        override readonly label = 'One'
        override contribution(): ProjectContribution { return new ProjectContribution([]) }
      })()]
    }
    const requiresWeb = new RequiresWeb()
    const webRegistry = new FeatureRegistry([web, requiresWeb], project.profile)
    expect(() => { project.edit(webRegistry).installFeature(requiresWeb, selection('requires-web', ['one'])) })
      .toThrow('required feature web is inconsistent')

    class RequiresAcp extends FixedFeature {
      override readonly id = featureId('requires-acp')
      override readonly summary = 'requires acp'
      override readonly options = [new (class extends FeatureOption {
        override readonly id = 'one'
        override readonly label = 'One'
        override contribution(): ProjectContribution { return new ProjectContribution([]) }
      })()]
      override requirements(): readonly [{ id: ReturnType<typeof featureId>; options: readonly string[] }] {
        return [{ id: featureId('app'), options: ['acp'] }]
      }
    }
    const requiring = new RequiresAcp()
    const complete = await createCommitted()
    const app = createBuiltinRegistry(complete.profile).get(featureId('app'))
    const registry = new FeatureRegistry([app, requiring], complete.profile)
    expect(() => { complete.edit(registry).installFeature(requiring, selection('requires-acp', ['one'])) })
      .toThrow('does not satisfy the option requirement')
  })

  it('removes obsolete environment resources when switching options', async () => {
    const project = await createCommitted([selection('web', ['exa'], { apiKey: 'exa' })])
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    edit.configureFeature(registry.get(featureId('web')), selection('web', ['deepseek-official']))
    expect(edit.readEnvironment('.env.example', 'EXA_API_KEY')).toBeUndefined()
  })

  it('preserves duplicate and existing .env values while appending differently named secrets', async () => {
    const project = await createCommitted()
    if (process.platform !== 'win32') expect((await stat(join(project.root, '.env'))).mode & 0o777).toBe(0o600)
    const original = '# keep\nDEEPSEEK_API_KEY=first\nDEEPSEEK_API_KEY=second\n'
    await writeFile(join(project.root, '.env'), original)
    if (process.platform !== 'win32') await chmod(join(project.root, '.env'), 0o640)
    const reopened = await SdkProject.open(project.root)
    const registry = createBuiltinRegistry(reopened.profile)
    expect(registry.get(featureId('provider')).inspect(reopened)).toMatchObject({
      state: 'enabled', selection: { secrets: { apiKey: 'second' } },
    })
    const edit = reopened.edit(registry)
    edit.configureFeature(
      registry.get(featureId('provider')),
      selection('provider', ['deepseek-official'], { apiKey: 'replacement' }),
    )
    edit.installFeature(registry.get(featureId('web')), selection('web', ['exa'], { apiKey: 'exa-key' }))
    const withExa = (await edit.commit()).project
    expect(await readFile(join(withExa.root, '.env'), 'utf8')).toBe(`${original}EXA_API_KEY=exa-key\n`)
    if (process.platform !== 'win32') {
      expect((await stat(join(withExa.root, '.env'))).mode & 0o777).toBe(0o640)
    }
    const nextRegistry = createBuiltinRegistry(withExa.profile)
    const remove = withExa.edit(nextRegistry)
    remove.configureFeature(nextRegistry.get(featureId('web')), selection('web', ['deepseek-official']))
    await remove.commit()
    expect(await readFile(join(withExa.root, '.env'), 'utf8')).toBe(`${original}EXA_API_KEY=exa-key\n`)
  })

  it('refuses to remove a feature-owned file after user edits', async () => {
    const project = await createCommitted([selection('hooks', ['claude', 'codex'])])
    await writeFile(join(project.root, 'hooks.json'), '{"hooks":{}}\n')
    const reopened = await SdkProject.open(project.root)
    const registry = createBuiltinRegistry(reopened.profile)
    const edit = reopened.edit(registry)
    expect(() => { edit.configureFeature(
      registry.get(featureId('hooks')),
      selection('hooks', ['codex']),
    ) }).toThrow('owned file was modified: hooks.json')
  })

  it('does not mistake a linked NPM dependency closure for an installed feature', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-link-closure-inspection-'))
    temporary.push(root)
    const base = request([selection('hooks', ['claude'])])
    const creation: ProjectCreationRequest = { ...base, linkWorkspaceRoot: repoRoot }
    const project = SdkProject.create(root, creation)
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    for (const item of creation.features) edit.installFeature(registry.get(item.id), item)
    const committed = (await edit.commit()).project
    expect(committed.packageManifest().dependencies?.['@deepseek-ai/dsh-subagent']).toMatch(/^file:/)
    expect(createBuiltinRegistry(committed.profile).get(featureId('subagent')).inspect(committed).state).toBe('absent')
  })

  it('mounts an external plugin dependency and rejects missing deps or duplicate entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-external-plugin-'))
    temporary.push(root)
    const creation = request()
    const project = SdkProject.create(root, creation)
    const registry = createBuiltinRegistry(project.profile)
    const edit = project.edit(registry)
    for (const item of creation.features) edit.installFeature(registry.get(item.id), item)
    await edit.commit()
    const manifestPath = join(root, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
    manifest.dependencies = { ...manifest.dependencies, 'ext-plugin': 'github:o/r#sha' }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
    const reopened = await SdkProject.open(root)
    const edit2 = reopened.edit(createBuiltinRegistry(reopened.profile))
    edit2.addExternalPlugin('ext-plugin', 'ext-plugin')
    expect(() => { edit2.addExternalPlugin('ext-plugin', 'ext-plugin') }).toThrow('already exists')
    expect(() => { edit2.addExternalPlugin('missing', 'not-a-dep') }).toThrow('not installed')
    const commit = await edit2.commit()
    expect(commit.project.cordis.entry('ext-plugin')?.name).toBe('ext-plugin')
  })
})

describe('extension points', () => {
  const profile: ProjectProfile = {
    name: 'test', description: 'test', runtime: { model: 'm' }, runInterface: 'embed',
    packageManager: new NpmPackageManager('10.0.0'), releaseVersion: '0.0.1',
  }

  it('rejects cross-feature resource ownership conflicts at registry construction', () => {
    class TestOption extends FeatureOption {
      override readonly id = 'default'
      override readonly label = 'Default'
      override contribution(): ProjectContribution {
        return new ProjectContribution([{
          kind: 'npm-dependency', key: resourceKey('npm-dependency:shared'), name: 'shared', section: 'dependencies',
        }])
      }
    }
    class TestFeature extends FixedFeature {
      override readonly id
      override readonly summary = 'test'
      override readonly options = [new TestOption()]
      constructor(id: string) {
        super()
        this.id = featureId(id)
      }
    }
    expect(() => new FeatureRegistry([
      new TestFeature('one'), new TestFeature('two'),
    ], profile)).toThrow('declared by both one and two')
    expect(new TestFeature('one').defaultOptions()).toEqual(['default'])
    expect(() => new FeatureRegistry([
      new TestFeature('one'), new TestFeature('one'),
    ], profile)).toThrow('duplicate feature id')
  })

  it('validates selection modes and declarative feature definitions', () => {
    const option = { id: 'one', label: 'One', default: true, resources: [] } as const
    expect(() => defineFeature({ id: 'bad-single', summary: 'bad', mode: 'single', options: [] }))
      .toThrow('requires one default option')
    expect(() => defineFeature({
      id: 'bad-exclusive', summary: 'bad', mode: 'exclusive', options: [{ ...option, default: false }],
    })).toThrow('exactly one default option')
    expect(() => defineFeature({
      id: 'bad-multiple', summary: 'bad', mode: 'multiple', options: [{ ...option, default: false }],
    })).toThrow('at least one default option')
    const exclusive = defineFeature({
      id: 'defined', summary: 'Defined', mode: 'exclusive', supportedInterfaces: ['embed'],
      requires: [{ id: 'base' }], suggests: ['suggested'],
      baseResources: [{ kind: 'npm-dependency', name: 'base', section: 'devDependencies' }],
      options: [
        {
          id: 'one', label: 'One', default: true,
          requires: [{ id: 'option', options: ['required'] }],
          secrets: [{ id: 'token', environment: 'TOKEN', message: 'Token', required: true }],
          resources: [
            {
              kind: 'npm-cordis-config-entry', id: 'one', package: 'one-package',
              config: { nested: { value: 1 }, list: ['x'], nullable: null },
            },
            { kind: 'owned-file', path: 'one.txt', text: 'one', removeOnlyWhenUnchanged: false },
          ],
        },
        {
          id: 'two', label: 'Two', resources: [
            { kind: 'file-cordis-config-entry', id: 'two', path: './two.ts' },
          ],
        },
      ],
    })
    expect(exclusive.defaultOptions(profile)).toEqual(['one'])
    expect(exclusive.isApplicable(profile)).toBe(true)
    expect(exclusive.isApplicable({ ...profile, runInterface: 'acp' })).toBe(false)
    expect(exclusive.requirements(selection('defined', ['one']))).toEqual([
      { id: 'base' }, { id: 'option', options: ['required'] },
    ])
    const contribution = exclusive.contribution({
      id: featureId('defined'), options: ['one'], secrets: { token: 'secret' },
    }, profile)
    expect(contribution.resources.map(resource => resource.kind)).toEqual([
      'npm-dependency', 'npm-dependency', 'cordis-config-entry', 'owned-file', 'environment',
    ])
    const entry = contribution.resources.find(resource => resource.kind === 'cordis-config-entry')
    expect(entry?.validateConfig?.({ nested: { value: 2 }, list: ['a', 'b'], nullable: null })).toEqual([])
    expect(entry?.validateConfig?.({ nested: [], list: 'bad' })).toHaveLength(3)
    expect(() => exclusive.normalizeSelection(selection('other', ['one']), profile)).toThrow('does not belong')
    expect(() => exclusive.normalizeSelection(selection('defined', ['one']), { ...profile, runInterface: 'acp' }))
      .toThrow('not available')
    expect(() => exclusive.normalizeSelection(selection('defined', ['missing']), profile)).toThrow('unknown')
    expect(() => exclusive.normalizeSelection(selection('defined', ['one', 'two']), profile)).toThrow('exactly one')
    expect(defineFeatures([exclusive, {
      id: 'fixed', summary: 'Fixed', mode: 'single', options: [option],
    }])).toHaveLength(2)
    expect(() => new FeatureRegistry([], profile).get(featureId('missing'))).toThrow('unknown feature')
    expect(new FeatureRegistry([exclusive], profile).ownerOfPackage('one-package', { ...profile, runInterface: 'acp' }))
      .toBeUndefined()
    class Unsupported extends FixedFeature {
      override readonly id = featureId('unsupported')
      override readonly summary = 'unsupported'
      override readonly options = [new (class extends FeatureOption {
        override readonly id = 'one'
        override readonly label = 'One'
        override contribution(): ProjectContribution { return new ProjectContribution([]) }
      })()]
      override readonly supportedInterfaces = []
    }
    expect(() => new FeatureRegistry([new Unsupported()], profile)).toThrow('supports no run interface')
  })

  it('covers feature base classes and resource conflict checks', () => {
    class EmptySimple extends FixedFeature {
      override readonly id = featureId('empty')
      override readonly summary = 'empty'
      override readonly options = []
    }
    expect(() => new EmptySimple().defaultOptions()).toThrow('has no option')
    class BadSimple extends FixedFeature {
      override readonly id = featureId('bad-simple')
      override readonly summary = 'bad'
      override readonly options = [new (class extends FeatureOption {
        override readonly id = 'one'
        override readonly label = 'One'
        override contribution(): ProjectContribution { return new ProjectContribution([]) }
      })(), new (class extends FeatureOption {
        override readonly id = 'two'
        override readonly label = 'Two'
        override contribution(): ProjectContribution { return new ProjectContribution([]) }
      })()]
    }
    expect(() => new BadSimple().normalizeSelection(selection('bad-simple', ['one']), profile)).toThrow('one fixed option')
    class EmptyMulti extends MultiOptionFeature {
      override readonly id = featureId('multi')
      override readonly summary = 'multi'
      override readonly options = []
      override defaultOptions(): readonly string[] { return [] }
    }
    expect(() => new EmptyMulti().normalizeSelection(selection('multi', []), profile)).toThrow('at least one')
    class EmptyExclusive extends ExclusiveOptionFeature {
      override readonly id = featureId('exclusive')
      override readonly summary = 'exclusive'
      override readonly options = []
      override defaultOptions(): readonly string[] { return [] }
    }
    expect(() => new EmptyExclusive().normalizeSelection(selection('exclusive', []), profile)).toThrow('exactly one')
    const resource = {
      kind: 'npm-dependency' as const, key: resourceKey('same'), name: 'one', section: 'dependencies' as const,
    }
    expect(() => new ProjectContribution([resource, resource])).toThrow('duplicate contribution')
    expect(() => ProjectContribution.merge(
      new ProjectContribution([resource]),
      new ProjectContribution([{ ...resource, name: 'two' }]),
    )).toThrow('conflicting definitions')
    expect(ProjectContribution.merge(new ProjectContribution([resource]), new ProjectContribution([resource])).byKey().size)
      .toBe(1)
    expect(ownedTextFile('owner', 'file.txt', 'text').document).toBeInstanceOf(TextProjectFile)
    expect(optionalString({ value: 1 }, 'value')).toHaveLength(1)
    expect(optionalString({}, 'value')).toEqual([])
    expect(requiredString({ value: 'x' }, 'value')).toEqual([])
    expect(stringArray({ value: ['a'] }, 'value')).toEqual([])
    expect(stringArray({ value: [1] }, 'value')).toHaveLength(1)
    expect(cordisConfigEntry('owner', { id: 'entry', name: 'pkg' }).ownedConfigKeys).toEqual([])
    expect(npmCordisConfigEntry('owner', { id: 'entry', name: 'pkg' })[1].ownedConfigKeys).toEqual([])
    expect(npmCordisConfigEntry('owner', { id: 'entry', name: '@scope/pkg/subpath' })[0].name).toBe('@scope/pkg')
    expect(npmCordisConfigEntry('owner', { id: 'entry', name: 'pkg/subpath' })[0].name).toBe('pkg')
    for (const invalid of ['', '@scope', '@scope/']) {
      expect(() => npmCordisConfigEntry('owner', { id: 'entry', name: invalid })).toThrow('invalid bare package specifier')
    }
    expect(environmentResource('owner', 'EMPTY', undefined)).not.toHaveProperty('value')
    const builtins = createBuiltinRegistry(profile)
    expect(builtins.get(featureId('app')).defaultOptions(profile)).toEqual(['embed'])
    expect(builtins.get(featureId('hmr')).defaultOptions(profile)).toEqual(['default'])
    const app = builtins.get(featureId('app'))
    const acpEntry = builtins.get(featureId('app')).contribution(selection('app', ['acp']), profile).resources
      .find((resource): resource is CordisConfigEntryResource =>
        resource.kind === 'cordis-config-entry' && resource.entry.id === 'acp')
    expect(acpEntry?.entry.id).toBe('acp')
    expect(acpEntry?.validateConfig?.({ model: '' })).toHaveLength(1)
    const embedOption = app.options.find(option => option.id === 'embed')
    expect(embedOption?.markerConfigEntries(profile)).toEqual([])
    expect(embedOption?.contribution(profile, {}).resources.map(resource => resource.kind)).toEqual([
      'owned-file', 'owned-file', 'package-script', 'package-script',
    ])
    expect(embedOption?.matchesConfigEntries([
      { id: 'agent-loop', name: '@deepseek-ai/dsh-agent-loop' },
      { id: 'acp', name: '@deepseek-ai/dsh-acp' },
    ], profile)).toBe(false)
    const spineAgentLoop = builtins.get(featureId('spine')).contribution(selection('spine', ['default']), profile).resources
      .find((resource): resource is CordisConfigEntryResource =>
        resource.kind === 'cordis-config-entry' && resource.entry.id === 'agent-loop')
    expect(spineAgentLoop?.validateConfig?.({ agents: 'main' })).toEqual(['agents must be an array'])
    expect(spineAgentLoop?.validateConfig?.({ agents: ['main'] })).toEqual(['agents must be empty'])
    expect(spineAgentLoop?.validateConfig?.({ agents: [] })).toEqual([])
    expect(builtins.get(featureId('provider')).defaultOptions(profile)).toEqual(['deepseek-official'])
    expect(() => builtins.get(featureId('provider')).contribution({
      id: featureId('provider'), options: ['custom'], values: { baseURL: 1 },
    }, profile)).toThrow('baseURL must be a string')
    const alternateModel = builtins.get(featureId('provider')).contribution({
      id: featureId('provider'), options: ['deepseek-official'],
    }, { ...profile, runtime: { model: 'other' } }).resources
      .find(resource => resource.kind === 'cordis-config-entry')
    expect(alternateModel?.entry.config?.models).toEqual(['other'])
    class RequiringSimple extends BadSimple {
      override readonly requires = [featureId('npm-dependency')]
    }
    expect(new RequiringSimple().requirements(selection('bad-simple', ['one']))).toEqual([{ id: 'npm-dependency' }])
    expect(builtins.get(featureId('bash')).defaultOptions(profile)).toEqual(['local'])
  })

  it('reports every inconsistent feature resource shape', () => {
    const feature = defineFeature({
      id: 'inspectable', summary: 'Inspectable', mode: 'single',
      baseResources: [{ kind: 'file-cordis-config-entry', id: 'base', path: 'pkg' }],
      options: [{
        id: 'one', label: 'One', default: true,
        secrets: [{ id: 'token', environment: 'TOKEN', message: 'Token', required: true }],
        resources: [
          { kind: 'file-cordis-config-entry', id: 'one', path: 'pkg', config: { value: 'x' } },
          { kind: 'npm-dependency', name: 'dep' },
          { kind: 'owned-file', path: 'owned.txt', text: 'owned' },
        ],
      }],
    })
    const view = (entries: readonly CordisConfigEntry[]): FeatureProjectView => ({
      profile,
      cordisConfigEntries: () => entries,
      packageManifest: () => ({}),
      hasDocument: () => false,
      readEnvironment: (path) => {
        if (path === '.env.example') throw new Error('bad env')
        return 'secret'
      },
    })
    expect(feature.inspect(view([])).state).toBe('absent')
    const inconsistent = feature.inspect(view([
      { id: 'one', name: 'pkg', config: { value: 1 } },
      { id: 'extra', name: 'pkg', disabled: true },
    ]))
    expect(inconsistent.state).toBe('inconsistent')
    expect(inconsistent.diagnostics.join('\n')).toContain('missing Cordis config entry base')
    expect(inconsistent.diagnostics.join('\n')).toContain('unexpected owned Cordis config entry extra')
    expect(inconsistent.diagnostics.join('\n')).toContain('missing package.json dependencies entry dep')
    expect(inconsistent.diagnostics.join('\n')).toContain('missing owned file owned.txt')
    expect(inconsistent.diagnostics.join('\n')).toContain('bad env')
    expect(inconsistent.diagnostics.join('\n')).toContain('mixed enabled states')
    expect(feature.inspect(view([{ id: 'unknown', name: 'pkg' }])).state).toBe('inconsistent')
    const ambiguous = defineFeature({
      id: 'ambiguous', summary: 'Ambiguous', mode: 'exclusive',
      options: [
        { id: 'one', label: 'One', default: true, resources: [], markers: [{ id: 'one', name: 'pkg' }] },
        { id: 'two', label: 'Two', resources: [], markers: [{ id: 'two', name: 'pkg' }] },
      ],
    })
    expect(ambiguous.inspect(view([{ id: 'one', name: 'pkg' }, { id: 'two', name: 'pkg' }])).state)
      .toBe('inconsistent')
    const noValidator = defineFeature({
      id: 'no-validator', summary: 'No validator', mode: 'single',
      options: [{
        id: 'one', label: 'One', default: true,
        resources: [{ kind: 'file-cordis-config-entry', id: 'plain', path: 'plain-package' }],
      }],
    })
    expect(noValidator.inspect(view([{ id: 'plain', name: 'plain-package' }])).state).toBe('enabled')
    const app = createBuiltinRegistry(profile).get(featureId('app'))
    expect(app.inspect(view([{ id: 'acp', name: '@deepseek-ai/dsh-acp' }])).state)
      .toBe('inconsistent')
  })
})
