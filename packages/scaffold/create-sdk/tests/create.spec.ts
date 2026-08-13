import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HeadlessPromptPort,
  LocalPluginBlueprint,
  featureId,
  NodeCommandRunner,
  NpmPackageManager,
  type FeatureSelection,
  type NestedMultiSelectValue,
  type PromptPort,
} from '@deepseek-ai/dsh-helper'
import type {
  ConfirmPromptRequest,
  MultiSelectPromptRequest,
  NestedMultiSelectRequest,
  PromptOutcome,
  SecretPromptRequest,
  SelectPromptRequest,
  TextPromptRequest,
} from '../../helper/src/questions/prompt-port.ts'
import { parseCreateArgs } from '../src/args.ts'
import {
  createProject,
  readCreateSdkVersion,
  runCreateCommand,
  type CreateCommandContext,
} from '../src/command.ts'
import { CreateWizard } from '../src/create-wizard.ts'
import { resolveHeadless } from '../src/headless.ts'
import { scaffoldProject } from '../src/project-scaffolder.ts'

class ScriptedPort implements PromptPort {
  readonly requests: string[] = []
  readonly #answers: unknown[]

  constructor(answers: unknown[]) {
    this.#answers = [...answers]
  }

  answer<T>(message: string): Promise<PromptOutcome<T>> {
    this.requests.push(message)
    const value = this.#answers.shift()
    return Promise.resolve(value === ScriptedPort.cancel
      ? { status: 'cancelled' }
      : { status: 'answered', value: value as T })
  }

  async text(request: TextPromptRequest): Promise<PromptOutcome<string>> {
    const outcome = await this.answer<string>(request.message)
    if (outcome.status === 'cancelled') return outcome
    const value = outcome.value || request.defaultValue || ''
    const diagnostic = request.validate?.(value)
    if (diagnostic) throw new Error(diagnostic)
    return { status: 'answered', value }
  }
  secret(request: SecretPromptRequest): Promise<PromptOutcome<string>> { return this.answer(request.message) }
  select<T>(request: SelectPromptRequest<T>): Promise<PromptOutcome<T>> { return this.answer(request.message) }
  multiselect<T>(request: MultiSelectPromptRequest<T>): Promise<PromptOutcome<readonly T[]>> {
    return this.answer(request.message)
  }
  confirm(request: ConfirmPromptRequest): Promise<PromptOutcome<boolean>> { return this.answer(request.message) }
  nestedMultiselect<TValue, TChoice>(
    request: NestedMultiSelectRequest<TValue, TChoice>,
  ): Promise<PromptOutcome<readonly NestedMultiSelectValue<TValue, TChoice>[]>> {
    return this.answer(request.message)
  }

  static readonly cancel = Symbol('cancel')
}

const temporary: string[] = []
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

