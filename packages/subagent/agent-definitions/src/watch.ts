/**
 * Host filesystem watching for agent-definition roots: the SkillWatchManager
 * shape narrowed to flat `<name>.md` role files. Root/ancestor dual-mode
 * watching, `awaitWriteFinish` stabilization, project capacity eviction, and
 * microtask-debounced invalidation carry over unchanged.
 *
 * @module @huiliyi37/dsh-agent-definitions/watch
 */

/* jscpd:ignore-start -- intentional copy of dsh-skill-local's private
   SkillWatchManager (plan C7-5/C1), narrowed to flat-file relevance. */
import { stat } from 'node:fs/promises'
import { unwatchFile, watchFile, type Stats } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@huiliyi37/cordis'
import chokidar from 'chokidar'
import type { AgentRoot } from './discovery.ts'

type AgentWatchEvent = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'

type RootWatchMode =
  | { kind: 'root'; anchor: string }
  | { kind: 'ancestor'; anchor: string; nextPath: string }

interface RootWatchState {
  root: AgentRoot
  owners: Set<string>
  watcher: WatchHandle | undefined
  opening: Promise<void> | undefined
  unhealthy: boolean
}

interface WatchHandle {
  mode: RootWatchMode
  close(): Promise<void> | void
}

/** Resolved watcher tuning, asserted positive at plugin load. */
export interface ResolvedAgentWatchConfig {
  readonly enabled: boolean
  readonly usePolling: boolean
  readonly stabilityThresholdMs: number
  readonly pollIntervalMs: number
  readonly maxProjects: number
  readonly followSymlinks: boolean
}

/** Owns bounded host watchers while discovery and reads remain on the filesystem service. */
export class AgentWatchManager {
  private readonly roots = new Map<string, RootWatchState>()
  private readonly projects = new Map<string, Set<string>>()
  private readonly lifecycle = new AbortController()
  private closing = false
  private invalidationQueued = false

  constructor(
    private readonly ctx: Context,
    private readonly invalidate: () => void,
    private readonly config: ResolvedAgentWatchConfig,
  ) {}

  /**
   * Retain watchers for one discovery pass's roots, evicting the oldest
   * project beyond the configured capacity.
   * @param roots - the roots this observation scanned.
   */
  async observeRoots(roots: readonly AgentRoot[]): Promise<void> {
    if (this.closing) return
    const projectRoots = new Map<string, AgentRoot[]>()
    const pending: Promise<void>[] = []
    for (const root of roots) {
      if (root.projectRoot === undefined) {
        pending.push(this.retainRoot(root, `shared:${root.path}`))
        continue
      }
      const grouped = projectRoots.get(root.projectRoot) ?? []
      grouped.push(root)
      projectRoots.set(root.projectRoot, grouped)
    }
    for (const [projectRoot, grouped] of projectRoots) {
      const owner = `project:${projectRoot}`
      this.projects.delete(projectRoot)
      const paths = new Set(grouped.map(root => root.path))
      this.projects.set(projectRoot, paths)
      for (const root of grouped) pending.push(this.retainRoot(root, owner))
    }
    let evictedProject = false
    while (this.projects.size > this.config.maxProjects) {
      const oldest = this.projects.entries().next()
      /* v8 ignore next -- the loop condition proves one project exists. */
      if (oldest.done) break
      const [projectRoot, paths] = oldest.value
      this.projects.delete(projectRoot)
      const owner = `project:${projectRoot}`
      for (const path of paths) pending.push(this.releaseRoot(path, owner))
      evictedProject = true
    }
    await Promise.all(pending)
    if (evictedProject) this.invalidate()
  }

  /**
   * Invalidate synchronously after a first-party filesystem mutation.
   * @param path - host display path observed after a model-facing write or edit.
   */
  observeHostMutation(path: string): void {
    if (this.closing) return
    const normalized = resolve(path)
    if (![...this.roots.values()].some(state => isPotentialAgentPath(state.root, normalized))) return
    this.invalidate()
  }

  /**
   * Close every host watcher and contain late filesystem callbacks.
   * @returns once every watcher reached quiescence.
   */
  async dispose(): Promise<void> {
    this.closing = true
    this.lifecycle.abort(new Error('agent-definitions watcher disposed'))
    const states = [...this.roots.values()]
    this.roots.clear()
    this.projects.clear()
    await Promise.all(states.map(async (state) => {
      await settleWatcherOpening(state.opening)
      const watcher = state.watcher
      state.watcher = undefined
      if (watcher !== undefined) await this.closeWatcher(watcher)
    }))
  }

  private async retainRoot(root: AgentRoot, owner: string): Promise<void> {
    let state = this.roots.get(root.path)
    if (state === undefined) {
      state = { root, owners: new Set(), watcher: undefined, opening: undefined, unhealthy: true }
      this.roots.set(root.path, state)
    }
    state.owners.add(owner)
    if (this.config.enabled) await this.ensureWatcher(state)
  }

