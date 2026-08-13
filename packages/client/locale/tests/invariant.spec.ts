// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { apply as nodeApply } from '@huiliyi37/dsh-client-locale'
import { apply as clientApply, COMMON_NS, LocaleService, inject } from '@huiliyi37/dsh-client-locale/client'
import * as LocaleInvariant from '@huiliyi37/dsh-client-locale/invariant'
import { SlotsService } from '@huiliyi37/dsh-client-runtime/client'
import InvariantService from '@huiliyi37/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantService, { enabled: true })
    await expect(ctx.plugin(LocaleInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', () => {
    nodeApply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })

  it('client apply provides ctx.locale seeded with the zh/en common namespace', async () => {
    // The feature registers its own Language settings row, hence the slots edge.
    expect(inject).toEqual(['slots'])
    const ctx = new Context()
    new SlotsService(ctx)
    await ctx.plugin({ inject, apply: clientApply }).await()
    const locale = ctx.get('locale')
    expect(locale).toBeInstanceOf(LocaleService)
    // Seeded dictionaries occupy the (ns, locale) seats even while empty.
    expect(() => (locale as LocaleService).register(COMMON_NS, 'zh', {})).toThrow('already has locale')
    expect(() => (locale as LocaleService).register(COMMON_NS, 'en', {})).toThrow('already has locale')
  })
})
