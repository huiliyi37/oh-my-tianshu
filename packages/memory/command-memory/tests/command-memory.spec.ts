import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import Loader from '@huiliyi37/cordis-plugin-loader'
import type { Agent } from '@huiliyi37/dsh-agent'
import CommandService, { type CommandResult } from '@huiliyi37/dsh-commands'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import * as commandMemory from '@huiliyi37/dsh-command-memory'

interface FakeEntry {
  id: string
  text: string
  tags: string[]
  createdAt: number
}

/** In-memory memory facet: save prepends, list returns insertion view, delete records the id. */
class FakeMemory {
  readonly entries: FakeEntry[] = []
  readonly deleted: string[] = []

  save(entry: { text: string; scope: string; tags: string[]; source: string }): Promise<{ id: string }> {
    const stored: FakeEntry = { id: `mem-${this.entries.length + 1}`, text: entry.text, tags: entry.tags, createdAt: this.entries.length + 1 }
    this.entries.unshift(stored)
    return Promise.resolve({ id: stored.id })
  }

  list(opts?: { scope?: string; limit?: number }): Promise<FakeEntry[]> {
    return Promise.resolve(this.entries.slice(0, opts?.limit ?? this.entries.length))
  }

  delete(id: string): Promise<void> {
    this.deleted.push(id)
    const index = this.entries.findIndex(entry => entry.id === id)
    if (index >= 0) this.entries.splice(index, 1)
    return Promise.resolve()
  }
}

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

async function harness(options: { memory?: FakeMemory } = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(CommandService)
  if (options.memory !== undefined) ctx.provide('memory', options.memory)
  const plugin = await ctx.plugin(commandMemory)
  const session = Session.create(SessionId('command-memory'))
  const agent = {
    session,
    status: 'idle',
    options: {},
    reserveTurnAdmission: () => () => undefined,
  } as unknown as Agent
  return { ctx, agent, plugin }
}

async function run(
  test: Harness,
  line: string,
  controller = new AbortController(),
): Promise<NonNullable<Awaited<ReturnType<CommandService['execute']>>>> {
  const execution = await test.ctx.commands.execute(test.agent, line, controller.signal)
  if (execution === undefined) throw new Error(`command was not registered: ${line}`)
  return execution
}

/** Assert the executor-owned lifecycle pair and absence from model history. */
function expectLastLifecycle(
  test: Harness,
  name: string,
  args: string,
  outcome: CommandResult,
): string {
  const lifecycle = test.agent.session.events
    .filter(event => event.type === 'command/run' || event.type === 'command/done')
    .slice(-2)
  const runEvent = lifecycle[0]
  const doneEvent = lifecycle[1]
  if (runEvent?.type !== 'command/run' || doneEvent?.type !== 'command/done') {
    throw new Error(`expected command lifecycle pair, got ${lifecycle.map(event => event.type).join(',')}`)
  }
  expect(lifecycle.map(event => ({ type: event.type, data: event.data }))).toEqual([
    {
      type: 'command/run',
      data: {
        commandId: runEvent.data.commandId,
        name,
        args,
        source: { kind: 'user' },
      },
    },
    {
      type: 'command/done',
      data: {
        commandId: runEvent.data.commandId,
        ...outcome,
      },
    },
  ])
  expect(doneEvent.data.commandId).toBe(runEvent.data.commandId)
  expect(test.agent.session.surface.nodes).toEqual([])
  expect(test.agent.session.deriveMessages()).toEqual([])
  return runEvent.data.commandId
}

describe('@huiliyi37/dsh-command-memory registration', () => {
  it('registers both commands with Loader-safe exports and disposes them', async () => {
    const test = await harness()
    expect(commandMemory.name).toBe('command-memory')
    expect(commandMemory.inject).toEqual(['commands'])
    expect('default' in commandMemory).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandMemory)).toBe(commandMemory)
    expect(test.ctx.commands.list(test.agent)).toEqual([
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

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'remember')).toBeUndefined()
    expect(test.ctx.commands.find(test.agent, 'memory')).toBeUndefined()
  })
})

