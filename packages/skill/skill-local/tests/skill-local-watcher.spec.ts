import { EventEmitter } from 'node:events'
import type { Stats } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import SkillService from '@huiliyi37/dsh-skill'

interface FakeWatcherControl {
  emitter: EventEmitter
  closeCalls: number
  options: Record<string, unknown>
}

interface FakeWatchFileControl {
  path: string
  listener(current: Stats, previous: Stats): void
}

interface FakeStatGate {
  started: PromiseWithResolvers<undefined>
  release: PromiseWithResolvers<undefined>
}

const watcherHarness = vi.hoisted(() => ({
  watchers: [] as FakeWatcherControl[],
  startupErrors: [] as Error[],
  closeErrors: 0,
  deferredReady: 0,
  watchFiles: [] as FakeWatchFileControl[],
  statGates: [] as FakeStatGate[],
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

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async stat(...args: Parameters<typeof actual.stat>) {
      const gate = watcherHarness.statGates.shift()
      if (gate !== undefined) {
        gate.started.resolve(undefined)
        await gate.release.promise
      }
      return await actual.stat(...args)
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
        if (watcherHarness.closeErrors > 0) {
          watcherHarness.closeErrors -= 1
          throw new Error('close failed')
        }
      }
      watcherHarness.watchers.push(control)
      queueMicrotask(() => {
        if (watcherHarness.deferredReady > 0) {
          watcherHarness.deferredReady -= 1
          return
        }
        const error = watcherHarness.startupErrors.shift()
        if (error === undefined) emitter.emit('ready')
        else emitter.emit('error', error)
      })
      return emitter
    },
  },
}))

const SkillLocal = await import('../src/index.ts')

async function tempDir(name: string): Promise<string> {
  return await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), `dsh-${name}-`)))
}