interface GeneratedPackageManifest {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface GeneratedTsConfig {
  compilerOptions: {
    types?: readonly string[]
  }
}

function parseGeneratedPackageManifest(text: string): GeneratedPackageManifest {
  return JSON.parse(text) as GeneratedPackageManifest
}

function parseGeneratedTsConfig(text: string): GeneratedTsConfig {
  return JSON.parse(text) as GeneratedTsConfig
}

function commandContext(
  cwd: string,
  port?: PromptPort,
  setup?: CreateCommandContext['setup'],
): CreateCommandContext & { readStdout: () => string; readStderr: () => string } {
  let stdout = ''
  let stderr = ''
  const input = Object.assign(new PassThrough(), { isTTY: true }) as unknown as NodeJS.ReadStream
  const output = Object.assign(new Writable({
    write(chunk, _encoding, callback) { stdout += String(chunk); callback() },
  }), { isTTY: true }) as unknown as NodeJS.WriteStream
  const error = new Writable({
    write(chunk, _encoding, callback) { stderr += String(chunk); callback() },
  }) as unknown as NodeJS.WriteStream
  return {
    cwd,
    stdin: input,
    stdout: output,
    stderr: error,
    releaseVersion: '0.0.1',
    versionProbe: async () => '10.0.0',
    ...port ? { port } : {},
    ...setup ? { setup } : {},
    readStdout: () => stdout,
    readStderr: () => stderr,
  }
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('create arguments', () => {
  it('parses public options and the private repository link mode', () => {
    expect(parseCreateArgs([
      'agent', '--description=demo', '--provider', 'deepseek-official', '--base-url=https://api.example',
      '--api-key', 'key', '--model=m', '--interface', 'acp', '--pm=pnpm', '--no-install',
      '--link-workspace',
    ])).toEqual({
      directory: 'agent',
      description: 'demo',
      provider: 'deepseek-official',
      baseURL: 'https://api.example',
      apiKey: 'key',
      model: 'm',
      runInterface: 'acp',
      packageManager: 'pnpm',
      install: false,
      linkWorkspace: true,
      help: false,
    })
    expect(parseCreateArgs(['--link-workspace']).linkWorkspace).toBe(true)
    expect(() => parseCreateArgs(['--link-packages-workspace'])).toThrow("unknown option '--link-packages-workspace'")
    expect(parseCreateArgs(['--provider=custom']).provider).toBe('custom')
    expect(parseCreateArgs(['--help']).help).toBe(true)
    expect(() => parseCreateArgs(['--interface=bad'])).toThrow('Allowed choices are acp, embed')
    expect(() => parseCreateArgs(['--unknown'])).toThrow("unknown option '--unknown'")
    expect(() => parseCreateArgs(['one', 'two'])).toThrow('too many arguments')
  })

  it('validates empty directories and package names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-validation-'))
    temporary.push(root)
    await expect(new CreateWizard({
      args: parseCreateArgs(['']), port: new ScriptedPort([]), cwd: root,
      releaseVersion: '0.0.1', versionProbe: async () => '10.0.0',
    }).run()).rejects.toThrow('A value is required')
    await expect(new CreateWizard({
      args: parseCreateArgs(['agent']), port: new ScriptedPort(['Invalid Name']), cwd: root,
      releaseVersion: '0.0.1', versionProbe: async () => '10.0.0',
    }).run()).rejects.toThrow('lowercase npm package name')
  })

  it('rejects an existing target before asking project questions', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'create-existing-target-'))
    temporary.push(cwd)
    await mkdir(join(cwd, 'taken'))
    const port = new ScriptedPort([])
    const wizard = new CreateWizard({
      args: parseCreateArgs(['taken']),
      port,
      cwd,
      releaseVersion: '0.0.1',
      versionProbe: async () => '10.0.0',
    })
    await expect(wizard.run()).rejects.toThrow('directory: Target already exists')
    expect(port.requests).toEqual([])
  })
})