describe('/remember and /memory without a memory plugin', () => {
  it('answers the unavailable text for both commands', async () => {
    const test = await harness()
    const remembered = await run(test, '/remember ship it')
    expect(remembered.result).toEqual({ kind: 'error', text: '⚠ memory 服务不可用（未加载 memory 插件）' })
    expect(remembered.commandId).toBe(expectLastLifecycle(test, 'remember', ' ship it', remembered.result))

    const listed = await run(test, '/memory')
    expect(listed.result).toEqual({ kind: 'error', text: '⚠ memory 服务不可用（未加载 memory 插件）' })
    expect(listed.commandId).toBe(expectLastLifecycle(test, 'memory', '', listed.result))
  })
})

describe('/remember human command', () => {
  it('saves one global user entry and reports its id', async () => {
    const memory = new FakeMemory()
    const test = await harness({ memory })
    const execution = await run(test, '/remember 发布前跑 pnpm run constraints')
    expect(execution.result).toEqual({ kind: 'success', text: '已保存记忆: mem-1' })
    expect(execution.commandId).toBe(expectLastLifecycle(test, 'remember', ' 发布前跑 pnpm run constraints', execution.result))
    expect(memory.entries).toEqual([
      { id: 'mem-1', text: '发布前跑 pnpm run constraints', tags: [], createdAt: 1 },
    ])
  })

  it('rejects empty input with the usage line', async () => {
    const memory = new FakeMemory()
    const test = await harness({ memory })
    const execution = await run(test, '/remember   ')
    expect(execution.result).toEqual({ kind: 'error', text: '用法: /remember <text>' })
    expect(execution.commandId).toBe(expectLastLifecycle(test, 'remember', '   ', execution.result))
    expect(memory.entries).toEqual([])
  })
})

describe('/memory human command', () => {
  it('lists entries one per line, newest first, and summarizes long text', async () => {
    const memory = new FakeMemory()
    const test = await harness({ memory })
    const empty = await run(test, '/memory')
    expect(empty.result).toEqual({ kind: 'success', text: '暂无记忆' })
    expect(empty.commandId).toBe(expectLastLifecycle(test, 'memory', '', empty.result))

    await memory.save({ text: '第一条', scope: 'global', tags: [], source: 'user' })
    await memory.save({ text: `多行\n${'长'.repeat(120)}`, scope: 'global', tags: [], source: 'user' })
    const listed = await run(test, '/memory')
    expect(listed.result).toEqual({
      kind: 'success',
      text: `- mem-2: 多行 ${'长'.repeat(77)}…\n- mem-1: 第一条`,
    })
    expect(listed.commandId).toBe(expectLastLifecycle(test, 'memory', '', listed.result))
  })

  it('deletes one entry by id', async () => {
    const memory = new FakeMemory()
    const test = await harness({ memory })
    await memory.save({ text: 'gone', scope: 'global', tags: [], source: 'user' })
    const execution = await run(test, '/memory delete mem-1')
    expect(execution.result).toEqual({ kind: 'success', text: '已删除记忆: mem-1' })
    expect(execution.commandId).toBe(expectLastLifecycle(test, 'memory', ' delete mem-1', execution.result))
    expect(memory.deleted).toEqual(['mem-1'])
    expect(memory.entries).toEqual([])
  })

  it('rejects a missing delete id and unknown subcommands with usage lines', async () => {
    const memory = new FakeMemory()
    const test = await harness({ memory })
    const missing = await run(test, '/memory delete  ')
    expect(missing.result).toEqual({ kind: 'error', text: '用法: /memory delete <id>' })
    expect(missing.commandId).toBe(expectLastLifecycle(test, 'memory', ' delete  ', missing.result))

    const unknown = await run(test, '/memory search foo')
    expect(unknown.result).toEqual({ kind: 'error', text: '用法: /memory [delete <id>]' })
    expect(unknown.commandId).toBe(expectLastLifecycle(test, 'memory', ' search foo', unknown.result))
    expect(memory.deleted).toEqual([])
  })
})
