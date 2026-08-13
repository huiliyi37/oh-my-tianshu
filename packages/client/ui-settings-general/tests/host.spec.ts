import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { Settings, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply } from '../src/index.ts'
import { WELCOME_NOTICE_SETTINGS_NAMESPACE } from '../src/onboarding-copy.ts'

class MemorySettings extends Settings {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-settings-general host', () => {
  it('registers and disposes the durable onboarding namespace with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(ctx.settings.describe().map(row => row.ns)).toContain(
      settingsNamespace(WELCOME_NOTICE_SETTINGS_NAMESPACE),
    )
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(
      settingsNamespace(WELCOME_NOTICE_SETTINGS_NAMESPACE),
    )
  })
})
