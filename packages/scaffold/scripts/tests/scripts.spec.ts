import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  HeadlessPromptPort,
  LocalPluginBlueprint,
  NpmPackageManager,
  SdkProject,
  featureId,
  createBuiltinRegistry,
  type CommandRunner,
  type NestedMultiSelectValue,
  type ProjectCreationRequest,
  type PromptPort,
} from '@huiliyi37/dsh-helper'
import type {
  ConfirmPromptRequest,
  MultiSelectPromptRequest,
  NestedMultiSelectRequest,
  PromptOutcome,
  SecretPromptRequest,
  SelectPromptRequest,
  TextPromptRequest,
} from '../../helper/src/questions/prompt-port.ts'
import { runSDK, startSDK } from '@huiliyi37/dsh-scripts'
import { parseDshSdkArgs, parseSdkBootArgs } from '../src/args.ts'
import { PluginBuild, ProjectBuild, runProjectBuild } from '../src/build.ts'
import { runDshSdkCommand, type DshSdkCommandContext } from '../src/command.ts'
import { runConfigCommand } from '../src/config.ts'
import { ConfigWorkflow, type ConfigPlan } from '../src/config/config-workflow.ts'
import { runCreatePluginCommand } from '../src/create-plugin.ts'
import { reportCommandTelemetry, type CommandTelemetryEvent } from '../src/telemetry.ts'
import { initialize, resolve as resolveLocalPlugin } from '../src/local-plugin-loader-hooks.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

