/**
 * File-level stigmergy pheromones (Tianshu `src/context/stigmergy.ts` port).
 *
 * Session-scoped spatial memory via pheromone deposition, persisted to
 * `.rivet/pheromones.json` with atomic replacement. Signals decay
 * exponentially (half-life default 7 days); entries below the prune threshold
 * are cleaned up; capacity is enforced LRU-style by dropping the oldest
 * entries. The store is a pure library — signal sources (test-failure RED,
 * read/edit traces) are wired by consuming plugins.
 *
 * @module @deepseek-ai/dsh-pheromone
 */

import { readFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** File-level signal kinds (plan Wave 3). */
export type PheromoneSignal =
  | 'fragile'
  | 'well-tested'
  | 'entry-point'
  | 'dead-end'
  | 'coupling-hub'

/** 一次信息素沉积请求（强度会被截断到 [0,1]）。 */
export interface PheromoneDeposit {
  path: string
  signal: PheromoneSignal
  /** Initial strength in [0, 1]; clamped on deposit. */
  strength: number
  /** Optional context snippet; truncated to 80 chars. */
  context?: string
  /** Custom half-life in ms. Default: 604_800_000 (7 days). */
  halfLifeMs?: number
}

/** 已存储的信息素条目（含沉积时间与半衰期）。 */
export interface Pheromone {
  path: string
  signal: PheromoneSignal
  strength: number
  depositedAt: number
  halfLife: number
  context?: string
}

/** A stored pheromone with its decayed current strength computed. */
export interface PheromoneQueryResult extends Pheromone {
  currentStrength: number
}

/** 默认半衰期：7 天（毫秒）。 */
export const DEFAULT_HALF_LIFE_MS = 604_800_000 // 7 days
const DECAY_CONSTANT = 0.693 // ln(2)
/** 默认容量上限（超出按 LRU 丢弃最旧）。 */
export const DEFAULT_MAX_CAPACITY = 200
/** 剪枝阈值：衰减强度低于此值即清理。 */
export const PRUNE_THRESHOLD = 0.05
const DEFAULT_FLUSH_DELAY_MS = 200
const CONTEXT_MAX_CHARS = 80
/** Backoff ceiling for retried disk writes after a failure (2^6 × 200ms). */
const MAX_FLUSH_BACKOFF_MS = 30_000

/**
 * Compute the current (decayed) strength of a pheromone: exponential decay
 * `strength * e^(-λ·elapsed/halfLife)` with λ = ln(2) ≈ 0.693.
 * @param initialStrength - deposition strength (0–1).
 * @param elapsedMs - time since deposition.
 * @param halfLifeMs - signal half-life; non-positive yields 0.
 * @returns current strength (0–1).
 */
export function computeCurrentStrength(
  initialStrength: number,
  elapsedMs: number,
  halfLifeMs: number,
): number {
  if (halfLifeMs <= 0) return 0
  return initialStrength * Math.exp(-DECAY_CONSTANT * elapsedMs / halfLifeMs)
}

/** 存储选项：容量与写盘防抖窗口。 */
export interface StigmergyStoreOptions {
  /** Max entries before the oldest are dropped (default 200). */
  maxCapacity?: number
  /** Debounce window for batched disk writes (default 200ms). */
  flushDelayMs?: number
}

/**
 * Session-scoped spatial memory via pheromone deposition. `filePath` may be
 * undefined for a pure memory-mode store (no disk round-trips).
 */
export class StigmergyStore {
  private readonly maxCapacity: number
  private readonly flushDelayMs: number
  private readonly filePath: string | undefined
  /** In-memory entries; lazily loaded from disk. */
  private cache: Pheromone[] | null = null
  /** In-flight disk load, single-flighted so concurrent deposit/query share one read. */
  private loadPromise: Promise<Pheromone[]> | null = null
  /** True when the cache holds unsaved mutations. */
  private dirty = false
  /** Debounce timer for batched writes. */
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  /** Consecutive write failures — drives the retry backoff. */
  private flushAttempts = 0

  constructor(filePath: string | undefined, opts: StigmergyStoreOptions = {}) {
    this.filePath = filePath
    this.maxCapacity = opts.maxCapacity ?? DEFAULT_MAX_CAPACITY
    this.flushDelayMs = opts.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS
  }

  private async loadFromDisk(): Promise<Pheromone[]> {
    if (this.filePath === undefined) return []
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((e): e is Pheromone =>
        typeof e === 'object' && e !== null
        && typeof (e as Pheromone).path === 'string'
        && typeof (e as Pheromone).signal === 'string'
        && typeof (e as Pheromone).strength === 'number'
        && typeof (e as Pheromone).depositedAt === 'number'
        && typeof (e as Pheromone).halfLife === 'number')
    } catch {
      return [] // corrupt or missing → start fresh
    }
  }

  /**
   * Entries from the in-memory cache, loading from disk once. The load is
   * single-flighted: concurrent `deposit`/`query` share one read, and because
   * promise continuations run in registration order, a deposit that started
   * before a query lands its mutation before the query reads the array.
   */
  private getEntries(): Promise<Pheromone[]> {
    if (this.cache !== null) return Promise.resolve(this.cache)
    if (this.loadPromise === null) {
      this.loadPromise = this.loadFromDisk().then((entries) => {
        this.cache = entries
        this.loadPromise = null
        return entries
      })
    }
    return this.loadPromise
  }

  /**
   * Schedule the debounced write. After a failure the delay backs off
   * exponentially (×2 per attempt, capped) and the pending state stays
   * observable, so a transient disk fault recovers without dropping data —
   * and the rejection never escapes as an unhandledRejection.
   */
  private scheduleFlush(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer)
    const delay = Math.min(this.flushDelayMs * 2 ** Math.min(this.flushAttempts, 6), MAX_FLUSH_BACKOFF_MS)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      if (this.dirty && this.cache !== null) {
        void this.persist(this.cache).catch(() => {
          this.flushAttempts++
          if (this.dirty && this.cache !== null) this.scheduleFlush()
        })
      }
    }, delay)
  }

  private markDirty(entries: Pheromone[]): void {
    this.cache = entries
    this.dirty = true
    this.flushAttempts = 0
    this.scheduleFlush()
  }

  private async persist(entries: Pheromone[]): Promise<void> {
    if (this.filePath === undefined) {
      this.dirty = false
      return
    }
    await writeFileAtomic(this.filePath, JSON.stringify(entries, null, 2), {
      mode: 0o600,
      dirMode: 0o700,
    })
    // Clear dirty only after the write succeeded — a failure must leave the
    // pending state observable so a later flush can retry.
    this.dirty = false
    this.flushAttempts = 0
  }

  /** Force-flush any pending writes. Call before process exit or compaction. */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.dirty && this.cache !== null) {
      await this.persist(this.cache)
    }
  }

  /**
   * Synchronous force-flush for process-exit paths where async work is
   * abandoned. Non-atomic (direct write) — the async path uses
   * `writeFileAtomic`; this is the shutdown best-effort.
   */
  flushSync(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.dirty && this.cache !== null) {
      if (this.filePath === undefined) {
        this.dirty = false
        return
      }
      writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8')
      this.dirty = false
    }
  }

  /**
   * Deposit (or refresh) one pheromone signal for a file. A matching entry
   * (same path + signal) is overwritten; capacity is enforced LRU-style.
   * Writes are debounced.
   * @param deposit - signal description.
   */
  async deposit(deposit: PheromoneDeposit): Promise<void> {
    const entries = await this.getEntries()
    const now = Date.now()
    const entry: Pheromone = {
      path: deposit.path,
      signal: deposit.signal,
      strength: Math.max(0, Math.min(1, deposit.strength)),
      depositedAt: now,
      halfLife: deposit.halfLifeMs ?? DEFAULT_HALF_LIFE_MS,
      ...deposit.context !== undefined && deposit.context.length > 0
        ? { context: deposit.context.slice(0, CONTEXT_MAX_CHARS) }
        : {},
    }

    const idx = entries.findIndex(e => e.path === deposit.path && e.signal === deposit.signal)
    if (idx >= 0) {
      entries[idx] = entry
    } else {
      entries.push(entry)
    }
    const capped = entries.slice(-this.maxCapacity)
    this.markDirty(capped)
  }

  /**
   * Query pheromones with their decayed current strength.
   * @param path - optional file-path filter; omitted returns all entries.
   * @returns entries with `currentStrength`; sub-threshold entries are NOT
   * excluded here — use {@link prune} for cleanup.
   */
  async query(path?: string): Promise<PheromoneQueryResult[]> {
    const entries = await this.getEntries()
    const filtered = path === undefined ? entries : entries.filter(e => e.path === path)
    const now = Date.now()
    return filtered.map(e => ({
      ...e,
      currentStrength: computeCurrentStrength(e.strength, now - e.depositedAt, e.halfLife),
    }))
  }

  /**
   * Remove entries whose decayed current strength fell below the prune
   * threshold (0.05). Persists the result via the debounced writer.
   */
  async prune(): Promise<void> {
    const entries = await this.getEntries()
    const now = Date.now()
    const kept = entries.filter(e =>
      computeCurrentStrength(e.strength, now - e.depositedAt, e.halfLife) >= PRUNE_THRESHOLD)
    if (kept.length < entries.length) this.markDirty(kept)
  }
}
