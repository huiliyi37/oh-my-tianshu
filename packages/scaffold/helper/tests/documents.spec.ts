import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { CordisYamlFile, JsExpression } from '../src/documents/cordis-yaml-file.ts'
import { EnvFile } from '../src/documents/env-file.ts'
import { PackageJsonFile } from '../src/documents/package-json-file.ts'
import { PnpmWorkspaceFile } from '../src/documents/pnpm-workspace-file.ts'
import { TsConfigFile } from '../src/documents/tsconfig-file.ts'
import { TextProjectFile, withTrailingNewline } from '../src/documents/project-file.ts'
import { featureId, resourceKey } from '../src/ids.ts'
import { LinkWorkspace } from '../src/package-managers/link-workspace.ts'
import { LocalPluginBlueprint } from '../src/plugins/local-plugin-blueprint.ts'
import {
  NpmPackageManager,
  NodeCommandRunner,
  PnpmPackageManager,
  YarnPackageManager,
  createPackageManager,
  inferPackageManagerName,
  probePackageManagerVersion,
  scrubEnvironment,
  type CommandRunner,
} from '../src/package-managers/package-manager.ts'
import { createBaselineProjectArtifacts } from '../src/templates/project-template.ts'
import { loadHelperTemplate } from '../src/templates/template-assets.ts'
import { TextTemplate } from '../src/templates/text-template.ts'
import { resolveNpmDependency } from '../src/project/npm-dependency-policy.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('structured project documents', () => {
  it('normalizes trailing newlines and preserves managed package fields', () => {
    expect(withTrailingNewline('a\n\n')).toBe('a\n')
    const manifest = PackageJsonFile.parse('{"name":"demo","custom":1,"dependencies":{"z":"1"}}\n')
    manifest.setScript('start', 'node index.js')
    manifest.setNpmDependency('dependencies', 'a', '2')
    manifest.setNpmDependency('devDependencies', 'typescript', '3')
    manifest.removeNpmDependency('dependencies', 'z')
    manifest.addWorkspace('plugins/*')
    manifest.addWorkspace('plugins/*')
    manifest.setPackageManager('pnpm@10.0.0')
    manifest.setResolution('a', 'portal:../a')
    manifest.validate()
    expect(manifest.npmDependency('a')).toEqual({ section: 'dependencies', spec: '2' })
    expect(manifest.npmDependencyNames()).toEqual(['a', 'typescript'])
    expect(JSON.parse(manifest.serialize())).toMatchObject({
      name: 'demo',
      custom: 1,
      dependencies: { a: '2' },
      workspaces: ['plugins/*'],
    })
    manifest.setPackageManager(undefined)
    expect(manifest.value().packageManager).toBeUndefined()
    expect(() => PackageJsonFile.parse('[]')).toThrow('root must be an object')
    expect(() => PackageJsonFile.parse('{')).toThrow('invalid package.json')
    for (const [text, diagnostic] of [
      ['{}', 'name must be'],
      ['{"name":"x","scripts":null}', 'scripts must be an object'],
      ['{"name":"x","dependencies":[]}', 'dependencies must be an object'],
      ['{"name":"x","devDependencies":{"bad":""}}', 'must be a non-empty string'],
      ['{"name":"x","workspaces":"bad"}', 'workspaces must be an array'],
    ] as const) expect(() => { PackageJsonFile.parse(text).validate() }).toThrow(diagnostic)
    const minimal = PackageJsonFile.parse('{"name":"x"}')
    minimal.validate()
    expect(minimal.npmDependency('missing')).toBeUndefined()
    expect(minimal.serialize()).toBe('{\n  "name": "x"\n}\n')
    expect(PackageJsonFile.parse('{"name":"x","devDependencies":{"a":"1"}}').npmDependencyNames()).toEqual(['a'])
  })

  it('round-trips Cordis comments and !!js while editing owned fields', () => {
    const created = CordisYamlFile.create().clone()
    created.addEntry({ id: 'created', name: 'created-package' }, `Uncomment this example.
config:
  value: true`)
    expect(created.serialize()).toMatch(/^- id: created/m)
    expect(created.serialize()).toContain('  # Uncomment this example.\n  # config:\n  #   value: true')
    expect(created.serialize()).not.toMatch(/^\[/)
    const flow = CordisYamlFile.parse('[{ id: flow, name: flow-package, config: { root: ./flow } }]\n')
    expect(flow.serialize()).toContain('- id: flow\n  name: flow-package\n  config:\n    root: ./flow')
    expect(flow.serialize()).not.toContain('{')
    const document = CordisYamlFile.parse(`# lead
- id: provider
  name: 'provider-package'
  config:
    endpoint: !!js process.env.PROVIDER_URL
    custom: keep
`)
    const endpoint = document.entry('provider')?.config?.endpoint
    expect(endpoint).toBeInstanceOf(JsExpression)
    document.updateOwnedConfig('provider', ['endpoint'], { endpoint: new JsExpression('process.env.NEXT_URL') })
    document.setDisabled('provider', true)
    document.addEntry({ id: 'tool', name: 'demo-tool' })
    document.validate()
    const text = document.serialize()
    expect(text).toContain('# lead')
    expect(text).toContain('!!js process.env.NEXT_URL')
    expect(text).toContain('custom: keep')
    expect(document.removeEntry('tool')).toBe(true)
    expect(document.removeEntry('tool')).toBe(false)
    document.setDisabled('provider', false)
    expect(document.entry('provider')?.disabled).toBeUndefined()
    expect(() => { document.addEntry({ id: 'provider', name: 'duplicate' }) }).toThrow('already exists')
    expect(() => CordisYamlFile.parse('{}')).toThrow('root must be a sequence')
  })

  it('rejects malformed Cordis config entries and missing mutation targets', () => {
    expect(() => new JsExpression(' ')).toThrow('must not be empty')
    expect(() => CordisYamlFile.parse('[')).toThrow('invalid cordis.yml')
    for (const [text, diagnostic] of [
      ['- nope\n', 'every entry must be a mapping'],
      ['- name: pkg\n', 'id must be'],
      ['- id: x\n', 'name must be'],
      ['- id: x\n  name: pkg\n  config: nope\n', 'config must be'],
      ['- id: x\n  name: pkg\n  disabled: nope\n', 'disabled must be'],
    ] as const) expect(() => CordisYamlFile.parse(text).entries()).toThrow(diagnostic)
    const duplicate = CordisYamlFile.parse('- id: x\n  name: one\n- id: x\n  name: two\n')
    expect(() => { duplicate.validate() }).toThrow('duplicate Cordis config entry id')
    const document = CordisYamlFile.create()
    expect(() => { document.setDisabled('missing', true) }).toThrow('does not exist')
    expect(() => { document.updateOwnedConfig('missing', [], {}) }).toThrow('does not exist')
    document.addEntry({ id: 'plain', name: 'pkg' })
    document.updateOwnedConfig('plain', [], { value: 1 })
    expect(document.entry('plain')?.config).toEqual({ value: 1 })
    document.updateOwnedConfig('plain', ['value'], {})
    expect(document.entry('plain')?.config).toBeUndefined()
    const scalar = CordisYamlFile.parse('- id: plain\n  name: pkg\n  config: value\n')
    expect(() => { scalar.updateOwnedConfig('plain', [], {}) }).toThrow('config is not a mapping')
    expect(() => { CordisYamlFile.parse('- nope\n').setDisabled('missing', true) }).toThrow('does not exist')
  })

  it('keeps .env append-only while managing .env.example strictly', () => {
    const document = EnvFile.parse('.env', '# keep\nA=1\nexport B=2\n')
    expect(document.get('A')).toBe('1')
    expect(document.get('B')).toBe('2')
    expect(document.append('A', 'next')).toBe(false)
    expect(document.append('C', '', 'Required')).toBe(true)
    expect(document.serialize()).toBe('# keep\nA=1\nexport B=2\n# Required\nC=\n')
    expect(() => { document.append('bad-name', 'x') }).toThrow('invalid environment variable')
    expect(() => { document.append('D', '', '') }).toThrow('non-empty line')
    expect(() => { document.append('D', '', 'bad\ncomment') }).toThrow('non-empty line')
    expect(() => { document.set('A', 'next') }).toThrow('.env is append-only')
    expect(() => { document.remove('A') }).toThrow('.env is append-only')
    const duplicateEnv = EnvFile.parse('.env', 'A=1\nA=2\n')
    expect(duplicateEnv.get('A')).toBe('2')
    expect(duplicateEnv.append('A', 'next')).toBe(false)
    expect(() => { duplicateEnv.validate() }).not.toThrow()

    const example = EnvFile.parse('.env.example', '# keep\nA=1\n')
    example.set('A', 'next')
    example.set('C', '')
    example.remove('C')
    expect(example.serialize()).toBe('# keep\nA=next\n')
    expect(() => { example.append('C', '') }).toThrow('.env.example is SDK-managed')
    expect(() => { example.set('bad-name', 'x') }).toThrow('invalid environment variable')
    const duplicate = EnvFile.parse('.env.example', 'A=1\nA=2\n')
    expect(() => { duplicate.validate() }).toThrow('duplicate variable A')
    expect(() => duplicate.get('A')).toThrow('duplicate variable A')
    expect(() => { duplicate.set('A', 'next') }).toThrow('duplicate variable A')
    expect(() => { duplicate.remove('A') }).toThrow('duplicate variable A')
    example.remove('missing')
    expect(document.get('missing')).toBeUndefined()
    expect(EnvFile.parse('.env', '').clone().serialize()).toBe('\n')
  })

  it('patches JSONC references without erasing comments', () => {
    const document = TsConfigFile.parse(`{
  // retained
  "references": [{ "path": "./plugins/a" }]
}`)
    document.addReference('./plugins/a')
    document.addReference('./plugins/b')
    document.validate()
    expect(document.serialize()).toContain('// retained')
    expect(document.serialize()).toContain('./plugins/b')
    expect(() => TsConfigFile.parse('{')).toThrow('valid JSONC object')
    const malformed = TsConfigFile.parse('{"references": {}}')
    expect(() => { malformed.addReference('./plugins/x') }).toThrow('must be an array')
    const badItem = TsConfigFile.parse('{"references":[null]}')
    expect(() => { badItem.addReference('./plugins/x') }).toThrow('must contain')
    expect(() => { badItem.validate() }).toThrow('must contain')
    const created = TsConfigFile.create()
    created.validate()
    expect(created.clone().serialize()).toContain('"references": []')
    TsConfigFile.parse('{}').validate()
    const noReferences = TsConfigFile.parse('{}')
    noReferences.addReference('./plugin')
    expect(noReferences.serialize()).toContain('./plugin')
    expect(() => { TsConfigFile.parse('{"references":{}}').validate() }).toThrow('must be an array')
  })

  it('creates and parses pnpm workspace policy', () => {
    const document = PnpmWorkspaceFile.create()
    document.addPackage('plugins/*')
    document.addPackage('plugins/*')
    document.disableAutoInstallPeers()
    document.validate()
    expect(document.serialize()).toContain('autoInstallPeers: false')
    const parsed = PnpmWorkspaceFile.parse(document.serialize())
    expect(parsed.clone().serialize()).toBe(document.serialize())
    expect(() => PnpmWorkspaceFile.parse('packages: [')).toThrow('invalid pnpm-workspace.yaml')
    expect(() => PnpmWorkspaceFile.parse('packages: nope')).toThrow('packages must be an array')
    expect(() => PnpmWorkspaceFile.parse('packages: [{}]')).toThrow('packages must be an array')
    expect(() => PnpmWorkspaceFile.parse('packages: [1]')).toThrow('packages must be an array')
    expect(() => PnpmWorkspaceFile.parse('[]')).toThrow('root must be an object')
    expect(() => PnpmWorkspaceFile.parse('packages: []\nautoInstallPeers: nope')).toThrow('must be boolean')
    const invalid = PnpmWorkspaceFile.create()
    invalid.addPackage(' ')
    expect(() => { invalid.validate() }).toThrow('must not be empty')
    expect(PnpmWorkspaceFile.parse('packages: []\n').serialize()).not.toContain('autoInstallPeers')
    const preserved = PnpmWorkspaceFile.parse(`# keep workspace settings
packages:
  - apps/*
catalog:
  react: ^19.0.0
overrides:
  legacy: modern
`)
    preserved.disableAutoInstallPeers()
    const preservedText = preserved.clone().serialize()
    expect(preservedText).toContain('# keep workspace settings')
    expect(preservedText).toContain('catalog:\n  react: ^19.0.0')
    expect(preservedText).toContain('overrides:\n  legacy: modern')
    expect(preservedText).toContain('autoInstallPeers: false')
  })

  it('renders strict complete-file templates without escaping code text', () => {
    const template = new TextTemplate<{ value: string }>('value={{value}} missing={{missing}}')
    expect(() => template.render({ value: '<code>' })).toThrow()
    const valid = new TextTemplate<{ value: string }>('value={{value}}')
    expect(valid.render({ value: '<code>' })).toBe('value=<code>')
    expect(new TextTemplate<Record<string, never>>('\\{{model}}').render({})).toBe('{{model}}')
    expect(() => new TextProjectFile('/absolute', 'x')).toThrow('stay inside')
    expect(() => new TextProjectFile('../outside', 'x')).toThrow('stay inside')
    expect(new TextProjectFile('inside', 'x').clone().serialize()).toBe('x\n')
    expect(() => featureId('Bad Id')).toThrow('invalid feature id')
    expect(() => resourceKey('')).toThrow('must not be empty')
    expect(() => loadHelperTemplate('../bad.tpl')).toThrow('must not contain a directory')
    expect(createBaselineProjectArtifacts({
      name: 'demo', description: 'demo', releaseVersion: '0.0.1', model: 'model', modelLiteral: '"model"', packageManager: 'yarn',
      isAcp: false, isEmbed: true,
      installArgs: 'install', buildArgs: 'build',
    }).map(document => document.relativePath)).toContain('.yarnrc.yml')
    expect(() => new LocalPluginBlueprint('---', 'plugin')).toThrow('invalid local plugin name')
    expect(new LocalPluginBlueprint('tool', 'tool').packageName('@scope/project')).toBe('@scope/project-tool')
    expect(new LocalPluginBlueprint('tool', 'tool').packageName('@invalid')).toBe('@invalid-tool')
  })
})

