/**
 * Read-only renderers over the live runtime for `cordis_inspect`: the service list, the flat
 * plugin list, the registered tools, the temporary-plugin table (with per-plugin provides/waits),
 * and the catalog-backed `api` / `events` sections. Exact-name lookups add the
 * original source JSDoc without inflating the default reports.
 * @module @deepseek-ai/dsh-tool-cordis/inspect
 */

import type { Context, Fiber } from 'cordis'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { EVENT_API, INHERITED_CTX_API, SERVICE_API, TYPE_API } from './api-catalog.ts'
import type { EventApiEntry, InheritedApiEntry, ServiceApiEntry, TypeApiEntry } from './api-catalog.ts'
import { FiberState, STATE_LABELS } from './fiber-state.ts'
import { missingServices } from './mount.ts'
import type { DynamicMount } from './mount.ts'

/** The live service registrations from `ctx.reflect.store` (map + filter keeps the possibly-undefined index read branch-free). */
function liveImpls(ctx: Context): { name: string; fiber: Fiber }[] {
  const store = ctx.reflect.store
  return Object.getOwnPropertySymbols(store)
    .map(key => store[key])
    .filter((impl): impl is NonNullable<typeof impl> => impl !== undefined)
}

/** Whether `fiber` is `root` itself or mounted anywhere inside `root`'s subtree. */
function withinFiber(fiber: Fiber, root: Fiber): boolean {
  let current = fiber
  while (true) {
    if (current === root) return true
    const parent = current.parent.fiber
    if (parent === current) return false
    current = parent
  }
}

/**
 * Return the service names provided by a mount's fiber subtree.
 * @param ctx - the runtime whose service registrations are inspected.
 * @param fiber - the root of the mounted fiber subtree.
 * @returns the provided service names in lexical order.
 */
export function providedServices(ctx: Context, fiber: Fiber): string[] {
  return liveImpls(ctx)
    .filter(impl => withinFiber(impl.fiber, fiber))
    .map(impl => impl.name)
    .sort()
}

/**
 * The `services` section: every provided ctx service with its owning fiber,
 * annotating non-active owners with their lifecycle state.
 * @param ctx - the runtime to enumerate.
 * @returns one line per service, or a single placeholder line when none are provided.
 */
export function describeServices(ctx: Context): string[] {
  const lines = liveImpls(ctx).map((impl) => {
    const active = impl.fiber.state === FiberState.ACTIVE
    return `- ${impl.name} (provided by ${impl.fiber.name}${active ? '' : `, ${STATE_LABELS[impl.fiber.state]}`})`
  })
  return lines.length > 0 ? lines : ['(no services provided)']
}

/**
 * The `plugins` section: a flat list of every fiber the registry knows, one
 * line per fiber with its lifecycle state, sorted by plugin name (a plugin
 * mounted more than once repeats — one line per instance). Temporary plugins are
 * listed like any other plugin; their ids live in the `temporary` section.
 * @param ctx - the runtime whose registry is enumerated.
 * @returns one line per loaded plugin fiber.
 */
export function describePlugins(ctx: Context): string[] {
  const fibers: Array<Fiber> = []
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) fibers.push(fiber)
  }
  return fibers
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(fiber => `- ${fiber.name} [${STATE_LABELS[fiber.state]}]`)
}

/**
 * The `tools` section: the model-facing tool names the CALLING agent can see
 * (its scoped layer shadowing/joining the restricted global surface) — the
 * honest answer to the tool description's "what you can call".
 * @param ctx - the runtime whose tool registry is read.
 * @param scope - the calling agent (the viewing scope); omitted = global view.
 * @returns one line per visible tool.
 */
export function describeTools(ctx: Context, scope?: ScopeKey): string[] {
  return ctx.tools.schemas(scope).map(schema => `- ${schema.name}`)
}

/**
 * The `temporary` section: one line per temporary plugin with id, plugin name, lifecycle
 * state, the services its subtree provides, and — for a pending mount — the
 * services it waits for.
 * @param ctx - the runtime the mounts live in.
 * @param mounts - the tracked mounts, in mount order.
 * @returns one line per mount, or a single placeholder line when none exist.
 */
export function describeDynamic(ctx: Context, mounts: ReadonlyMap<string, DynamicMount>): string[] {
  if (mounts.size === 0) {
    return ['No temporary Plugins are running. Temporary Plugins created with cordis_mount disappear when DSH restarts.']
  }
  return [...mounts].map(([id, mount]) => {
    const provides = providedServices(ctx, mount.fiber)
    const waiting = missingServices(ctx, mount.fiber)
    const state = mount.fiber.state === FiberState.ACTIVE ? 'running' : STATE_LABELS[mount.fiber.state]
    return `- Temporary Plugin ${id}: ${mount.pluginName} [${state}] — provides: ${provides.join(', ') || 'none'}; waiting for: ${waiting.join(', ') || 'none'}; lifetime: until unmounted or DSH restarts`
  })
}

