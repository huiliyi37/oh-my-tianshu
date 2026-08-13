import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import InvariantService from '@deepseek-ai/dsh-invariants'
import * as StorageSqliteInvariant from '../src/invariant.ts'

describe('invariant companion', () => {
  it('registers under the package name with an explained-empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantService, { enabled: true })
    await expect(ctx.plugin(StorageSqliteInvariant).await()).resolves.toBeDefined()
  })
})
