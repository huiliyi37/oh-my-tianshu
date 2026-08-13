/**
 * ui-command browser half on a real cordis Context with fake slash/slots
 * faces and real session scopes: the plugin body mounts CommandService as
 * `command`, the popupSelect shell registers into conversation.input.overlay
 * through slot declaration injection with a per-session inject (sessionId →
 * scope → popupFor; unknown id fails loud), both fold up on fiber disposal
 * (HMR safety), and the service satisfies the frozen CommandServiceContract.
 */
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { createScope, scopeOf, SlotsService } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SlashSource } from '@deepseek-ai/dsh-client-ui-slash/client'
import type { CommandServiceContract } from '../src/client/contract.ts'
import type { PopupSelectInjected } from '../src/client/PopupSelectView.tsx'
import { LocaleService } from '@deepseek-ai/dsh-client-locale/client'
import { apply, CommandService, inject } from '../src/client/index.ts'

const sid = (k: string): SessionId => k as SessionId

async function bench() {
  const ctx = new Context()
  const sources = new Map<string, SlashSource>()
  ctx.provide('slash', {
    registerSource(src: SlashSource) {
      sources.set(`${src.trigger} ${src.name}`, src)
      return () => { sources.delete(`${src.trigger} ${src.name}`) }
    },
  })
  const scopes = new Map<SessionId, Context>()
  ctx.provide('sessions', {
    scope: (id: SessionId) => scopes.get(id),
    scopeOf: (c: Context) => scopeOf(c),
  })
  ctx.provide('connection', { api: { commands: { list: () => Promise.resolve({ result: { ok: true, value: { commands: [] } } }) } } })
  await ctx.plugin(SlotsService).await()
  ctx.slots.register({
    name: 'root', children: { 'conversation.input.overlay': { kind: 'list', scope: 'session' } },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleService(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const mint = (key: string) => {
    const handle = createScope(ctx, sid(key))
    scopes.set(sid(key), handle.ctx)
    return handle
  }
  return { ctx, fiber, sources, slots: ctx.slots, mint }
}

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slash', 'sessions', 'connection', 'locale'])
  })

  it('mounts ctx.command, registers the source and the overlay entry, and folds up on disposal', async () => {
    const { ctx, fiber, sources, slots } = await bench()
    const command = ctx.get('command')
    expect(command).toBeInstanceOf(CommandService)
    // Frozen-contract conformance (compile-time check rides the assignment).
    const contract: CommandServiceContract = command as CommandService
    expect(typeof contract.register).toBe('function')
    expect(typeof contract.popupFor).toBe('function')
    expect([...sources.keys()]).toEqual(['/ command'])
    expect(slots.entries('conversation.input.overlay').map(entry => entry.options.id)).toEqual(['command-popup'])
    await fiber.dispose()
    expect(sources.size).toBe(0)
    expect(slots.entries('conversation.input.overlay')).toHaveLength(0)
  })

  it('the overlay inject resolves the per-session popup controller by sessionId and fails loud on an unknown id', async () => {
    const { ctx, slots, mint } = await bench()
    const command = ctx.get('command') as CommandService
    const scope = mint('s1')
    const entry = slots.entries('conversation.input.overlay')[0]!
    const injectEntry = entry.inject as unknown as (sessionId: SessionId) => PopupSelectInjected
    expect(injectEntry(sid('s1')).popup).toBe(command.popupFor(scope.ctx))
    expect(() => injectEntry(sid('ghost'))).toThrow(/resolved no scope/)
  })
})
