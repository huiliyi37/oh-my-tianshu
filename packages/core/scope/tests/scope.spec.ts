import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from 'cordis'
import { carrierKeyOf, createScope, isScopeCarrier, scopeOf, scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scope, Scoped } from '@deepseek-ai/dsh-scope'

declare module 'cordis' {
  interface Events {
    /**
     * Test-only event for scope-filtered dispatch.
     * @param value - opaque payload recorded by listeners.
     * @mode emit
     */
    'scope-test/ping'(value: string): void
  }
}

/** Mount a host plugin and mint a scope inside it. */
async function mintScope(ctx: Context, key: object): Promise<Scope> {
  let scope!: Scope
  await ctx.plugin((inner: Context) => { scope = createScope(inner, key) })
  return scope
}

describe('createScope', () => {
  it('tags contexts and derived contexts, with the nearest tag winning', async () => {
    const ctx = new Context()
    const outerKey = { name: 'outer' }
    const innerKey = { name: 'inner' }
    const outer = await mintScope(ctx, outerKey)
    const inner = createScope(outer.ctx, innerKey)

    expect(scopeOf(ctx)).toBeUndefined()
    expect(scopeOf(outer.ctx)).toBe(outerKey)
    expect(scopeOf(outer.ctx.extend({}))).toBe(outerKey)
    expect(scopeOf(inner.ctx)).toBe(innerKey)

    await inner.dispose()
    await outer.dispose()
  })

  it('is usable synchronously before the backing fiber activates', async () => {
    const ctx = new Context()
    const events: string[] = []
    let scope!: Scope
    await ctx.plugin((inner: Context) => {
      scope = createScope(inner, { name: 'sync' })
      scope.ctx.effect(() => () => void events.push('disposed'))
      events.push('registered')
    })
    expect(events).toEqual(['registered'])
    await scope.dispose()
    expect(events).toEqual(['registered', 'disposed'])
  })

  it('shares quiescence across repeat and raw-disposer-first calls', async () => {
    const ctx = new Context()
    const scope = await mintScope(ctx, { name: 'quiescence' })
    const gate = Promise.withResolvers<undefined>()
    let finished = false
    scope.ctx.effect(() => async () => {
      await gate.promise
      finished = true
    })

    const raw = Promise.resolve(scope.rawDispose())
    const publicDispose = scope.dispose()
    await Promise.resolve()
    expect(finished).toBe(false)
    gate.resolve(undefined)
    await Promise.all([raw, publicDispose, scope.dispose()])
    expect(finished).toBe(true)
  })

  it('exposes the exact raw disposer for ordered composite teardown', async () => {
    const ctx = new Context()
    const order: string[] = []
    let dispose!: () => Promise<void> | void
    await ctx.plugin((inner: Context) => {
      dispose = inner.effect(function* () {
        yield () => void order.push('outer')
        const scope = createScope(inner, { name: 'nested' })
        scope.ctx.effect(() => () => void order.push('scope'))
        yield scope.rawDispose
        yield () => void order.push('inner')
      })
    })
    await dispose()
    expect(order).toEqual(['inner', 'scope', 'outer'])
  })
})

describe('scopeTarget', () => {
  it('routes scoped listeners by key while untagged listeners remain global', async () => {
    const ctx = new Context()
    const keyA = { name: 'A' }
    const keyB = { name: 'B' }
    const scopeA = await mintScope(ctx, keyA)
    const scopeB = await mintScope(ctx, keyB)
    const heard: string[] = []
    ctx.on('scope-test/ping', value => void heard.push(`global:${value}`))
    scopeA.ctx.on('scope-test/ping', value => void heard.push(`A:${value}`))
    scopeB.ctx.on('scope-test/ping', value => void heard.push(`B:${value}`))

    ctx.emit(scopeTarget(ctx, keyA), 'scope-test/ping', 'a')
    ctx.emit(scopeTarget(ctx, keyB), 'scope-test/ping', 'b')
    ctx.emit(scopeTarget(ctx, undefined), 'scope-test/ping', 'none')

    expect(heard).toEqual(['global:a', 'A:a', 'global:b', 'B:b', 'global:none'])
    await Promise.all([scopeA.dispose(), scopeB.dispose()])
  })

  it('preserves a base Cordis filter and its receiver', async () => {
    const ctx = new Context()
    const key = { name: 'A' }
    const scope = await mintScope(ctx, key)
    const heard: string[] = []
    ctx.on('scope-test/ping', value => void heard.push(`global:${value}`))
    scope.ctx.on('scope-test/ping', value => void heard.push(`A:${value}`))
    let receiverMatches = false
    const base = {
      [Context.filter](this: object): boolean {
        receiverMatches = this === base
        return false
      },
    }

    ctx.emit(scopeTarget(base, key), 'scope-test/ping', 'vetoed')
    expect(heard).toEqual([])
    expect(receiverMatches).toBe(true)
    await scope.dispose()
  })

  it('{ global: true } listeners retain Cordis global-listener semantics', async () => {
    const ctx = new Context()
    const scope = await mintScope(ctx, { name: 'A' })
    const heard: string[] = []
    scope.ctx.on('scope-test/ping', value => void heard.push(value), { global: true })
    ctx.emit(scopeTarget(ctx, { name: 'other' }), 'scope-test/ping', 'foreign')
    ctx.emit(scopeTarget(ctx, undefined), 'scope-test/ping', 'none')
    expect(heard).toEqual(['foreign', 'none'])
    await scope.dispose()
  })

  it('uses an opaque branded carrier with a separately tracked key', () => {
    const key = { name: 'key' }
    const subject = { value: 1 }
    const carrier = scopeTarget(subject, key)
    expect(isScopeCarrier(carrier)).toBe(true)
    expect(carrierKeyOf(carrier)).toBe(key)
    expect(isScopeCarrier(subject)).toBe(false)
    expect(carrierKeyOf(subject)).toBeUndefined()
    expect('value' in carrier).toBe(false)
    expectTypeOf(carrier).toEqualTypeOf<Scoped<typeof subject>>()
  })
})
