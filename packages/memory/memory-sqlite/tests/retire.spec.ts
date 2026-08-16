/**
 * dsh-memory-sqlite 阶段三能力单测：markUncertain 与 retireStale（退役）。
 *
 * 行为契约：
 * - markUncertain：当前 active 事实降级 uncertain（不删除、不取代）；检索仍
 *   命中但状态权重降分（active 1.0 → uncertain 0.6）；无该对 active 事实时
 *   返回 false；uncertain 之后同对新 value 的 save 重新物化 active 版本。
 * - retireStale：每次调用 = 一个巩固期（计数 +1）；superseded 且 valid_to
 *   早于 now − 保留期的版本退役；active/uncertain 连续 N 个巩固期未被检索
 *   命中（used_at_consolidation 停滞）的事实退役。retired 退出 search 与
 *   list，但行与事件日志保留（审计链不断）；search 命中刷新使用信号。
 *
 * @module @huiliyi37/dsh-memory-sqlite/tests/retire
 */

import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMemoryStore } from '../src/store.ts'

const stores: SqliteMemoryStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
})

/** 每个用例独立 ':memory:' 存储（无 Markdown 共存源）。 */
function makeStore(): SqliteMemoryStore {
  const store = new SqliteMemoryStore({ dbPath: ':memory:', journalMode: 'wal', importMaxFileBytes: 1_048_576 })
  stores.push(store)
  return store
}

/** 保存一条结构化事实（global scope、固定 topic，避免 DEFAULT_TOPIC 噪音）。 */
async function saveFact(
  store: SqliteMemoryStore,
  fact: { subject: string; predicate: string; value: string },
  text = `${fact.subject} ${fact.predicate} ${fact.value}`,
): Promise<void> {
  await store.save({
    text,
    scope: 'global',
    tags: ['phase3'],
    source: 'auto',
    kind: 'fact',
    topic: 'phase3',
    fact,
  })
}

describe('markUncertain', () => {
  it('active 事实降级 uncertain：检索仍命中但降权，list 保留', async () => {
    const store = makeStore()
    await saveFact(store, { subject: 'db', predicate: 'stated', value: 'postgres' }, 'db stated postgres')
    const before = await store.search('postgres')
    expect(before).toHaveLength(1)

    expect(await store.markUncertain('global', 'db', 'stated')).toBe(true)

    const after = await store.search('postgres')
    expect(after).toHaveLength(1)
    // uncertain 权重 0.6：同一 relevance 下降分（relevance 相同查询下同内容）。
    expect(after[0]?.score).toBeCloseTo((before[0]?.score ?? 0) * 0.6, 5)
    // list 读物化当前视图：active + uncertain 都在。
    expect(await store.list()).toHaveLength(1)
  })

  it('无该对 active 事实返回 false；uncertain 后同对新 value 重新 active', async () => {
    const store = makeStore()
    expect(await store.markUncertain('global', 'missing', 'stated')).toBe(false)

    await saveFact(store, { subject: 'db', predicate: 'stated', value: 'postgres' }, 'db stated postgres')
    await store.markUncertain('global', 'db', 'stated')
    await saveFact(store, { subject: 'db', predicate: 'stated', value: 'neon' }, 'db stated neon')

    const hits = await store.search('neon')
    expect(hits).toHaveLength(1)
    // 新版本 active（权重 1.0），旧 uncertain 版本不再是该对的当前视图。
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.text).toBe('db stated neon')
  })
})

describe('retireStale', () => {
  it('超期 superseded 版本退役并退出检索；行与日志保留', async () => {
    const store = makeStore()
    await saveFact(store, { subject: 'db', predicate: 'stated', value: 'postgres' }, 'db stated postgres')
    await saveFact(store, { subject: 'db', predicate: 'stated', value: 'neon' }, 'db stated neon')
    // superseded 的 postgres 版本仍降权命中。
    expect((await store.search('postgres')).length).toBe(1)

    const report = await store.retireStale({ now: Date.now(), supersededRetentionMs: -1, unusedConsolidations: 1000 })
    expect(report.consolidations).toBe(1)
    expect(report.retiredSuperseded).toBe(1)
    expect(report.retiredUnused).toBe(0)

    // retired 退出检索与 list；当前 active 版本不受影响。
    expect(await store.search('postgres')).toHaveLength(0)
    expect(await store.search('neon')).toHaveLength(1)
    expect(await store.list()).toHaveLength(1)
  })

  it('连续 N 个巩固期未被检索命中的 active 事实退役；search 命中刷新使用信号', async () => {
    const store = makeStore()
    await saveFact(store, { subject: 'cache', predicate: 'stated', value: 'redis' }, 'cache stated redis')

    // 第 1 个巩固期：1 - 0 = 1 < 2，不退役。
    let report = await store.retireStale({ now: Date.now(), supersededRetentionMs: 0, unusedConsolidations: 2 })
    expect(report.retiredUnused).toBe(0)
    // 检索命中：used_at_consolidation 提升到 1。
    expect((await store.search('redis')).length).toBe(1)
    // 第 2 个巩固期：2 - 1 = 1 < 2，不退役。
    report = await store.retireStale({ now: Date.now(), supersededRetentionMs: 0, unusedConsolidations: 2 })
    expect(report.retiredUnused).toBe(0)
    // 第 3 个巩固期（期间未再命中）：3 - 1 = 2 ≥ 2，退役。
    report = await store.retireStale({ now: Date.now(), supersededRetentionMs: 0, unusedConsolidations: 2 })
    expect(report.retiredUnused).toBe(1)
    expect(report.consolidations).toBe(3)

    expect(await store.search('redis')).toHaveLength(0)
    expect(await store.list()).toHaveLength(0)
  })

  it('退役推进 topic 版本（STM 门控能观察到失效）', async () => {
    const store = makeStore()
    await saveFact(store, { subject: 'cache', predicate: 'stated', value: 'redis' }, 'cache stated redis')
    const before = (await store.topicVersions()).phase3 ?? 0
    await store.retireStale({ now: Date.now(), supersededRetentionMs: 0, unusedConsolidations: 1 })
    const after = (await store.topicVersions()).phase3 ?? 0
    expect(after).toBeGreaterThan(before)
  })
})
