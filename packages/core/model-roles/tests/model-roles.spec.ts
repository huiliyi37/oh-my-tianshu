/** Per-role model pins layered over a real settings provider. */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import ModelRolesService, {
  MODEL_ROLES_SETTINGS_NAMESPACE,
  MODEL_ROLES_SETTINGS_SCHEMA,
} from '../src/index.ts'
import { Settings } from '@huiliyi37/dsh-settings'
import type { SettingsNamespace } from '@huiliyi37/dsh-settings'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends Settings {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }

  /** Simulate an external storage change reaching the provider. */
  pushExternal(doc: Record<string, unknown>): void {
    this.doc = structuredClone(doc)
    this.publish(structuredClone(doc))
  }
}

async function boot(): Promise<{
  ctx: Context
  settingsFiber: Context['fiber']
  modelRoles: ModelRolesService
}> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  await ctx.plugin(ModelRolesService)
  return { ctx, settingsFiber, modelRoles: ctx.modelRoles }
}

describe('model-roles settings schema', () => {
  it('accepts an empty section', () => {
    expect(MODEL_ROLES_SETTINGS_SCHEMA({})).toEqual({})
  })

  it('rejects a role object missing its model', () => {
    // Deliberately invalid input: the static type requires both route fields.
    expect(() => MODEL_ROLES_SETTINGS_SCHEMA({ vision: { provider: 'acme-gateway' } } as never)).toThrow()
  })
})

describe('ModelRolesService', () => {
  it('resolves every role to undefined before any pin', async () => {
    const bench = await boot()
    expect(bench.modelRoles.resolve('vision')).toBeUndefined()
    expect(bench.modelRoles.resolve('secondary')).toBeUndefined()
    expect(bench.modelRoles.resolve('subagent')).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })

  it('resolves a pin once the settings write settles', async () => {
    const bench = await boot()
    await bench.modelRoles.pin('secondary', { provider: 'acme-gateway', model: 'acme-small' })
    expect(bench.modelRoles.resolve('secondary')).toEqual({ provider: 'acme-gateway', model: 'acme-small' })
    expect(bench.modelRoles.resolve('vision')).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })

  it('unpins a role back to following the default route', async () => {
    const bench = await boot()
    await bench.modelRoles.pin('vision', { provider: 'acme-gateway', model: 'acme-vision' })
    await bench.modelRoles.unpin('vision')
    expect(bench.modelRoles.resolve('vision')).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })

  it('reflects an external settings change on the next resolve', async () => {
    const bench = await boot()
    const provider = bench.settingsFiber.ctx.settings as MemorySettings
    provider.pushExternal({
      [MODEL_ROLES_SETTINGS_NAMESPACE]: { subagent: { provider: 'acme-gateway', model: 'acme-large' } },
    })
    expect(bench.modelRoles.resolve('subagent')).toEqual({ provider: 'acme-gateway', model: 'acme-large' })
    await bench.ctx.fiber.dispose()
  })

  it('falls back to unpinned roles when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.modelRoles.pin('vision', { provider: 'acme-gateway', model: 'acme-vision' })
    expect(bench.modelRoles.resolve('vision')).toBeDefined()
    await bench.settingsFiber.dispose()
    expect(bench.modelRoles.resolve('vision')).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })

  it('keeps resolving undefined and no-ops writes without a settings provider', async () => {
    const ctx = new Context()
    await ctx.plugin(ModelRolesService)
    await ctx.modelRoles.pin('vision', { provider: 'acme-gateway', model: 'acme-vision' })
    await ctx.modelRoles.unpin('vision')
    expect(ctx.modelRoles.resolve('vision')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
