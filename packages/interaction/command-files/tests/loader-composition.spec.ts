/**
 * command-files real Loader composition: the file-backed commands are
 * discovered through the Loader like any shipped plugin, project layer shadows
 * the user layer, and the TUI slash menu picks them up once tui.commands is
 * composed.
 * @module @huiliyi37/dsh-command-files/tests/loader-composition
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import Loader from '@huiliyi37/cordis-plugin-loader'
import Include from '@huiliyi37/cordis-plugin-include'
import CommandService from '@huiliyi37/dsh-commands'
import type { Agent } from '@huiliyi37/dsh-agent'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import * as commandFiles from '@huiliyi37/dsh-command-files'

let root: string | undefined
let context: Context | undefined

async function writeCommand(dir: string, rel: string, frontmatter: string, body: string): Promise<void> {
  const file = join(dir, rel)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, `---\n${frontmatter}\n---\n${body}`)
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('command-files real Loader composition', () => {
  it('discovers file-backed commands, project shadows user, and executes', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-command-files-loader-'))
    const userDir = join(root, 'user')
    const projectDir = join(root, 'project')
    await writeCommand(userDir, 'hello.md', 'description: user hello', 'USER $1')
    await writeCommand(userDir, 'git/log.md', 'description: show log', 'LOG $ARGUMENTS')
    await writeCommand(projectDir, 'greet.md', 'description: project greet', 'PROJECT $1')
    await writeCommand(projectDir, 'hello.md', 'description: project hello', 'PROJECT $1')

    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@huiliyi37/dsh-commands'",
      "- name: '@huiliyi37/dsh-command-files'",
      '  config:',
      `    userDir: ${JSON.stringify(userDir)}`,
      `    projectDir: ${JSON.stringify(projectDir)}`,
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@huiliyi37/dsh-commands', CommandService],
      ['@huiliyi37/dsh-command-files', commandFiles],
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

    const session = Session.create(SessionId('loader-command-files'))
    const agent = {
      session,
      status: 'idle',
      options: {},
      reserveTurnAdmission: () => () => undefined,
      steer: () => undefined,
    } as unknown as Agent

    // Names sorted by the registry; project `hello` shadows user `hello`.
    expect(context.commands.list(agent).map(command => command.name)).toEqual(['git-log', 'greet', 'hello'])

    const userExecution = await context.commands.execute(agent, '/hello world', new AbortController().signal)
    expect(userExecution?.result).toEqual({ kind: 'success', text: 'PROJECT world' })

    const nestedExecution = await context.commands.execute(agent, '/git-log tail -n 5', new AbortController().signal)
    expect(nestedExecution?.result).toEqual({ kind: 'success', text: 'LOG  tail -n 5' })
  })

  it('registers the file-backed commands into the TUI slash menu once tui.commands is provided', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-command-files-loader-'))
    const userDir = join(root, 'user')
    const projectDir = join(root, 'project')
    await writeCommand(userDir, 'hello.md', 'description: Say hello', 'Hello $1')

    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@huiliyi37/dsh-commands'",
      "- name: '@huiliyi37/dsh-command-files'",
      '  config:',
      `    userDir: ${JSON.stringify(userDir)}`,
      `    projectDir: ${JSON.stringify(projectDir)}`,
      '- name: test-tui-commands-stub',
      '',
    ].join('\n'))

    interface TuiCommand {
      name: string
      description: string
      argsHint?: string
      run(args: { text: string; sessionId: string | null; echo(text: string): void; ctx: { agents?: Map<string, unknown> } }): Promise<void>
    }
    const registry = {
      registered: [] as TuiCommand[],
      register: (command: TuiCommand) => { registry.registered.push(command) },
    }
    const stub = {
      name: 'test-tui-commands-stub',
      apply(ctx: Context) {
        ctx.provide('tui.commands', registry)
      },
    }

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@huiliyi37/dsh-commands', CommandService],
      ['@huiliyi37/dsh-command-files', commandFiles],
      ['test-tui-commands-stub', stub],
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

    expect(registry.registered.map(entry => entry.name)).toEqual(['hello'])
    expect(registry.registered[0]?.description).toContain('Say hello')

    const session = Session.create(SessionId('loader-tui'))
    const agent = {
      session,
      status: 'idle',
      options: {},
      reserveTurnAdmission: () => () => undefined,
      steer: () => undefined,
    } as unknown as Agent
    const echoes: string[] = []
    await registry.registered[0]!.run({
      text: 'world',
      sessionId: 'loader-tui',
      echo: (text) => { echoes.push(text) },
      ctx: { agents: new Map([['loader-tui', agent]]) },
    })
    expect(echoes).toEqual(['Hello world'])
  })
})
