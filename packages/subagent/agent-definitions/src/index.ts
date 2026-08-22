/**
 * Agent role definitions (`ctx.agentDefinitions`): named delegation roles
 * discovered from flat markdown files plus a runtime registration seam for
 * built-in roles.
 *
 * A role is a named composition of subagent START-REQUEST inputs — persona
 * body, tool allow list, model route, sandbox narrowing — that a delegation
 * consumer (today `@huiliyi37/dsh-tool-subagent`'s `agent` parameter) merges
 * into one request. It is NOT a new provider: provider selection stays with
 * the delegation tool's deployment configuration.
 *
 * Discovery mirrors the skill seam's local provider: ranked roots (project
 * `.dsh/agents` and `.agents/agents`, then custom, user, and bundled roots),
 * YAML frontmatter (`name` and `description` required, optional `tools` allow
 * list and `model`), first-wins duplicate handling, and chokidar-backed
 * invalidation. Runtime registrations through {@link AgentDefinitionService.register}
 * sit between project and custom roots, which is where the built-in read-only
 * `explore` role lives.
 *
 * @module @huiliyi37/dsh-agent-definitions
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context, Service } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import type Schema from '@huiliyi37/schemastery'
import { isSkillName } from '@huiliyi37/dsh-skill'
import { resolveDshHome } from '@huiliyi37/dsh-paths'
import {
  discoverAgentRoot,
  parseAgentFile,
  resolveAgentRoots,
} from './discovery.ts'
import type { AgentDefinitionSource, AgentLocator } from './discovery.ts'
import { AgentWatchManager } from './watch.ts'
import type { ResolvedAgentWatchConfig } from './watch.ts'

export type { AgentDefinitionSource } from './discovery.ts'

const DEFAULT_COLLECT_CACHE_ENTRIES = 128
const MAX_COLLECT_ATTEMPTS = 2
const RUNTIME_RANK = 250
const DEFAULT_WATCH_STABILITY_THRESHOLD_MS = 200
const DEFAULT_WATCH_POLL_INTERVAL_MS = 100
const DEFAULT_WATCH_MAX_PROJECTS = 128

/** Caller context used for cwd-sensitive and abortable definition lookups. */
export interface AgentDefinitionLookupOptions {
  /** Workspace selector for the current lookup. */
  readonly cwd?: string | undefined
  /** Abort discovery or loading work for the current caller. */
  readonly signal?: AbortSignal | undefined
}

/** Invocation-neutral role metadata returned by `ctx.agentDefinitions.list()`. */
export interface AgentDefinitionSummary {
  /** Kebab-case identifier used to address the role. */
  readonly name: string
  /** Short routing description shown by discovery consumers. */
  readonly description: string
  /** Discovery source that produced this winning role. */
  readonly source: AgentDefinitionSource
  /** Absolute file path when the role came from disk. */
  readonly path?: string
}

/** Complete parsed role definition, including the persona body. */
export interface AgentDefinition extends AgentDefinitionSummary {
  /** Persona body: the markdown content after frontmatter removal. */
  readonly content: string
  /** Global tool names the child keeps when delegated as this role. */
  readonly tools?: readonly string[]
  /** Model route override for the child's `agentOptions.model`. */
  readonly model?: string
  /** Sandbox narrowing requested for the child; only `'read-only'` is representable. */
  readonly sandbox?: 'read-only'
}

/** Runtime role contribution accepted by `ctx.agentDefinitions.register()`. */
export interface AgentDefinitionRegistration {
  /** Kebab-case identifier used to address the role. */
  readonly name: string
  /** Short routing description shown by discovery consumers. */
  readonly description: string
  /** Persona body installed as the child's shadowing `deployment:persona` section. */
  readonly content: string
  /** Origin bucket; omission records `runtime`. */
  readonly source?: AgentDefinitionSource
  /** Global tool names the child keeps when delegated as this role. */
  readonly tools?: readonly string[]
  /** Model route override for the child's `agentOptions.model`. */
  readonly model?: string
  /** Sandbox narrowing requested for the child; only `'read-only'` is representable. */
  readonly sandbox?: 'read-only'
}

/** One catalog observation plus whether discovery completed within a stable revision. */
export interface AgentDefinitionCatalogSnapshot {
  /** Sorted invocation-neutral summaries collected in this observation. */
  readonly definitions: AgentDefinitionSummary[]
  /** Whether root watching started cleanly and this observation may be cached. */
  readonly complete: boolean
}

