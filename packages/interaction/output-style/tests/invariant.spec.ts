/** Invariant-companion behavior: at most one output-style section per assembly. */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { SystemPrompt } from '@huiliyi37/dsh-system-prompt'
import CommandService from '@huiliyi37/dsh-commands'
import InvariantService from '@huiliyi37/dsh-invariants'
import * as outputStyle from '../src/index.ts'
import * as OutputStyleInvariant from '../src/invariant.ts'

/** The plugin as a Cordis module with its runtime inject attached (the top-level inject guarantees `commands`). */
const outputStylePlugin = Object.assign(
  (ctx: Context, config: outputStyle.Config = {}) => { outputStyle.apply(ctx, config) },
  { inject: outputStyle.inject, Config: outputStyle.Config },
)

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(CommandService)
  await ctx.plugin(InvariantService)
  await ctx.plugin(OutputStyleInvariant)
  await ctx.plugin(outputStylePlugin)
  return ctx
}

/** Register a waterfall rewrite that appends a second `output-style` section to the settled value. */
function injectDuplicateSection(ctx: Context): void {
  ctx.on('system-prompt/assemble', (_assembly, _context, next) => next().then(settled => ({
    ...settled,
    sections: [...settled.sections, {
      name: outputStyle.OUTPUT_STYLE_SECTION_NAME,
      text: 'duplicate style prose',
    }],
  })))
}

describe('output-style invariants', () => {
  it('accepts the single registered section through a full assembly', async () => {
    const ctx = await setup()
    const sections = (await ctx.systemPrompt.assemble()).sections
      .filter(section => section.name === outputStyle.OUTPUT_STYLE_SECTION_NAME)
    expect(sections).toHaveLength(1)
  })

  it('fails an assembly whose waterfall output carries a second output-style section', async () => {
    const ctx = await setup()
    injectDuplicateSection(ctx)
    await expect(ctx.systemPrompt.assemble()).rejects.toThrow(/more than one 'output-style' section/)
  })

  it('fails companion load when a duplicate section is already being produced', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(CommandService)
    await ctx.plugin(outputStylePlugin)
    injectDuplicateSection(ctx)
    await ctx.plugin(InvariantService)
    await expect(ctx.plugin(OutputStyleInvariant).then(() => undefined)).rejects.toThrow(/more than one 'output-style' section/)
  })
})