class QueuePort implements PromptPort {
  readonly #answers: unknown[]
  constructor(answers: unknown[]) { this.#answers = [...answers] }
  next<T>(): Promise<PromptOutcome<T>> {
    return Promise.resolve({ status: 'answered', value: this.#answers.shift() as T })
  }
  text(_request: TextPromptRequest): Promise<PromptOutcome<string>> { return this.next() }
  secret(_request: SecretPromptRequest): Promise<PromptOutcome<string>> { return this.next() }
  select<T>(_request: SelectPromptRequest<T>): Promise<PromptOutcome<T>> { return this.next() }
  multiselect<T>(_request: MultiSelectPromptRequest<T>): Promise<PromptOutcome<readonly T[]>> { return this.next() }
  confirm(_request: ConfirmPromptRequest): Promise<PromptOutcome<boolean>> { return this.next() }
  nestedMultiselect<TValue, TChoice>(
    _request: NestedMultiSelectRequest<TValue, TChoice>,
  ): Promise<PromptOutcome<readonly NestedMultiSelectValue<TValue, TChoice>[]>> { return this.next() }
}

function outputBuffer(): { stream: Writable; read: () => string } {
  let text = ''
  return {
    stream: new Writable({ write(chunk, _encoding, callback) { text += String(chunk); callback() } }),
    read: () => text,
  }
}

function commandContext(cwd: string): DshSdkCommandContext & { readStdout: () => string; readStderr: () => string } {
  let stdout = ''
  let stderr = ''
  const stdin = Object.assign(new PassThrough(), { isTTY: true }) as unknown as NodeJS.ReadStream
  const output = Object.assign(new Writable({
    write(chunk, _encoding, callback) { stdout += String(chunk); callback() },
  }), { isTTY: true }) as unknown as NodeJS.WriteStream
  const error = new Writable({
    write(chunk, _encoding, callback) { stderr += String(chunk); callback() },
  }) as unknown as NodeJS.WriteStream
  return {
    cwd, stdin, stdout: output, stderr: error,
    readStdout: () => stdout,
    readStderr: () => stderr,
  }
}

function creation(
  extra: ProjectCreationRequest['features'] = [],
  localPlugins: readonly LocalPluginBlueprint[] = [],
  app: 'acp' | 'embed' = 'embed',
): ProjectCreationRequest {
  return {
    name: 'config-agent',
    description: 'config test',
    runtime: { model: 'deepseek-v4-flash' },
    packageManager: new NpmPackageManager('10.0.0'),
    releaseVersion: '0.0.1',
    features: [
      { id: featureId('provider'), options: ['deepseek-official'], secrets: { apiKey: 'key' } },
      { id: featureId('bash'), options: ['local'] },
      { id: featureId('app'), options: [app] },
      { id: featureId('persistence'), options: ['jsonl'] },
      ...extra,
    ],
    localPlugins,
  }
}

async function committedProject(
  extra: ProjectCreationRequest['features'] = [],
  localPlugins: readonly LocalPluginBlueprint[] = [],
  app: 'acp' | 'embed' = 'embed',
): Promise<SdkProject> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-config-workflow-'))
  temporary.push(root)
  const request = creation(extra, localPlugins, app)
  const project = SdkProject.create(root, request)
  const registry = createBuiltinRegistry(project.profile)
  const edit = project.edit(registry)
  for (const item of request.features) edit.installFeature(registry.get(item.id), item)
  for (const plugin of localPlugins) edit.addPlugin(plugin)
  return (await edit.commit()).project
}

describe('Commander launcher arguments', () => {
  it('parses real subcommands and forwards arbitrary build options', () => {
    expect(parseDshSdkArgs([])).toMatchObject({ help: true })
    expect(parseDshSdkArgs(['start', 'index.js'])).toMatchObject({ command: 'start', target: 'index.js' })
    expect(parseDshSdkArgs(['dev'])).toEqual({ command: 'dev', forwarded: [], help: false })
    expect(parseDshSdkArgs(['build', '--watch', '--minify'])).toMatchObject({
      command: 'build', forwarded: ['--watch', '--minify'],
    })
    expect(parseDshSdkArgs(['start', 'index.js', '--', '--resume', 'session-1'])).toMatchObject({
      command: 'start', target: 'index.js', forwarded: ['--resume', 'session-1'],
    })
    expect(parseDshSdkArgs(['config'])).toMatchObject({ command: 'config' })
    expect(parseDshSdkArgs(['start'])).toEqual({ command: 'start', forwarded: [], help: false })
    expect(parseDshSdkArgs(['dev', 'index.ts'])).toMatchObject({ command: 'dev', target: 'index.ts' })
    expect(parseDshSdkArgs(['-h'])).toMatchObject({ help: true })
    expect(parseDshSdkArgs(['--help'])).toMatchObject({ help: true })
    expect(() => parseDshSdkArgs(['unknown'])).toThrow()
    expect(() => parseDshSdkArgs(['config', 'extra'])).toThrow()
    expect(() => parseDshSdkArgs(['config', '--', 'extra'])).toThrow('does not accept forwarded')
    expect(parseSdkBootArgs([
      '--model=mock', '--resume=session-1', '--custom=value', '--verbose', '--no-cache', '--max-depth=-1',
    ])).toEqual({
      model: 'mock', resume: 'session-1', custom: 'value', verbose: true, cache: false, 'max-depth': '-1',
    })
  })

  it('dispatches every command and maps failures to exit codes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-command-'))
    temporary.push(root)
    const context = commandContext(root)
    const calls: unknown[] = []
    context.run = async (target, options) => { calls.push(['run', target, options]); return undefined }
    context.build = async (args, cwd) => { calls.push(['build', args, cwd]) }
    context.config = async () => { calls.push(['config']); return {} }
    await expect(runDshSdkCommand(['start', 'index.js', '--', '--resume', 'session-1'], context)).resolves.toBe(0)
    await expect(runDshSdkCommand(['dev', 'index.ts'], context)).resolves.toBe(0)
    await expect(runDshSdkCommand(['build', '--watch'], context)).resolves.toBe(0)
    await expect(runDshSdkCommand(['config'], context)).resolves.toBe(0)
    expect(calls).toHaveLength(4)
    expect(calls[0]).toEqual(['run', 'index.js', { cwd: root, argv: ['--resume', 'session-1'] }])
    expect(calls[1]).toEqual(['run', 'index.ts', { cwd: root, dev: true, argv: [] }])
    context.config = async () => ({ installError: new Error('offline') })
    await expect(runDshSdkCommand(['config'], context)).resolves.toBe(1)
    context.config = async () => { throw 'broken' }
    await expect(runDshSdkCommand(['config'], context)).resolves.toBe(1)
    expect(context.readStderr()).toContain('broken')
    await expect(runDshSdkCommand(['unknown'], context)).resolves.toBe(1)
    await expect(runDshSdkCommand([], context)).resolves.toBe(0)
    expect(context.readStdout()).toContain('Usage: dsh-sdk')
    expect(context.readStdout()).toContain('create <source>')

    const defaults = commandContext(root)
    await writeFile(join(root, 'main.mjs'), 'export function main() { return "ok" }\n')
    await expect(runDshSdkCommand(['start', 'main.mjs'], defaults)).resolves.toBe(0)
    await expect(runDshSdkCommand(['build'], defaults)).resolves.toBe(0)
    defaults.port = new QueuePort([[]])
    await expect(runDshSdkCommand(['config'], defaults)).resolves.toBe(1)
  })
})

