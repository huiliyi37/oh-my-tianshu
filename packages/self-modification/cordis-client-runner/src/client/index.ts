/**
 * Dynamic-package runner, browser half: the load engine that turns one browser
 * half's source into a live cordis plugin (closure → guard → module table →
 * loader entry, ./runtime.ts), plus the retract announcement that unloads it.
 *
 * Nothing loads on activation: this page holds no dynamic package until a
 * dispatch arrives, and a dispatch only follows a model `cordis_run` or a user
 * pressing a card's start control. A refresh therefore starts clean by design —
 * host process memory still holds the definition, the page simply does not run
 * it until asked again.
 */

import type { Context } from '@huiliyi37/cordis'
import type {
  ApprovalRequestId, CordisDynamicPluginId, CordisDynamicPluginRunId, DynamicCordisInvokeResult, JsonValue,
  DynamicCordisInventoryRow,
} from '@huiliyi37/dsh-api-remotes/client'
import type { ClientModuleSystem } from '@huiliyi37/dsh-client-modules/client'
import type { SlotsService } from '@huiliyi37/dsh-client-runtime/client'
// The Client Remote assembly is the one place the two planes meet: it mounts the
// `dynamicCordisRunner` namespace and re-exports its payload vocabulary, so this
// package names what it sends without importing a Host package.
import type { DynamicCordisLivePackage } from './runtime.ts'
import { DynamicCordisPackageRunner } from './runtime.ts'
import { CordisRunOrchestrator } from './orchestrator.ts'
import { ClientCordisInspectRegistry, provideClientCordisInspect } from './inspect-registry.ts'
import { clientInspectProviders } from './providers.ts'
import { provideClientTimer } from './timer.ts'
import type { CordisRunActivity, CordisRunFailure, CordisUserRunRequest } from './orchestrator.ts'
import type { CordisObservable, DynamicCordisRenderFailure } from './runtime.ts'

export { CordisRunOrchestrator } from './orchestrator.ts'
export { ClientCordisInspectRegistry } from './inspect-registry.ts'
export type {
  ClientCordisInspectHost, ClientCordisInspectProviderRegistration, ClientCordisInspectQueryContext,
} from './inspect-registry.ts'
export type {
  CordisRunActivity, CordisRunFailure, CordisRunHostSeam,
  CordisRunOrchestratorEnv, CordisRunRequest, CordisUserRunRequest,
} from './orchestrator.ts'
export { DynamicCordisPackageRunner } from './runtime.ts'
export type {
  CordisObservable, DynamicCordisClientHalf, DynamicCordisLivePackage, DynamicCordisLoadErrorCause,
  DynamicCordisLoadResult, DynamicCordisRenderFailure, DynamicCordisRunnerEnv,
} from './runtime.ts'

export { DynamicCordisStyles, evaluateClientHalf, isDynamicCordisPlugin } from './evaluator.ts'
export type { DynamicCordisClosureEnv, DynamicCordisEvaluatedPlugin } from './evaluator.ts'
export { dynamicCordisContext } from './guard.ts'
export type { DynamicCordisGuardEnv, DynamicCordisSlotLedgerRow } from './guard.ts'
export { ClientTimerService } from './timer.ts'
// Re-exported so consumers of the service face and the two events can name
// their subjects without reaching into the wire contract themselves.
export type {
  ApprovalRequestId, CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId,
  DynamicCordisPackage,
} from '@huiliyi37/dsh-api-remotes/client'


/**
 * What a run surface reads and calls. The activity map is the single home of
 * "a run is in flight", so an affordance never keeps its own copy — that is what
 * makes it survive a remount.
 */
export interface CordisRunnerFace {
  /** Each definition's in-flight run activity. */
  readonly activeRuns: CordisObservable<ReadonlyMap<CordisDynamicPluginId, CordisRunActivity>>
  /** The last failure of this page's own run attempt, per definition. */
  readonly lastRunError: CordisObservable<ReadonlyMap<CordisDynamicPluginId, CordisRunFailure>>
  /**
   * This page's last render crash per definition: a browser half that loaded
   * cleanly and then broke while React rendered it. Page-local and current by
   * construction — cleared when the package stops, is retracted, or loads again —
   * which is what makes it safe for a row to render directly. The host keeps its
   * own last-across-pages copy for the model; the two have different owners and
   * lifetimes and neither is derived from the other.
   */
  readonly renderFailures: CordisObservable<ReadonlyMap<CordisDynamicPluginId, DynamicCordisRenderFailure>>
  /**
   * Restore pending approvals after a page reconnect or missed event.
   * @param rows - current dynamic Plugin inventory.
   */
  reconcileApprovals(rows: readonly DynamicCordisInventoryRow[]): void
  /**
   * Answer one run request with "run it" and drive both halves.
   * @param requestId - the request being answered; unknown or settled ids are a no-op.
   * @param approveFutureVersions - whether this decision covers later Packages of the same Plugin.
   * @returns after the orchestration settled.
   */
  approve(requestId: ApprovalRequestId, approveFutureVersions: boolean): Promise<void>
  /**
   * Answer one run request with "do not run it".
   * @param requestId - the request being answered; unknown or settled ids are a no-op.
   * @returns after the refusal reached the host.
   */
  decline(requestId: ApprovalRequestId): Promise<void>
  /**
   * Run a definition here at the user's own request (the gesture authorizes it).
   * A definition with a browser half also loads onto this page; a host-only one
   * only comes up in the host process.
   * @param request - the definition to run, its session, and whether it has a browser half.
   * @returns after the orchestration settled.
   */
  startUserRun(request: CordisUserRunRequest): Promise<void>
  /**
   * Observe what this page has loaded.
   * @param fn - notified after every converged load or unload.
   * @returns unsubscribe.
   */
  subscribe(fn: () => void): () => void
  /**
   * Read what this page currently has loaded.
   * @returns immutable rows for live Client halves.
   */
  getSnapshot(): readonly DynamicCordisLivePackage[]
  /**
   * Whether this page loaded a definition's browser half — page-local truth,
   * never the host's "it is running".
   * @param pluginId - stable Plugin identity.
   * @returns true while a load is live here.
   */
  isLoaded(pluginId: CordisDynamicPluginId): boolean
}

