import { EventEmitter } from 'node:events'
import type { Stats } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'

interface FakeWatcherControl {
  emitter: EventEmitter
  closeCalls: number
  options: Record<string, unknown>
}

interface FakeWatchFileControl {
  path: string
  listener(current: Stats, previous: Stats): void
}

const watcherHarness = vi.hoisted(() => ({
  watchers: [] as FakeWatcherControl[],
  startupErrors: [] as Error[],
  watchFiles: [] as FakeWatchFileControl[],
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    watchFile(path: string, _options: unknown, listener: FakeWatchFileControl['listener']) {
      watcherHarness.watchFiles.push({ path, listener })
    },
    unwatchFile(path: string, listener: FakeWatchFileControl['listener']) {
      const index = watcherHarness.watchFiles.findIndex(control => control.path === path && control.listener === listener)
      if (index !== -1) watcherHarness.watchFiles.splice(index, 1)
    },
  }
})

vi.mock('chokidar', () => ({
  default: {
    watch(_path: unknown, options: Record<string, unknown>) {
      const emitter = new EventEmitter() as EventEmitter & { close(): Promise<void> }
      const control: FakeWatcherControl = { emitter, closeCalls: 0, options }
      emitter.close = async () => {
        control.closeCalls += 1
      }
      watcherHarness.watchers.push(control)
      queueMicrotask(() => {
        const error = watcherHarness.startupErrors.shift()
        if (error === undefined) emitter.emit('ready')
        else emitter.emit('error', error)
      })
      return emitter
    },
  },
}))

const AgentDefinitions = await import('../src/index.ts')

async function tempDir(name: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), `dsh-${name}-`))
}

function roleFile(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  watcherHarness.watchers.length = 0
  watcherHarness.startupErrors.length = 0
  watcherHarness.watchFiles.length = 0
})

describe('dsh-agent-definitions watcher', () => {
  it('invalidates the catalog on role file events and filters irrelevant paths', async () => {
    const home = await tempDir('agents-watch')
    const root = join(home, '.dsh/agents')
    await mkdir(root, { recursive: true })
    const ctx = new Context()
    const fiber = await ctx.plugin(AgentDefinitions.default, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchPollIntervalMs: 10,
      watchStabilityThresholdMs: 20,
    })

    // Existing root gets a chokidar watcher; missing roots get ancestor watchFiles.
    expect((await ctx.agentDefinitions.snapshot()).complete).toBe(true)
    const rootWatcher = watcherHarness.watchers[0]
    expect(rootWatcher?.options).toMatchObject({ depth: 0, atomic: true })
    const initial = (await ctx.agentDefinitions.list()).map(entry => entry.name)
    expect(initial).toEqual(['explore', 'verify'])

    // Irrelevant events keep the cached catalog: a non-markdown file, a
    // subdirectory event, and anything below a nested directory.
    await writeFile(join(root, 'notes.txt'), 'not a role')
    rootWatcher?.emitter.emit('add', join(root, 'notes.txt'))
    rootWatcher?.emitter.emit('addDir', join(root, 'nested'))
    rootWatcher?.emitter.emit('add', join(root, 'nested/hidden.md'))
    await settle()
    expect((await ctx.agentDefinitions.list()).map(entry => entry.name)).toEqual(['explore', 'verify'])

    // A role file add invalidates; the next lookup rediscovers.
    await writeFile(join(root, 'scout.md'), roleFile('scout', 'watched role'))
    rootWatcher?.emitter.emit('add', join(root, 'scout.md'))
    await settle()
    expect((await ctx.agentDefinitions.list()).map(entry => entry.name)).toEqual(['explore', 'scout', 'verify'])

    // Change and unlink follow the same path.
    await writeFile(join(root, 'scout.md'), roleFile('scout', 'renamed description'))
    rootWatcher?.emitter.emit('change', join(root, 'scout.md'))
    await settle()
    expect((await ctx.agentDefinitions.list()).find(entry => entry.name === 'scout')?.description).toBe('renamed description')
    await rm(join(root, 'scout.md'))
    rootWatcher?.emitter.emit('unlink', join(root, 'scout.md'))
    await settle()
    expect((await ctx.agentDefinitions.list()).map(entry => entry.name)).toEqual(['explore', 'verify'])

    await fiber.dispose()
    expect(rootWatcher?.closeCalls).toBeGreaterThan(0)
  })

  it('keeps definitions readable but incomplete across watcher startup failures', async () => {
    const home = await tempDir('agents-watch-error')
    const root = join(home, '.dsh/agents')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'resilient.md'), roleFile('resilient', 'survives watcher failure'))
    watcherHarness.startupErrors.push(new Error('watch unavailable'))
    const ctx = new Context()
    const fiber = await ctx.plugin(AgentDefinitions.default, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchUsePolling: true,
      watchPollIntervalMs: 10,
      watchStabilityThresholdMs: 20,
    })

    const snapshot = await ctx.agentDefinitions.snapshot()
    expect(snapshot.complete).toBe(false)
    expect(snapshot.definitions.map(entry => entry.name)).toEqual(['explore', 'resilient', 'verify'])
    expect((await ctx.agentDefinitions.get('resilient'))?.content).toBe('Body.')

    await fiber.dispose()
  })
})