describe('build profiles and invocation', () => {
  it('discovers root and plugin targets and creates independent profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-build-profile-'))
    temporary.push(root)
    await mkdir(join(root, 'plugins', 'one', 'src'), { recursive: true })
    await writeFile(join(root, 'index.ts'), 'export {}\n')
    await writeFile(join(root, 'plugins', 'one', 'package.json'), '{"name":"one"}\n')
    await writeFile(join(root, 'plugins', 'one', 'src', 'index.ts'), 'export {}\n')
    expect(ProjectBuild({ cwd: root, entry: ['index.ts'] })).toEqual([
      { cwd: root, entry: ['index.ts'] },
      { workspace: { include: ['plugins/*'] } },
    ])
    expect(PluginBuild({ entry: ['src/index.ts'], dts: true })).toEqual({ entry: ['src/index.ts'], dts: true })
    expect(() => ProjectBuild({ workspace: true })).toThrow('owns workspace discovery')
    expect(() => PluginBuild({ workspace: true })).toThrow('does not accept nested workspace')
    expect(ProjectBuild({ cwd: join(root, 'empty'), entry: ['index.ts'] })).toEqual([
      { cwd: join(root, 'empty'), entry: ['index.ts'] },
    ])
    expect(ProjectBuild({ entry: ['index.ts'] })[0]).toMatchObject({ entry: ['index.ts'] })
  })

  it('runs the project-installed tsdown and reports child failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-build-run-'))
    temporary.push(root)
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
    await writeFile(join(root, 'index.ts'), 'export {}\n')
    await writeFile(join(root, 'tsdown.config.ts'), 'export default {}\n')
    await mkdir(join(root, 'node_modules'), { recursive: true })
    const manifest = fileURLToPath(import.meta.resolve('tsdown/package.json'))
    await symlink(dirname(manifest), join(root, 'node_modules', 'tsdown'))
    const calls: string[][] = []
    const runner: CommandRunner = {
      run: async (command, args) => {
        calls.push([command, ...args])
        return { exitCode: 0, signal: null }
      },
    }
    await runProjectBuild(['--watch'], root, runner)
    expect(calls[0]?.[0]).toBe(process.execPath)
    expect(calls[0]?.at(-1)).toBe('--watch')
    const failed: CommandRunner = { run: async () => ({ exitCode: 2, signal: null }) }
    await expect(runProjectBuild([], root, failed)).rejects.toThrow('exited with code 2')
    const killed: CommandRunner = { run: async () => ({ exitCode: null, signal: 'SIGTERM' }) }
    await expect(runProjectBuild([], root, killed)).rejects.toThrow('killed by SIGTERM')
  })

  it('recognizes every tsdown config source', async () => {
    const manifest = fileURLToPath(import.meta.resolve('tsdown/package.json'))
    for (const extension of ['cts', 'cjs', 'json']) {
      const root = await mkdtemp(join(tmpdir(), `dsh-build-${extension}-`))
      temporary.push(root)
      await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
      await writeFile(join(root, `tsdown.config.${extension}`), '{}\n')
      await mkdir(join(root, 'node_modules'), { recursive: true })
      await symlink(dirname(manifest), join(root, 'node_modules', 'tsdown'))
      let called = false
      await runProjectBuild([], root, {
        run: async () => { called = true; return { exitCode: 0, signal: null } },
      })
      expect(called).toBe(true)
    }
    const root = await mkdtemp(join(tmpdir(), 'dsh-build-package-json-'))
    temporary.push(root)
    await writeFile(join(root, 'package.json'), '{"type":"module","tsdown":{}}\n')
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await symlink(dirname(manifest), join(root, 'node_modules', 'tsdown'))
    let called = false
    await runProjectBuild([], root, {
      run: async () => { called = true; return { exitCode: 0, signal: null } },
    })
    expect(called).toBe(true)
  })

  it('reports missing and malformed project tsdown executables', async () => {
    const missing = await mkdtemp(join(tmpdir(), 'dsh-build-missing-'))
    temporary.push(missing)
    await writeFile(join(missing, 'package.json'), '{"type":"module"}')
    await writeFile(join(missing, 'tsdown.config.ts'), 'export default {}\n')
    await expect(runProjectBuild([], missing)).rejects.toThrow('requires tsdown')
    const malformed = await mkdtemp(join(tmpdir(), 'dsh-build-malformed-'))
    temporary.push(malformed)
    await writeFile(join(malformed, 'package.json'), '{"type":"module"}')
    await writeFile(join(malformed, 'tsdown.config.ts'), 'export default {}\n')
    await mkdir(join(malformed, 'node_modules', 'tsdown'), { recursive: true })
    await writeFile(join(malformed, 'node_modules', 'tsdown', 'package.json'), JSON.stringify({
      name: 'tsdown', version: '0.0.0', exports: { './package.json': './package.json' }, bin: {},
    }))
    await expect(runProjectBuild([], malformed)).rejects.toThrow('has no executable')
    await writeFile(join(malformed, 'node_modules', 'tsdown', 'package.json'), JSON.stringify({
      name: 'tsdown', version: '0.0.0', exports: { './package.json': './package.json' },
    }))
    await expect(runProjectBuild([], malformed)).rejects.toThrow('has no executable')
    const stringBin = await mkdtemp(join(tmpdir(), 'dsh-build-string-bin-'))
    temporary.push(stringBin)
    await writeFile(join(stringBin, 'package.json'), '{"type":"module"}')
    await writeFile(join(stringBin, 'tsdown.config.js'), 'export default {}\n')
    await mkdir(join(stringBin, 'node_modules', 'tsdown'), { recursive: true })
    await writeFile(join(stringBin, 'node_modules', 'tsdown', 'package.json'), JSON.stringify({
      name: 'tsdown', version: '0.0.0', exports: { './package.json': './package.json' }, bin: 'cli.js',
    }))
    await writeFile(join(stringBin, 'node_modules', 'tsdown', 'cli.js'), '')
    let command = ''
    await runProjectBuild([], stringBin, {
      run: async (_node, args) => { command = args[0] ?? ''; return { exitCode: 0, signal: null } },
    })
    expect(command).toContain('cli.js')
  })

  it('returns a no-op for a project with no build targets and hints on a missing start target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-no-build-'))
    temporary.push(root)
    let called = false
    await runProjectBuild([], root, { run: async () => { called = true; return { exitCode: 0, signal: null } } })
    expect(called).toBe(false)
    const unreadableManifest = await mkdtemp(join(tmpdir(), 'dsh-build-unreadable-manifest-'))
    temporary.push(unreadableManifest)
    await mkdir(join(unreadableManifest, 'package.json'))
    await expect(runProjectBuild([], unreadableManifest)).rejects.toThrow()
    await expect(runSDK('index.js', { cwd: root })).rejects.toThrow('Run dsh-sdk build first')
  })

  it('invokes the target module main export and rejects passive modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-module-main-'))
    temporary.push(root)
    await writeFile(join(root, 'main.mjs'), 'export function main(context) { return context }\n')
    await writeFile(join(root, 'passive.mjs'), 'export const value = 1\n')
    await expect(runSDK('main.mjs', {
      cwd: root,
      argv: ['--model=mock', '--resume=session-1', 'custom'],
    })).resolves.toEqual({
      argv: ['--model=mock', '--resume=session-1', 'custom'],
      args: { model: 'mock', resume: 'session-1' }, cwd: root, mode: 'start',
    })
    await expect(runSDK('passive.mjs', { cwd: root })).rejects.toThrow('must export function main()')
  })

  it('boots empty Cordis configs and delegates targetless runs', async () => {
    expectTypeOf(runSDK).toBeCallableWith()
    const root = await mkdtemp(join(tmpdir(), 'dsh-start-sdk-'))
    temporary.push(root)
    await writeFile(join(root, 'cordis.yml'), '[]\n')
    const byUrl = await startSDK(pathToFileURL(join(root, 'cordis.yml')))
    await byUrl.fiber.dispose()
    const byRun: import('@huiliyi37/cordis').Context = await runSDK(undefined, { cwd: root }) as import('@huiliyi37/cordis').Context
    await byRun.fiber.dispose()
    const dev = await startSDK('./cordis.yml', { cwd: root, dev: true })
    await dev.fiber.dispose()
    await expect(startSDK(new URL('https://example.invalid/cordis.yml'), { cwd: root })).rejects.toThrow()
  })

  it('validates local plugin metadata in dev mode', async () => {
    const malformed = await mkdtemp(join(tmpdir(), 'dsh-dev-malformed-'))
    temporary.push(malformed)
    await mkdir(join(malformed, 'plugins', 'bad'), { recursive: true })
    await expect(runSDK('missing.ts', { cwd: malformed, dev: true })).rejects.toThrow('cannot load local plugin metadata')
    const absent = await mkdtemp(join(tmpdir(), 'dsh-dev-absent-'))
    temporary.push(absent)
    await expect(runSDK('missing.ts', { cwd: absent, dev: true })).rejects.toThrow('cannot start missing target')

    const unnamed = await mkdtemp(join(tmpdir(), 'dsh-dev-unnamed-'))
    temporary.push(unnamed)
    await mkdir(join(unnamed, 'plugins', 'bad', 'src'), { recursive: true })
    await writeFile(join(unnamed, 'plugins', 'bad', 'package.json'), '{}')
    await writeFile(join(unnamed, 'plugins', 'bad', 'src/index.ts'), 'export {}\n')
    await expect(runSDK('missing.ts', { cwd: unnamed, dev: true })).rejects.toThrow('has no name')

    const duplicate = await mkdtemp(join(tmpdir(), 'dsh-dev-duplicate-'))
    temporary.push(duplicate)
    for (const name of ['one', 'two']) {
      await mkdir(join(duplicate, 'plugins', name, 'src'), { recursive: true })
      await writeFile(join(duplicate, 'plugins', name, 'package.json'), '{"name":"same"}')
      await writeFile(join(duplicate, 'plugins', name, 'src/index.ts'), 'export {}\n')
    }
    await expect(runSDK('missing.ts', { cwd: duplicate, dev: true })).rejects.toThrow('duplicate local plugin')

    const valid = await mkdtemp(join(tmpdir(), 'dsh-dev-valid-'))
    temporary.push(valid)
    await mkdir(join(valid, 'plugins', 'one', 'src'), { recursive: true })
    await writeFile(join(valid, 'plugins', 'README.md'), 'skip\n')
    await writeFile(join(valid, 'plugins', 'one', 'package.json'), '{"name":"local"}')
    await writeFile(join(valid, 'plugins', 'one', 'src/index.ts'), 'export {}\n')
    await writeFile(join(valid, 'main.ts'), 'export function main() { return "dev" }\n')
    await expect(runSDK('main.ts', { cwd: valid, dev: true })).resolves.toBe('dev')
    await expect(runSDK('missing.ts', { cwd: valid, dev: true })).rejects.toThrow('cannot start missing target')
  })

  it('maps only exact local package names through the loader hook', async () => {
    initialize({ mappings: { local: 'file:///tmp/local.ts' } })
    const next = async (specifier: string) => ({ url: specifier, format: 'module' as const })
    const context: import('node:module').ResolveHookContext = {
      conditions: [], importAttributes: {}, parentURL: undefined,
    }
    await expect(resolveLocalPlugin('local', context, next)).resolves.toMatchObject({ url: 'file:///tmp/local.ts' })
    await expect(resolveLocalPlugin('other', context, next)).resolves.toMatchObject({ url: 'other' })
  })
})

