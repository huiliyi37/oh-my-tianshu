/**
 * ui-plan browser half on a real SlotsService: the plugin occupies the
 * conversation-declared `conversation.input.plan` single seat with the active
 * plan status chip; the injected face executes /plan off and folds admission
 * outcomes into null (admitted) or a user-visible failure line; teardown
 * empties the seat (HMR safety).
 */
import { Context } from 'cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotsService } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleService } from '@deepseek-ai/dsh-client-locale/client'
import { PlanChip } from '../src/client/PlanModeControl.tsx'
import type { PlanChipInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-plan' as SessionId

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotsService).await()
  const slots = ctx.get('slots') as SlotsService
  slots.register({
    name: 'root',
    children: { 'conversation.input.plan': { kind: 'single', scope: 'session' } },
  } as never, () => { return null })
  const execute = vi.fn((_payload: { sessionId: SessionId; line: string }) =>
    Promise.resolve({ result: { ok: true as const, value: { matched: true as const, commandId: 'c1' } } }))
  ctx.provide('connection', { api: { commands: { execute } } })
  ctx.provide('locale', new LocaleService(ctx))
  return { ctx, slots, execute }
}

describe('ui-plan browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'connection', 'locale'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('waits until conversation declares the plan seat', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotsService).await()
    ctx.provide('connection', {})
    ctx.provide('locale', new LocaleService(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.plan')).toHaveLength(0)
    ctx.slots.register({
      name: 'root', children: { 'conversation.input.plan': { kind: 'single', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.input.plan')).toHaveLength(1)
  })

  it('registers the chip, executes /plan off, and unregisters on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.plan')[0]!
    expect(entry.component).toBe(PlanChip)
    const injected = (entry.inject as unknown as (id: SessionId) => PlanChipInjected)(SID)

    await expect(injected.exitPlanMode()).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith({ sessionId: SID, line: '/plan off' })

    // Business failure folds to the composer-visible line.
    b.execute.mockResolvedValueOnce({
      result: { ok: false as const, error: { code: 'session-not-found', message: 'gone', details: {} } },
    } as never)
    await expect(injected.exitPlanMode()).resolves.toBe('gone (session-not-found)')

    // Unmatched admission (plan-mode not composed host-side) is also a failure line.
    b.execute.mockResolvedValueOnce({
      result: { ok: true as const, value: { matched: false as const } },
    } as never)
    await expect(injected.exitPlanMode()).resolves.toBe('unknown command: /plan off')

    await fiber.dispose()
    expect(b.slots.entries('conversation.input.plan')).toHaveLength(0)
  })
})
