/**
 * Runtime invariant companion: explained empty installer, package ownership.
 *
 * @module @huiliyi37/dsh-tool-memory-recall/tests/invariant
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import InvariantService from '@huiliyi37/dsh-invariants'
import * as ToolMemoryRecallInvariant from '../src/invariant.ts'

describe('tool-memory-recall invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantService)
    const fiber = await ctx.plugin(ToolMemoryRecallInvariant)

    expect(() => {
      ctx.invariants.register('@huiliyi37/dsh-tool-memory-recall', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
