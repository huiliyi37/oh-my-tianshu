import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeCurrentStrength, StigmergyStore } from '../src/index.ts'

describe('computeCurrentStrength', () => {
  it('decays exponentially with the configured half-life', () => {
    // After exactly one half-life, strength halves.
    expect(computeCurrentStrength(1, 604_800_000, 604_800_000)).toBeCloseTo(0.5, 3)
    expect(computeCurrentStrength(0.8, 0, 604_800_000)).toBeCloseTo(0.8)
  })

  it('returns 0 for non-positive half-life', () => {
    expect(computeCurrentStrength(1, 1000, 0)).toBe(0)
  })
})

describe('StigmergyStore (memory mode)', () => {
  afterEach(() => { vi.useRealTimers() })

  it('deposits, overwrites same path+signal, and queries with decayed strength', async () => {
    const store = new StigmergyStore(undefined)
    await store.deposit({ path: 'src/a.ts', signal: 'fragile', strength: 1 })
    await store.deposit({ path: 'src/a.ts', signal: 'entry-point', strength: 0.6 })

    const all = await store.query()
    expect(all).toHaveLength(2)
    const fragile = all.find(e => e.signal === 'fragile')
    expect(fragile?.path).toBe('src/a.ts')
    expect(fragile?.currentStrength).toBeCloseTo(1) // fresh deposit

    // Overwrite: same path+signal replaces, not duplicates.
    await store.deposit({ path: 'src/a.ts', signal: 'fragile', strength: 0.5 })
    const after = await store.query('src/a.ts')
    expect(after.filter(e => e.signal === 'fragile')).toHaveLength(1)
    expect(after.find(e => e.signal === 'fragile')?.strength).toBe(0.5)
  })

  it('clamps strength to [0, 1]', async () => {
    const store = new StigmergyStore(undefined)
    await store.deposit({ path: 'p.ts', signal: 'dead-end', strength: 5 })
    await store.deposit({ path: 'p.ts', signal: 'fragile', strength: -1 })
    const all = await store.query()
    expect(all.find(e => e.signal === 'dead-end')?.strength).toBe(1)
    expect(all.find(e => e.signal === 'fragile')?.strength).toBe(0)
  })

  it('enforces capacity by dropping the oldest entries', async () => {
    const store = new StigmergyStore(undefined, { maxCapacity: 3 })
    for (const i of [1, 2, 3, 4]) {
      await store.deposit({ path: `p${i}.ts`, signal: 'entry-point', strength: 1 })
    }
    const all = await store.query()
    expect(all).toHaveLength(3)
    expect(all.some(e => e.path === 'p1.ts')).toBe(false)
  })

  it('prunes entries whose decayed strength fell below the 0.05 threshold', async () => {
    vi.useFakeTimers()
    const store = new StigmergyStore(undefined)
    await store.deposit({ path: 'aged.ts', signal: 'fragile', strength: 1 })
    // 35 days ≈ 5 half-lives → 0.5^5 = 0.03125 < 0.05.
    vi.setSystemTime(Date.now() + 35 * 24 * 3600 * 1000)
    await store.deposit({ path: 'fresh.ts', signal: 'fragile', strength: 1 })
    await store.prune()
    const kept = await store.query()
    expect(kept.some(e => e.path === 'fresh.ts')).toBe(true)
    expect(kept.some(e => e.path === 'aged.ts')).toBe(false)
  })

  it('keeps a bounded context snippet', async () => {
    const store = new StigmergyStore(undefined)
    await store.deposit({ path: 'a.ts', signal: 'dead-end', strength: 1, context: 'x'.repeat(200) })
    const all = await store.query()
    expect(all[0]?.context?.length).toBeLessThanOrEqual(80)
  })
})

describe('StigmergyStore (persistence)', () => {
  it('persists and reloads pheromones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pheromone-'))
    const path = join(dir, 'pheromones.json')
    try {
      const first = new StigmergyStore(path)
      await first.deposit({ path: 'src/a.ts', signal: 'fragile', strength: 1 })
      await first.flush()

      const second = new StigmergyStore(path)
      const all = await second.query()
      expect(all).toHaveLength(1)
      expect(all[0]?.path).toBe('src/a.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns empty on corrupt or missing file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pheromone-'))
    const path = join(dir, 'pheromones.json')
    try {
      writeFileSync(path, '{ not json', 'utf-8')
      const store = new StigmergyStore(path)
      expect(await store.query()).toEqual([])
      const missing = new StigmergyStore(join(dir, 'nope.json'))
      expect(await missing.query()).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps pending state and retries when the disk write fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pheromone-'))
    const path = join(dir, 'pheromones.json')
    try {
      writeFileSync(path, '[]', 'utf-8')
      // Read-only store directory → the debounced write fails (EACCES).
      chmodSync(dir, 0o500)
      const store = new StigmergyStore(path, { flushDelayMs: 10 })
      await store.deposit({ path: 'x.ts', signal: 'fragile', strength: 0.8 })
      // Allow the first write attempt to fail and the retry to be scheduled.
      await new Promise(r => setTimeout(r, 60))
      chmodSync(dir, 0o700)
      // The retry (backed off) must land the deposit without any further call.
      await new Promise(r => setTimeout(r, 200))
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as Array<{ path: string; signal: string }>
      expect(raw).toHaveLength(1)
      expect(raw[0]?.path).toBe('x.ts')
    } finally {
      try { chmodSync(dir, 0o700) } catch { /* dir may already be gone */ }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('single-flights the disk load: a concurrent query sees a deposit started first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pheromone-'))
    const path = join(dir, 'big.json')
    try {
      // A large store makes the initial disk load slow enough that both calls
      // land inside the in-flight window; the query must still observe the
      // deposit because the load is single-flighted and continuations run in
      // registration order.
      const big = JSON.stringify(Array.from({ length: 30000 }, (_, i) => ({
        path: `f${i}.ts`, signal: 'entry-point' as const, strength: 0.5, depositedAt: Date.now(), halfLife: 604_800_000,
      })))
      writeFileSync(path, big)
      const store = new StigmergyStore(path)
      const deposit = store.deposit({ path: 'new.ts', signal: 'fragile', strength: 0.8 })
      const query = store.query('new.ts')
      await deposit
      const qr = await query
      expect(qr).toHaveLength(1)
      expect(qr[0]?.signal).toBe('fragile')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
