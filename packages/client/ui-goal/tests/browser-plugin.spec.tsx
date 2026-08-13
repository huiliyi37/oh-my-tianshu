// @vitest-environment jsdom
/**
 * ui-goal browser half on a real cordis Context with fake slots/api/
 * sessions faces: the plugin registers the GoalBar dock entry at
 * conversation.input.dock, the inject face's four verbs read the CAS ref
 * from the session's CURRENT projected value at call time (no fence — the
 * Remote method's compare-and-set is the guard), a missing projection short-circuits
 * to the no-current-goal error without touching the wire, and Remote errors
 * map onto the inline-render result shape. Registration disposal rides the
 * plugin fiber (HMR safety). The node half and the invariant companion are
 * exercised over the same Context.
 */
import { Context, Service } from 'cordis'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach } from 'vitest'
import { SlotsService, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { GoalProjection } from '@deepseek-ai/dsh-goal/client'
import { LocaleService } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { GoalBarActions } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { GoalDock } from '../src/client/GoalBar.tsx'
import { zh } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(cleanup)

const sid = (k: string): SessionId => k as SessionId

function makeProjection(revision = 3): GoalProjection {
  return {
    goal: {
      id: 'g-1' as GoalProjection['goal']['id'],
      revision,
      objective: 'Ship it',
      phase: 'active',
      maxGoalRounds: 8,
    },
    roundsStarted: 1,
    createdAt: 10,
    updatedAt: 20,
  }
}

/** Boot the plugin over fake faces; Goal Remote methods record arguments and answer per the script. */
async function bench(options: {
  projection?: GoalProjection | null | undefined
  failWith?: { code: string; message: string }
  rejectWith?: unknown
} = {}) {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  function answer<T>(method: string, value: T) {
    return (...args: unknown[]) => {
      calls.push({ method, args })
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the defensive scenario under test.
      if ('rejectWith' in options) return Promise.reject(options.rejectWith)
      if (options.failWith !== undefined) {
        return Promise.reject(new Error(`Remote ${method} failed`, { cause: options.failWith }))
      }
      return Promise.resolve(value)
    }
  }
  const ref = { id: 'g-1', revision: 3 }
  const goals = (prefix: string) => ({
    edit: answer(`${prefix}/edit`, { ref }),
    pause: answer(`${prefix}/pause`, { ref }),
    resume: answer(`${prefix}/resume`, { ref }),
    clear: answer(`${prefix}/clear`, ref),
  })
  let activeGoals: ReturnType<typeof goals> | undefined = goals('goals')
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.goals', {
    get edit() { return activeGoals?.edit },
    get pause() { return activeGoals?.pause },
    get resume() { return activeGoals?.resume },
    get clear() { return activeGoals?.clear },
  })
  await ctx.plugin(SlotsService).await()
  ctx.slots.register({
    name: 'root', children: { 'conversation.input.dock': { kind: 'list', scope: 'session' } },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleService(ctx))
  ctx.provide('sessions', {
    binding: (id: SessionId) => ({
      sessionId: id,
      session: { projections: { faceOf: (key: string) => ({
        getSnapshot: () => (key !== 'goal' ? undefined : options.projection),
        subscribe: () => () => {},
      }) } },
      ctx,
    }),
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return {
    ctx,
    fiber,
    calls,
    remountGoals: () => { activeGoals = goals('remounted-goals') },
    unmountGoals: () => { activeGoals = undefined },
    entry: () => {
      const entry = ctx.slots.entries('conversation.input.dock')[0]
      if (entry === undefined) return undefined
      return {
        ...entry.options,
        locale: entry.locale,
        inject: entry.inject as unknown as ((sessionId: SessionId) => GoalBarActions) | undefined,
      }
    },
  }
}

describe('ui-goal browser plugin', () => {
  it('registers the GoalBar dock entry with the documented id and order', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toMatchObject({ id: 'goal', order: 10, locale: 'goal' })
    expect(b.entry()?.inject).toBeTypeOf('function')
  })

  it('verbs read the CAS ref from the current projected value at call time', async () => {
    const b = await bench({ projection: makeProjection(5) })
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1'))
    expect(await verbs.onEdit('New objective')).toEqual({ ok: true })
    expect(await verbs.onPause()).toEqual({ ok: true })
    expect(await verbs.onResume()).toEqual({ ok: true })
    expect(await verbs.onClear()).toEqual({ ok: true })
    expect(b.calls.map(c => c.method)).toEqual(['goals/edit', 'goals/pause', 'goals/resume', 'goals/clear'])
    const ref = { id: 'g-1', revision: 5 }
    expect(b.calls[0]?.args).toEqual(['s1', ref, { objective: 'New objective' }])
    expect(b.calls[1]?.args).toEqual(['s1', ref])
    expect(b.calls[2]?.args).toEqual(['s1', ref])
    expect(b.calls[3]?.args).toEqual(['s1', ref])
  })

  it('verbs read a remounted Remote namespace at action time', async () => {
    const b = await bench({ projection: makeProjection() })
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1'))
    b.remountGoals()

    expect(await verbs.onPause()).toEqual({ ok: true })
    expect(b.calls).toMatchObject([{ method: 'remounted-goals/pause' }])
  })

  it('settles every verb when the Remote namespace is temporarily absent', async () => {
    const b = await bench({ projection: makeProjection() })
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1'))
    b.unmountGoals()

    for (const result of [await verbs.onEdit('x'), await verbs.onPause(), await verbs.onResume(), await verbs.onClear()]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
    }
    expect(b.calls).toHaveLength(0)
  })

  it('a null or absent projection short-circuits every verb without touching the wire', async () => {
    for (const projection of [null, undefined]) {
      const b = await bench({ projection })
      await b.fiber.await()
      const verbs = b.entry()!.inject!(sid('s1'))
      for (const result of [await verbs.onEdit('x'), await verbs.onPause(), await verbs.onResume(), await verbs.onClear()]) {
        expect(result).toEqual({ ok: false, error: { code: 'no-current-goal', message: 'no current goal to mutate' } })
      }
      expect(b.calls).toHaveLength(0)
    }
  })

  it('maps a Remote error onto the inline-render shape', async () => {
    const b = await bench({ projection: makeProjection(), failWith: { code: 'internal', message: 'stale revision' } })
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1'))
    expect(await verbs.onEdit('x')).toEqual({ ok: false, error: { code: 'internal', message: 'stale revision' } })
  })

  it.each([
    [new Error('connection closed'), 'connection closed'],
    ['connection closed', 'goal mutation failed'],
    [new Error('invalid Remote failure', { cause: null }), 'invalid Remote failure'],
    [new Error('invalid Remote failure', { cause: { code: 1, message: 'stale revision' } }), 'invalid Remote failure'],
    [new Error('invalid Remote failure', { cause: { code: 'internal', message: 1 } }), 'invalid Remote failure'],
  ])('maps an unstructured rejection onto an internal error', async (rejection, message) => {
    const b = await bench({ projection: makeProjection(), rejectWith: rejection })
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1'))
    expect(await verbs.onEdit('x')).toEqual({ ok: false, error: { code: 'internal', message } })
  })

  it('drops the dock entry when the plugin fiber unloads (HMR safety)', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toBeDefined()
    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
  })
})