describe('CreateWizard and scaffolder', () => {
  it('asks only unresolved questions in requirement-safe order', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'create-wizard-'))
    temporary.push(cwd)
    const port = new ScriptedPort([
      'my-agent',
      [
        { value: featureId('persistence'), choices: ['sqlite'] },
        { value: featureId('hmr'), choices: [] },
        { value: featureId('fs'), choices: [] },
        { value: featureId('web'), choices: ['exa'] },
      ],
      false,
      'exa-key',
      'tool',
    ])
    const args = parseCreateArgs([
      'my-agent',
      '--description=demo',
      '--provider=deepseek-official',
      '--api-key=deepseek-key',
      '--model=deepseek-v4-flash',
      '--interface=acp',
      '--pm=npm',
      '--no-install',
      '--link-workspace',
    ])
    const resolved = await new CreateWizard({
      args,
      port,
      cwd,
      releaseVersion: '0.0.1',
      versionProbe: async () => '10.0.0',
    }).run()
    expect(port.requests).toEqual([
      'Package name',
      'Select features',
      'Add the recommended tool timeout policy for web search and fetch tools?',
      'Exa API key',
      'Local plugin',
    ])
    expect(resolved.install).toBe(false)
    expect(resolved.request.packageManager.name).toBe('npm')
    expect(resolved.request.linkWorkspaceRoot).toBe(repoRoot)
    expect(resolved.request.localPlugins[0]).toMatchObject({ name: 'tool', kind: 'tool' })
    expect(resolved.request.features.find(item => item.id === 'web')).toMatchObject({
      options: ['exa'], secrets: { apiKey: 'exa-key' },
    })
    expect(resolved.request.features.find(item => item.id === 'hmr')).toMatchObject({ options: ['default'] })
  })

  it('runs headlessly from a feature plan without reaching the terminal', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'create-headless-'))
    temporary.push(cwd)
    const features: FeatureSelection[] = [
      { id: featureId('persistence'), options: ['sqlite'], values: { region: 'us' } },
      { id: featureId('web'), options: ['exa'], secrets: { apiKey: 'exa-key' } },
    ]
    const resolved = await new CreateWizard({
      args: parseCreateArgs([
        'my-agent', '--description=demo', '--provider=deepseek-official', '--api-key=deepseek-key',
        '--model=deepseek-v4-flash', '--interface=acp', '--pm=npm', '--no-install',
      ]),
      port: new HeadlessPromptPort(),
      cwd,
      releaseVersion: '0.0.1',
      versionProbe: async () => '10.0.0',
      features,
    }).run()
    expect(resolved.install).toBe(false)
    expect(resolved.request.localPlugins).toEqual([])
    expect(resolved.request.features.find(item => item.id === 'web')).toMatchObject({
      options: ['exa'], secrets: { apiKey: 'exa-key' },
    })
    expect(resolved.request.features.find(item => item.id === 'persistence')).toMatchObject({ options: ['sqlite'] })
    expect(resolved.request.features.find(item => item.id === 'provider')).toMatchObject({
      secrets: { apiKey: 'deepseek-key' },
    })
  })

  it('rejects a non-string feature value in a headless plan', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'create-headless-bad-'))
    temporary.push(cwd)
    const features = [
      { id: featureId('persistence'), options: ['sqlite'], values: { bad: 1 } },
    ] as unknown as FeatureSelection[]
    await expect(new CreateWizard({
      args: parseCreateArgs([
        'my-agent', '--description=demo', '--provider=deepseek-official', '--api-key=k',
        '--model=m', '--interface=acp', '--pm=npm', '--no-install',
      ]),
      port: new HeadlessPromptPort(),
      cwd,
      releaseVersion: '0.0.1',
      versionProbe: async () => '10.0.0',
      features,
    }).run()).rejects.toThrow('must be a string')
  })

  it('writes the project once and refuses every existing target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-scaffold-'))
    temporary.push(root)
    const request = {
      name: 'agent',
      description: 'demo',
      runtime: { model: 'deepseek-v4-flash' },
      packageManager: new NpmPackageManager('10.0.0'),
      releaseVersion: '0.0.1',
      features: [
        { id: featureId('provider'), options: ['deepseek-official'], secrets: { apiKey: 'key' } },
        { id: featureId('bash'), options: ['local'] },
        { id: featureId('app'), options: ['embed'] },
        { id: featureId('persistence'), options: ['jsonl'] },
      ],
      localPlugins: [new LocalPluginBlueprint('plugin', 'plugin')],
    }
    const target = join(root, 'project')
    const result = await scaffoldProject(target, request)
    expect(result.changes.changedFiles).toContain('README.md')
    const index = await readFile(join(target, 'index.ts'), 'utf8')
    expect(index).toContain('SdkBootContext')
    expect(index).toContain('ctx.agents.create')
    expect(index).toContain('agentOptions: { model: "deepseek-v4-flash" }')
    expect(index).not.toContain('AgentId')
    const tsconfig = parseGeneratedTsConfig(await readFile(join(target, 'tsconfig.base.json'), 'utf8'))
    const manifest = parseGeneratedPackageManifest(await readFile(join(target, 'package.json'), 'utf8'))
    expect(tsconfig.compilerOptions.types).toEqual(['node'])
    expect(manifest.scripts).toEqual({
      dev: 'dsh-sdk dev index.ts',
      build: 'dsh-sdk build',
      typecheck: 'tsc -b',
      start: 'dsh-sdk start index.js',
      config: 'dsh-sdk config',
    })
    expect(manifest.dependencies).not.toHaveProperty('node-addon-require-builtin')
    expect(manifest.devDependencies?.['@types/node']).toBe('^22.20.0')
    expect(await readFile(join(target, 'plugins/plugin/src/index.ts'), 'utf8')).toContain('export function apply')
    const cordis = await readFile(join(target, 'cordis.yml'), 'utf8')
    expect(cordis).toMatch(/^- id:/)
    expect(cordis).not.toMatch(/^\[/)
    const occupied = join(root, 'occupied')
    await mkdir(occupied)
    await expect(scaffoldProject(occupied, request)).rejects.toThrow('already exists')
    await writeFile(join(occupied, 'keep'), 'x')
    await expect(scaffoldProject(occupied, request)).rejects.toThrow('already exists')
  })

  it('installs workflow requirements before validating the next feature', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'create-workflow-requires-'))
    temporary.push(cwd)
    const port = new ScriptedPort([
      'workflow-agent',
      [
        { value: featureId('persistence'), choices: ['jsonl'] },
        { value: featureId('workflow'), choices: [] },
      ],
      'none',
    ])
    const resolved = await new CreateWizard({
      args: parseCreateArgs([
        'workflow-agent', '--description=test', '--provider=deepseek-official', '--api-key=key',
        '--interface=embed', '--pm=npm', '--no-install',
      ]),
      port,
      cwd,
      releaseVersion: '0.0.1',
      versionProbe: async () => '10.0.0',
    }).run()
    const result = await scaffoldProject(resolved.directory, resolved.request)
    expect(result.project.cordis.entry('subagent-spawn')).toBeDefined()
    expect(result.project.cordis.entry('tool-subagent')).toBeDefined()
  })

  it('confirms an empty provider key and leaves a documented .env placeholder', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'create-empty-key-'))
    temporary.push(cwd)
    const port = new ScriptedPort([
      'empty-key-agent',
      '',
      true,
      [{ value: featureId('persistence'), choices: ['jsonl'] }],
      'none',
    ])
    const resolved = await new CreateWizard({
      args: parseCreateArgs([
        'empty-key-agent', '--description=test', '--provider=deepseek-official',
        '--interface=embed', '--pm=npm', '--no-install',
      ]),
      port,
      cwd,
      releaseVersion: '0.0.1',
      versionProbe: async () => '10.0.0',
    }).run()
    await scaffoldProject(resolved.directory, resolved.request)
    expect(await readFile(join(resolved.directory, '.env'), 'utf8')).toBe(
      '# Required before the first model request.\nDEEPSEEK_API_KEY=\n',
    )
    expect(port.requests).toContain('Keep the API key empty and fill .env later?')
  })

  it('collects custom provider inputs, retries an empty key, and accepts a recommendation', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'create-custom-inputs-'))
    temporary.push(cwd)
    const port = new ScriptedPort([
      'custom-agent',
      'test custom provider',
      'custom',
      'https://provider.example/v1',
      '', false, 'custom-key',
      'embed',
      [
        { value: featureId('persistence'), choices: ['jsonl'] },
        { value: featureId('web'), choices: ['deepseek-official'] },
      ],
      true,
      'none',
      'npm',
      false,
    ])
    const resolved = await new CreateWizard({
      args: parseCreateArgs(['custom-agent']),
      port,
      cwd,
      releaseVersion: '0.0.1',
      versionProbe: async () => '10.0.0',
      userAgent: '',
    }).run()
    expect(resolved.request.features.find(item => item.id === 'provider')).toMatchObject({
      options: ['custom'], values: { baseURL: 'https://provider.example/v1' }, secrets: { apiKey: 'custom-key' },
    })
    expect(resolved.request.features.some(item => item.id === 'timeout-policy')).toBe(true)
  })

  it('does not re-suggest an already selected feature', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'create-selected-suggestion-'))
    temporary.push(cwd)
    const port = new ScriptedPort([
      'agent',
      [
        { value: featureId('persistence'), choices: ['jsonl'] },
        { value: featureId('web'), choices: ['deepseek-official'] },
        { value: featureId('timeout-policy'), choices: ['default'] },
      ],
      'none',
    ])
    const resolved = await new CreateWizard({
      args: parseCreateArgs([
        'agent', '--description=test', '--provider=deepseek-official', '--api-key=key',
        '--interface=embed', '--pm=npm', '--no-install',
      ]),
      port,
      cwd,
      releaseVersion: '0.0.1',
      versionProbe: async () => '10.0.0',
    }).run()
    expect(resolved.request.features.filter(item => item.id === 'timeout-policy')).toHaveLength(1)
  })

  it('uses process defaults when constructor infrastructure is omitted', async () => {
    const name = `default-infra-${String(process.pid)}`
    const port = new ScriptedPort([
      name, [{ value: featureId('persistence'), choices: ['jsonl'] }], 'none',
    ])
    const resolved = await new CreateWizard({
      args: parseCreateArgs([
        name, '--description=test', '--provider=deepseek-official', '--api-key=key',
        '--interface=embed', '--pm=npm', '--no-install',
      ]),
      port,
      releaseVersion: '0.0.1',
    }).run()
    expect(resolved.request.packageManager.name).toBe('npm')
  })

  it('reads the release batch from the initializer package', async () => {
    await expect(readCreateSdkVersion()).resolves.toBe('0.0.1')
  })
})