async function writeSkill(root: string, name: string): Promise<void> {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n\nBody.\n`)
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  watcherHarness.watchers.length = 0
  watcherHarness.startupErrors.length = 0
  watcherHarness.closeErrors = 0
  watcherHarness.deferredReady = 0
  watcherHarness.watchFiles.length = 0
  watcherHarness.statGates.length = 0
})

describe('skill-local watcher failures', () => {
  it('ignores missing-path probes until the observed path actually changes', async () => {
    const home = await tempDir('skill-watch-missing-stable')
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const fiber = await ctx.plugin(SkillLocal, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchPollIntervalMs: 10,
    })
    expect(await ctx.skills.snapshot()).toEqual({ skills: [], complete: true })
    expect(watcherHarness.watchFiles).toHaveLength(2)
    let invalidations = 0
    ctx.on('skills/change', () => { invalidations += 1 })

    for (const control of watcherHarness.watchFiles) {
      control.listener({} as Stats, {} as Stats)
    }
    await settle()

    expect(invalidations).toBe(0)
    expect(watcherHarness.watchFiles).toHaveLength(2)
    await fiber.dispose()
  })

  it('keeps skills loadable across persistent watcher startup failures without caching them', async () => {
    const home = await tempDir('skill-watch-start-error')
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'retry-skill')
    watcherHarness.startupErrors.push(
      new Error('watch failed once'),
      new Error('watch failed twice'),
      new Error('watch failed three times'),
    )
    watcherHarness.closeErrors = 1
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const fiber = await ctx.plugin(SkillLocal, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchUsePolling: true,
      watchFollowSymlinks: false,
      watchPollIntervalMs: 10,
      watchStabilityThresholdMs: 20,
    })

    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'retry-skill' }],
      complete: false,
    })
    expect((await ctx.skills.get('retry-skill'))?.content).toBe('Body.')
    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'retry-skill' }],
      complete: false,
    })
    expect(watcherHarness.watchers).toHaveLength(3)
    expect(watcherHarness.watchers[0]?.options).toMatchObject({
      atomic: true,
      depth: 1,
      followSymlinks: false,
      usePolling: true,
      interval: 10,
      awaitWriteFinish: {
        stabilityThreshold: 20,
        pollInterval: 10,
      },
    })

    await fiber.dispose()
  })

  it('filters events, coalesces invalidation, recovers runtime errors, and contains late callbacks', async () => {
    const home = await tempDir('skill-watch-runtime-error')
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'watched-skill')
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const fiber = await ctx.plugin(SkillLocal, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchPollIntervalMs: 10,
      watchStabilityThresholdMs: 20,
    })
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['watched-skill'])
    let invalidations = 0
    ctx.on('skills/change', () => { invalidations += 1 })
    const first = watcherHarness.watchers[0]
    if (first === undefined) throw new Error('expected a root watcher')

    first.emitter.emit('change', join(root, 'notes.txt'))
    first.emitter.emit('change', join(home, 'outside.md'))
    first.emitter.emit('change', join(root, 'watched-skill/references.md'))
    first.emitter.emit('change', join(root, '.system/SKILL.md'))
    await settle()
    expect(invalidations).toBe(0)

    first.emitter.emit('change', join(root, 'watched-skill/SKILL.md'))
    first.emitter.emit('change', join(root, 'watched-skill/SKILL.md'))
    await settle()
    expect(invalidations).toBe(1)

    watcherHarness.closeErrors = 1
    watcherHarness.startupErrors.push(new Error('runtime rewatch failed'))
    first.emitter.emit('error', new Error('runtime watch failed'))
    await settle()
    await settle()
    expect(watcherHarness.watchers.length).toBeGreaterThanOrEqual(2)
    expect(invalidations).toBeGreaterThanOrEqual(2)
    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'watched-skill' }],
      complete: true,
    })

    await fiber.dispose()
    first.emitter.emit('change', join(root, 'watched-skill/SKILL.md'))
    first.emitter.emit('error', new Error('late error'))
    await settle()
  })

  it('replaces a retained watcher when its root emits unlinkDir', async () => {
    const home = await tempDir('skill-watch-root-unlink')
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'removed-skill')
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const fiber = await ctx.plugin(SkillLocal, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchPollIntervalMs: 10,
      watchStabilityThresholdMs: 20,
    })

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['removed-skill'])
    const original = watcherHarness.watchers[0]
    if (original === undefined) throw new Error('expected a root watcher')

    await rm(root, { recursive: true })
    original.emitter.emit('unlinkDir', root)
    await vi.waitFor(() => { expect(original.closeCalls).toBeGreaterThan(0) })
    expect(watcherHarness.watchFiles.some(control => control.path === root)).toBe(true)

    await fiber.dispose()
  })

  it('re-probes a retained root after child unlink and observes immediate recreation', async () => {
    const home = await tempDir('skill-watch-root-reprobe')
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'old-skill')
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const fiber = await ctx.plugin(SkillLocal, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchPollIntervalMs: 10,
      watchStabilityThresholdMs: 20,
    })

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['old-skill'])
    const original = watcherHarness.watchers[0]
    if (original === undefined) { throw new Error('expected a root watcher') }

    await rm(root, { recursive: true })
    original.emitter.emit('unlink', join(root, 'old-skill/SKILL.md'))
    await settle()
    expect(await ctx.skills.snapshot()).toEqual({ skills: [], complete: true })

    const missingRoot = watcherHarness.watchFiles.find(control => control.path === root)
    expect(missingRoot).toBeDefined()
    await writeSkill(root, 'recreated-skill')
    missingRoot!.listener({} as Stats, {} as Stats)
    await vi.waitFor(() => { expect(watcherHarness.watchers).toHaveLength(2) })
    await settle()

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['recreated-skill'])
    await fiber.dispose()
  })

  it('settles an opening watcher when plugin disposal races its ready event', async () => {
    const home = await tempDir('skill-watch-opening-dispose')
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'racing-skill')
    watcherHarness.deferredReady = 1
    const ctx = new Context()
    await ctx.plugin(SkillService)
    let provider!: InstanceType<typeof SkillLocal.LocalSkillProvider>
    const disposeProvider = ctx.skills.registerProvider((control) => {
      provider = new SkillLocal.LocalSkillProvider(ctx, control, {
        dshHome: join(home, '.dsh'),
        agentsHome: join(home, '.agents'),
        watch: true,
        watchPollIntervalMs: 10,
        watchStabilityThresholdMs: 20,
      })
      return provider
    })

    const discovery = provider.list({})
    await vi.waitFor(() => { expect(watcherHarness.watchers).toHaveLength(1) })
    const first = watcherHarness.watchers[0]
    if (first === undefined) throw new Error('expected an opening root watcher')
    const disposal = provider.dispose()

    await expect(discovery).rejects.toThrow('skill-local watcher disposed')
    await disposal
    disposeProvider()
    await settle()
    expect(first.closeCalls).toBeGreaterThan(0)
  })

  it('closes an opening watcher when disposal wins the mode probe', async () => {
    const home = await tempDir('skill-watch-probe-dispose')
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'racing-skill')
    watcherHarness.deferredReady = 1
    const statGate: FakeStatGate = {
      started: Promise.withResolvers<undefined>(),
      release: Promise.withResolvers<undefined>(),
    }
    watcherHarness.statGates.push(statGate)
    const ctx = new Context()
    await ctx.plugin(SkillService)
    let provider!: InstanceType<typeof SkillLocal.LocalSkillProvider>
    const disposeProvider = ctx.skills.registerProvider((control) => {
      provider = new SkillLocal.LocalSkillProvider(ctx, control, {
        dshHome: join(home, '.dsh'),
        agentsHome: join(home, '.agents'),
        watch: true,
        watchPollIntervalMs: 10,
        watchStabilityThresholdMs: 20,
      })
      return provider
    })

    const discovery = provider.list({})
    await statGate.started.promise
    const disposal = provider.dispose()
    statGate.release.resolve(undefined)

    await expect(discovery).rejects.toThrow('skill-local watcher disposed')
    await disposal
    expect(watcherHarness.watchers).toHaveLength(1)
    expect(watcherHarness.watchers[0]?.closeCalls).toBeGreaterThan(0)
    disposeProvider()
  })

  it('contains an opening watcher rejection during provider teardown', async () => {
    const home = await tempDir('skill-watch-opening-reject')
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'rejected-skill')
    watcherHarness.deferredReady = 1
    const ctx = new Context()
    await ctx.plugin(SkillService)
    let provider!: InstanceType<typeof SkillLocal.LocalSkillProvider>
    const disposeProvider = ctx.skills.registerProvider((control) => {
      provider = new SkillLocal.LocalSkillProvider(ctx, control, {
        dshHome: join(home, '.dsh'),
        agentsHome: join(home, '.agents'),
        watch: true,
        watchPollIntervalMs: 10,
        watchStabilityThresholdMs: 20,
      })
      return provider
    })

    const discovery = provider.list({})
    await vi.waitFor(() => { expect(watcherHarness.watchers).toHaveLength(1) })
    const first = watcherHarness.watchers[0]
    if (first === undefined) throw new Error('expected an opening root watcher')
    first.emitter.emit('error', new Error('opening failed during disposal'))
    const disposal = provider.dispose()

    await expect(discovery).rejects.toThrow('opening failed during disposal')
    await disposal
    disposeProvider()
  })
})
