import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from 'cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import PtyService, { PtyBackendCleanupError, PtyError, PtySessionId } from '@deepseek-ai/dsh-pty'
import type {
  PtyBackend,
  PtyBackendSession,
  PtyReadRequest,
  PtySendOperation,
  PtySendRequest,
  PtySessionId as PtySessionIdType,
  PtySessionStatus,
  PtySignal,
} from '@deepseek-ai/dsh-pty'

const agentScopeDisposers = new WeakMap<Agent, () => Promise<void>>()
const ptyServiceDisposers = new WeakMap<Context, () => Promise<void>>()

function stubAgent(ctx: Context, rawId: string): Agent {
  const id = SessionId(rawId)
  const scopeFiber = ctx.plugin(() => {})
  const session = Session.create(id)
  const agent: Agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scopeFiber.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  agentScopeDisposers.set(agent, async () => { await scopeFiber.dispose() })
  return agent
}

async function disposeAgentScope(agent: Agent): Promise<void> {
  const dispose = agentScopeDisposers.get(agent)
  if (dispose === undefined) throw new Error('missing agent scope')
  await dispose()
}

class StubSession implements PtyBackendSession {
  readonly motd = 'stub ready'
  readonly pid = 123
  closed: string[] = []
  statusValue: PtySessionStatus = { kind: 'running' }
  operation: PtySendOperation | undefined
  rejectSend = false
  rejectClose = false
  closeGate: PromiseWithResolvers<undefined> | undefined

  startSend(_request: PtySendRequest): PtySendOperation {
    if (this.rejectSend) {
      return { done: Promise.reject(new Error('send failed')), readOutput: () => ({ delta: '', truncated: false }), cancel: () => false }
    }
    let settle!: () => void
    let settled = false
    const done = new Promise<void>((resolve) => { settle = resolve }).then(() => ({
      viewport: 'done',
      waitReason: 'stdin_read' as const,
      sessionStatus: this.statusValue,
      truncated: false,
    }))
    const operation: PtySendOperation = {
      done,
      readOutput: () => ({ delta: 'delta', truncated: false }),
      cancel: () => {
        if (settled) return false
        settled = true
        settle()
        return true
      },
    }
    this.operation = operation
    return operation
  }

  read(request: PtyReadRequest) {
    return { text: `${request.offset ?? 0}:${request.count ?? 0}`, totalLines: 1, lineBegin: 0, lineEnd: 1, truncated: false }
  }

  async signal(signal: PtySignal) {
    return { delivered: true as const, targetPgid: signal === 'SIGINT' ? 12 : 13 }
  }

  status(): PtySessionStatus {
    return this.statusValue
  }

  async close(reason: string): Promise<void> {
    this.closed.push(reason)
    if (this.rejectClose) throw new Error('close failed')
    if (this.closeGate !== undefined) await this.closeGate.promise
    this.statusValue = { kind: 'exited', exitCode: 0, signal: null }
    this.operation?.cancel()
  }
}

function backend(type = 'stub') {
  const sessions: StubSession[] = []
  const provider: PtyBackend = {
    type,
    async spawn() {
      const session = new StubSession()
      sessions.push(session)
      return session
    },
  }
  return { provider, sessions }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  const fiber = await ctx.plugin(PtyService)
  ptyServiceDisposers.set(ctx, async () => { await fiber.dispose() })
  return ctx
}

async function disposePtyService(ctx: Context): Promise<void> {
  const dispose = ptyServiceDisposers.get(ctx)
  if (dispose === undefined) throw new Error('missing PTY service fiber')
  await dispose()
}

