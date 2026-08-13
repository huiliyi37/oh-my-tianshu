/** Settings shell registration: slot declaration injection, the ledger projections, and HMR recovery. */
import { Context } from '@huiliyi37/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotsService } from '@huiliyi37/dsh-client-runtime/client'
import { apply, inject } from '@huiliyi37/dsh-client-ui-settings/client'
import type { SettingsRootInjected } from '@huiliyi37/dsh-client-ui-settings/client'
import { SettingsRoot } from '../src/client/SettingsRoot.tsx'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotsService).await()
  return { ctx, slots: ctx.get('slots') as SlotsService }
}

function declare(slots: SlotsService): () => void {
  return slots.register(
    { name: 'root', children: { 'sidebar.settings': { kind: 'single', scope: 'root' } } } as never,
    () => null,
  )
}

function injectedOf(slots: SlotsService): SettingsRootInjected {
  const entry = slots.entries('sidebar.settings')[0]!
  return (entry.inject as () => SettingsRootInjected)()
}

/** The shell's child declarations (chrome, actions, sections, and onboarding overlays). */
const CHILD_SPECS = {
  'settings.trigger': { kind: 'single', scope: 'root' },
  'settings.header': { kind: 'single', scope: 'root' },
  'settings.action': { kind: 'list', scope: 'root' },
  'settings.close': { kind: 'single', scope: 'root' },
  'settings.section': { kind: 'list', scope: 'root' },
  'settings.onboarding': { kind: 'list', scope: 'root' },
} as const

describe('ui-settings apply', () => {
  it('declares only the slot registry (a pure composition face, no locale)', () => {
    expect(inject).toEqual(['slots'])
  })

  it('registers the shell and declares every child slot, before or after the declaration', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.slots.entries('sidebar.settings')[0]!.component).toBe(SettingsRoot)
    for (const name of Object.keys(CHILD_SPECS) as Array<keyof typeof CHILD_SPECS>) {
      expect(before.slots.spec(name)).toEqual(CHILD_SPECS[name])
    }

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('sidebar.settings')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('sidebar.settings')[0]!.component).toBe(SettingsRoot)
    // The self-inflicted ledger notifications hit the duplicate guard.
    expect(after.slots.entries('sidebar.settings')).toHaveLength(1)
  })

  it('projects the section ledger into ordered nav rows with option defaults', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { sections } = injectedOf(b.slots).hooks
    // The shell ships no sections of its own — registrants fill the ledger.
    expect(sections.getSnapshot()).toEqual([])
    b.slots.register({ name: 'settings.section', id: 'z', order: 20, label: 'Z' } as never, () => null)
    // No order and no label: both projection defaults apply.
    b.slots.register({ name: 'settings.section', id: 'a' } as never, () => { return null })
    const rows = sections.getSnapshot()
    expect(rows).toEqual([
      { id: 'a', order: 0, label: '' },
      { id: 'z', order: 20, label: 'Z' },
    ])
    // Snapshot identity is stable until the ledger moves (uSES contract).
    expect(sections.getSnapshot()).toBe(rows)
    const listener = vi.fn()
    const off = sections.subscribe(listener)
    b.slots.register({ name: 'settings.section', id: 'b', order: 1, label: 'B' } as never, () => null)
    await Promise.resolve()
    expect(listener).toHaveBeenCalled()
    expect(sections.getSnapshot()).not.toBe(rows)
    off()
  })

  it('projects onboarding entries into stable coordinator order', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { onboardingSteps } = injectedOf(b.slots).hooks
    b.slots.register({ name: 'settings.onboarding', id: 'credential', order: 0 } as never, () => null)
    b.slots.register({ name: 'settings.onboarding', id: 'welcome', order: -100 } as never, () => null)
    b.slots.register({ name: 'settings.onboarding', id: 'default-order' } as never, () => null)
    const steps = onboardingSteps.getSnapshot()
    expect(steps).toEqual([
      { id: 'welcome', order: -100 },
      { id: 'credential', order: 0 },
      { id: 'default-order', order: 0 },
    ])
    expect(onboardingSteps.getSnapshot()).toBe(steps)
    const listener = vi.fn()
    const off = onboardingSteps.subscribe(listener)
    b.slots.register({ name: 'settings.onboarding', id: 'later', order: 10 } as never, () => null)
    await Promise.resolve()
    expect(listener).toHaveBeenCalledOnce()
    off()
  })

  it('re-registers after an HMR collapse re-declares the slot (stale disposer must not block)', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar.settings')).toHaveLength(1)
    // Declarer unload: the cascade removes our entry and every child
    // declaration while our local disposer variable goes stale.
    redeclare()
    expect(b.slots.entries('sidebar.settings')).toHaveLength(0)
    expect(b.slots.spec('settings.trigger')).toBeUndefined()
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('sidebar.settings')[0]!.component).toBe(SettingsRoot)
    for (const name of Object.keys(CHILD_SPECS) as Array<keyof typeof CHILD_SPECS>) {
      expect(b.slots.spec(name)).toEqual(CHILD_SPECS[name])
    }
  })

  it('unregisters the shell and collapses every child slot on teardown', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar.settings')).toHaveLength(0)
    for (const name of Object.keys(CHILD_SPECS) as Array<keyof typeof CHILD_SPECS>) {
      expect(b.slots.spec(name)).toBeUndefined()
    }
  })
})