/** Agent definition registry and local discovery configuration. */
export interface Config {
  /** Whether project and user roots are included around custom roots. */
  includeDefaultRoots?: boolean
  /** Tianshu Harness config root. Defaults to `$DSH_HOME` or `~/.dsh-tianshu`. */
  dshHome?: string
  /** Shared agent config root. Defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  agentsHome?: string
  /** Additional agent roots scanned after project roots and before user roots. */
  customAgentDirs?: string[]
  /** Bundled agent root for installer-supplied roles; defaults to none. */
  bundledAgentDir?: string
  /** Register the built-in read-only `explore` role (default true). */
  builtinExplore?: boolean
  /** Register the built-in read-only `verify` role (default true). */
  builtinVerify?: boolean
  /** Maximum number of completed cwd catalogs kept in memory. */
  collectCacheMaxEntries?: number
  /** Whether host-local agent roots are watched for catalog changes. */
  watch?: boolean
  /** Whether Chokidar uses polling instead of native filesystem events. */
  watchUsePolling?: boolean
  /** Milliseconds a changed role file must remain stable before it is observed. */
  watchStabilityThresholdMs?: number
  /** Milliseconds between Chokidar stability or polling probes. */
  watchPollIntervalMs?: number
  /** Maximum distinct project roots whose agent directories remain watched. */
  watchMaxProjects?: number
  /** Whether watched symbolic links follow their target files. */
  watchFollowSymlinks?: boolean
}

declare module '@huiliyi37/cordis' {
  interface Context {
    agentDefinitions: AgentDefinitionService
  }
}

interface CandidateEntry {
  summary: AgentDefinitionSummary
  rank: number
  originOrder: number
  localOrder: number
  locator: AgentLocator | undefined
  runtime: AgentDefinition | undefined
}

interface CollectResult {
  entries: CandidateEntry[]
  cacheable: boolean
}

/**
 * The built-in read-only exploration role: a read-only tool allow list plus a
 * `read-only` sandbox narrowing, so its shell access cannot mutate the
 * workspace. The allow list names only tools shipped by the base assembly
 * (`grep`, `read`, `glob`, `semantic_search`, `bash`); a deployment missing
 * one fails the delegation loud through `tools.restrict()`.
 */
const BUILTIN_EXPLORE: AgentDefinitionRegistration = {
  name: 'explore',
  description:
    'Read-only codebase exploration: surveys, searches, and explains code, citing exact file paths and line '
    + 'numbers. Cannot modify files or run mutating commands. Use for scoped questions about how the code works.',
  content: [
    'You are an exploration subagent. Your job is to survey, search, and explain the codebase — never to change it.',
    'Work read-only: gather evidence with search and file-reading tools, and use shell commands only for read-only inspection.',
    'Answer concisely and cite exact file paths with line numbers for every claim.',
    'If the answer is not in the code you can read, say what you checked and what remains unknown.',
  ].join('\n'),
  tools: ['grep', 'read', 'glob', 'semantic_search', 'bash'],
  sandbox: 'read-only',
}

/**
 * The built-in read-only verification role: an independent second channel that
 * re-checks claims and runs verification commands (tests) without ever writing.
 * Companion to {@link BUILTIN_EXPLORE} — agent-router maps its verifier profile
 * onto this role. The allow list names only base-assembly tools; a deployment
 * missing one fails the delegation loud through `tools.restrict()`.
 */
const BUILTIN_VERIFY: AgentDefinitionRegistration = {
  name: 'verify',
  description:
    'Independent read-only verification: re-checks specific claims, reproduces defects, and runs read-only '
    + 'verification commands (e.g. focused tests) with evidence-backed verdicts. Cannot modify files or the workspace.',
  content: [
    'You are an independent verification subagent. Your job is to re-check a claim from scratch — never to fix or change anything.',
    'Work read-only: read the cited code, reproduce the claimed behavior, and run only read-only or test-running shell commands.',
    'Deliver a verdict — supported, unsupported, or inconclusive — backed by concrete evidence you gathered yourself.',
    'State exactly what you ran and observed; if you cannot decide, say inconclusive and what evidence would decide it.',
  ].join('\n'),
  tools: ['grep', 'read', 'glob', 'repo_graph', 'bash'],
  sandbox: 'read-only',
}

/**
 * Registry of agent role definitions. It merges the runtime registrations with
 * local filesystem discovery using stable first-wins duplicate handling,
 * exposes sorted invocation-neutral summaries, and loads full role bodies on
 * demand. Discovery invalidation is watcher- and mutation-driven; catalogs are
 * cached per cwd until the next invalidation.
 */