  private async releaseRoot(path: string, owner: string): Promise<void> {
    const state = this.roots.get(path)
    /* v8 ignore next -- Concurrent cwd observations can evict the same shared root before this release settles. */
    if (state === undefined) return
    state.owners.delete(owner)
    if (state.owners.size > 0) return
    this.roots.delete(path)
    await settleWatcherOpening(state.opening)
    const watcher = state.watcher
    state.watcher = undefined
    if (watcher !== undefined) await this.closeWatcher(watcher)
  }

  private ensureWatcher(state: RootWatchState): Promise<void> {
    /* v8 ignore next -- A scheduled rewatch can reach this guard only when teardown wins its await. */
    if (this.closing || !this.config.enabled) return Promise.resolve()
    if (state.opening !== undefined) return state.opening
    const opening = this.ensureCurrentWatcher(state)
    state.opening = opening
    void opening.then(
      () => {
        state.opening = undefined
      },
      () => {
        state.opening = undefined
      },
    )
    return opening
  }

  private async ensureCurrentWatcher(state: RootWatchState): Promise<void> {
    const watcher = state.watcher
    if (watcher !== undefined && !state.unhealthy) {
      const current = await resolveRootWatchMode(state.root.path)
      // A child unlink can publish an empty catalog before root unlinkDir arrives.
      // Discovery therefore revalidates the retained handle independently.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- watcher callbacks can mark unhealthy while the probe awaits
      if (!state.unhealthy && sameWatchMode(watcher.mode, current)) return
    }
    await this.replaceWatcher(state)
  }

  private async replaceWatcher(state: RootWatchState): Promise<void> {
    const previous = state.watcher
    state.watcher = undefined
    if (previous !== undefined) await this.closeWatcher(previous)
    /* v8 ignore next -- Teardown can win while an unhealthy watcher is still closing. */
    if (this.closing || state.owners.size === 0) return
    try {
      const watcher = await this.openStableWatcher(state)
      /* v8 ignore next -- The loop returns no handle only when teardown wins between awaited probes. */
      if (watcher === undefined) return
      /* v8 ignore start -- Post-open teardown is timing-dependent; the disposal race has an explicit integration test. */
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- teardown can race awaited watcher startup
      if (this.closing || state.owners.size === 0) {
        await this.closeWatcher(watcher)
        return
      }
      /* v8 ignore stop */
      state.watcher = watcher
      state.unhealthy = false
    } catch (error) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- teardown can race awaited watcher startup
      if (!this.closing) {
        state.unhealthy = true
        this.ctx.logger.warn(`agent-definitions: failed to watch ${state.root.path}: ${errorMessage(error)}`)
      }
      throw error
    }
  }

  private async openStableWatcher(state: RootWatchState): Promise<WatchHandle | undefined> {
    while (!this.closing && state.owners.size > 0) {
      const mode = await resolveRootWatchMode(state.root.path)
      const watcher = mode.kind === 'ancestor'
        ? this.openAncestorWatcher(state, mode)
        : await this.openRootWatcher(state, mode)
      const current = await resolveRootWatchMode(state.root.path)
      /* v8 ignore else -- A host path transition between the two probes is timing-dependent. */
      if (sameWatchMode(mode, current)) return watcher
      /* v8 ignore next -- Covered by the same host path transition guard. */
      await this.closeWatcher(watcher)
    }
    /* v8 ignore next -- The loop exits only when teardown wins between awaited probes. */
    return undefined
  }

  private openAncestorWatcher(state: RootWatchState, mode: Extract<RootWatchMode, { kind: 'ancestor' }>): WatchHandle {
    const listener = (_current: Stats, _previous: Stats): void => {
      void this.handleAncestorWatchEvent(state, mode)
    }
    watchFile(mode.nextPath, {
      persistent: false,
      interval: this.config.pollIntervalMs,
    }, listener)
    return {
      mode,
      close() {
        unwatchFile(mode.nextPath, listener)
      },
    }
  }

  private async handleAncestorWatchEvent(
    state: RootWatchState,
    mode: Extract<RootWatchMode, { kind: 'ancestor' }>,
  ): Promise<void> {
    let current: RootWatchMode
    try {
      current = await resolveRootWatchMode(state.root.path)
    } catch (error) {
      /* v8 ignore start -- Non-absence stat failures need a platform permission or I/O fault. */
      if (!this.closing && state.owners.size > 0) this.handleWatcherError(state, error)
      return
      /* v8 ignore stop */
    }
    if (this.closing || state.owners.size === 0 || sameWatchMode(mode, current)) return
    this.queueInvalidation()
    state.unhealthy = true
    this.scheduleRewatch(state)
  }

  private async openRootWatcher(state: RootWatchState, mode: Extract<RootWatchMode, { kind: 'root' }>): Promise<WatchHandle> {
    const watcher = chokidar.watch(mode.anchor, {
      persistent: false,
      ignoreInitial: true,
      // Flat role files only: direct children of the root, never bundles.
      depth: 0,
      followSymlinks: this.config.followSymlinks,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: this.config.stabilityThresholdMs,
        pollInterval: this.config.pollIntervalMs,
      },
      usePolling: this.config.usePolling,
      interval: this.config.pollIntervalMs,
    })
    const handle: WatchHandle = {
      mode,
      close: () => watcher.close(),
    }
    let ready = false
    const readiness = Promise.withResolvers<undefined>()
    const signal = this.lifecycle.signal
    if (signal.aborted) {
      await this.closeWatcher(handle)
      signal.throwIfAborted()
    }
    const onAbort = (): void => { readiness.reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    const onError = (error: unknown): void => {
      if (!ready) {
        readiness.reject(error)
        return
      }
      this.handleWatcherError(state, error)
    }
    watcher.on('error', onError)
    watcher.once('ready', () => {
      ready = true
      readiness.resolve(undefined)
    })
    for (const event of ['add', 'addDir', 'change', 'unlink', 'unlinkDir'] as const) {
      watcher.on(event, (path) => { this.handleWatchEvent(state, event, path) })
    }
    try {
      await readiness.promise
    } catch (error) {
      await this.closeWatcher(handle)
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
    return handle
  }

  private handleWatchEvent(
    state: RootWatchState,
    event: AgentWatchEvent,
    path: string,
  ): void {
    if (this.closing || !isRelevantWatchEvent(state.root, event, resolve(path))) return
    this.queueInvalidation()
    if (resolve(path) === state.root.path && event === 'unlinkDir') {
      state.unhealthy = true
      this.scheduleRewatch(state)
    }
  }

  private handleWatcherError(state: RootWatchState, error: unknown): void {
    if (this.closing) return
    this.ctx.logger.warn(`agent-definitions: watcher for ${state.root.path} failed: ${errorMessage(error)}`)
    state.unhealthy = true
    this.queueInvalidation()
    this.scheduleRewatch(state)
  }

  private scheduleRewatch(state: RootWatchState): void {
    const currentOpening = state.opening ?? Promise.resolve()
    void (async () => {
      await settleWatcherOpening(currentOpening)
      try {
        await this.ensureWatcher(state)
      } catch {
        // Watch startup logged the retry failure; the next incomplete discovery retries it again.
        return
      }
      this.queueInvalidation()
    })()
  }

  private queueInvalidation(): void {
    if (this.closing || this.invalidationQueued) return
    this.invalidationQueued = true
    queueMicrotask(() => {
      this.invalidationQueued = false
      /* v8 ignore next -- Effect teardown can win this queued microtask before provider disposal emits. */
      if (this.closing) return
      this.invalidate()
    })
  }

  private async closeWatcher(watcher: WatchHandle): Promise<void> {
    try {
      await watcher.close()
    } catch (error) {
      this.ctx.logger.warn(`agent-definitions: failed to close watcher: ${errorMessage(error)}`)
    }
  }
}