describe('GoalDock adapter', () => {
  it('renders the projected goal snapshot and nothing for absent/null', () => {
    const projection = makeProjection()
    const useProjection = vi.fn(() => projection)
    const actions: GoalBarActions = {
      onEdit: () => Promise.resolve({ ok: true }),
      onPause: () => Promise.resolve({ ok: true }),
      onResume: () => Promise.resolve({ ok: true }),
      onClear: () => Promise.resolve({ ok: true }),
    }
    const t = makeTranslate(zh, commonZh)
    const dockProps = (up: () => GoalProjection | null | undefined) =>
      ({ useProjection: up, ...actions, t }) as unknown as Parameters<typeof GoalDock>[0]
    const shown = render(<GoalDock {...dockProps(useProjection)} />)
    expect(shown.getByText('Ship it')).toBeTruthy()
    cleanup()

    const empty = render(<GoalDock {...dockProps(() => null)} />)
    expect(empty.container.firstChild).toBeNull()
    cleanup()

    const absent = render(<GoalDock {...dockProps(() => undefined)} />)
    expect(absent.container.firstChild).toBeNull()
  })
})

describe('ui-goal node half', () => {
  // The invariant companion is mounted by the vitest-wide invariant host on
  // every Context this suite creates; its registration is covered there.
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