export class AgentDefinitionService extends Service {
  /* jscpd:ignore-start -- intentional copy of dsh-skill-local's config schema shape. */
  static Config: Schema<Config> = z.object({
    includeDefaultRoots: z.boolean().default(true),
    dshHome: z.string(),
    agentsHome: z.string(),
    customAgentDirs: z.array(z.string()).default([]),
    bundledAgentDir: z.string(),
    builtinExplore: z.boolean().default(true),
    builtinVerify: z.boolean().default(true),
    collectCacheMaxEntries: z.number().default(DEFAULT_COLLECT_CACHE_ENTRIES),
    watch: z.boolean().default(true),
    watchUsePolling: z.boolean().default(false),
    watchStabilityThresholdMs: z.number().default(DEFAULT_WATCH_STABILITY_THRESHOLD_MS),
    watchPollIntervalMs: z.number().default(DEFAULT_WATCH_POLL_INTERVAL_MS),
    watchMaxProjects: z.number().default(DEFAULT_WATCH_MAX_PROJECTS),
    watchFollowSymlinks: z.boolean().default(true),
  })
  /* jscpd:ignore-end */

  private readonly includeDefaultRoots: boolean
  private readonly dshHome: string
  private readonly agentsHome: string
  private readonly customAgentDirs: string[]
  private readonly bundledAgentDir: string | undefined
  private readonly collectCacheMaxEntries: number
  private readonly watchManager: AgentWatchManager
  private readonly runtime = new Map<string, AgentDefinition>()
  private readonly collectCache = new Map<string, CandidateEntry[]>()
  private revision = 0
  private disposal: Promise<void> | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'agentDefinitions')
    this.includeDefaultRoots = config.includeDefaultRoots ?? true
    this.dshHome = resolveDshHome(config.dshHome)
    this.agentsHome = resolve(config.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'))
    this.customAgentDirs = (config.customAgentDirs ?? []).map(root => resolve(root))
    this.bundledAgentDir = config.bundledAgentDir === undefined ? undefined : resolve(config.bundledAgentDir)
    this.collectCacheMaxEntries = config.collectCacheMaxEntries ?? DEFAULT_COLLECT_CACHE_ENTRIES
    assertPositiveInteger('collectCacheMaxEntries', this.collectCacheMaxEntries)
    this.watchManager = new AgentWatchManager(ctx, () => { this.invalidateCache() }, resolveWatchConfig(config))
    ctx.effect(function* (this: AgentDefinitionService) {
      yield async () => { await this.disposeWatcher() }
    }.bind(this), 'agent-definitions watcher')
    ctx.on('fs/observed', (target, _observation, actor) => {
      if (mutationToolName(actor) === undefined) return
      this.watchManager.observeHostMutation(target.displayPath)
    })
    if (config.builtinExplore !== false) this.register(BUILTIN_EXPLORE)
    if (config.builtinVerify !== false) this.register(BUILTIN_VERIFY)
  }

  /**
   * Register a borrowed readonly runtime role. Project entries outrank runtime
   * entries, which outrank custom and user entries. Same-name runtime entries
   * are first-wins; a duplicate logs a warning and receives a no-op disposer so
   * it cannot remove the winner.
   * @param registration - the role definition input; an omitted source records `runtime`.
   * @returns the exact Cordis effect disposer, preserving composite teardown order.
   */
  register(registration: AgentDefinitionRegistration): () => void {
    validateRuntimeRegistration(registration)
    const existing = this.runtime.get(registration.name)
    if (existing !== undefined) {
      this.ctx.logger.warn(`runtime agent "${registration.name}" ignored because it is already registered`)
      return () => {}
    }
    const definition: AgentDefinition = {
      name: registration.name,
      description: registration.description,
      content: registration.content,
      source: registration.source ?? 'runtime',
      ...registration.tools !== undefined ? { tools: registration.tools } : {},
      ...registration.model !== undefined ? { model: registration.model } : {},
      ...registration.sandbox !== undefined ? { sandbox: registration.sandbox } : {},
    }
    const runtime = this.runtime
    const invalidateCache = (): void => { this.invalidateCache() }
    const dispose = this.ctx.effect(function* () {
      runtime.set(definition.name, definition)
      invalidateCache()
      yield () => {
        runtime.delete(definition.name)
        invalidateCache()
      }
    }, 'agentDefinitions.register()')
    return dispose
  }

  /**
   * List invocation-neutral role summaries for a workspace.
   * @param options - lookup options; `cwd` selects project roots and `signal` cancels discovery.
   * @returns all sorted winning summaries.
   */
  async list(options: AgentDefinitionLookupOptions = {}): Promise<AgentDefinitionSummary[]> {
    return (await this.snapshot(options)).definitions
  }

  /**
   * Observe the current invocation-neutral catalog and whether discovery
   * completed cleanly. Incomplete observations are never cached, allowing
   * consumers to retain last-good state and retry on their next request
   * boundary.
   * @param options - lookup options; `cwd` selects project roots and `signal` cancels discovery.
   * @returns sorted summaries plus discovery-completeness state.
   */
  async snapshot(options: AgentDefinitionLookupOptions = {}): Promise<AgentDefinitionCatalogSnapshot> {
    const collected = await this.collect(options)
    return {
      definitions: collected.entries
        .map(entry => entry.summary)
        .sort(compareSummaries),
      complete: collected.cacheable,
    }
  }

  /**
   * Load the winning role definition for a name, re-reading the source file so
   * a watcher-less deployment still observes external edits at this boundary.
   * @param name - kebab-case role name.
   * @param options - lookup options; `cwd` selects workspace-sensitive roles and `signal` cancels work.
   * @returns the full role definition, or `undefined` when the name is unknown.
   */
  async get(name: string, options: AgentDefinitionLookupOptions = {}): Promise<AgentDefinition | undefined> {
    if (!isSkillName(name)) return undefined
    const collected = await this.collect(options)
    throwIfAborted(options.signal)
    const match = collected.entries.find(entry => entry.summary.name === name)
    if (match === undefined) return undefined
    if (match.runtime !== undefined) return match.runtime
    /* v8 ignore next -- A non-runtime entry always carries its file locator. */
    const locator = match.locator as AgentLocator
    const parsed = await parseAgentFile(locator.path, this.ctx, options.signal, match.summary.source === 'bundled')
    if (parsed === undefined) return undefined
    if (parsed.name !== match.summary.name) {
      // The file was renamed underneath a stale cached candidate; drop the
      // cache so the next lookup rediscovers instead of trusting this read.
      this.invalidateCache()
      return undefined
    }
    return {
      name: parsed.name,
      description: parsed.description,
      source: match.summary.source,
      path: locator.path,
      ...parsed.tools !== undefined ? { tools: parsed.tools } : {},
      ...parsed.model !== undefined ? { model: parsed.model } : {},
      content: parsed.content,
    }
  }

  /** Close every host watcher; idempotent, and safe to call from teardown. */
  private disposeWatcher(): Promise<void> {
    this.disposal ??= this.watchManager.dispose()
    return this.disposal
  }

  /* jscpd:ignore-start -- intentional copy of dsh-skill's revision-guarded cache loop. */
  private async collect(options: AgentDefinitionLookupOptions): Promise<CollectResult> {
    throwIfAborted(options.signal)
    let attempt = 1
    while (true) {
      const revision = this.revision
      const key = collectCacheKey(options, revision)
      const cached = this.collectCache.get(key)
      if (cached !== undefined) return { entries: cached, cacheable: true }

      const result = await this.collectFresh(options)
      throwIfAborted(options.signal)
      if (revision !== this.revision) {
        if (attempt < MAX_COLLECT_ATTEMPTS) {
          attempt += 1
          continue
        }
        return { entries: result.entries, cacheable: false }
      }
      if (result.cacheable) {
        this.collectCache.set(key, result.entries)
        if (this.collectCache.size > this.collectCacheMaxEntries) {
          const oldest = this.collectCache.keys().next() as IteratorYieldResult<string>
          this.collectCache.delete(oldest.value)
        }
      }
      return result
    }
  }
  /* jscpd:ignore-end */

  private async collectFresh(options: AgentDefinitionLookupOptions): Promise<CollectResult> {
    const entries: CandidateEntry[] = []
    let originOrder = 0
    let localOrder = 0
    for (const definition of [...this.runtime.values()].sort((a, b) => compareCodePoints(a.name, b.name))) {
      entries.push({
        summary: toSummary(definition),
        rank: RUNTIME_RANK,
        originOrder,
        localOrder,
        locator: undefined,
        runtime: definition,
      })
      localOrder += 1
    }
    originOrder += 1
    const roots = await resolveAgentRoots(options.cwd, {
      includeDefaultRoots: this.includeDefaultRoots,
      dshHome: this.dshHome,
      agentsHome: this.agentsHome,
      customAgentDirs: this.customAgentDirs,
      bundledAgentDir: this.bundledAgentDir,
    }, this.ctx)
    let cacheable = true
    try {
      await this.watchManager.observeRoots(roots)
    } catch (error) {
      if (this.disposal !== undefined) throw error
      cacheable = false
    }
    for (const root of roots) {
      let fileOrder = 0
      for (const { parsed, locator } of await discoverAgentRoot(root, this.ctx)) {
        entries.push({
          summary: {
            name: parsed.name,
            description: parsed.description,
            source: root.source,
            path: locator.path,
          },
          rank: root.rank,
          originOrder,
          localOrder: fileOrder,
          locator,
          runtime: undefined,
        })
        fileOrder += 1
      }
      originOrder += 1
    }
    entries.sort(compareEntries)
    const seen = new Set<string>()
    const winners: CandidateEntry[] = []
    for (const entry of entries) {
      if (seen.has(entry.summary.name)) {
        this.ctx.logger.warn(`agent "${entry.summary.name}" from ${entry.summary.source} ignored because a higher-priority agent already exists`)
        continue
      }
      seen.add(entry.summary.name)
      winners.push(entry)
    }
    return { entries: winners, cacheable }
  }

  private invalidateCache(): void {
    this.revision += 1
    this.collectCache.clear()
  }
}

