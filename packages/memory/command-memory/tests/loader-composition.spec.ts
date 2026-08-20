import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import Loader from '@huiliyi37/cordis-plugin-loader'
import Include from '@huiliyi37/cordis-plugin-include'
import type { Agent } from '@huiliyi37/dsh-agent'
import CommandService from '@huiliyi37/dsh-commands'
import * as commandMemory from '@huiliyi37/dsh-command-memory'
import { Session, SessionId } from '@huiliyi37/dsh-session'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('command-memory real Loader composition', () => {
  it('discovers both commands without a memory plugin and answers the unavailable text', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-command-memory-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@huiliyi37/dsh-commands'",
      "- name: '@huiliyi37/dsh-command-memory'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@huiliyi37/dsh-commands', CommandService],
      ['@huiliyi37/dsh-command-memory', commandMemory],
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

    const session = Session.create(SessionId('loader-command-memory'))
    const agent = {
      session,
      status: 'idle',
      options: {},
      reserveTurnAdmission: () => () => undefined,
    } as unknown as Agent
    expect(context.commands.list(agent)).toEqual([
      {
        name: 'memory',
        description: 'List saved memories; delete <id> removes one',
        input: { hint: '[delete <id>]' },
      },
      {
        name: 'remember',
        description: 'Save a project memory entry (writes .dsh/memory/global.md)',
        input: { hint: '<text>' },
      },
    ])
    const execution = await context.commands.execute(agent, '/remember ship it', new AbortController().signal)
    if (execution === undefined) throw new Error('Loader composition did not resolve /remember')
    expect(execution.result).toEqual({ kind: 'error', text: '⚠ memory 服务不可用（未加载 memory 插件）' })
    expect(session.events.map(event => ({ type: event.type, data: event.data }))).toEqual([
      {
        type: 'command/run',
        data: {
          commandId: execution.commandId,
          name: 'remember',
          args: ' ship it',
          source: { kind: 'user' },
        },
      },
      {
        type: 'command/done',
        data: {
          commandId: execution.commandId,
          kind: 'error',
          text: '⚠ memory 服务不可用（未加载 memory 插件）',
        },
      },
    ])
    expect(session.surface.nodes).toEqual([])
    expect(session.deriveMessages()).toEqual([])
  })
})