declare module '@huiliyi37/cordis' {
  interface Context {
    /** Run orchestration and page-local load state: what run surfaces read and call. */
    dynamicCordisRunner: CordisRunnerFace
  }
}

/**
/** Teaching text for a routing failure the infrastructure itself reports. */
function invokeFailure(pluginId: CordisDynamicPluginId, method: string, result: Extract<DynamicCordisInvokeResult, { ok: false }>): string {
  const where = `host.call("${method}") on ${pluginId}`
  if (result.code === 'plugin-not-running') {
    return `${where} found no active Host half — the Plugin is stopped or was removed.`
  }
  if (result.code === 'stale-run') {
    return `${where} belongs to an activation that has already been replaced.`
  }
  if (result.code === 'method-not-found') {
    return `${where} is not registered: the host half must declare it with harness.handle("${method}", fn).`
  }
  return `${where} failed inside the host handler: ${result.message}`
}

/**
 * Teaching text for a `host.call` the wire itself refused: the generated codec
 * rejected the argument before sending, or the result on the way back, or the
 * transport broke. The infrastructure's message names the field it refused but
 * not the call it belonged to, and the model authored both halves — so this adds
 * the call and the contract it has to satisfy.
 */
function wireFailure(id: CordisDynamicPluginId, method: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `host.call("${method}") on ${id} did not complete: ${message}\n`
    + 'Both directions carry JSON only: pass plain JSON data as the argument — or omit it, and the handler receives '
    + `null — and answer from harness.handle("${method}", fn) with JSON (\`return null\` when there is nothing to report).`
}

/** Stable Cordis plugin name. */
export const name = 'cordis-client-runner'

/**
 * Required services: the loader/module chain for entries, the slot registry for
 * contributions, and the `dynamicCordisRunner` Remote namespace. Declaring the
 * namespace parks this plugin until the host side exists, so a page never loads
 * a browser half whose host half it could not reach.
 */
export const inject = ['loader', 'modules', 'slots', 'remote', 'remote.dynamicCordisRunner']

