/**
 * @vitest-environment jsdom
 *
 * Load-engine account: what `load` answers its caller (that answer is what the
 * run orchestration reports to the host), Plugin Run convergence against live
 * state, per-Plugin serialization, the three-step teardown, and each failing stage.
 *
 * The loader is stood in by real `ctx.plugin` fibers: entry creation must run the
 * guarded surface as a genuine plugin, or neither activation gating nor the
 * disposal cascade under test would be real.
 */
import { Context } from '@huiliyi37/cordis'
import type { Loader } from '@huiliyi37/cordis-plugin-loader'
import { describe, expect, it, vi } from 'vitest'
import type {
  CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId,
} from '@huiliyi37/dsh-api-remotes/client'
import type { SessionId } from '@huiliyi37/dsh-client-connection/client'
import type { ClientModuleSystem } from '@huiliyi37/dsh-client-modules/client'
import { SlotsService } from '@huiliyi37/dsh-client-runtime/client'
import { DynamicCordisPackageRunner } from '../src/client/runtime.ts'
import type { DynamicCordisClientHalf, DynamicCordisRenderFailure } from '../src/client/runtime.ts'

const PLUGIN = 'dyn-1' as CordisDynamicPluginId
const PACKAGE = 'pkg-1' as CordisDynamicPackageId
const RUN = 'run-1' as CordisDynamicPluginRunId
const AGENT = 's-1' as SessionId

function runId(value: number): CordisDynamicPluginRunId {
  return `run-${value}` as CordisDynamicPluginRunId
}

/** One browser half as the host hands it over. */
function half(overrides: Partial<DynamicCordisClientHalf> = {}): DynamicCordisClientHalf {
  return {
    pluginId: PLUGIN,
    packageId: PACKAGE,
    pluginRunId: RUN,
    agentId: AGENT,
    name: 'demo',
    code: 'return { apply(ctx) {} }',
    ...overrides,
  }
}

interface Bench {
  ctx: Context
  slots: SlotsService
  runner: DynamicCordisPackageRunner
  invalidated: string[]
  removed: string[]
  created: string[]
  invoke: ReturnType<typeof vi.fn>
  /** Render failures the runner sent upstream, in order. */
  reported: {
    agentId: SessionId
    pluginId: CordisDynamicPluginId
    pluginRunId: CordisDynamicPluginRunId
    failure: DynamicCordisRenderFailure
  }[]
  /**
   * Report one entry crash the way the renderer's boundary does: the runner
   * subscribed through the supervision seam, and this calls what it registered.
   */
  crash: (slot: string, entry: unknown, error: unknown, abdicated?: boolean) => void
  /** Whether the runner released its subscription. */
  watching: () => boolean
  settle: () => Promise<void>
}

/**
 * Terminate the awaitable fiber handle. The runner reads activation failure
 * through `fiber.await()`; without a handler on the fiber itself, a deliberately
 * failing package would also surface as an unhandled rejection.
 */
function seated<T>(fiber: T): T {
  void Promise.resolve(fiber).catch(() => {})
  return fiber
}

