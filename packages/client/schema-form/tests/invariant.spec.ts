import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import * as SchemaFormInvariant from '@huiliyi37/dsh-client-schema-form/invariant'
import InvariantService from '@huiliyi37/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantService, { enabled: true })
    await expect(ctx.plugin(SchemaFormInvariant).await()).resolves.toBeDefined()
  })
})