/**
 * Client plugin body: build the runner and subscribe the dispatch family.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  provideClientTimer(ctx)
  const inspect = new ClientCordisInspectRegistry({
    sync: async (providers) => {
      // The local TypeRT carrier returns the raw result (null when the
      // namespace is unavailable); wire failures surface as rejections.
      await ctx.remote.dynamicCordisRunner.syncInspectManifest(providers)
    },
    resolve: async (agentId, requestId, resolution) => {
      const answered = await ctx.remote.dynamicCordisRunner.resolveInspectQuery(agentId, requestId, resolution)
      // The generated codec types the raw result as CordisInspectResolveAck — no null —
      // so an unanswered query is exactly `accepted: false`.
      if (!answered.accepted) throw new Error(`inspect query ${requestId} was not answered`)
    },
  })
  provideClientCordisInspect(ctx, inspect)
  for (const provider of clientInspectProviders(ctx)) {
    ctx.effect(() => inspect.register(provider), `cordis-client-runner: inspect ${provider.manifest.id}`)
  }
  ctx.on('connection/reset', () => { inspect.publish() })

  const runner = new DynamicCordisPackageRunner({
    ctx,
    loader: ctx.loader,
    modules: ctx.get('modules') as ClientModuleSystem,
    slots: ctx.get('slots') as SlotsService,
    invoke: async (pluginId, pluginRunId, method, args) => {
      // Model-authored arguments reach this boundary untyped; the namespace's
      // generated codec is what validates them as JSON, and its rejection is a
      // bare field name — this is the only place that still knows which call it
      // belonged to, so the teaching has to be added here.
      const answered = await ctx.remote.dynamicCordisRunner.invoke(pluginId, pluginRunId, method, args as JsonValue)
        .catch((error: unknown) => { throw new Error(wireFailure(pluginId, method, error)) })
      // The generated codec types the raw result as DynamicCordisInvokeResult — no null:
      // a call that never reached the host half surfaces as the rejection above, and the
      // namespace's own `ok: false` envelope when that half answers with a refusal.
      if (!answered.ok) throw new Error(wireFailure(pluginId, method, invokeFailure(pluginId, method, answered)))
      return answered.value
    },
    // Post-settle diagnosis, deliberately fire-and-forget: the run this package
    // belongs to was answered before it ever rendered, so nothing waits on this
    // and a failed report must not turn one crash into two.
    reportRenderFailure: (agentId, pluginId, pluginRunId, failure) => {
      void ctx.remote.dynamicCordisRunner.reportRenderFailure(agentId, pluginId, pluginRunId, failure).catch((error: unknown) => {
        console.error(`[cordis-client-runner] reporting a render failure of ${pluginId} failed:`, error)
      })
    },
    reportGuardFailure: (agentId, pluginId, pluginRunId, failure) => {
      void ctx.remote.dynamicCordisRunner.reportClientGuardFailure(agentId, pluginId, pluginRunId, failure).catch((error: unknown) => {
        console.error(`[cordis-client-runner] reporting a guard failure of ${pluginId} failed:`, error)
      })
    },
  })
  const orchestrator = new CordisRunOrchestrator({
    runner,
    host: {
      // The seam names business payloads only, so a carrier failure is folded
      // here into whatever each verb already does with one: the short-circuit
      // message for a start, a throw where the caller has a catch of its own.
      runHostHalf: async (agentId, pluginId, packageId, mode, requestId, approveFutureVersions) => {
        const answered = await ctx.remote.dynamicCordisRunner.runHostHalf(
          agentId, pluginId, packageId, mode, requestId, approveFutureVersions,
        )
        return answered.ok ? answered : { ok: false, message: answered.message }
      },
      getClientCode: async (agentId, pluginId, pluginRunId) => {
        const answered = await ctx.remote.dynamicCordisRunner.getClientCode(agentId, pluginId, pluginRunId)
        // The generated codec types the raw result as DynamicCordisClientSource — no null.
        return answered
      },
      resolveRequestRun: async (requestId, resolution) => {
        const answered = await ctx.remote.dynamicCordisRunner.resolveRequestRun(requestId, resolution)
        // Thrown rather than returned: `answer` logs and drops a failed answer,
        // and the host settles the request on its own either way. The generated
        // codec types the raw result as DynamicCordisResolveAck — no null.
        if (!answered.accepted) throw new Error(`host half refused resolveRequestRun for ${requestId}`)
        return answered
      },
      settleUserRun: async (agentId, pluginId, resolution) => {
        const answered = await ctx.remote.dynamicCordisRunner.settleUserRun(agentId, pluginId, resolution)
        // The generated codec types the raw result as DynamicCordisRunResponse — no null:
        // no result at all is a carrier rejection, and "no" is `ok: false`.
        if (!answered.ok) throw new Error(`host half refused settleUserRun for ${pluginId}`)
        return answered
      },
    },
  })
  const face: CordisRunnerFace = {
    activeRuns: orchestrator.activeRuns,
    lastRunError: orchestrator.lastRunError,
    renderFailures: runner.renderFailures,
    reconcileApprovals: (rows) => { orchestrator.reconcileApprovals(rows) },
    approve: (requestId, approveFutureVersions) => orchestrator.approve(requestId, approveFutureVersions),
    decline: requestId => orchestrator.decline(requestId),
    startUserRun: request => orchestrator.startUserRun(request),
    subscribe: fn => runner.subscribe(fn),
    getSnapshot: () => runner.getSnapshot(),
    isLoaded: id => runner.isLoaded(id),
  }
  ctx.provide('dynamicCordisRunner', face)
  ctx.effect(() => () => { void runner.dispose() }, 'cordis-client-runner: dynamic package runner')

  // Host-forwarded dynamic-cordis events. The local Gateway does not forward
  // events yet ($on is typed but absent at runtime), so the subscriptions are
  // guarded; once the forwarding seam lands they become live without a change.
  if (typeof ctx.remote.$on === 'function') {
    ctx.remote.$on('cordis/request-run', (request) => {
      orchestrator.open(request as Parameters<typeof orchestrator.open>[0])
    })
    ctx.remote.$on('cordis/request-run-resolved', (resolved) => {
      orchestrator.close((resolved as { requestId: ApprovalRequestId }).requestId)
    })
    ctx.remote.$on('cordis/dynamic-retract', (retracted) => {
      runner.retract(
        (retracted as { pluginId: CordisDynamicPluginId }).pluginId,
        (retracted as { pluginRunId: CordisDynamicPluginRunId }).pluginRunId,
      )
    })
    ctx.remote.$on('cordis/inspect-query', (request) => {
      void inspect.query(request as Parameters<typeof inspect.query>[0]).catch((error: unknown) => {
        console.error('[cordis-client-runner] inspect query failed:', error)
      })
    })
    ctx.remote.$on('cordis/inspect-query-resolved', (resolved) => {
      inspect.close((resolved as { requestId: string }).requestId as never)
    })
  }
}