describe('ConfigWorkflow', () => {
  it('opens a project through the config command prompt seam', async () => {
    const project = await committedProject()
    const context = commandContext(project.root)
    context.port = new QueuePort([[]])
    context.install = async () => { throw new Error('install should not run') }
    await expect(runConfigCommand(context)).resolves.toEqual({})
    delete context.port
    delete context.install
    context.stdin.isTTY = false
    await expect(runConfigCommand(context)).rejects.toThrow('interactive TTY')
    context.stdin.isTTY = true
    context.stdout.isTTY = false
    await expect(runConfigCommand(context)).rejects.toThrow('interactive TTY')
  })
  it('accumulates a disable and commits only after Review & Apply', async () => {
    const project = await committedProject([{ id: featureId('todo'), options: ['default'] }])
    const registry = createBuiltinRegistry(project.profile)
    const output = outputBuffer()
    const workflow = new ConfigWorkflow(new QueuePort([
      [], true,
    ]), output.stream, async () => { throw new Error('install should not run') })
    const result = await workflow.run(project, registry)
    expect(result.commit?.project.cordis.entry('tool-todo')?.disabled).toBe(true)
    expect(output.read()).toContain('Disable feature: todo')
  })

  it('reconciles a headless plan without prompting and preserves custom plugins', async () => {
    const project = await committedProject([], [new LocalPluginBlueprint('plugin', 'plugin')])
    const registry = createBuiltinRegistry(project.profile)
    const output = outputBuffer()
    let installs = 0
    const plan: ConfigPlan = {
      features: [
        { id: featureId('bash'), options: ['local'] },
        { id: featureId('persistence'), options: ['jsonl'] },
        { id: featureId('todo'), options: ['default'] },
        { id: featureId('web'), options: ['exa'], secrets: { apiKey: 'exa-key' } },
      ],
    }
    const result = await new ConfigWorkflow(
      new HeadlessPromptPort(), output.stream, async () => { installs += 1 },
    ).run(project, registry, plan)
    expect(result.commit?.project.cordis.entry('tool-todo')).toBeDefined()
    // the unlisted custom local plugin keeps its enabled state (not nuked by the plan)
    expect(result.commit?.project.cordis.entry('plugin')?.disabled).toBeFalsy()
    expect(installs).toBe(1)
  })

  it('installs once after NPM dependency changes and keeps committed files on install failure', async () => {
    const project = await committedProject()
    const registry = createBuiltinRegistry(project.profile)
    const output = outputBuffer()
    let installs = 0
    const workflow = new ConfigWorkflow(new QueuePort([
      [{ value: 'feature:todo', choices: [] }], true,
    ]), output.stream, async () => {
      installs += 1
      throw new Error('offline')
    })
    const result = await workflow.run(project, registry)
    expect(installs).toBe(1)
    expect(result.installError?.message).toBe('offline')
    expect(result.commit?.project.cordis.entry('tool-todo')).toBeDefined()
    expect(output.read()).toContain('Changes were committed, but install failed')
  })

  it('cancels apply and enables a disabled feature without reinstalling', async () => {
    const project = await committedProject([{ id: featureId('todo'), options: ['default'] }])
    const registry = createBuiltinRegistry(project.profile)
    const cancelled = await new ConfigWorkflow(new QueuePort([[], false]), outputBuffer().stream).run(project, registry)
    expect(cancelled).toEqual({})
    const disable = project.edit(registry)
    disable.disableFeature(registry.get(featureId('todo')))
    const disabled = (await disable.commit()).project
    let installs = 0
    const enabled = await new ConfigWorkflow(new QueuePort([
      [{ value: 'feature:todo', choices: [] }], true,
    ]), outputBuffer().stream, async () => { installs += 1 }).run(disabled, createBuiltinRegistry(disabled.profile))
    expect(enabled.commit?.project.cordis.entry('tool-todo')?.disabled).toBeUndefined()
    expect(installs).toBe(0)
  })

  it('toggles custom Cordis config entries without changing NPM dependencies', async () => {
    const project = await committedProject([], [new LocalPluginBlueprint('sample', 'plugin')])
    await expect(new ConfigWorkflow(new QueuePort([
      [{ value: 'plugin:sample', choices: [] }],
    ]), outputBuffer().stream).run(project, createBuiltinRegistry(project.profile))).resolves.toEqual({})
    const output = outputBuffer()
    const disabled = await new ConfigWorkflow(new QueuePort([[], true]), output.stream).run(
      project, createBuiltinRegistry(project.profile),
    )
    expect(disabled.commit?.project.cordis.entry('sample')?.disabled).toBe(true)
    expect(output.read()).toContain('Disable custom plugin: sample')
    const next = disabled.commit?.project
    if (!next) throw new Error('custom toggle did not commit')
    const enabled = await new ConfigWorkflow(new QueuePort([
      [{ value: 'plugin:sample', choices: [] }], true,
    ]), outputBuffer().stream).run(next, createBuiltinRegistry(next.profile))
    expect(enabled.commit?.project.cordis.entry('sample')?.disabled).toBeUndefined()
  })

  it('shows inconsistent features as diagnostic-only rows', async () => {
    const complete = await committedProject()
    await writeFile(join(complete.root, 'cordis.yml'), `${await readFile(join(complete.root, 'cordis.yml'), 'utf8')}- id: web-search-exa
  name: '@huiliyi37/dsh-web-search-exa'
`)
    const project = await SdkProject.open(complete.root)
    const port = new QueuePort([[]])
    await expect(new ConfigWorkflow(port, outputBuffer().stream).run(project, createBuiltinRegistry(project.profile)))
      .resolves.toEqual({})
  })

  it('uses the default installer and normalizes non-Error install failures', async () => {
    const project = await committedProject()
    const install = vi.spyOn(NpmPackageManager.prototype, 'install').mockResolvedValue()
    await new ConfigWorkflow(new QueuePort([
      [{ value: 'feature:todo', choices: [] }], true,
    ])).run(project, createBuiltinRegistry(project.profile))
    expect(install).toHaveBeenCalledOnce()
    install.mockRestore()
    const next = await committedProject()
    const failed = await new ConfigWorkflow(new QueuePort([
      [{ value: 'feature:todo', choices: [] }], true,
    ]), outputBuffer().stream, async () => { throw 'offline-string' }).run(next, createBuiltinRegistry(next.profile))
    expect(failed.installError?.message).toBe('offline-string')
  })

  it('reconciles a child option selected in the feature tree', async () => {
    const project = await committedProject()
    const registry = createBuiltinRegistry(project.profile)
    let installs = 0
    const workflow = new ConfigWorkflow(new QueuePort([
      [{ value: 'feature:persistence', choices: ['sqlite'] }], true,
    ]), outputBuffer().stream, async () => { installs += 1 })
    const result = await workflow.run(project, registry)
    expect(result.commit?.project.cordis.entry('session-persistence')).toMatchObject({
      name: '@huiliyi37/dsh-session-persistence-sqlite',
      config: { path: './.sessions/sessions.sqlite' },
    })
    expect(installs).toBe(1)
  })

  it('switches required provider and interface options', async () => {
    const project = await committedProject()
    const registry = createBuiltinRegistry(project.profile)
    const workflow = new ConfigWorkflow(new QueuePort([
      [
        { value: 'feature:provider', choices: ['custom'] },
        { value: 'feature:app', choices: ['acp'] },
        { value: 'feature:persistence', choices: ['jsonl'] },
      ],
      'https://provider.example/v1',
      'custom-key',
      true,
    ]), outputBuffer().stream, async () => {})
    const result = await workflow.run(project, registry)
    const provider = result.commit?.project.cordis.entry('llm-pi-ai')
    expect(provider?.config).not.toHaveProperty('apiKey')
    expect(provider?.config?.baseURL).toBe('https://provider.example/v1')
    expect(result.commit?.project.cordis.entry('acp')).toBeDefined()
    expect(result.commit?.project.cordis.entry('agent-loop')).toBeDefined()
    expect(result.commit?.project.cordis.entry('agent-core')).toBeUndefined()
  })

})

