/** Platform-neutral assembly of generated Host Remote contributions. */

import type { Context } from '@huiliyi37/cordis'
import goalsRemote from '@huiliyi37/dsh-goal/remote'
import dynamicCordisRemote from '@huiliyi37/dsh-cordis-host-runner/remote'
import type { TypeRTClientRemote } from '@huiliyi37/dsh-type-meta'

export type { TypeRTClientRemote as ClientRemote } from '@huiliyi37/dsh-type-meta'
export type {} from '@huiliyi37/dsh-goal/remote'

declare module '@huiliyi37/cordis' {
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
  const disposers: Array<() => Promise<void>> = []
  try {
    for (const contribution of [goalsRemote, dynamicCordisRemote]) {
      disposers.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
  // Unwound in reverse mount order, so a namespace never outlives one mounted
  // after it.
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}

// The dynamic-cordis contract types, re-exported from the host-runner's
// client-safe ./types (the local assembly plays the same role the official
// api-remotes client does: one place both planes legitimately meet).
export type {
  ApprovalRequestId,
  CordisDynamicPackageId,
  CordisDynamicPluginId,
  CordisDynamicPluginRunId,
  CordisDynamicRunMode,
  CordisInspectProviderManifest,
  CordisInspectQueryRequest,
  CordisInspectQueryResolution,
  CordisInspectRequestId,
  DynamicCordisClientSource,
  DynamicCordisHostHalfResult,
  DynamicCordisInventoryRow,
  DynamicCordisInvokeResult,
  DynamicCordisPackage,
  DynamicCordisRequestResolved,
  DynamicCordisResolveAck,
  DynamicCordisRetracted,
  DynamicCordisRunRequest,
  DynamicCordisRunResolution,
  DynamicCordisRunResponse,
} from '@huiliyi37/dsh-cordis-host-runner/types'
export type {} from '@huiliyi37/dsh-cordis-host-runner/remote'
export type { JsonValue } from '@huiliyi37/dsh-session/types'