describe('create command composition', () => {
  const argv = (directory: string, install: boolean): string[] => [
    directory, '--description=test', '--provider=deepseek-official', '--api-key=key',
    '--interface=embed', '--pm=npm', install ? '--install' : '--no-install',
  ]

  it('prints help before requiring a TTY and rejects non-interactive creation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-command-help-'))
    temporary.push(root)
    const context = commandContext(root)
    context.stdin.isTTY = false
    context.stdout.isTTY = false
    await expect(createProject(['--help'], context)).resolves.toBeUndefined()
    expect(context.readStdout()).toContain('Usage: create-sdk')
    expect(context.readStdout()).toContain('--config-json <json>')
    expect(context.readStdout()).not.toContain('--link-workspace')
    await expect(createProject(argv('agent', false), context)).rejects.toThrow('interactive TTY')
    context.stdin.isTTY = true
    await expect(createProject(argv('agent', false), context)).rejects.toThrow('interactive TTY')
  })

  it('creates headlessly from --config-json with no TTY', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-headless-cmd-'))
    temporary.push(root)
    const spec = JSON.stringify({
      directory: 'agent', description: 'test', provider: 'deepseek-official', apiKey: 'key',
      model: 'deepseek-v4-flash', interface: 'embed', pm: 'npm', install: false,
      features: [{ id: 'persistence', options: ['jsonl'] }],
    })
    const context = commandContext(root)
    context.stdin.isTTY = false
    context.stdout.isTTY = false
    const result = await createProject(['--config-json', spec], context)
    expect(result?.project.root).toBe(join(root, 'agent'))
  })

  it('emits NDJSON lifecycle events under --json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-headless-json-'))
    temporary.push(root)
    const base = {
      description: 'test', model: 'deepseek-v4-flash', interface: 'embed', pm: 'npm', install: false,
    }
    const ok = commandContext(root)
    ok.stdin.isTTY = false
    ok.stdout.isTTY = false
    const okSpec = JSON.stringify({ ...base, directory: 'done-agent', provider: 'deepseek-official', apiKey: 'key', features: [] })
    await expect(runCreateCommand(['--config-json', okSpec, '--json'], ok)).resolves.toBe(0)
    expect(ok.readStdout()).toContain('{"type":"done"}')
    // stdout stays pure NDJSON: every line parses, human progress goes to stderr
    for (const line of ok.readStdout().split('\n').filter(line => line.length > 0)) {
      expect(() => { JSON.parse(line) }).not.toThrow()
    }
    expect(ok.readStderr()).toContain('Created done-agent')
    expect(ok.readStderr()).toContain('Next: cd')

    const missing = commandContext(root)
    missing.stdin.isTTY = false
    missing.stdout.isTTY = false
    const missingSpec = JSON.stringify({ ...base, directory: 'miss-agent', provider: 'custom', baseURL: 'https://x', features: [] })
    await expect(runCreateCommand(['--config-json', missingSpec, '--json'], missing)).resolves.toBe(1)
    expect(missing.readStdout()).toContain('"type":"action-required"')

    const broken = commandContext(root)
    broken.stdin.isTTY = false
    broken.stdout.isTTY = false
    await expect(runCreateCommand(['--config-json', '{bad', '--json'], broken)).resolves.toBe(1)
    expect(broken.readStdout()).toContain('"type":"error"')

    const cancelled = commandContext(root, new ScriptedPort([ScriptedPort.cancel]))
    await expect(runCreateCommand(['--json', ...argv('cancel-agent', false)], cancelled)).resolves.toBe(1)
    expect(cancelled.readStdout()).toContain('"reason":"cancelled"')
  })

  it('creates through an injected prompt port and delegates optional setup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-command-success-'))
    temporary.push(root)
    const port = new ScriptedPort([
      'agent', [{ value: featureId('persistence'), choices: ['jsonl'] }], 'none',
    ])
    let setupDirectory = ''
    const context = commandContext(root, port, async (request) => { setupDirectory = request.directory })
    const result = await createProject(argv('agent', true), context)
    expect(result?.project.root).toBe(join(root, 'agent'))
    expect(setupDirectory).toBe(join(root, 'agent'))
    expect(context.readStdout()).toContain('Created agent')
    expect(context.readStdout()).toContain('Next: cd')
    const noInstall = commandContext(root, new ScriptedPort([
      'next', [{ value: featureId('persistence'), choices: ['jsonl'] }], 'none',
    ]))
    await expect(createProject(argv('next', false), noInstall)).resolves.toBeDefined()
    expect(noInstall.readStdout()).toContain('npm install && npm run build && npm start')
  })

  it('uses the package manager setup path when no setup override is supplied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-command-default-setup-'))
    temporary.push(root)
    const port = new ScriptedPort([
      'agent', [{ value: featureId('persistence'), choices: ['jsonl'] }], 'none',
    ])
    const install = vi.spyOn(NpmPackageManager.prototype, 'install').mockResolvedValue()
    const build = vi.spyOn(NpmPackageManager.prototype, 'build').mockResolvedValue()
    const context = commandContext(root, port)
    delete context.releaseVersion
    delete context.versionProbe
    await createProject(argv('agent', true), context)
    expect(install).toHaveBeenCalledOnce()
    expect(build).toHaveBeenCalledOnce()
    const spec = JSON.stringify({
      directory: 'json-agent', description: 'test', provider: 'deepseek-official', apiKey: 'key',
      model: 'deepseek-v4-flash', interface: 'embed', pm: 'npm', install: true, features: [],
    })
    const json = commandContext(root)
    json.stdin.isTTY = false
    json.stdout.isTTY = false
    await createProject(['--config-json', spec, '--json'], json)
    // json mode hands install/build a runner that redirects child output to stderr
    expect(install).toHaveBeenCalledTimes(2)
    expect(install.mock.calls[1]?.[1]).toBeInstanceOf(NodeCommandRunner)
    install.mockRestore()
    build.mockRestore()
  })

  it('reports setup failures after preserving generated files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-command-failure-'))
    temporary.push(root)
    const port = new ScriptedPort([
      'agent', [{ value: featureId('persistence'), choices: ['jsonl'] }], 'none',
    ])
    const context = commandContext(root, port, async () => { throw new Error('offline') })
    await expect(createProject(argv('agent', true), context)).rejects.toThrow('offline')
    expect(context.readStderr()).toContain('Project files are ready, but setup failed')
    expect(context.readStderr()).toContain('npm install && npm run build')
    const stringFailure = commandContext(root, new ScriptedPort([
      'next', [{ value: featureId('persistence'), choices: ['jsonl'] }], 'none',
    ]), async () => { throw 'offline-string' })
    await expect(runCreateCommand(argv('next', true), stringFailure)).resolves.toBe(1)
    expect(stringFailure.readStderr()).toContain('offline-string')
  })

  it('maps cancellation and ordinary errors to command exit codes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-command-exit-'))
    temporary.push(root)
    const cancelled = commandContext(root, new ScriptedPort([ScriptedPort.cancel]))
    await expect(runCreateCommand([], cancelled)).resolves.toBe(1)
    expect(cancelled.readStderr()).toContain('cancelled')
    const invalid = commandContext(root)
    await expect(runCreateCommand(['--unknown'], invalid)).resolves.toBe(1)
    expect(invalid.readStderr()).toContain('unknown option')
    const help = commandContext(root)
    await expect(runCreateCommand(['--help'], help)).resolves.toBe(0)
  })
})

