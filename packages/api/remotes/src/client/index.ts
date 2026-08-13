/** Platform-neutral assembly of generated Host Remote contributions. */

import type { Context } from 'cordis'
import goalsRemote from '@deepseek-ai/dsh-goal/remote'
import type { TypeRTClientRemote } from '@deepseek-ai/dsh-type-meta'

export type { TypeRTClientRemote as ClientRemote } from '@deepseek-ai/dsh-type-meta'
export type {} from '@deepseek-ai/dsh-goal/remote'

declare module 'cordis' {
  interface Context {
    /** Generated Remote namespaces selected by this Client assembly. */
    remote: TypeRTClientRemote
  }
}

/** Required service: the typed Client Remote contribution mount. */
export const inject = ['remote']

/**
 * Mount the Host capabilities explicitly selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the typed API service.
 * @returns disposer after every selected Remote namespace is ready.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await ctx.remote.$mount(goalsRemote)
}
