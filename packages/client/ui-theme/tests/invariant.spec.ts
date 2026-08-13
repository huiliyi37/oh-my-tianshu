// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-ui-theme'
import { apply as clientApply, inject, ThemeService } from '@deepseek-ai/dsh-client-ui-theme/client'
import * as ThemeInvariant from '@deepseek-ai/dsh-client-ui-theme/invariant'
import { apply as localeApply } from '@deepseek-ai/dsh-client-locale/client'
import { SlotsService } from '@deepseek-ai/dsh-client-runtime/client'
import InvariantService from '@deepseek-ai/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantService, { enabled: true })
    await expect(ctx.plugin(ThemeInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', () => {
    nodeApply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })

  it('client apply provides ctx.theme over the slots/locale edges', async () => {
    // The feature registers its own Appearance settings row with localized
    // copy, hence the slots + locale edges.
    expect(inject).toEqual(['slots', 'locale'])
    const ctx = new Context()
    new SlotsService(ctx)
    await ctx.plugin({ inject: ['slots'], apply: localeApply }).await()
    await ctx.plugin({ inject, apply: clientApply }).await()
    expect(ctx.get('theme')).toBeInstanceOf(ThemeService)
  })
})