/**
 * The transitive closure of catalogued type shapes referenced (word-bounded)
 * by the seed texts — the runtime scoping that keeps the `api` section to the
 * shapes the LIVE signatures actually mention.
 */
function typeClosure(seeds: string[], types: readonly TypeApiEntry[]): TypeApiEntry[] {
  const included = new Map<string, TypeApiEntry>()
  let frontier = seeds
  while (frontier.length > 0) {
    const next: string[] = []
    for (const entry of types) {
      if (included.has(entry.name)) continue
      const pattern = new RegExp(`\\b${entry.name}\\b`)
      if (frontier.some(text => pattern.test(text))) {
        included.set(entry.name, entry)
        next.push(entry.declaration)
      }
    }
    frontier = next
  }
  return [...included.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Render one catalogued service, optionally including source-owned method JSDoc. */
function serviceLines(entry: ServiceApiEntry, detailed: boolean): string[] {
  const lines = [`- ${entry.key} — ${entry.summary}`]
  for (const method of entry.methods) {
    if (detailed) {
      for (const docLine of method.jsDoc.split('\n')) lines.push(`    ${docLine}`)
    }
    lines.push(`    ${method.signature}`)
  }
  return lines
}

/**
 * Render the generated catalog against the live runtime: live catalogued services with methods,
 * uncatalogued live services with owners, absent loadable services, referenced type shapes, and
 * inherited Context APIs.
 * @param ctx - the runtime to intersect the catalog with.
 * @param api - generated service entries, replaceable in tests.
 * @param inherited - inherited `ctx` entries, replaceable in tests.
 * @param types - public type shapes, replaceable in tests.
 * @param name - exact live service key whose methods should include original JSDoc; omitted for the compact catalog.
 * @returns the section lines.
 */
export function describeApi(
  ctx: Context,
  api: readonly ServiceApiEntry[] = SERVICE_API,
  inherited: readonly InheritedApiEntry[] = INHERITED_CTX_API,
  types: readonly TypeApiEntry[] = TYPE_API,
  name?: string,
): string[] {
  const live = new Map<string, string>()
  for (const impl of liveImpls(ctx)) live.set(impl.name, impl.fiber.name)
  const lines: string[] = []
  const liveMethodTexts: string[] = []
  let selected = api.filter(entry => live.has(entry.key))
  if (name !== undefined) {
    const entry = api.find(candidate => candidate.key === name)
    if (!entry) throw new Error(`no catalogued service named "${name}"`)
    if (!live.has(name)) throw new Error(`catalogued service "${name}" is not running`)
    selected = [entry]
  }
  for (const entry of selected) {
    lines.push(...serviceLines(entry, name !== undefined))
    for (const method of entry.methods) {
      liveMethodTexts.push(method.signature)
    }
  }
  if (name === undefined) {
    const catalogued = new Set(api.map(entry => entry.key))
    for (const [liveName, fiber] of [...live].sort(([a], [b]) => a.localeCompare(b))) {
      if (!catalogued.has(liveName)) lines.push(`- ${liveName} (provided by ${fiber}, no catalog entry)`)
    }
    const notRunning = api.filter(entry => !live.has(entry.key)).map(entry => entry.key)
    if (notRunning.length > 0) lines.push(`not running (loadable services with no live provider): ${notRunning.join(', ')}`)
  }
  const shapes = typeClosure(liveMethodTexts, types)
  if (shapes.length > 0) {
    lines.push('type shapes (referenced by the signatures above — read these before assuming a field is a string):')
    for (const shape of shapes) {
      for (const declLine of shape.declaration.split('\n')) lines.push(`    ${declLine}`)
    }
  }
  if (name === undefined) {
    lines.push('inherited ctx API:')
    for (const entry of inherited) lines.push(`- ${entry.name} — ${entry.summary}`)
  }
  return lines
}

/**
 * The `events` section: every harness event with its dispatch mode, one-line
 * summary, and exact signature, closed by the waterfall caution.
 * @param events - the event catalog (the generated one by default; injectable for tests).
 * @param name - exact event name whose signature should include original JSDoc; omitted for the compact catalog.
 * @returns the section lines.
 */
export function describeEvents(events: readonly EventApiEntry[] = EVENT_API, name?: string): string[] {
  let selected = events
  if (name !== undefined) {
    const event = events.find(candidate => candidate.name === name)
    if (!event) throw new Error(`no catalogued event named "${name}"`)
    selected = [event]
  }
  const lines = selected.flatMap((event) => {
    const entry = [`- ${event.name} [${event.mode}] — ${event.summary}`]
    if (name !== undefined) {
      for (const docLine of event.jsDoc.split('\n')) entry.push(`    ${docLine}`)
    }
    entry.push(`    ${event.signature}`)
    return entry
  })
  lines.push('waterfall listeners receive a trailing next() and MUST call it to delegate — returning without next() short-circuits the chain.')
  return lines
}
