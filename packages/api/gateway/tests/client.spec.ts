import { Context, Service } from 'cordis'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {
  InvocationDescriptor,
  TypeRTClientRemote,
  TypeRTContext,
  TypeRTRemoteScopeApi,
  TypeRTRemoteNamespace,
} from '@deepseek-ai/dsh-type-meta'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { apply, inject } from '../src/client/index.ts'

declare module '@deepseek-ai/dsh-type-meta' {
  interface TypeRTContextMap {
    fixture: TypeRTContext<string>
  }

  interface TypeRTRemoteMap {
    'goals/create': (
      agentId: string,
      request: { readonly objective: string },
      signal?: AbortSignal,
    ) => Promise<{ readonly ref: string }>
  }

  interface TypeRTRemoteScopeMap {
    'fixture:goals/create': (
      request: { readonly objective: string },
      signal?: AbortSignal,
    ) => Promise<{ readonly ref: string }>
    'fixture:goals/rename': (request: { readonly objective: string }) => Promise<{ readonly renamed: boolean }>
  }

  interface TypeRTRemoteNamespaceMap {
    goals: TypeRTRemoteNamespace<'goals'>
  }

}

type FixtureContext = Omit<Context, 'remote'> & {
  readonly remote: TypeRTClientRemote & TypeRTRemoteScopeApi<'fixture'>
}

const idSchema = z.string().min(1)
const requestSchema = z.object({ objective: z.string().min(1) })
const createResultSchema = z.object({ ref: z.string().min(1) })
const renameResultSchema = z.object({ renamed: z.boolean() })

function directDescriptor(): InvocationDescriptor {
  return {
    id: '@fixture/goals#goals/create',
    service: 'goals',
    namespace: 'goals',
    method: 'create',
    invocation: { kind: 'direct' },
    scope: { context: 'fixture', wire: 'agentId' },
    parameters: [{
      name: 'agent',
      wire: 'agentId',
      source: 'lookup',
      lookup: 'fixture',
      codec: { mode: 'strict', typeSymbol: '@fixture#AgentId', schema: idSchema },
    }, {
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: '@fixture#CreateRequest', schema: requestSchema },
    }],
    cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: '@fixture#CreateResult', schema: createResultSchema },
  }
}

function contextDescriptor(): InvocationDescriptor {
  return {
    id: '@fixture/goals#goals/rename',
    service: 'goals',
    namespace: 'goals',
    method: 'rename',
    invocation: {
      kind: 'context',
      context: 'fixture',
      wire: 'agentId',
      codec: { mode: 'strict', typeSymbol: '@fixture#AgentId', schema: idSchema },
    },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: '@fixture#RenameRequest', schema: requestSchema },
    }],
    result: { mode: 'strict', typeSymbol: '@fixture#RenameResult', schema: renameResultSchema },
  }
}

async function bench(call: ConnectionHandle['rpc']['call']): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  ctx.provide('connection', { rpc: { call } } as unknown as ConnectionHandle)
  await ctx.plugin({ inject, apply })
  return ctx
}

