/** Pin-visibility invariant: committed settings are readable through resolve(). */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import InvariantService from '@huiliyi37/dsh-invariants'
import ModelRolesService, { MODEL_ROLES_SETTINGS_NAMESPACE } from '../src/index.ts'
import * as ModelRolesInvariant from '../src/invariant.ts'
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
}

async function boot(withService: boolean): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantService)
  await ctx.plugin(ModelRolesInvariant)
  await ctx.plugin(MemorySettings)
  if (withService) await ctx.plugin(ModelRolesService)
  return ctx
}

describe('model-roles invariants', () => {
  it('accepts a committed pin the service can resolve', async () => {
    const ctx = await boot(true)
    await ctx.modelRoles.pin('vision', { provider: 'acme-gateway', model: 'acme-vision' })
    expect(ctx.modelRoles.resolve('vision')).toEqual({ provider: 'acme-gateway', model: 'acme-vision' })
    await ctx.fiber.dispose()
  })

  it('fails a settings/updated emission the service cannot resolve', async () => {
    const ctx = await boot(true)
    // Fabricated next pins a role the service still resolves to undefined.
    expect(() => {
      ctx.emit('settings/updated', MODEL_ROLES_SETTINGS_NAMESPACE, {
        vision: { provider: 'acme-gateway', model: 'acme-vision' },
      }, {}, 'update')
    }).toThrow(/does not reflect the committed model-roles section/)
    await ctx.fiber.dispose()
  })

  it('fails a model-roles emission without a live modelRoles service', async () => {
    const ctx = await boot(false)
    expect(() => {
      ctx.emit('settings/updated', MODEL_ROLES_SETTINGS_NAMESPACE, {}, {}, 'provider')
    }).toThrow(/without a live modelRoles service/)
    await ctx.fiber.dispose()
  })
})