function toSummary(definition: AgentDefinition): AgentDefinitionSummary {
  return {
    name: definition.name,
    description: definition.description,
    source: definition.source,
    ...definition.path !== undefined ? { path: definition.path } : {},
  }
}

/** Validate a runtime registration at the registration boundary. */
function validateRuntimeRegistration(registration: AgentDefinitionRegistration): void {
  if (!isSkillName(registration.name)) throw new Error(`invalid agent name "${registration.name}"`)
  if (registration.description.length === 0) throw new Error(`agent "${registration.name}" requires a description`)
  if (typeof registration.content !== 'string') {
    throw new TypeError(`runtime agent "${registration.name}" requires a persona body`)
  }
  if (registration.tools !== undefined
    && registration.tools.some(tool => typeof tool !== 'string' || tool.length === 0)) {
    throw new TypeError(`runtime agent "${registration.name}" tools must be an array of tool names`)
  }
}

function compareSummaries(left: AgentDefinitionSummary, right: AgentDefinitionSummary): number {
  return compareCodePoints(left.name, right.name)
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareEntries(left: CandidateEntry, right: CandidateEntry): number {
  return left.rank - right.rank
    || left.originOrder - right.originOrder
    || left.localOrder - right.localOrder
}

function assertPositiveInteger(name: string, value: number, minimum = 1): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`agent-definitions: ${name} must be an integer greater than or equal to ${minimum}`)
  }
}

