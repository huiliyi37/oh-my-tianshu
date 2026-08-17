/**
 * Runtime invariant companion: explained empty installer, package ownership.
 *
 * @module @huiliyi37/dsh-memory-sqlite/tests/invariant
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import InvariantService from '@huiliyi37/dsh-invariants'
import * as MemorySqliteInvariant from '../src/invariant.ts'

describe('memory-sqlite invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantService)
    const fiber = await ctx.plugin(MemorySqliteInvariant)

    expect(() => {
      ctx.invariants.register('@huiliyi37/dsh-memory-sqlite', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