async function boot(): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SlotsService)
  const invalidated: string[] = []
  const removed: string[] = []
  const created: string[] = []
  const factories = new Map<string, () => unknown>()
  const fibers = new Map<string, { fiber: unknown }>()
  let next = 0

  ;(globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__ = {
    load: (handoff: { id: string; factory: () => unknown }) => { factories.set(handoff.id, handoff.factory) },
  }
  const loader = {
    create: (options: { name: string }) => {
      created.push(options.name)
      const factory = factories.get(options.name)
      if (factory === undefined) throw new Error(`no factory for ${options.name}`)
      const entryId = `entry-${++next}`
      fibers.set(entryId, { fiber: seated(ctx.plugin(factory() as Parameters<Context['plugin']>[0])) })
      return Promise.resolve(entryId)
    },
    resolve: (entryId: string) => fibers.get(entryId) ?? { fiber: undefined },
    remove: async (entryId: string) => {
      removed.push(entryId)
      const entry = fibers.get(entryId)
      fibers.delete(entryId)
      await (entry?.fiber as { dispose(): Promise<void> } | undefined)?.dispose()
    },
  } as unknown as Loader

  const invoke = vi.fn(() => Promise.resolve(null))
  const reported: Bench['reported'] = []
  // The crash seam mirrors the official renderer boundary; the local runner
  // never subscribes to it (documented limitation), and the render-failure
  // tests below assert that inertness. Registrations still go through the real
  // service, so the entries are real.
  type EntryErrorListener = (slot: string, entry: unknown, error: unknown, info: { abdicated: boolean }) => void
  let listener: EntryErrorListener | undefined
  const runner = new DynamicCordisPackageRunner({
    ctx,
    loader,
    modules: { invalidate: (id: string) => { invalidated.push(id) } } as unknown as ClientModuleSystem,
    slots: {
      onEntryError: (fn: EntryErrorListener) => {
        listener = fn
        return () => { listener = undefined }
      },
    } as unknown as SlotsService,
    invoke,
    reportGuardFailure: () => {},
    reportRenderFailure: (agentId, pluginId, pluginRunId, failure) => {
      reported.push({ agentId, pluginId, pluginRunId, failure })
    },
  })
  return {
    ctx,
    slots: ctx.slots,
    runner,
    invalidated,
    removed,
    created,
    invoke,
    reported,
    crash: (slot, entry, error, abdicated = true) => {
      // The local runner never subscribes (the local SlotsService has no
      // onEntryError seam — documented limitation), so an unwatched crash is
      // dropped exactly as production drops it.
      if (listener !== undefined) listener(slot, entry, error, { abdicated })
    },
    watching: () => listener !== undefined,
    settle: async () => { await new Promise((resolve) => { setTimeout(resolve, 0) }) },
  }
}