describe('Client TypeRT API', () => {
  it('mounts concrete direct methods, validates both boundaries, and withdraws retained handles', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValue({ ok: true, value: { ref: 'goal-1' } })
    const ctx = await bench(call)
    const businessGoals = { owner: 'host business service' }
    const disposeBusinessGoals = ctx.provide('goals', businessGoals)
    const assembly = ctx.plugin(Object.assign(
      (scope: Context) => scope.remote.$mount({ package: '@fixture/goals', descriptors: [directDescriptor()] }),
      { inject: ['remote'] },
    ))
    await assembly
    const retained = ctx.remote.goals.create

    await expect(ctx.remote.goals.create('agent-1', { objective: 'ship' })).resolves.toEqual({ ref: 'goal-1' })
    expect(call).toHaveBeenCalledWith(
      '/api',
      'goals/create',
      { args: { agentId: 'agent-1', request: { objective: 'ship' } } },
      expect.any(AbortSignal),
    )
    const callerAbort = new AbortController()
    await expect(ctx.remote.goals.create(
      'agent-1',
      { objective: 'cancel me' },
      callerAbort.signal,
    )).resolves.toEqual({ ref: 'goal-1' })
    const combinedSignal = call.mock.calls.at(-1)?.[3]
    expect(combinedSignal).toBeInstanceOf(AbortSignal)
    expect(combinedSignal).not.toBe(callerAbort.signal)
    const cancellation = new Error('caller cancelled')
    callerAbort.abort(cancellation)
    expect(combinedSignal?.aborted).toBe(true)
    expect(combinedSignal?.reason).toBe(cancellation)
    await expect(ctx.remote.goals.create('', { objective: 'ship' })).rejects.toThrow('rejected "agentId"')

    call.mockResolvedValueOnce({ ok: true, value: { ref: 1 } })
    await expect(ctx.remote.goals.create('agent-1', { objective: 'ship' })).rejects.toThrow('rejected "result"')

    await assembly.dispose()
    expect((ctx.remote as unknown as Record<string, unknown>).goals).toBeUndefined()
    expect(ctx.get('remote.goals')).toBeUndefined()
    expect(ctx.get('goals')).toBe(businessGoals)
    expect(ctx.typert.remotes.list()).toEqual([])
    await expect(retained?.('agent-1', { objective: 'ship' })).rejects.toThrow('no longer mounted')
    disposeBusinessGoals()
  })

  it('projects one direct lookup descriptor onto an Agent-scoped alias', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValue({ ok: true, value: { ref: 'goal-2' } })
    const ctx = await bench(call)
    const agentCtx = ctx.extend({ fixtureId: 'agent-2' }) as FixtureContext
    ctx.typert.contexts.registerClient('fixture', {
      identity: candidate => (candidate as Context & { fixtureId?: string }).fixtureId,
    })
    const assembly = ctx.plugin(Object.assign(
      (scope: Context) => scope.remote.$mount({ package: '@fixture/goals', descriptors: [directDescriptor()] }),
      { inject: ['remote'] },
    ))
    await assembly

    await expect(agentCtx.remote.goals.create({ objective: 'ship scoped' })).resolves.toEqual({ ref: 'goal-2' })
    expect(call).toHaveBeenCalledWith(
      '/api',
      'goals/create',
      { args: { agentId: 'agent-2', request: { objective: 'ship scoped' } } },
      expect.any(AbortSignal),
    )
    await expect((ctx as FixtureContext).remote.goals.create({ objective: 'wrong scope' }))
      .rejects.toThrow('expected 2 business argument(s)')

    await assembly.dispose()
    expect((ctx.remote as unknown as Record<string, unknown>).goals).toBeUndefined()
    expect(ctx.get('remote.goals')).toBeUndefined()
  })

  it('uses the caller Context identity for scoped namespace methods', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValue({ ok: true, value: { renamed: true } })
    const ctx = await bench(call)
    const agentCtx = ctx.extend({ fixtureId: 'agent-2' }) as FixtureContext
    ctx.typert.contexts.registerClient('fixture', {
      identity: candidate => (candidate as Context & { fixtureId?: string }).fixtureId,
    })
    const assembly = ctx.plugin(Object.assign(
      (scope: Context) => scope.remote.$mount({ package: '@fixture/goals', descriptors: [contextDescriptor()] }),
      { inject: ['remote'] },
    ))
    await assembly

    await expect(agentCtx.remote.goals.rename({ objective: 'land' })).resolves.toEqual({ renamed: true })
    expect(call).toHaveBeenCalledWith(
      '/api',
      'goals/rename',
      { args: { agentId: 'agent-2', request: { objective: 'land' } } },
      expect.any(AbortSignal),
    )
    await expect((ctx as FixtureContext).remote.goals.rename({ objective: 'land' }))
      .rejects.toThrow('requires a "fixture" Context')

    await assembly.dispose()
    expect(ctx.get('remote.goals')).toBeUndefined()
  })

  it('rejects weak descriptors and namespace collisions before registration', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const weak: InvocationDescriptor = {
      ...directDescriptor(),
      result: { mode: 'src-json' },
    }

    await expect(ctx.remote.$mount({ package: '@fixture/weak', descriptors: [weak] }))
      .rejects.toThrow('has no strict codec')
    await expect(ctx.remote.$mount({
      package: '@fixture/conflict',
      descriptors: [{ ...directDescriptor(), namespace: '$mount' }],
    })).rejects.toThrow('conflicts with the Remote service')
    expect(ctx.typert.remotes.list()).toEqual([])
  })

  it('rejects duplicate, live, scoped-service, and Context namespace collisions', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValue({ ok: true, value: { renamed: true } })
    const ctx = await bench(call)
    const agentCtx = ctx.extend({ fixtureId: 'agent-remounted' }) as FixtureContext
    ctx.typert.contexts.registerClient('fixture', {
      identity: candidate => (candidate as Context & { fixtureId?: string }).fixtureId,
    })
    const direct = directDescriptor()
    const context = contextDescriptor()

    await expect(ctx.remote.$mount({
      package: '@fixture/direct-duplicates',
      descriptors: [direct, { ...direct, id: '@fixture/goals#goals/create-again' }],
    })).rejects.toThrow('repeats direct method')
    await expect(ctx.remote.$mount({
      package: '@fixture/scoped-duplicates',
      descriptors: [context, { ...context, id: '@fixture/goals#goals/rename-again' }],
    })).rejects.toThrow('repeats scoped method')

    const disposeDirect = await ctx.remote.$mount({ package: '@fixture/direct-live', descriptors: [direct] })
    await expect(ctx.remote.$mount({
      package: '@fixture/direct-conflict', descriptors: [{ ...direct, id: '@fixture/other#goals/create' }],
    })).rejects.toThrow('direct method goals/create is already mounted')
    await disposeDirect()

    const disposeScoped = await ctx.remote.$mount({ package: '@fixture/scoped-live', descriptors: [context] })
    await expect(ctx.remote.$mount({
      package: '@fixture/scoped-conflict', descriptors: [{ ...context, id: '@fixture/other#goals/rename' }],
    })).rejects.toThrow('scoped method goals/rename is already mounted')
    await expect(ctx.remote.$mount({
      package: '@fixture/service-method-conflict',
      descriptors: [{ ...context, id: '@fixture/goals#goals/remove', method: 'remove' }],
    })).rejects.toThrow('conflicts with its namespace service')
    const scopedService = ctx.get('remote.goals') as unknown as object
    Object.defineProperty(scopedService, 'custom', { configurable: true, value: () => undefined })
    await expect(ctx.remote.$mount({
      package: '@fixture/service-own-property-conflict',
      descriptors: [{ ...direct, id: '@fixture/goals#goals/custom', method: 'custom' }],
    })).rejects.toThrow('conflicts with its namespace service')
    Reflect.deleteProperty(scopedService, 'custom')
    await disposeScoped()

    const disposeRemoteTypert = ctx.reflect.provide('remote.typert', { owner: 'fixture' })
    await expect(ctx.remote.$mount({
      package: '@fixture/context-property-conflict',
      descriptors: [{ ...context, namespace: 'typert' }],
    })).rejects.toThrow('conflicts with an existing Remote namespace')
    await disposeRemoteTypert()

    const disposeMultipleScoped = await ctx.remote.$mount({
      package: '@fixture/multiple-scoped',
      descriptors: [directDescriptor(), contextDescriptor()],
    })
    await expect(agentCtx.remote.goals.rename({ objective: 'remounted' })).resolves.toEqual({ renamed: true })
    expect(call).toHaveBeenLastCalledWith(
      '/api',
      'goals/rename',
      { args: { agentId: 'agent-remounted', request: { objective: 'remounted' } } },
      expect.any(AbortSignal),
    )
    await disposeMultipleScoped()
  })

  it('rolls back earlier descriptors when a later descriptor fails to install', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const { scope: _scope, ...first } = directDescriptor()
    const second: InvocationDescriptor = {
      ...first,
      id: '@fixture/goals#goals/archive',
      method: 'archive',
    }
    const defineProperty = Object.defineProperty
    const spy = vi.spyOn(Object, 'defineProperty').mockImplementation((target, key, attributes) => {
      if (key === 'archive') throw new Error('fixture later-descriptor failure')
      return defineProperty(target, key, attributes)
    })
    try {
      await expect(ctx.remote.$mount({ package: '@fixture/failing-batch', descriptors: [first, second] }))
        .rejects.toThrow('fixture later-descriptor failure')
    } finally {
      spy.mockRestore()
    }

    expect((ctx.remote as unknown as Record<string, unknown>).goals).toBeUndefined()
    await vi.waitFor(() => { expect(ctx.typert.remotes.list()).toEqual([]) })
    const retry = await ctx.remote.$mount({ package: '@fixture/retry-batch', descriptors: [first, second] })
    expect(ctx.remote.goals.create).toBeTypeOf('function')
    expect((ctx.remote.goals as unknown as Record<string, unknown>).archive).toBeTypeOf('function')
    await retry()
  })

  it('rolls back a direct projection when its scoped projection fails to install', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const disposeContext = await ctx.remote.$mount({
      package: '@fixture/context-anchor',
      descriptors: [contextDescriptor()],
    })
    const namespace = ctx.get('remote.goals') as unknown as {
      installScoped: (...args: unknown[]) => void
      readonly create?: unknown
    }
    const installScoped = vi.spyOn(namespace, 'installScoped').mockImplementation(() => {
      throw new Error('fixture scoped projection failure')
    })
    try {
      await expect(ctx.remote.$mount({
        package: '@fixture/direct-projection-failure',
        descriptors: [directDescriptor()],
      })).rejects.toThrow('fixture scoped projection failure')
    } finally {
      installScoped.mockRestore()
    }

    expect(namespace.create).toBeUndefined()
    await disposeContext()
  })

  it('rejects weak parameter and Context codecs plus malformed scope projections', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const direct = directDescriptor()
    const context = contextDescriptor()
    await expect(ctx.remote.$mount({
      package: '@fixture/weak-parameter',
      descriptors: [{
        ...direct,
        parameters: direct.parameters.map((parameter, index) => index === 0
          ? { ...parameter, codec: { mode: 'src-json' } }
          : parameter),
      }],
    })).rejects.toThrow('has no strict codec')
    await expect(ctx.remote.$mount({
      package: '@fixture/weak-context',
      descriptors: [{
        ...context,
        invocation: { ...context.invocation, codec: { mode: 'src-json' } },
      } as InvocationDescriptor],
    })).rejects.toThrow('has no strict codec')
    await expect(ctx.remote.$mount({
      package: '@fixture/malformed-scope',
      descriptors: [{ ...direct, scope: { context: 'fixture', wire: 'missingId' } }],
    })).rejects.toThrow('scope must select its only lookup parameter')
    await expect(ctx.remote.$mount({
      package: '@fixture/ambiguous-scope',
      descriptors: [{
        ...direct,
        parameters: [...direct.parameters, {
          name: 'other', wire: 'otherId', source: 'lookup', lookup: 'fixture',
          codec: { mode: 'strict', typeSymbol: '@fixture#AgentId', schema: idSchema },
        }],
      }],
    })).rejects.toThrow('scope must select its only lookup parameter')
  })

  it('validates invocation arity, required binders, live Connection, and mutable descriptor codecs', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValue({ ok: true, value: { ref: 'goal-1' } })
    const ctx = await bench(call)
    const descriptor = directDescriptor()
    const dispose = await ctx.remote.$mount({
      package: '@fixture/goals',
      descriptors: [descriptor, contextDescriptor()],
    })
    const create = ctx.remote.goals.create as unknown as (...args: unknown[]) => Promise<unknown>
    const goals = (ctx as FixtureContext).remote.goals
    const rename = goals.rename as unknown as (...args: unknown[]) => Promise<unknown>

    await expect(create('agent-1')).rejects.toThrow('expected 2 business argument(s) plus an optional AbortSignal, got 1')
    await expect(create('agent-1', { objective: 'ship' }, undefined, 'extra'))
      .rejects.toThrow('got 4')
    await expect(rename.call(goals)).rejects.toThrow('expected 1 argument(s), got 0')
    await expect((ctx as FixtureContext).remote.goals.create({ objective: 'ship' }))
      .rejects.toThrow('expected 2 business argument(s)')
    await expect((ctx as FixtureContext).remote.goals.rename({ objective: 'ship' }))
      .rejects.toThrow('no Client Context binder')

    ;(descriptor.parameters[0] as { codec: { mode: string } }).codec.mode = 'src-json'
    await expect(ctx.remote.goals.create('agent-1', { objective: 'ship' })).rejects.toThrow('has no strict codec')
    ;(descriptor.parameters[0] as { codec: { mode: string } }).codec.mode = 'strict'

    ctx.set('connection', undefined)
    await expect(ctx.remote.goals.create('agent-1', { objective: 'ship' })).rejects.toThrow('no active Connection')
    await dispose()
  })

  it('withdraws a pending invocation and preserves a direct namespace until its last method leaves', async () => {
    let resolveCall!: (result: Awaited<ReturnType<ConnectionHandle['rpc']['call']>>) => void
    const pending = new Promise<Awaited<ReturnType<ConnectionHandle['rpc']['call']>>>((resolve) => {
      resolveCall = resolve
    })
    const call = vi.fn<ConnectionHandle['rpc']['call']>().mockReturnValue(pending)
    const ctx = await bench(call)
    const { scope: _scope, ...first } = directDescriptor()
    const second: InvocationDescriptor = {
      ...first,
      id: '@fixture/goals#goals/archive',
      method: 'archive',
    }
    const dispose = await ctx.remote.$mount({ package: '@fixture/goals', descriptors: [first, second] })
    const invocation = ctx.remote.goals.create('agent-1', { objective: 'ship' })
    await vi.waitFor(() => { expect(call).toHaveBeenCalledTimes(1) })
    await dispose()
    resolveCall({ ok: true, value: { ref: 'goal-1' } })

    await expect(invocation).rejects.toThrow('withdrawn during invocation')
    expect((ctx.remote as unknown as Record<string, unknown>).goals).toBeUndefined()
  })

  it('fails a method obtained from a withdrawn namespace getter', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const dispose = await ctx.remote.$mount({ package: '@fixture/goals', descriptors: [directDescriptor()] })
    const namespace = ctx.get('remote.goals') as unknown as object
    const getWithdrawn = Object.getOwnPropertyDescriptor(namespace, 'create')?.get?.bind(namespace)

    await dispose()

    expect(getWithdrawn).toBeTypeOf('function')
    const withdrawn = getWithdrawn?.() as (...args: unknown[]) => Promise<unknown>
    expect(() => withdrawn('agent-1', { objective: 'ship' }))
      .toThrow('Remote method is no longer mounted')
  })

  it('preserves a __proto__ wire parameter as an own named argument', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>()
      .mockResolvedValue({ ok: true, value: { ref: 'goal-1' } })
    const ctx = await bench(call)
    const { scope: _scope, ...base } = directDescriptor()
    const descriptor: InvocationDescriptor = {
      ...base,
      id: '@fixture/goals#goals/prototype',
      method: 'prototype',
      parameters: [{
        name: 'value',
        wire: '__proto__',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: '@fixture#PrototypeValue', schema: z.string() },
      }],
    }
    const dispose = await ctx.remote.$mount({ package: '@fixture/prototype', descriptors: [descriptor] })

    const method = (ctx.remote.goals as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>).prototype
    await expect(method?.('wire-value')).resolves.toEqual({ ref: 'goal-1' })
    const payload = call.mock.calls[0]?.[2] as { readonly args: Record<string, unknown> }
    expect(Object.getPrototypeOf(payload.args)).toBeNull()
    expect(Object.hasOwn(payload.args, '__proto__')).toBe(true)
    expect(payload.args.__proto__).toBe('wire-value')
    await dispose()
  })

  it('rolls back Remote registration when namespace Service startup fails', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const defineProperty = Object.defineProperty
    const spy = vi.spyOn(Object, 'defineProperty').mockImplementation((target, key, attributes) => {
      if (key === Service.tracker) throw new Error('fixture namespace startup failure')
      return defineProperty(target, key, attributes)
    })
    try {
      await expect(ctx.remote.$mount({ package: '@fixture/goals', descriptors: [directDescriptor()] }))
        .rejects.toThrow('fixture namespace startup failure')
      await vi.waitFor(() => { expect(ctx.typert.remotes.list()).toEqual([]) })
    } finally {
      spy.mockRestore()
    }

    const retry = await ctx.remote.$mount({ package: '@fixture/goals-retry', descriptors: [directDescriptor()] })
    expect(ctx.remote.goals.create).toBeTypeOf('function')
    await retry()
  })

  it('withdraws a fresh direct namespace when its first method fails to install', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const defineProperty = Object.defineProperty
    const spy = vi.spyOn(Object, 'defineProperty').mockImplementation((target, key, attributes) => {
      if (key === 'create') throw new Error('fixture direct method installation failure')
      return defineProperty(target, key, attributes)
    })
    try {
      await expect(ctx.remote.$mount({
        package: '@fixture/direct-method-failure',
        descriptors: [directDescriptor()],
      })).rejects.toThrow('fixture direct method installation failure')
    } finally {
      spy.mockRestore()
    }

    expect((ctx.remote as unknown as Record<string, unknown>).goals).toBeUndefined()
    await vi.waitFor(() => { expect(ctx.typert.remotes.list()).toEqual([]) })
    const retry = await ctx.remote.$mount({
      package: '@fixture/direct-method-retry',
      descriptors: [directDescriptor()],
    })
    expect(ctx.remote.goals.create).toBeTypeOf('function')
    await retry()
  })

  it('withdraws a fresh scoped Service when its first method fails to install', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const defineProperty = Object.defineProperty
    const spy = vi.spyOn(Object, 'defineProperty').mockImplementation((target, key, attributes) => {
      if (key === 'rename') throw new Error('fixture scoped installation failure')
      return defineProperty(target, key, attributes)
    })
    try {
      await expect(ctx.remote.$mount({ package: '@fixture/scoped-failure', descriptors: [contextDescriptor()] }))
        .rejects.toThrow('fixture scoped installation failure')
    } finally {
      spy.mockRestore()
    }

    expect(ctx.get('remote.goals')).toBeUndefined()
    await vi.waitFor(() => { expect(ctx.typert.remotes.list()).toEqual([]) })
    const retry = await ctx.remote.$mount({ package: '@fixture/scoped-retry', descriptors: [contextDescriptor()] })
    expect((ctx.get('remote.goals') as unknown as Record<string, unknown>).rename).toBeTypeOf('function')
    await retry()
  })

  it('unregisters an empty scoped namespace so another provider can claim its name', async () => {
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>())
    const dispose = await ctx.remote.$mount({ package: '@fixture/scoped', descriptors: [contextDescriptor()] })
    expect(ctx.get('remote.goals')).toBeDefined()

    await dispose()

    expect(ctx.get('remote.goals')).toBeUndefined()
    const replacement = { owner: 'replacement' }
    const disposeReplacement = ctx.reflect.provide('remote.goals', replacement)
    expect(ctx.get('remote.goals')).toBe(replacement)
    await disposeReplacement()
  })

  it('throws RPC failures with the structured error as its cause', async () => {
    const rpcError = { code: 'internal' as const, message: 'host failed', details: {} }
    const ctx = await bench(vi.fn<ConnectionHandle['rpc']['call']>().mockResolvedValue({ ok: false, error: rpcError }))
    await ctx.remote.$mount({ package: '@fixture/goals', descriptors: [directDescriptor()] })

    let failure: unknown
    try {
      await ctx.remote.goals.create('agent-1', { objective: 'ship' })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('expected Client API invocation to fail')
    expect(failure.message).toContain('internal: host failed')
    expect(failure.cause).toBe(rpcError)
  })
})
