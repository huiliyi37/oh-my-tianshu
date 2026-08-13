import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import {
  bindTypeRTGateway,
  GatewayService,
  Remote,
  RemoteScope,
  remoteMethods,
  type TypeRTContext,
} from '@deepseek-ai/dsh-type-meta'

declare module '@deepseek-ai/dsh-type-meta' {
  interface TypeRTContextMap {
    metaFixture: TypeRTContext<string>
  }
}

describe('type-meta Remote declarations', () => {
  it('binds a GatewayService name and executes decorators through the Vitest source transform', async () => {
    class Goals extends GatewayService {
      constructor(ctx: Context) {
        super(ctx, 'goals')
      }

      @Remote
      create(value: string): string {
        return value
      }

      @RemoteScope('metaFixture')
      scoped(value: string): string {
        return value
      }
    }

    class NamespacedGoals extends GatewayService {
      constructor(ctx: Context) {
        super(ctx, 'internalGoals', { namespace: 'goals' })
      }
    }

    const ctx = new Context()
    const goals = new Goals(ctx)
    const namespaced = new NamespacedGoals(ctx)
    expect(goals.typertGateway).toEqual({ service: goals, serviceKey: 'goals', namespace: 'goals' })
    expect(namespaced.typertGateway).toEqual({
      service: namespaced,
      serviceKey: 'internalGoals',
      namespace: 'goals',
    })
    expect(remoteMethods(goals)).toEqual([
      { method: 'create', invocation: { kind: 'direct' } },
      { method: 'scoped', invocation: { kind: 'context', context: 'metaFixture' } },
    ])
    await ctx.fiber.dispose()
  })

  it('executes standard decorator syntax through the TSX source launcher', () => {
    const fixture = fileURLToPath(new URL('./fixtures/source-launch.ts', import.meta.url))
    const output = execFileSync(process.execPath, ['--import', 'tsx/esm', fixture], { encoding: 'utf8' })
    expect(JSON.parse(output)).toEqual([
      { method: 'create', invocation: { kind: 'direct' } },
      { method: 'scoped', invocation: { kind: 'context', context: 'agent' } },
    ])
  })

  it('keeps decorator markers in private module state', () => {
    class Goals {
      readonly typertGateway = bindTypeRTGateway(this, 'goals')

      create(agent: object, request: object): object {
        return { agent, request }
      }

      scoped(request: object): object {
        return request
      }
    }

    const initializers: Array<(this: Goals) => void> = []
    Remote(
      Reflect.get(Goals.prototype, 'create') as (this: Goals, ...args: unknown[]) => unknown,
      methodContext('create', initializers),
    )
    RemoteScope('metaFixture')(
      Reflect.get(Goals.prototype, 'scoped') as (this: Goals, ...args: unknown[]) => unknown,
      methodContext('scoped', initializers),
    )

    const goals = new Goals()
    for (const initialize of initializers) initialize.call(goals)
    expect(goals.typertGateway).toEqual({ service: goals, serviceKey: 'goals', namespace: 'goals' })
    expect(Object.isFrozen(goals.typertGateway)).toBe(true)
    expect(remoteMethods(goals)).toEqual([
      { method: 'create', invocation: { kind: 'direct' } },
      { method: 'scoped', invocation: { kind: 'context', context: 'metaFixture' } },
    ])
    expect(Reflect.ownKeys(Goals)).toEqual(['length', 'name', 'prototype'])
    expect(Reflect.ownKeys(Goals.prototype)).toEqual(['constructor', 'create', 'scoped'])
  })

  it('keeps markers idempotent across instances and returns detached snapshots', () => {
    class Service {
      run(value: string): string {
        return value
      }
    }

    const initializers: Array<(this: Service) => void> = []
    Remote(
      Reflect.get(Service.prototype, 'run') as (this: Service, ...args: unknown[]) => unknown,
      methodContext('run', initializers),
    )

    const first = new Service()
    const second = new Service()
    for (const initialize of initializers) {
      initialize.call(first)
      initialize.call(second)
    }
    const snapshot = remoteMethods(first)
    expect(remoteMethods(second)).toEqual(snapshot)
    ;(snapshot as unknown as Array<{ method: string }>)[0]!.method = 'changed'
    expect(remoteMethods(first)).toEqual([{ method: 'run', invocation: { kind: 'direct' } }])
  })

  it('supports explicit export names without exposing marker storage', () => {
    class Service {
      run(value: string): string {
        return value
      }

      scoped(value: string): string {
        return value
      }
    }
    const initializers: Array<(this: Service) => void> = []
    Remote('execute')(
      Reflect.get(Service.prototype, 'run') as (this: Service, ...args: unknown[]) => unknown,
      methodContext('run', initializers),
    )
    RemoteScope('metaFixture', 'inspect')(
      Reflect.get(Service.prototype, 'scoped') as (this: Service, ...args: unknown[]) => unknown,
      methodContext('scoped', initializers),
    )
    const service = new Service()
    for (const initialize of initializers) initialize.call(service)

    expect(remoteMethods(service)).toEqual([
      { method: 'run', exportName: 'execute', invocation: { kind: 'direct' } },
      { method: 'scoped', exportName: 'inspect', invocation: { kind: 'context', context: 'metaFixture' } },
    ])
    expect(remoteMethods({})).toEqual([])
    const prototypeLess: object = {}
    Reflect.setPrototypeOf(prototypeLess, null)
    expect(remoteMethods(prototypeLess)).toEqual([])
  })

  it('rejects malformed decorator calls and targets', () => {
    const method: (this: object) => void = function (this: object): void {}
    expect(() => { (Remote as unknown as (value: typeof method) => void)(method) }).toThrow('context is missing')
    expect(() => Remote('bad/name')).toThrow('export name')
    expect(() => Remote('bad#name')).toThrow('export name')
    expect(() => Remote('bad name')).toThrow('export name')
    expect(() => Remote('.')).toThrow('export name')
    expect(() => Remote('..')).toThrow('export name')
    expect(() => RemoteScope('' as 'metaFixture')).toThrow('Scope key')
    expect(() => RemoteScope('metaFixture', 'bad/name')).toThrow('export name')

    for (const context of [
      { ...methodContext('run', []), private: true },
      { ...methodContext('run', []), static: true },
      { ...methodContext('run', []), name: Symbol('run') },
    ]) {
      expect(() => { Remote(method, context) })
        .toThrow('public instance method')
    }
  })

  it('rejects prototype-less initialization and conflicting markers', () => {
    const method: (this: object) => void = function (this: object): void {}
    const direct: Array<(this: object) => void> = []
    Remote(method, methodContext('run', direct))
    const prototypeLess: object = {}
    Reflect.setPrototypeOf(prototypeLess, null)
    expect(() => { direct[0]!.call(prototypeLess) }).toThrow('without a prototype')

    class Service {
      run(): void {}
    }
    const conflicting: Array<(this: Service) => void> = []
    Remote(
      Reflect.get(Service.prototype, 'run'),
      methodContext('run', conflicting),
    )
    RemoteScope('metaFixture')(
      Reflect.get(Service.prototype, 'run'),
      methodContext('run', conflicting),
    )
    const service = new Service()
    conflicting[0]!.call(service)
    expect(() => { conflicting[1]!.call(service) }).toThrow('conflicting invocation markers')
  })

  it('rejects ambiguous binding names', () => {
    expect(() => bindTypeRTGateway({}, '')).toThrow('service key')
    expect(() => bindTypeRTGateway({}, 'goals', { namespace: 'api/goals' })).toThrow('namespace')
    expect(() => bindTypeRTGateway({}, 'goals', { namespace: 'api goals' })).toThrow('namespace')
  })
})

function methodContext<This extends object>(
  name: string,
  initializers: Array<(this: This) => void>,
): ClassMethodDecoratorContext<This, (this: This, ...args: unknown[]) => unknown> {
  return {
    kind: 'method',
    name,
    static: false,
    private: false,
    metadata: {},
    access: {
      has: object => name in object,
      get: object => (object as Record<string, unknown>)[name] as (this: This, ...args: unknown[]) => unknown,
    },
    addInitializer: (initializer) => { initializers.push(initializer) },
  }
}