describe('PtyService backend registry', () => {
  it('preserves the id brand and disposes exact backend contributions', async () => {
    expectTypeOf(PtySessionId('pty-1')).toEqualTypeOf<PtySessionIdType>()
    const ctx = await harness()
    const first = backend()
    const dispose = ctx.pty.registerBackend(first.provider)
    expect(ctx.pty.listBackends()).toEqual(['stub'])
    expect(() => ctx.pty.registerBackend(backend().provider)).toThrow(PtyError)
    const internal = ctx.pty as unknown as { backends: Map<string, PtyBackend> }
    internal.backends.set('stub', backend('replacement').provider)
    dispose()
    expect(ctx.pty.listBackends()).toEqual(['stub'])
    internal.backends.clear()
  })

  it('rejects empty backend types', async () => {
    const ctx = await harness()
    expect(() => ctx.pty.registerBackend(backend('').provider)).toThrow('must be non-empty')
  })
})

describe('PtyService ownership and lifecycle', () => {
  it('publishes only after spawn and fences every operation to the exact owner', async () => {
    const ctx = await harness()
    const b = backend()
    ctx.pty.registerBackend(b.provider)
    const owner = stubAgent(ctx, 'owner')
    const foreign = stubAgent(ctx, 'foreign')
    ctx.agents.register(owner)
    ctx.agents.register(foreign)

    const created = await ctx.pty.spawn(owner, { type: 'stub', name: 'main', cwd: '/tmp' })
    expect(created).toMatchObject({ sessionId: 'pty-1', name: 'main', type: 'stub', pid: 123, motd: 'stub ready', status: { kind: 'running' } })
    expect(ctx.pty.hasOwnerActivity(owner)).toBe(true)
    expect(ctx.pty.list(owner)).toHaveLength(1)
    expect(ctx.pty.list(foreign)).toEqual([])
    expect(() => ctx.pty.read(foreign, created.sessionId)).toThrow('belongs to another agent')
    expect(() => ctx.pty.signal(foreign, created.sessionId, 'SIGINT')).toThrow('belongs to another agent')
    await expect(Promise.resolve().then(() => ctx.pty.kill(foreign, created.sessionId))).rejects.toThrow('belongs to another agent')
  })

  it('rejects unknown backends, non-live owners, duplicate names, and active sends', async () => {
    const ctx = await harness()
    const owner = stubAgent(ctx, 'owner')
    await expect(ctx.pty.spawn(owner, { type: 'missing' })).rejects.toMatchObject({ code: 'OWNER_NOT_LIVE' })
    ctx.agents.register(owner)
    await expect(ctx.pty.spawn(owner, { type: 'missing' })).rejects.toMatchObject({ code: 'NO_BACKEND' })
    const b = backend()
    ctx.pty.registerBackend(b.provider)
    const created = await ctx.pty.spawn(owner, { type: 'stub', name: 'main' })
    await expect(ctx.pty.spawn(owner, { type: 'stub', name: '' })).rejects.toThrow('must be non-empty')
    const aborted = new AbortController()
    const abortReason = new Error('spawn aborted')
    aborted.abort(abortReason)
    await expect(ctx.pty.spawn(owner, { type: 'stub' }, aborted.signal)).rejects.toBe(abortReason)
    await expect(ctx.pty.spawn(owner, { type: 'stub', name: 'main' })).rejects.toMatchObject({ code: 'DUPLICATE_NAME' })

    const operation = ctx.pty.startSend(owner, created.sessionId, { text: 'echo hi', submit: true })
    expect(() => ctx.pty.startSend(owner, created.sessionId, { text: 'pwd', submit: true })).toThrow(PtyError)
    expect(operation.readOutput()).toEqual({ delta: 'delta', truncated: false })
    expect(operation.cancel()).toBe(true)
    await operation.done
    const next = ctx.pty.startSend(owner, created.sessionId, { text: 'pwd', submit: true })
    next.cancel()
    await next.done

    b.sessions[0]!.rejectSend = true
    await expect(ctx.pty.startSend(owner, created.sessionId, { text: 'bad', submit: true }).done).rejects.toThrow('send failed')
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('reserves concurrent names and rolls back a spawn whose owner disappears', async () => {
    const ctx = await harness()
    const gate = Promise.withResolvers<PtyBackendSession>()
    const session = new StubSession()
    ctx.pty.registerBackend({ type: 'slow', spawn: () => gate.promise })
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    const pending = ctx.pty.spawn(owner, { type: 'slow', name: 'main' })
    await expect(ctx.pty.spawn(owner, { type: 'slow', name: 'main' })).rejects.toMatchObject({ code: 'DUPLICATE_NAME' })
    const disposal = disposeAgentScope(owner)
    gate.resolve(session)
    await expect(pending).rejects.toMatchObject({ code: 'OWNER_NOT_LIVE' })
    await disposal
    expect(session.closed).toEqual(['PTY spawn rolled back'])
  })

  it('preserves caller cancellation when a pending backend spawn completes', async () => {
    const ctx = await harness()
    const gate = Promise.withResolvers<PtyBackendSession>()
    const session = new StubSession()
    ctx.pty.registerBackend({ type: 'slow', spawn: () => gate.promise })
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    const controller = new AbortController()
    const reason = new Error('cancelled by caller')

    const pending = ctx.pty.spawn(owner, { type: 'slow' }, controller.signal)
    controller.abort(reason)
    gate.resolve(session)

    await expect(pending).rejects.toBe(reason)
    expect(session.closed).toEqual(['PTY spawn rolled back'])
    expect(ctx.agents.get(owner.id)).toBe(owner)
  })

  it('preserves caller cancellation when unpublished rollback fails', async () => {
    const ctx = await harness()
    const gate = Promise.withResolvers<PtyBackendSession>()
    const session = new StubSession()
    session.rejectClose = true
    ctx.pty.registerBackend({ type: 'slow', spawn: () => gate.promise })
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    const controller = new AbortController()
    const reason = new Error('cancelled by caller')

    const pending = ctx.pty.spawn(owner, { type: 'slow' }, controller.signal)
    controller.abort(reason)
    gate.resolve(session)

    await expect(pending).rejects.toBe(reason)
    expect(ctx.pty.hasOwnerActivity(owner)).toBe(true)
    const internal = ctx.pty as unknown as { disposeAll(): Promise<void> }
    await expect(internal.disposeAll()).rejects.toThrow('failed to clean up PTY lifecycle')
    expect(ctx.pty.hasOwnerActivity(owner)).toBe(false)
    expect(session.closed).toEqual(['PTY spawn rolled back'])
  })

  it('preserves caller cancellation when a backend rejects in response to it', async () => {
    const ctx = await harness()
    const started = Promise.withResolvers<undefined>()
    const backendFailure = new Error('backend observed cancellation')
    ctx.pty.registerBackend({
      type: 'abortable',
      spawn: ({ signal }) => new Promise((_resolve, reject) => {
        if (signal === undefined) throw new Error('missing spawn signal')
        started.resolve(undefined)
        signal.addEventListener('abort', () => { reject(backendFailure) }, { once: true })
      }),
    })
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    const controller = new AbortController()
    const reason = new Error('cancelled by caller')

    const pending = ctx.pty.spawn(owner, { type: 'abortable' }, controller.signal)
    await started.promise
    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
  })

  it.each(['owner', 'service'] as const)('retains caller-triggered backend cleanup failure until %s disposal', async (scope) => {
    const ctx = await harness()
    const started = Promise.withResolvers<undefined>()
    const cleanupFailure = new Error('backend cleanup failed')
    ctx.pty.registerBackend({
      type: 'cleanup-failing',
      spawn: ({ signal }) => new Promise((_resolve, reject) => {
        if (signal === undefined) throw new Error('missing spawn signal')
        started.resolve(undefined)
        signal.addEventListener('abort', () => {
          reject(new PtyBackendCleanupError(signal.reason, cleanupFailure))
        }, { once: true })
      }),
    })
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    const controller = new AbortController()
    const reason = new Error('cancelled by caller')

    const pending = ctx.pty.spawn(owner, { type: 'cleanup-failing' }, controller.signal)
    await started.promise
    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(ctx.pty.hasOwnerActivity(owner)).toBe(true)
    const internal = ctx.pty as unknown as {
      disposeOwned(owner: Agent): Promise<void>
      disposeAll(): Promise<void>
    }
    const disposal = scope === 'owner' ? internal.disposeOwned(owner) : internal.disposeAll()
    await expect(disposal).rejects.toThrow('failed to clean up PTY lifecycle')
    expect(ctx.pty.hasOwnerActivity(owner)).toBe(false)
  })

  it.each([
    { scope: 'owner', code: 'OWNER_NOT_LIVE' },
    { scope: 'service', code: 'SERVICE_DISPOSING' },
  ] as const)('$scope disposal aborts and awaits unpublished backend setup', async ({ scope, code }) => {
    const ctx = await harness()
    const gate = Promise.withResolvers<PtyBackendSession>()
    const started = Promise.withResolvers<undefined>()
    const session = new StubSession()
    let backendSignal: AbortSignal | undefined
    ctx.pty.registerBackend({
      type: 'slow',
      spawn: (spec) => {
        backendSignal = spec.signal
        started.resolve(undefined)
        return gate.promise
      },
    })
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)

    const pending = ctx.pty.spawn(owner, { type: 'slow' })
    const pendingFailure = pending.then(
      () => { throw new Error('pending spawn unexpectedly succeeded') },
      (error: unknown) => error,
    )
    await started.promise
    let disposalSettled = false
    const disposal = (scope === 'owner' ? disposeAgentScope(owner) : disposePtyService(ctx))
      .then(() => { disposalSettled = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    const signalAbortedBeforeRelease = backendSignal?.aborted ?? false
    const signalReasonBeforeRelease = backendSignal?.reason as unknown
    const disposalSettledBeforeRelease = disposalSettled
    gate.resolve(session)

    expect(await pendingFailure).toMatchObject({ code })
    await disposal
    expect(signalAbortedBeforeRelease).toBe(true)
    expect(signalReasonBeforeRelease).toMatchObject({ code })
    expect(disposalSettledBeforeRelease).toBe(false)
    expect(session.closed).toEqual(['PTY spawn rolled back'])
  })

  it('reports unpublished rollback failure through service disposal', async () => {
    const ctx = await harness()
    const gate = Promise.withResolvers<PtyBackendSession>()
    const session = new StubSession()
    session.rejectClose = true
    ctx.pty.registerBackend({ type: 'slow', spawn: () => gate.promise })
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)

    const pending = ctx.pty.spawn(owner, { type: 'slow' })
    const pendingFailure = expect(pending).rejects.toThrow('PTY spawn and rollback both failed')
    const internal = ctx.pty as unknown as { disposeAll(): Promise<void> }
    const disposalFailure = expect(internal.disposeAll()).rejects.toThrow('failed to clean up PTY lifecycle')
    gate.resolve(session)

    await pendingFailure
    await disposalFailure
    expect(session.closed).toEqual(['PTY spawn rolled back'])
  })

  it.each([
    { scope: 'owner', code: 'OWNER_NOT_LIVE' },
    { scope: 'service', code: 'SERVICE_DISPOSING' },
  ] as const)('$scope disposal retains backend-side startup cleanup failure', async ({ scope, code }) => {
    const ctx = await harness()
    const started = Promise.withResolvers<undefined>()
    const cleanupFailure = new Error('backend cleanup failed')
    let backendAbortReason: unknown
    ctx.pty.registerBackend({
      type: 'cleanup-failing',
      spawn: ({ signal }) => new Promise((_resolve, reject) => {
        if (signal === undefined) throw new Error('missing spawn signal')
        started.resolve(undefined)
        signal.addEventListener('abort', () => {
          backendAbortReason = signal.reason
          reject(new PtyBackendCleanupError(signal.reason, cleanupFailure))
        }, { once: true })
      }),
    })
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)

    const pending = ctx.pty.spawn(owner, { type: 'cleanup-failing' })
    await started.promise
    const internal = ctx.pty as unknown as {
      disposeOwned(owner: Agent): Promise<void>
      disposeAll(): Promise<void>
    }
    const disposal = scope === 'owner' ? internal.disposeOwned(owner) : internal.disposeAll()
    const pendingError = await pending.then(
      () => { throw new Error('pending spawn unexpectedly succeeded') },
      (error: unknown) => error,
    )

    expect(pendingError).toBe(backendAbortReason)
    expect(pendingError).toMatchObject({ code })
    const disposalError = await disposal.then(
      () => { throw new Error('disposal unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(disposalError).toMatchObject({ message: 'failed to clean up PTY lifecycle' })
    const rollbackError = (disposalError as AggregateError).errors[0] as unknown
    const cleanupErrors = (rollbackError as AggregateError).errors as unknown[]
    expect(cleanupErrors).toEqual([cleanupFailure])
  })

  it('keeps independent reservations and handles provider failure before publication', async () => {
    const ctx = await harness()
    const firstGate = Promise.withResolvers<PtyBackendSession>()
    const secondGate = Promise.withResolvers<PtyBackendSession>()
    let count = 0
    ctx.pty.registerBackend({
      type: 'slow',
      spawn: () => ++count === 1 ? firstGate.promise : secondGate.promise,
    })
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    const first = ctx.pty.spawn(owner, { type: 'slow', name: 'one' })
    const second = ctx.pty.spawn(owner, { type: 'slow', name: 'two' })
    firstGate.resolve(new StubSession())
    await first
    secondGate.resolve(new StubSession())
    await second

    ctx.pty.registerBackend({ type: 'throwing', spawn: () => Promise.reject(new Error('provider failed')) })
    await expect(ctx.pty.spawn(owner, { type: 'throwing' })).rejects.toThrow('provider failed')

    const controller = new AbortController()
    const b = backend('signaled')
    ctx.pty.registerBackend(b.provider)
    await ctx.pty.spawn(owner, { type: 'signaled' }, controller.signal)
  })

  it('omits optional pid metadata when a backend has no process id', async () => {
    const ctx = await harness()
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    const session = new StubSession()
    Object.defineProperty(session, 'pid', { value: undefined })
    ctx.pty.registerBackend({ type: 'virtual', spawn: () => Promise.resolve(session) })
    expect(await ctx.pty.spawn(owner, { type: 'virtual' })).not.toHaveProperty('pid')
  })

  it('reports rollback and close failures without publishing false success', async () => {
    const ctx = await harness()
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    const failedSpawn = new StubSession()
    failedSpawn.rejectClose = true
    let ownerDisposal = Promise.resolve()
    const internal = ctx.pty as unknown as {
      disposedOwners: WeakSet<Agent>
      disposeOwned(owner: Agent): Promise<void>
    }
    ctx.pty.registerBackend({
      type: 'bad-spawn',
      async spawn({ signal }) {
        if (signal === undefined) throw new Error('missing spawn signal')
        internal.disposedOwners.add(owner)
        ownerDisposal = internal.disposeOwned(owner)
        if (!signal.aborted) {
          await new Promise<undefined>((resolve) => {
            signal.addEventListener('abort', () => { resolve(undefined) }, { once: true })
          })
        }
        return failedSpawn
      },
    })
    await expect(ctx.pty.spawn(owner, { type: 'bad-spawn' })).rejects.toThrow('spawn and rollback both failed')
    await expect(ownerDisposal).rejects.toThrow('failed to clean up PTY lifecycle')

    const nextOwner = stubAgent(ctx, 'next')
    ctx.agents.register(nextOwner)
    const b = backend('bad-close')
    ctx.pty.registerBackend(b.provider)
    const created = await ctx.pty.spawn(nextOwner, { type: 'bad-close' })
    b.sessions[0]!.rejectClose = true
    await expect(ctx.pty.kill(nextOwner, created.sessionId)).rejects.toThrow('close failed')
    expect(ctx.pty.list(nextOwner)).toHaveLength(1)
  })

  it('joins an already-running close and refuses new sends while closing', async () => {
    const ctx = await harness()
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    const b = backend()
    ctx.pty.registerBackend(b.provider)
    const created = await ctx.pty.spawn(owner, { type: 'stub' })
    b.sessions[0]!.closeGate = Promise.withResolvers<undefined>()
    const first = ctx.pty.kill(owner, created.sessionId)
    expect(() => ctx.pty.startSend(owner, created.sessionId, { text: '', submit: false })).toThrow('closing')
    const second = ctx.pty.kill(owner, created.sessionId)
    b.sessions[0]!.closeGate?.resolve(undefined)
    expect(await first).toBe(true)
    expect(await second).toBe(false)
    expect(() => ctx.pty.read(owner, created.sessionId)).toThrow('unknown PTY')
  })

  it('awaits owner cleanup and removes sessions while backend registration may reload', async () => {
    const ctx = await harness()
    const b = backend()
    const disposeBackend = ctx.pty.registerBackend(b.provider)
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    const created = await ctx.pty.spawn(owner, { type: 'stub' })
    disposeBackend()
    expect(ctx.pty.listBackends()).toEqual([])
    expect(ctx.pty.read(owner, created.sessionId).text).toBe('0:0')

    await disposeAgentScope(owner)
    expect(b.sessions[0]?.closed).toEqual(['PTY owner disposed'])
    expect(ctx.pty.list(owner)).toEqual([])
  })

  it('kills idempotently and service disposal closes all owners', async () => {
    const ctx = await harness()
    const b = backend()
    ctx.pty.registerBackend(b.provider)
    const first = stubAgent(ctx, 'first')
    const second = stubAgent(ctx, 'second')
    ctx.agents.register(first)
    ctx.agents.register(second)
    const a = await ctx.pty.spawn(first, { type: 'stub' })
    await ctx.pty.spawn(second, { type: 'stub' })
    expect(await ctx.pty.kill(first, a.sessionId)).toBe(true)
    expect(b.sessions[0]?.closed).toEqual(['model request'])

    const service = ctx.pty
    await disposePtyService(ctx)
    expect(b.sessions[1]?.closed).toEqual(['PTY service disposed'])
    await expect(service.spawn(first, { type: 'stub' })).rejects.toMatchObject({ code: 'SERVICE_DISPOSING' })
  })

  it('aggregates service-disposal close failures after attempting every record', async () => {
    const ctx = await harness()
    const service = ctx.pty
    const b = backend()
    ctx.pty.registerBackend(b.provider)
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    await ctx.pty.spawn(owner, { type: 'stub' })
    b.sessions[0]!.rejectClose = true
    const internal = service as unknown as {
      sessions: Map<PtySessionIdType, unknown>
      closeRecords(records: unknown[], reason: string): Promise<void>
    }
    const records = [...internal.sessions.values()]
    const firstFailure = expect(internal.closeRecords(records, 'test failure')).rejects.toThrow('failed to close 1 PTY session')
    const joinedFailure = expect(internal.closeRecords(records, 'joined failure')).rejects.toThrow('failed to close 1 PTY session')
    await firstFailure
    await joinedFailure
    b.sessions[0]!.rejectClose = false
    await expect(internal.closeRecords([...internal.sessions.values()], 'retry')).resolves.toBeUndefined()
    expect(b.sessions[0]!.closed).toEqual(['test failure', 'retry'])
    expect(internal.sessions.size).toBe(0)
    await disposePtyService(ctx)
    await expect(service.spawn(owner, { type: 'stub' })).rejects.toMatchObject({ code: 'SERVICE_DISPOSING' })
  })

  it('clears registries and runs owner cleanups even when a session close fails', async () => {
    const ctx = await harness()
    const service = ctx.pty
    const b = backend()
    service.registerBackend(b.provider)
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    await service.spawn(owner, { type: 'stub' })
    b.sessions[0]!.rejectClose = true
    const internal = service as unknown as {
      disposeAll(): Promise<void>
      backends: Map<string, unknown>
      ownerCleanups: Map<Agent, unknown>
    }
    // Teardown surfaces the close failure, but its finally still clears the
    // backend and owner-cleanup registries instead of orphaning them.
    await expect(internal.disposeAll()).rejects.toThrow('failed to clean up PTY lifecycle')
    expect(internal.backends.size).toBe(0)
    expect(internal.ownerCleanups.size).toBe(0)
  })
})
