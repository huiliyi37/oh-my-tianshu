import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import * as SlotsInvariant from '@deepseek-ai/dsh-client-ui-slots/invariant'
import InvariantService from '@deepseek-ai/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantService, { enabled: true })
    await expect(ctx.plugin(SlotsInvariant).await()).resolves.toBeDefined()
  })
})