async function settleWatcherOpening(opening: Promise<void> | undefined): Promise<void> {
  if (opening === undefined) return
  try {
    await opening
  } catch {
    // Watch startup already logged the underlying failure; teardown only contains it.
  }
}

async function resolveRootWatchMode(root: string): Promise<RootWatchMode> {
  let candidate = root
  while (true) {
    try {
      const info = await stat(candidate)
      if (info.isDirectory()) {
        if (candidate === root) return { kind: 'root', anchor: root }
        const firstSegment = relative(candidate, root).split(sep)[0]
        /* v8 ignore next -- candidate is a strict ancestor of root. */
        if (firstSegment === undefined || firstSegment.length === 0) return { kind: 'root', anchor: root }
        return { kind: 'ancestor', anchor: candidate, nextPath: join(candidate, firstSegment) }
      }
    } catch (error) {
      /* v8 ignore next -- Non-absence stat failures are platform/permission-specific and propagate as incomplete discovery. */
      if (!isAbsentPathError(error)) throw error
    }
    const parent = dirname(candidate)
    /* v8 ignore next -- Traversal reaches the existing filesystem root before this fallback. */
    if (parent === candidate) return { kind: 'ancestor', anchor: candidate, nextPath: root }
    candidate = parent
  }
}

function sameWatchMode(left: RootWatchMode, right: RootWatchMode): boolean {
  return left.kind === right.kind
    && left.anchor === right.anchor
    && (left.kind === 'root' || (right.kind === 'ancestor' && left.nextPath === right.nextPath))
}

function isRelevantWatchEvent(
  root: AgentRoot,
  event: AgentWatchEvent,
  path: string,
): boolean {
  const segments = containedSegments(root.path, path)
  if (segments === undefined) return false
  if (segments.length === 0) return event === 'addDir' || event === 'unlinkDir'
  // Flat layout: only `<name>.md` files directly under the root matter.
  return segments.length === 1
    && event !== 'addDir'
    && event !== 'unlinkDir'
    && segments[0]?.endsWith('.md') === true
}

function isPotentialAgentPath(root: AgentRoot, path: string): boolean {
  const segments = containedSegments(root.path, path)
  return segments !== undefined
    && segments.length === 1
    && segments[0]?.endsWith('.md') === true
}

function containedSegments(root: string, path: string): string[] | undefined {
  const child = relative(root, path)
  if (child.length === 0) return []
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) return undefined
  return child.split(sep)
}

function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return String(error)
}
/* jscpd:ignore-end */
