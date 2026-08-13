import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import * as WorkspaceInvariant from '@huiliyi37/dsh-client-ui-workspace/invariant'
import InvariantService from '@huiliyi37/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantService, { enabled: true })
    await expect(ctx.plugin(WorkspaceInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', async () => {
    const { apply } = await import('@huiliyi37/dsh-client-ui-workspace')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})