describe('resolveHeadless', () => {
  it('returns undefined without a config source', async () => {
    expect(await resolveHeadless(parseCreateArgs(['agent']))).toBeUndefined()
  })

  it('maps every inline --config-json field into args plus the feature plan', async () => {
    const spec = JSON.stringify({
      directory: 'a', description: 'd', provider: 'custom', baseURL: 'https://x', apiKey: 'k',
      model: 'm', interface: 'acp', pm: 'pnpm', install: true, linkWorkspace: true,
      features: [{ id: 'todo', options: ['default'] }],
    })
    const resolved = await resolveHeadless(parseCreateArgs(['--config-json', spec]))
    expect(resolved?.args).toMatchObject({
      directory: 'a', description: 'd', provider: 'custom', baseURL: 'https://x', apiKey: 'k',
      model: 'm', runInterface: 'acp', packageManager: 'pnpm', install: true, linkWorkspace: true, help: false,
    })
    expect(resolved?.features).toEqual([{ id: 'todo', options: ['default'] }])
  })

  it('reads --config from a file via the injected reader and omits absent fields', async () => {
    const resolved = await resolveHeadless(
      parseCreateArgs(['--config', '/spec.json']),
      async () => JSON.stringify({ description: 'from-file' }),
    )
    expect(resolved?.args.description).toBe('from-file')
    expect(resolved?.args.directory).toBeUndefined()
    expect(resolved?.args.linkWorkspace).toBeUndefined()
    expect(resolved?.features).toBeUndefined()
  })

  it('reads --config from disk with the default reader', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'create-headless-file-'))
    temporary.push(dir)
    const file = join(dir, 'spec.json')
    await writeFile(file, JSON.stringify({ description: 'on-disk' }))
    const resolved = await resolveHeadless(parseCreateArgs(['--config', file]))
    expect(resolved?.args.description).toBe('on-disk')
  })

  it('fails loud on invalid JSON, a non-object root, or a non-array features field', async () => {
    await expect(resolveHeadless(parseCreateArgs(['--config-json', '{bad']))).rejects.toThrow('invalid JSON')
    await expect(resolveHeadless(parseCreateArgs(['--config-json', '[]']))).rejects.toThrow('expected a JSON object')
    await expect(resolveHeadless(parseCreateArgs(['--config-json', 'null']))).rejects.toThrow('expected a JSON object')
    await expect(resolveHeadless(parseCreateArgs(['--config-json', '5']))).rejects.toThrow('expected a JSON object')
    await expect(resolveHeadless(parseCreateArgs(['--config-json', '{"features":1}']))).rejects.toThrow('must be an array')
  })

  it('accepts a minimal spec, leaving unspecified answers undefined', async () => {
    const resolved = await resolveHeadless(parseCreateArgs(['--config-json', '{"directory":"x"}']))
    expect(resolved?.args.directory).toBe('x')
    expect(resolved?.args.description).toBeUndefined()
    expect(resolved?.features).toBeUndefined()
  })
})
