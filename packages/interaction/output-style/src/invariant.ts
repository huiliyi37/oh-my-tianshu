/** Package-owned output-style section invariant. @module @huiliyi37/dsh-output-style/invariant */

import type { Context } from '@huiliyi37/cordis'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'
import type { PromptAssembly } from '@huiliyi37/dsh-system-prompt'
import { OUTPUT_STYLE_SECTION_NAME } from './index.ts'

const PACKAGE_NAME = '@huiliyi37/dsh-output-style'

/** Cordis companion plugin name. */
export const name = 'output-style-invariant'
/** Service required before the companion can check prompt assemblies. */
export const inject = ['invariants']

/**
 * Assert at most one `output-style` section per assembly: the package owns a
 * single registration, and a second contributor claiming the same section
 * name (for example through an assembly-waterfall rewrite) would silently
 * double-render style prose into every request. The check bounds the settled
 * assembly value downstream of the companion's listener, so a violating
 * rewrite fails the assembly itself at its authoritative boundary, and a
 * duplicate already produced at companion load fails the load.
 */
const install: InvariantInstaller = Object.assign(async (ctx: Context, fail: InvariantFailure): Promise<void> => {
  const assertSingleSection = (sections: PromptAssembly['sections']): void => {
    if (sections.filter(section => section.name === OUTPUT_STYLE_SECTION_NAME).length > 1) {
      fail(`assembly carries more than one '${OUTPUT_STYLE_SECTION_NAME}' section; at most one is allowed`)
    }
  }
  ctx.on('system-prompt/assemble', (_assembly, _context, next) =>
    next().then((settled) => {
      assertSingleSection(settled.sections)
      return settled
    }))
  assertSingleSection((await ctx.systemPrompt.assemble()).sections)
}, { inject: ['systemPrompt'] })

/**
 * Register the output-style invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
