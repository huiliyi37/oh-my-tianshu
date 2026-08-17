/**
 * dsh-memory-sqlite 关键词扩展单测（阶段二d）：不依赖外部 embedding provider
 * 的语义召回路径——save 时注入的 expander（生产为内置 chat 模型）产出同义/
 * 释义/跨语言扩展词，并入落库关键词，FTS 因此命中词面零交叠的查询。
 *
 * 行为契约：
 * - 配置 expander 后 save 产出扩展词并并入落库 keywords：原始 tags 在前
 *   （tags[0] 作为 topic 代理的消费侧契约不变），扩展词在后、精确去重。
 * - 扩展词进 FTS 索引：词面零交叠的释义查询（chargeback → 扣款）可命中。
 * - expander 抛错 = save 按未扩展落库（onExpansionError 记录，增强而非
 *   正确性依赖）；不配置 expander = 零调用、与既有行为逐字节一致。
 * - 幂等：同内容重保存不产生新版本（有 expander 时按原始 tags 比较，扩展词
 *   不参与幂等判定）；expander 调用次数可控。
 *
 * @module @huiliyi37/dsh-memory-sqlite/tests/expansion
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMemoryStore } from '../src/store.ts'
import type { SqliteMemoryStoreOptions } from '../src/store.ts'
import { parseExpansionOutput } from '../src/expander.ts'
import type { KeywordExpander } from '../src/expander.ts'

const dirs: string[] = []
const stores: SqliteMemoryStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** 记录调用、按脚本返回扩展词的假 expander。 */
interface FakeExpander {
  /** 每次调用的输入文本（按调用顺序）。 */
  calls: string[]
  /** 执行体。 */
  expand: KeywordExpander
}

/** 造一个假 expander：script 为固定返回的扩展词清单；throws 时每次抛错。 */
function makeFakeExpander(script: string[] | 'throws'): FakeExpander {
  const calls: string[] = []
  return {
    calls,
    expand: (input) => {
      calls.push(input.text)
      if (script === 'throws') return Promise.reject(new Error('model unavailable'))
      return Promise.resolve(script)
    },
  }
}

/** 造一个临时库（带可选 expander 与错误记录）。 */
async function makeStore(options: {
  expander?: KeywordExpander
  onExpansionError?: (error: unknown) => void
} = {}): Promise<SqliteMemoryStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-expansion-'))
  dirs.push(dir)
  const storeOptions: SqliteMemoryStoreOptions = {
    dbPath: ':memory:',
    journalMode: 'wal',
    importMaxFileBytes: 1_048_576,
    ...(options.expander === undefined ? {} : { keywordExpander: options.expander }),
    ...(options.onExpansionError === undefined ? {} : { onExpansionError: options.onExpansionError }),
  }
  const store = new SqliteMemoryStore(storeOptions)
  stores.push(store)
  return store
}

describe('memory-sqlite 关键词扩展（阶段二d）', () => {
  it('扩展词并入落库 keywords：原始 tags 在前，扩展词在后、去重', async () => {
    const fake = makeFakeExpander(['chargeback', '重复扣费', 'chargeback'])
    const store = await makeStore({ expander: fake.expand })
    const saved = await store.save({
      text: '/pay 接口 500 后重试可能重复扣款', scope: 'global', tags: ['failure-pattern', 'payment'], source: 'user',
    })
    expect(fake.calls).toHaveLength(1)
    expect(saved.tags[0]).toBe('failure-pattern')
    expect(saved.tags[1]).toBe('payment')
    expect(saved.tags.slice(2)).toEqual(['chargeback', '重复扣费'])
  })

  it('扩展词进 FTS：词面零交叠的释义查询命中', async () => {
    const fake = makeFakeExpander(['chargeback', 'duplicate charge'])
    const store = await makeStore({ expander: fake.expand })
    await store.save({ text: '/pay 接口 500 后重试可能重复扣款', scope: 'global', tags: ['failure-pattern'], source: 'user' })
    // 词面与正文零交叠：chargeback 只存在于扩展词里。
    const hits = await store.search('chargeback')
    expect(hits.map(hit => hit.id)).toContain((await store.list({ scope: 'global' }))[0]?.id)
  })

  it('expander 抛错：save 按未扩展落库，onExpansionError 记录', async () => {
    const errors: unknown[] = []
    const fake = makeFakeExpander('throws')
    const store = await makeStore({ expander: fake.expand, onExpansionError: error => errors.push(error) })
    const saved = await store.save({ text: 'plain entry', scope: 'global', tags: ['note'], source: 'user' })
    expect(saved.tags).toEqual(['note'])
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain('model unavailable')
  })

  it('不配置 expander：零调用、行为与既有逐字节一致', async () => {
    const store = await makeStore()
    const saved = await store.save({ text: 'plain entry', scope: 'global', tags: ['note'], source: 'user' })
    expect(saved.tags).toEqual(['note'])
    const hits = await store.search('plain')
    expect(hits).toHaveLength(1)
  })

  it('幂等：同 id 同内容重保存不产生新版本（扩展词不参与幂等判定）', async () => {
    const fake = makeFakeExpander(['extra'])
    const store = await makeStore({ expander: fake.expand })
    const first = await store.save({ text: 'same entry', scope: 'global', tags: ['note'], source: 'user' })
    const second = await store.save({ id: first.id, text: 'same entry', scope: 'global', tags: ['note'], source: 'user' })
    expect(second.id).toBe(first.id)
    expect(await store.list({ scope: 'global' })).toHaveLength(1)
    // 已知浪费（README 记录）：扩展发生在事务外、幂等判定之前，重保存会再调一次并被丢弃。
    expect(fake.calls).toHaveLength(2)
  })

  it('parseExpansionOutput：围栏容忍、非数组抛错、非字符串丢弃、去重截断', () => {
    expect(parseExpansionOutput('```json\n["a", "b"]\n```')).toEqual(['a', 'b'])
    expect(parseExpansionOutput('["a", 1, "", "a", "b"]')).toEqual(['a', 'b'])
    expect(parseExpansionOutput(JSON.stringify(Array.from({ length: 20 }, (_, i) => `t${i}`)))).toHaveLength(12)
    expect(() => parseExpansionOutput('not json')).toThrow('不是合法 JSON')
    expect(() => parseExpansionOutput('{"a":1}')).toThrow('不是 JSON 数组')
  })
})