function collectCacheKey(options: AgentDefinitionLookupOptions, revision: number): string {
  return JSON.stringify({ cwd: options.cwd, revision })
}

/* jscpd:ignore-start -- intentional copy of dsh-skill-local's watch-config resolution. */
function resolveWatchConfig(config: Config): ResolvedAgentWatchConfig {
  const stabilityThresholdMs = config.watchStabilityThresholdMs ?? DEFAULT_WATCH_STABILITY_THRESHOLD_MS
  const pollIntervalMs = config.watchPollIntervalMs ?? DEFAULT_WATCH_POLL_INTERVAL_MS
  const maxProjects = config.watchMaxProjects ?? DEFAULT_WATCH_MAX_PROJECTS
  assertPositiveInteger('watchStabilityThresholdMs', stabilityThresholdMs)
  assertPositiveInteger('watchPollIntervalMs', pollIntervalMs)
  assertPositiveInteger('watchMaxProjects', maxProjects)
  return {
    enabled: config.watch ?? true,
    usePolling: config.watchUsePolling ?? false,
    stabilityThresholdMs,
    pollIntervalMs,
    maxProjects,
    followSymlinks: config.watchFollowSymlinks ?? true,
  }
}
/* jscpd:ignore-end */

function mutationToolName(actor: object | undefined): 'edit' | 'write' | undefined {
  if (actor === undefined || !('name' in actor)) return undefined
  const value = actor.name
  return value === 'edit' || value === 'write' ? value : undefined
}

/* jscpd:ignore-start -- intentional copy of dsh-skill's total error normalizers. */
/** Throw a total Error for an already-aborted lookup. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw toError(signal.reason)
}

/** Normalize an arbitrary abort reason without trusting coercion. */
function toError(error: unknown): Error {
  try {
    if (error instanceof Error) return error
  } catch {
    // A hostile proxy may throw during instanceof; fall through to the total renderer.
  }
  return new Error(errorMessage(error))
}

/** Render an arbitrary failure without letting coercion escape containment. */
function errorMessage(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

export default AgentDefinitionService
/* jscpd:ignore-end */