describe('package manager strategies', () => {
  it('owns workspace fields, execution commands, and supported version floors', () => {
    const npm = new NpmPackageManager('10.1.0')
    const pnpm = new PnpmPackageManager('10.2.0')
    const yarn = new YarnPackageManager('4.0.0')
    for (const manager of [npm, pnpm, yarn]) manager.validateVersion()
    expect(npm.localPluginSpec()).toBe('*')
    expect(npm.linkSpec('../x')).toBe('file:../x')
    expect(npm.configureWorkspace(PackageJsonFile.create('{"name":"demo"}'))).toEqual([])
    const pnpmManifest = PackageJsonFile.create('{"name":"demo"}')
    expect(pnpm.configureWorkspace(pnpmManifest)[0]).toBeInstanceOf(PnpmWorkspaceFile)
    expect(pnpm.localPluginSpec()).toBe('workspace:*')
    expect(pnpm.linkSpec('../x')).toBe('link:../x')
    const yarnManifest = PackageJsonFile.create('{"name":"demo"}')
    expect(yarn.configureWorkspace(yarnManifest)).toEqual([])
    expect(yarn.localPluginSpec()).toBe('workspace:*')
    expect(yarn.linkSpec('../x')).toBe('portal:../x')
    expect(yarn.buildCommand()).toEqual(['build'])
    expect(npm.installCommand()).toEqual(['install'])
    expect(npm.buildCommand()).toEqual(['run', 'build'])
    expect(() => createPackageManager('npm', '9.0.0')).toThrow('npm >=10')
    expect(() => createPackageManager('pnpm', '9.0.0')).toThrow('pnpm >=10')
    expect(() => createPackageManager('yarn', '1.22.0')).toThrow('Yarn >=2')
    expect(inferPackageManagerName(undefined, 'pnpm/10.0.0 node/v24')).toBe('pnpm')
    expect(inferPackageManagerName(undefined, 'unknown/1')).toBeUndefined()
    expect(inferPackageManagerName('yarn', undefined)).toBe('yarn')
    expect(() => createPackageManager('npm', 'invalid')).toThrow('invalid package manager version')
    expect(resolveNpmDependency('cordis', 'devDependencies', '0.0.1')).toEqual({
      section: 'devDependencies', spec: '^4.0.0-rc.7',
    })
    expect(resolveNpmDependency('@cordisjs/plugin-hmr', 'dependencies', '0.0.1').spec).toBe('^1.0.15')
    expect(resolveNpmDependency('tsdown', 'devDependencies', '0.0.1').spec).toBe('0.22.2')
    expect(resolveNpmDependency('@deepseek-ai/dsh-tools', 'dependencies', '1.2.3').spec).toBe('^1.2.3')
    expect(() => resolveNpmDependency('unknown', 'dependencies', '0.0.1')).toThrow('no generated-project')
  })

  it('checks install/build process outcomes and scrubs credential-shaped names', async () => {
    const calls: string[][] = []
    const runner: CommandRunner = {
      run: async (command, args) => {
        calls.push([command, ...args])
        return { exitCode: 0, signal: null }
      },
    }
    const npm = new NpmPackageManager('10.0.0')
    await npm.install('/tmp', runner)
    await npm.build('/tmp', runner)
    expect(calls).toEqual([['npm', 'install'], ['npm', 'run', 'build']])
    await npm.add('some-pkg@1.0.0', '/tmp', runner)
    const pnpm = createPackageManager('pnpm', '10.0.0')
    await pnpm.add('github:o/r#sha', '/tmp', runner)
    expect(calls).toContainEqual(['npm', 'install', 'some-pkg@1.0.0'])
    expect(calls).toContainEqual(['pnpm', 'add', 'github:o/r#sha'])
    const failed: CommandRunner = { run: async () => ({ exitCode: 2, signal: null }) }
    await expect(npm.install('/tmp', failed)).rejects.toThrow('exited with code 2')
    const killed: CommandRunner = { run: async () => ({ exitCode: null, signal: 'SIGTERM' }) }
    await expect(npm.build('/tmp', killed)).rejects.toThrow('killed by SIGTERM')
    expect(scrubEnvironment({
      PATH: '/bin',
      API_KEY: 'secret',
      DB_PASSWORD: 'secret',
      TOKEN_VALUE: 'secret',
    })).toEqual({ PATH: '/bin' })
  })

  it('probes versions and runs real child-process boundaries', async () => {
    await expect(probePackageManagerVersion('npm', process.cwd())).resolves.toMatch(/^\d+/)
    await expect(probePackageManagerVersion('npm', '/missing/dsh-cwd')).rejects.toThrow('cannot run npm --version')
    const root = await mkdtemp(join(tmpdir(), 'dsh-empty-version-'))
    temporary.push(root)
    const executable = join(root, 'npm')
    await writeFile(executable, '#!/bin/sh\nexit 0\n')
    await chmod(executable, 0o755)
    const before = process.env.PATH
    process.env.PATH = root
    await expect(probePackageManagerVersion('npm', root)).rejects.toThrow('empty version output')
    process.env.PATH = before
    const runner = new NodeCommandRunner()
    await expect(runner.run(process.execPath, ['-e', ''], root)).resolves.toEqual({ exitCode: 0, signal: null })
    await expect(runner.run('missing-dsh-command', [], root)).rejects.toThrow()
    let redirected = ''
    const output = new Writable({
      write(chunk, _encoding, callback) { redirected += String(chunk); callback() },
    })
    const redirecting = new NodeCommandRunner(output)
    await expect(redirecting.run(
      process.execPath,
      ['-e', 'process.stdout.write("child-out"); process.stderr.write("child-err")'],
      root,
    )).resolves.toEqual({ exitCode: 0, signal: null })
    expect(redirected).toContain('child-out')
    expect(redirected).toContain('child-err')
    await expect(redirecting.run('missing-dsh-command', [], root)).rejects.toThrow()
  })

  it('discovers and rewrites a repository-local NPM dependency closure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-link-workspace-'))
    temporary.push(root)
    await mkdir(join(root, 'vendor', 'cordis'), { recursive: true })
    await mkdir(join(root, 'packages', 'sdk', 'scripts'), { recursive: true })
    await mkdir(join(root, 'packages', 'sdk', 'helper'), { recursive: true })
    await writeFile(join(root, 'vendor', 'cordis', 'package.json'), JSON.stringify({ name: 'cordis' }))
    await writeFile(join(root, 'packages', 'sdk', 'helper', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-helper' }))
    await writeFile(join(root, 'packages', 'sdk', 'scripts', 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-scripts', dependencies: { '@deepseek-ai/dsh-helper': '^0.0.1' }, peerDependencies: { cordis: '^4' },
    }))
    const workspace = await LinkWorkspace.open(root)
    expect(workspace.closure(['@deepseek-ai/dsh-scripts'])).toEqual([
      '@deepseek-ai/dsh-helper', '@deepseek-ai/dsh-scripts', 'cordis',
    ])
    const manifest = PackageJsonFile.create('{"name":"consumer","description":"test"}')
    manifest.setNpmDependency('dependencies', '@deepseek-ai/dsh-scripts', '^0.0.1')
    const pnpmWorkspace = PnpmWorkspaceFile.create()
    workspace.apply(join(root, 'consumer'), manifest, new PnpmPackageManager('10.0.0'), [pnpmWorkspace])
    expect(manifest.npmDependency('cordis')?.spec).toMatch(/^link:/)
    expect(pnpmWorkspace.serialize()).toContain('autoInstallPeers: false')
    expect(workspace.packageDirectory('cordis')).toBe(join(root, 'vendor', 'cordis'))
    expect(await readFile(join(root, 'vendor', 'cordis', 'package.json'), 'utf8')).toContain('cordis')
    expect(workspace.packageDirectory('missing')).toBeUndefined()
    const yarnManifest = PackageJsonFile.create('{"name":"consumer"}')
    yarnManifest.setNpmDependency('dependencies', '@deepseek-ai/dsh-scripts', '^0.0.1')
    workspace.apply(join(root, 'consumer-yarn'), yarnManifest, new YarnPackageManager('4.0.0'), [])
    expect(yarnManifest.value().resolutions).toBeDefined()
    const pnpmManifest = PackageJsonFile.create('{"name":"consumer"}')
    pnpmManifest.setNpmDependency('dependencies', '@deepseek-ai/dsh-scripts', '^0.0.1')
    expect(() => { workspace.apply(join(root, 'consumer-pnpm'), pnpmManifest, new PnpmPackageManager('10.0.0'), []) })
      .toThrow('requires pnpm-workspace.yaml')
  })

  it('rejects malformed linked repositories', async () => {
    const missing = await mkdtemp(join(tmpdir(), 'dsh-link-missing-'))
    temporary.push(missing)
    await mkdir(join(missing, 'vendor'), { recursive: true })
    await mkdir(join(missing, 'packages'), { recursive: true })
    await expect(LinkWorkspace.open(missing)).rejects.toThrow('not a DeepSeek Harness repository root')
    const unreadable = await mkdtemp(join(tmpdir(), 'dsh-link-unreadable-'))
    temporary.push(unreadable)
    await mkdir(join(unreadable, 'vendor', 'bad'), { recursive: true })
    await mkdir(join(unreadable, 'packages'), { recursive: true })
    await expect(LinkWorkspace.open(unreadable)).rejects.toThrow('cannot read linked package')
    const unnamed = await mkdtemp(join(tmpdir(), 'dsh-link-unnamed-'))
    temporary.push(unnamed)
    await mkdir(join(unnamed, 'vendor', 'unnamed'), { recursive: true })
    await mkdir(join(unnamed, 'packages'), { recursive: true })
    await writeFile(join(unnamed, 'vendor', 'unnamed', 'package.json'), '{}')
    await expect(LinkWorkspace.open(unnamed)).rejects.toThrow('not a DeepSeek Harness repository root')
    const duplicate = await mkdtemp(join(tmpdir(), 'dsh-link-duplicate-'))
    temporary.push(duplicate)
    await mkdir(join(duplicate, 'vendor', 'one'), { recursive: true })
    await mkdir(join(duplicate, 'packages', 'group', 'two'), { recursive: true })
    await writeFile(join(duplicate, 'vendor', 'one', 'package.json'), '{"name":"duplicate"}')
    await writeFile(join(duplicate, 'packages', 'group', 'two', 'package.json'), '{"name":"duplicate"}')
    await expect(LinkWorkspace.open(duplicate)).rejects.toThrow('duplicate linked package name')
  })
})
