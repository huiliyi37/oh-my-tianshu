/** Package-owned output-style section invariant. @module @huiliyi37/dsh-output-style/invariant */

import type { Context } from '@huiliyi37/cordis'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'
import { OUTPUT_STYLE_SECTION_NAME } from './index.ts'

const PACKAGE_NAME = '@huiliyi37/dsh-output-style'

/** Cordis companion plugin name. */
export const name = 'output-style-invariant'
/** Service required before the companion can check prompt assemblies. */
export const inject = ['invariants']

/**
 * Assert at most one `output-style` section per assembly: the package owns a
 * single registration, and a second contributor claiming the same section
 * name would silently double-render style prose into every request.
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const assertSingleSection = async (): Promise<void> => {
    const matches = (await ctx.systemPrompt.assemble()).sections
      .filter(section => section.name === OUTPUT_STYLE_SECTION_NAME)
    if (matches.length > 1) {
      fail(`assembly carries ${matches.length} '${OUTPUT_STYLE_SECTION_NAME}' sections; at most one is allowed`)
    }
  }
  void assertSingleSection()
  ctx.on('system-prompt/change', () => { void assertSingleSection() })
}, { inject: ['systemPrompt'] })

/**
 * Register the output-style invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