describe('dsh-sdk create', () => {
  const writeDependency = (name: string) => async (_m: unknown, spec: string, cwd: string): Promise<void> => {
    const path = join(cwd, 'package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8')) as { dependencies?: Record<string, string> }
    manifest.dependencies = { ...manifest.dependencies, [name]: spec }
    await writeFile(path, JSON.stringify(manifest, null, 2))
  }

  it('adds a dependency and mounts it after confirmation', async () => {
    const project = await committedProject()
    const context = { ...commandContext(project.root), port: new QueuePort([true]), add: writeDependency('my-ext-plugin') }
    const result = await runCreatePluginCommand('github:o/r#sha', context)
    expect(result?.project.cordis.entry('my-ext-plugin')?.name).toBe('my-ext-plugin')
    expect(context.readStdout()).toContain('Mounted my-ext-plugin')
  })

  it('derives the cordis id from a scoped package name', async () => {
    const project = await committedProject()
    const context = { ...commandContext(project.root), port: new QueuePort([true]), add: writeDependency('@acme/cool-plugin') }
    const result = await runCreatePluginCommand('@acme/cool-plugin@1.0.0', context)
    expect(result?.project.cordis.entry('cool-plugin')?.name).toBe('@acme/cool-plugin')
  })

  it('returns undefined and adds nothing when declined', async () => {
    const project = await committedProject()
    let added = false
    const context = {
      ...commandContext(project.root),
      port: new QueuePort([false]),
      add: async () => { added = true },
    }
    await expect(runCreatePluginCommand('pkg@1.0.0', context)).resolves.toBeUndefined()
    expect(added).toBe(false)
  })

  it('rejects an empty source, a non-TTY session, and a no-op add', async () => {
    const project = await committedProject()
    await expect(runCreatePluginCommand('   ', { ...commandContext(project.root), port: new QueuePort([]) }))
      .rejects.toThrow('requires a plugin source')
    const noTty = commandContext(project.root)
    noTty.stdin.isTTY = false
    noTty.stdout.isTTY = false
    await expect(runCreatePluginCommand('pkg@1.0.0', noTty)).rejects.toThrow('interactive TTY')
    const noOutTty = commandContext(project.root)
    noOutTty.stdout.isTTY = false
    await expect(runCreatePluginCommand('pkg@1.0.0', noOutTty)).rejects.toThrow('interactive TTY')
    await expect(runCreatePluginCommand('pkg@1.0.0', {
      ...commandContext(project.root), port: new QueuePort([true]), add: async () => {},
    })).rejects.toThrow('added no new dependency')
  })

  it('dispatches create through the launcher', async () => {
    const project = await committedProject()
    const context = commandContext(project.root)
    context.createPlugin = async () => undefined
    await expect(runDshSdkCommand(['create', 'pkg@1.0.0'], context)).resolves.toBe(0)
  })
})