describe('load', () => {
  it('mounts a browser half through the module table and the loader, then answers active', async () => {
    const bench = await boot()
    await expect(bench.runner.load(half())).resolves.toEqual({ ok: true, pluginRunId: RUN })
    expect(bench.invalidated).toEqual(['dyn/dyn-1'])
    expect(bench.created).toEqual(['dyn/dyn-1'])
    expect(bench.runner.isLoaded(PLUGIN)).toBe(true)
    expect(bench.runner.getSnapshot()).toEqual([
      { pluginId: PLUGIN, packageId: PACKAGE, pluginRunId: RUN, name: 'demo', slots: [], styleCount: 0 },
    ])
  })

  it('projects the contributions the package made', async () => {
    const bench = await boot()
    await bench.runner.load(half({
      code: `return {
        inject: ['slots'],
        apply(ctx) {
          styles.insert('.x {}')
          ctx.slots.register({ name: 'root' }, () => null)
        },
      }`,
    }))
    expect(bench.runner.getSnapshot()).toEqual([
      { pluginId: PLUGIN, packageId: PACKAGE, pluginRunId: RUN, name: 'demo', slots: ['root'], styleCount: 1 },
    ])
  })

  it('answers from live state when the revision is already loaded here', async () => {
    const bench = await boot()
    await bench.runner.load(half())
    // A replayed run must not look unacknowledged, and must not reload.
    await expect(bench.runner.load(half())).resolves.toEqual({ ok: true, pluginRunId: RUN })
    expect(bench.created).toEqual(['dyn/dyn-1'])
    expect(bench.runner.isLoaded(PLUGIN)).toBe(true)
  })

  it('replays the parked services a live package still waits for', async () => {
    const bench = await boot()
    const parked = half({ code: "return { inject: ['absent'], apply() {} }" })
    await expect(bench.runner.load(parked)).resolves.toEqual({ ok: true, pluginRunId: RUN, waitingFor: ['absent'] })
    await expect(bench.runner.load(parked)).resolves.toEqual({ ok: true, pluginRunId: RUN, waitingFor: ['absent'] })
    expect(bench.created).toEqual(['dyn/dyn-1'])
  })

  it('replaces a live load when a newer revision arrives', async () => {
    const bench = await boot()
    await bench.runner.load(half())
    await expect(bench.runner.load(half({ pluginRunId: runId(2) }))).resolves.toEqual({ ok: true, pluginRunId: runId(2) })
    expect(bench.removed).toEqual(['entry-1'])
    expect(bench.invalidated).toEqual(['dyn/dyn-1', 'dyn/dyn-1', 'dyn/dyn-1'])
    expect(bench.created).toEqual(['dyn/dyn-1', 'dyn/dyn-1'])
    expect(bench.runner.getSnapshot()[0]?.pluginRunId).toBe(runId(2))
  })

  it('loads the function form, which declares no services', async () => {
    const bench = await boot()
    await expect(bench.runner.load(half({ code: 'return (ctx) => { globalThis.__dynFnForm = true }' })))
      .resolves.toEqual({ ok: true, pluginRunId: RUN })
    expect((globalThis as { __dynFnForm?: boolean }).__dynFnForm).toBe(true)
    delete (globalThis as { __dynFnForm?: boolean }).__dynFnForm
  })

  it('serializes operations of one package id', async () => {
    const bench = await boot()
    const first = bench.runner.load(half())
    const second = bench.runner.load(half({ pluginRunId: runId(2) }))
    await expect(first).resolves.toEqual({ ok: true, pluginRunId: RUN })
    await expect(second).resolves.toEqual({ ok: true, pluginRunId: runId(2) })
    expect(bench.created).toEqual(['dyn/dyn-1', 'dyn/dyn-1'])
  })

  it('keeps the queue usable after a failed operation', async () => {
    const bench = await boot()
    const sink = (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__
    delete (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__
    await expect(bench.runner.load(half())).rejects.toThrow(/__ModuleLoader__ is missing/)
    ;(globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__ = sink
    await expect(bench.runner.load(half())).resolves.toEqual({ ok: true, pluginRunId: RUN })
  })
})

describe('failure stages', () => {
  it('classifies a closure that will not evaluate, and leaves no styles behind', async () => {
    const bench = await boot()
    await expect(bench.runner.load(half({ code: 'styles.insert(".leak {}"); return 42' }))).resolves.toEqual({
      ok: false,
      cause: 'evaluate',
      message: expect.stringContaining('must `return` a plugin') as string,
      stack: expect.any(String),
      error: expect.any(Error),
    })
    const leaked = [...document.querySelectorAll('style[data-dyn="dyn-1"]')]
      .filter(tag => tag.textContent === '.leak {}')
    expect(leaked).toHaveLength(0)
    expect(bench.created).toEqual([])
  })

  it('classifies an apply that throws, and tears the entry down', async () => {
    const bench = await boot()
    await expect(bench.runner.load(half({ code: 'return { apply() { throw new Error("apply exploded") } }' })))
      .resolves.toEqual({
        ok: false,
        cause: 'activate',
        message: 'apply exploded',
        stack: expect.any(String),
        error: expect.any(Error),
      })
    expect(bench.removed).toEqual(['entry-1'])
    expect(bench.runner.isLoaded(PLUGIN)).toBe(false)
  })

  it('stringifies a closure that rejects with a non-Error value', async () => {
    const bench = await boot()
    await expect(bench.runner.load(half({ code: 'throw "raw rejection"' })))
      .resolves.toEqual({ ok: false, cause: 'evaluate', message: 'raw rejection', error: 'raw rejection' })
  })

  it('classifies a loader entry that produced no fiber', async () => {
    const bench = await boot()
    const env = bench.runner as unknown as { env: { loader: { resolve: (id: string) => unknown } } }
    vi.spyOn(env.env.loader, 'resolve').mockReturnValue({ fiber: undefined })
    await expect(bench.runner.load(half())).resolves.toEqual({
      ok: false,
      cause: 'module-import',
      message: 'module import failed (see the browser console)',
    })
    vi.restoreAllMocks()
    expect(bench.removed).toEqual(['entry-1'])
  })

  it('mirrors a loaded package runtime error to the console without unloading it', async () => {
    const bench = await boot()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await bench.runner.load(half({
      code: 'return { apply: (ctx) => { ctx.on("t/ping", () => console.error("after load")) } }',
    }))
    ;(bench.ctx.emit as (type: string) => void)('t/ping')
    const mirrored = logged.mock.calls.filter(call => String(call[0]).includes('logged an error'))
    logged.mockRestore()
    expect(mirrored).toHaveLength(1)
    expect(bench.runner.isLoaded(PLUGIN)).toBe(true)
  })
})

describe('retract', () => {
  it('unloads at the named revision', async () => {
    const bench = await boot()
    await bench.runner.load(half())
    bench.runner.retract(PLUGIN, RUN)
    await bench.settle()
    expect(bench.removed).toEqual(['entry-1'])
    expect(bench.invalidated).toEqual(['dyn/dyn-1', 'dyn/dyn-1'])
    expect(bench.runner.isLoaded(PLUGIN)).toBe(false)
  })

  it('ignores a retract of a superseded revision', async () => {
    const bench = await boot()
    await bench.runner.load(half({ pluginRunId: runId(3) }))
    bench.runner.retract(PLUGIN, runId(2))
    await bench.settle()
    expect(bench.runner.isLoaded(PLUGIN)).toBe(true)
  })

  it('ignores a retract of a package this page never loaded', async () => {
    const bench = await boot()
    bench.runner.retract(PLUGIN, RUN)
    await bench.settle()
    expect(bench.removed).toEqual([])
  })
})

describe('observation and disposal', () => {
  it('notifies subscribers and re-derives the snapshot after each convergence', async () => {
    const bench = await boot()
    let notified = 0
    const unsubscribe = bench.runner.subscribe(() => { notified++ })
    const empty = bench.runner.getSnapshot()
    expect(bench.runner.getSnapshot()).toBe(empty) // stable between mutations
    await bench.runner.load(half())
    expect(notified).toBe(1)
    expect(bench.runner.getSnapshot()).not.toBe(empty)
    unsubscribe()
    bench.runner.retract(PLUGIN, RUN)
    await bench.settle()
    expect(notified).toBe(1)
  })

  it('unloads every live package on disposal', async () => {
    const bench = await boot()
    await bench.runner.load(half())
    await bench.runner.dispose()
    expect(bench.removed).toEqual(['entry-1'])
    expect(bench.runner.getSnapshot()).toEqual([])
    expect(bench.slots.entries('root')).toHaveLength(0)
  })

  it('routes host.call through the invoke seam it was given', async () => {
    const bench = await boot()
    await bench.runner.load(half({ code: 'return { apply: () => host.call("ping", 1) }' }))
    expect(bench.invoke).toHaveBeenCalledWith(PLUGIN, RUN, 'ping', 1)
  })
})

describe('render failures', () => {
  /** A package that seats one component in `root`, so a crash has something to name. */
  const CONTRIBUTOR = `return {
    inject: ['slots'],
    apply(ctx) { ctx.slots.register({ name: 'root' }, () => null) },
  }`

  it('keeps crash supervision inert while the local slots core lacks the seam', async () => {
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    // The local SlotsService exposes no onEntryError surface (documented
    // limitation), so the runner never subscribes and nothing is reported.
    expect(bench.watching()).toBe(false)
    const [entry] = bench.slots.entries('root')
    bench.crash('root', entry, new Error('Cannot read properties of undefined'))
    await bench.settle()
    expect(bench.reported).toEqual([])
    expect(bench.runner.renderFailures.getSnapshot().size).toBe(0)
  })

  it('seats a package that registers an unindexable component without claiming it', async () => {
    const bench = await boot()
    // A component that is not an object has no identity to key ownership on;
    // the registration still stands (the local core seats it verbatim).
    await expect(bench.runner.load(half({
      code: `return {
        inject: ['slots'],
        apply(ctx) { ctx.slots.register({ name: 'root' }, 'not-a-component') },
      }`,
    }))).resolves.toEqual({ ok: true, pluginRunId: RUN })
    expect(bench.slots.entries('root')).toHaveLength(1)
  })

  it('reports nothing across retract, reload, and a replayed run', async () => {
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    bench.runner.retract(PLUGIN, RUN)
    await bench.settle()
    await bench.runner.load(half({ code: CONTRIBUTOR, pluginRunId: runId(2) }))
    await bench.runner.load(half({ code: CONTRIBUTOR, pluginRunId: runId(2) }))
    expect(bench.reported).toEqual([])
    expect(bench.runner.renderFailures.getSnapshot().size).toBe(0)
  })

  it('stops watching nothing when the engine is disposed', async () => {
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    expect(bench.watching()).toBe(false)
    await bench.runner.dispose()
    expect(bench.watching()).toBe(false)
  })
})
