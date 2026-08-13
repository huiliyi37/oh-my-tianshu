/** Local Cordis plugin. */
import type { Context } from 'cordis'

export const name = '{{pluginName}}'

/** Register this plugin's project-local behavior. */
export function apply(ctx: Context): void {
  ctx.effect(() => () => {})
}