describe('command telemetry', () => {
  it('reports when consent allows and skips when denied or faulting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-telemetry-'))
    temporary.push(dir)
    const sent: unknown[] = []
    const reporter = { report: () => { sent.push(1) }, flush: async () => {} }
    await reportCommandTelemetry(
      { command: 'build', cwd: dir, durationMs: 5, success: true },
      { resolve: async () => ({ allowed: true, reason: 'absent' }), reporter },
    )
    expect(sent).toHaveLength(1)
    await reportCommandTelemetry(
      { command: 'build', cwd: dir, durationMs: 5, success: true },
      { resolve: async () => ({ allowed: false, reason: 'disabled' }), reporter },
    )
    expect(sent).toHaveLength(1)
    await expect(reportCommandTelemetry(
      { command: 'build', cwd: dir, durationMs: 5, success: true },
      { resolve: async () => { throw new Error('boom') }, reporter },
    )).resolves.toBeUndefined()
    expect(sent).toHaveLength(1)
  })

  it('emits a telemetry event carrying each command outcome', async () => {
    const project = await committedProject()
    const events: CommandTelemetryEvent[] = []
    const context = commandContext(project.root)
    context.telemetry = async (event) => { events.push(event) }
    context.build = async () => {}
    await expect(runDshSdkCommand(['build'], context)).resolves.toBe(0)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ command: 'build', cwd: project.root, success: true })

    await runDshSdkCommand([], context)
    expect(events).toHaveLength(1)

    context.build = async () => { throw new Error('boom') }
    await expect(runDshSdkCommand(['build'], context)).resolves.toBe(1)
    expect(events[1]).toMatchObject({ command: 'build', success: false })

    context.config = async () => ({ installError: new Error('offline') })
    await expect(runDshSdkCommand(['config'], context)).resolves.toBe(1)
    expect(events.at(-1)).toMatchObject({ command: 'config', success: false })
  })
})
