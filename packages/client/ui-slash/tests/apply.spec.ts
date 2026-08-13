/**
 * apply wiring on a real cordis Context + SlotsService: SlashService mounts
 * as ctx.slash once its sessions dependency is up; the MenuView overlay
 * registration follows the slot declaration, resolves the per-session controller from the slot's
 * sessionId, and unregisters on fiber teardown.
 */
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { LocaleService } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { createScope, scopeOf, SlotsService } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject, SlashService } from '@deepseek-ai/dsh-client-ui-slash/client'
import type { MenuViewInjected } from '@deepseek-ai/dsh-client-ui-slash/client'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

const sid = (k: string): SessionId => k as SessionId

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotsService).await()
  const slots = ctx.get('slots') as SlotsService
  // Stand-in for the ui-conversation composer entry: declare the overlay
  // slot without providing ConversationService, which is not its lifecycle
  // signal.
  slots.register(
    { name: 'root', children: { 'conversation.input.overlay': { kind: 'list', scope: 'session' } } } as never,
    () => null,
  )
  // Sessions face: mint one real scope for session 'a' and resolve it by id.
  const scope = createScope(ctx, sid('a'))
  ctx.provide('sessions', {
    scope: (id: SessionId) => (id === sid('a') ? scope.ctx : undefined),
    scopeOf: (c: Context) => scopeOf(c),
  })
  const locale = new LocaleService(ctx)
  ctx.provide('locale', locale)
  return { ctx, slots, locale }
}

describe('apply', () => {
  it('declares the sessions and locale dependencies (scope tree + localized menu copy)', () => {
    expect(inject).toEqual(['sessions', 'locale'])
  })

  it('registers the bilingual menu dictionaries (group titles by source name + the pending row)', async () => {
    const { ctx, locale } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const t = locale.bind('slash.menu')
    expect(t('command')).toBe('命令')
    locale.setLocale('en')
    expect(t('skill')).toBe('Skills')
    expect(t('subagent')).toBe('Subagents')
    expect(t('loading')).toBe('Loading…')
  })

  it('mounts ctx.slash once sessions is up, before any conversation service exists', async () => {
    const { ctx } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(ctx.get('slash')).toBeInstanceOf(SlashService)
  })

  it('registers MenuView into the overlay and resolves the per-session controller by slot sessionId', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('conversation.input.overlay')).toHaveLength(1)
    const entries = slots.entries('conversation.input.overlay')
    expect(entries[0]!.options.id).toBe('slash-menu')
    // Copy rides the standard locale seat, not the business face.
    expect(entries[0]!.locale).toBe('slash.menu')

    const slash = ctx.get('slash') as SlashService
    // StoredEntry.inject is declaration-typed ((...args: never[]) shape);
    // the erased registration widens it past a direct cast, so hop unknown.
    const injectEntry = entries[0]!.inject as unknown as (sessionId: SessionId) => MenuViewInjected
    const injected = injectEntry(sid('a'))
    const controller = slash.sessionOf(
      (ctx.get('sessions') as { scope(id: SessionId): Context }).scope(sid('a')),
    )
    expect(injected.menu).toBe(controller.menu)
    // The pick face routes into the controller pipeline (closed menu → no-op).
    injected.onPick('command', 0)
    expect(controller.menu.getSnapshot().open).toBe(false)
    // The dismiss face routes into the controller too (closed menu → no-op).
    injected.onDismiss()
    expect(controller.menu.getSnapshot().open).toBe(false)
    // An unknown session id fails loud (no silent scope miss).
    expect(() => injectEntry(sid('ghost'))).toThrow(/resolved no scope/)
  })

  it('fiber teardown removes the overlay entry', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('conversation.input.overlay')).toHaveLength(1)

    await fiber.dispose()
    expect(slots.entries('conversation.input.overlay')).toHaveLength(0)
    expect(ctx.get('slash')).toBeUndefined()
  })
})
