/**
 * Keyless fixture owner that mounts the runtime before its prepared wrapper.
 * Cordis starts sibling Loader entries concurrently, so row order is not a dependency edge.
 */
import * as RepositoryPlugin from '@deepseek-ai/dsh-repository-plugin'
import * as PreparedPlugin from './dsh-plugin.mjs'

export const name = 'headless-repository-fixture-loader'

export async function apply(ctx) {
  await ctx.plugin(RepositoryPlugin)
  await ctx.plugin(PreparedPlugin)
}
