/**
 * dsh-memory-sqlite 可选向量层单测（阶段二c，TDD）。
 *
 * 行为契约：
 * - 写时嵌入：配置 embedder 后 save 为文本取一次向量并写入 embeddings 表
 *   （带 embedder 戳记）——由"首次 search 只产生一次查询嵌入调用"间接证明。
 * - 混合检索：BM25 名次与全量过滤候选的余弦名次做 RRF 融合（k=60），
 *   fused 归一化（两榜双顶 = 1，单榜居首 = 0.5）× 状态权重流入 score；
 *   释义查询（词面无交叠/弱交叠）下语义命中压过纯 BM25 序。
 * - 缺省禁用：不配置 embedder 时结果与纯 BM25 路径逐字节一致（分数公式不变）。
 * - 戳记：库内向量的 embedder 戳记与当前 embedder 不符（或缺行，如无 embedder
 *   时期的写入 / Markdown 导入）时，search 按批惰性重嵌一次；戳记匹配后不再重嵌。
 * - 过滤不变：excludeIds/entities/topic 过滤对两个名次榜同样生效。
 *
 * 假 embedder 是确定性的：概念表把指定子串映射到固定维度（词面不同但概念
 * 相同的"释义"由此编码），不含任何概念的文本取向量零（余弦 0，不进向量榜）。
 *
 * @module @huiliyi37/dsh-memory-sqlite/tests/embedding
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EmbeddingProvider } from '@huiliyi37/dsh-semantic-index'
import { SqliteMemoryStore } from '../src/store.ts'
import type { SqliteMemoryStoreOptions } from '../src/store.ts'

const dirs: string[] = []
const stores: SqliteMemoryStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** 假 embedder 维度数（概念表之外的维度恒零——无关文本余弦恒 0）。 */
const FAKE_DIM = 8

/** 记录调用次数的确定性假 embedder。 */
interface FakeEmbedder extends EmbeddingProvider {
  /** 每次 embed 调用的输入批次（按调用顺序）。 */
  calls: string[][]
}

/**
 * 造一个确定性假 embedder：text 包含概念子串即置对应维度为 1。
 * @param id - embedder 戳记（换 id = 换模型）。
 * @param concepts - 概念子串 → 维度（同维度 = 语义相同，用于编码释义对）。
 */
function makeFakeEmbedder(id: string, concepts: Record<string, number>): FakeEmbedder {
  const calls: string[][] = []
  return {
    id,
    calls,
    isAvailable: () => true,
    embed(texts: string[]) {
      calls.push([...texts])
      return Promise.resolve(texts.map((text) => {
        const vector = Array.from({ length: FAKE_DIM }, () => 0)
        for (const [needle, dim] of Object.entries(concepts)) {
          if (text.includes(needle)) vector[dim] = 1
        }
        return vector
      }))
    },
  }
}

/** 计费域释义夹具：词面弱交叠，概念同维。 */
const BILLING = {
  /** 查询：重复 复收 收费 三个二元组。 */
  query: '重复收费',
  /** 语义正解：含 重复（弱 BM25）+ 扣款（概念）。 */
  semantic: '用户反馈被重复扣款后情绪非常激动，客服记录了完整沟通过程与后续补偿方案',
  /** 词面干扰：收费 高频短文本（强 BM25），无概念维度。 */
  lexical: '收费 收费 收费',
  /** 扣款 ↔ 重复收费 同维：释义由假 embedder 编码。 */
  concepts: { 扣款: 3, 重复收费: 3 },
}

/** 每个用例独立临时目录；缺省 ':memory:' 数据库。 */
async function makeStore(overrides: Partial<SqliteMemoryStoreOptions> = {}): Promise<{ store: SqliteMemoryStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-sqlite-embed-'))
  dirs.push(dir)
  const store = new SqliteMemoryStore({
    dbPath: ':memory:',
    mdRoot: join(dir, '.dsh/memory'),
    journalMode: 'wal',
    importMaxFileBytes: 1_048_576,
    ...overrides,
  })
  stores.push(store)
  return { store, dir }
}

describe('SqliteMemoryStore 向量层', () => {
  it('写时嵌入：save 取向量入库，首次 search 只产生一次查询嵌入调用', async () => {
    const embedder = makeFakeEmbedder('fake-v1', BILLING.concepts)
    const { store } = await makeStore({ embedder })
    await store.save({ text: BILLING.semantic, scope: 'global', tags: ['billing'], source: 'agent' })
    expect(embedder.calls).toEqual([[BILLING.semantic]])
    const hits = await store.search(BILLING.query)
    expect(hits).toHaveLength(1)
    // 嵌入行带匹配戳记入庫：检索只补一次查询嵌入，无重嵌批量调用。
    expect(embedder.calls).toEqual([[BILLING.semantic], [BILLING.query]])
    expect(hits[0]?.score).toBeCloseTo(1, 5)
  })

  it('混合融合：释义查询下语义命中压过纯 BM25 序，缺省禁用逐字节同今日', async () => {
    // 对照组：无 embedder（缺省）——纯 BM25，词面干扰居前，分数公式不变。
    const plain = await makeStore()
    const semanticPlain = await plain.store.save({ text: BILLING.semantic, scope: 'global', tags: ['billing'], source: 'agent' })
    const lexicalPlain = await plain.store.save({ text: BILLING.lexical, scope: 'global', tags: ['billing'], source: 'agent' })
    const plainHits = await plain.store.search(BILLING.query)
    expect(plainHits.map(hit => hit.id)).toEqual([lexicalPlain.id, semanticPlain.id])
    // 融合组：同数据 + embedder——语义命中双榜在列（BM25 弱 + 向量顶）压过单榜词面干扰。
    const embedder = makeFakeEmbedder('fake-v1', BILLING.concepts)
    const hybrid = await makeStore({ embedder })
    const semanticHybrid = await hybrid.store.save({ text: BILLING.semantic, scope: 'global', tags: ['billing'], source: 'agent' })
    const lexicalHybrid = await hybrid.store.save({ text: BILLING.lexical, scope: 'global', tags: ['billing'], source: 'agent' })
    const hybridHits = await hybrid.store.search(BILLING.query)
    expect(hybridHits.map(hit => hit.id)).toEqual([semanticHybrid.id, lexicalHybrid.id])
    // 归一化映射：双榜（顶 + 次）≈ 0.992，单榜首 = 0.5。
    expect(hybridHits[0]?.score).toBeCloseTo((1 / 61 + 1 / 62) / (2 / 61), 5)
    expect(hybridHits[1]?.score).toBeCloseTo(0.5, 5)
    // 融合分仍走 score 字段（adaptive-memory 置信度门无感消费）。
    expect(hybridHits[0]?.score).toBeGreaterThan(hybridHits[1]?.score ?? 0)
  })

  it('纯释义召回：词面零交叠的条目经向量榜进入结果（BM25-only 不可见）', async () => {
    const embedder = makeFakeEmbedder('fake-v1', BILLING.concepts)
    const { store } = await makeStore({ embedder })
    const paraphrase = await store.save({ text: '支付重试保护：同一订单只扣款一次', scope: 'global', tags: ['billing'], source: 'agent' })
    const plain = await makeStore()
    await plain.store.save({ text: '支付重试保护：同一订单只扣款一次', scope: 'global', tags: ['billing'], source: 'agent' })
    await plain.store.save({ text: '收费标准的年度调整流程', scope: 'global', tags: ['billing'], source: 'agent' })
    // 无 embedder：零词面交叠的释义条目不可见（只见词面干扰）。
    const plainHits = await plain.store.search(BILLING.query)
    expect(plainHits).toHaveLength(1)
    expect(plainHits.map(hit => hit.id)).not.toContain(paraphrase.id)
    // 有 embedder：释义条目以向量榜首（单榜首 = 0.5 × 状态权重）进入结果。
    const hits = await store.search(BILLING.query)
    expect(hits.map(hit => hit.id)).toEqual([paraphrase.id])
    expect(hits[0]?.score).toBeCloseTo(0.5, 5)
  })

  it('戳记不符与缺行触发惰性重嵌：重嵌一次，戳记匹配后不再重嵌', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-sqlite-embed-'))
    dirs.push(dir)
    const dbPath = join(dir, 'ltm.sqlite')
    // 第一阶段：无 embedder 写入（embeddings 缺行）。
    const writer = new SqliteMemoryStore({ dbPath, journalMode: 'wal', importMaxFileBytes: 1_048_576 })
    stores.push(writer)
    await writer.save({ text: BILLING.semantic, scope: 'global', tags: ['billing'], source: 'agent' })
    await writer.save({ text: BILLING.lexical, scope: 'global', tags: ['billing'], source: 'agent' })
    await writer.close()
    // 第二阶段：embedder v1——首次 search 重嵌全部候选一次，之后只取查询向量。
    const v1 = makeFakeEmbedder('fake-v1', BILLING.concepts)
    const storeV1 = new SqliteMemoryStore({ dbPath, journalMode: 'wal', importMaxFileBytes: 1_048_576, embedder: v1 })
    stores.push(storeV1)
    const hitsV1 = await storeV1.search(BILLING.query)
    expect(hitsV1[0]?.text).toBe(BILLING.semantic)
    expect(v1.calls).toHaveLength(2)
    expect(v1.calls[1]?.sort()).toEqual([BILLING.lexical, BILLING.semantic])
    await storeV1.search(BILLING.query)
    expect(v1.calls).toHaveLength(3)
    expect(v1.calls[2]).toEqual([BILLING.query])
    await storeV1.close()
    // 第三阶段：embedder v2（换模型）——戳记不符，再重嵌一次。
    const v2 = makeFakeEmbedder('fake-v2', BILLING.concepts)
    const storeV2 = new SqliteMemoryStore({ dbPath, journalMode: 'wal', importMaxFileBytes: 1_048_576, embedder: v2 })
    stores.push(storeV2)
    const hitsV2 = await storeV2.search(BILLING.query)
    expect(hitsV2[0]?.text).toBe(BILLING.semantic)
    expect(v2.calls).toHaveLength(2)
    expect(v2.calls[1]?.sort()).toEqual([BILLING.lexical, BILLING.semantic])
  })

  it('过滤不变：excludeIds 与 entities 过滤对两个名次榜同样生效', async () => {
    const embedder = makeFakeEmbedder('fake-v1', BILLING.concepts)
    const { store } = await makeStore({ embedder })
    const semantic = await store.save({
      text: BILLING.semantic, scope: 'global', tags: ['billing'], source: 'agent', entities: ['billing-service'],
    })
    await store.save({ text: BILLING.lexical, scope: 'global', tags: ['ops'], source: 'agent', entities: ['finance'] })
    // excludeIds 排掉语义顶——即使它居向量榜首也不出现。
    const excluded = await store.search(BILLING.query, { excludeIds: [semantic.id] })
    expect(excluded.map(hit => hit.id)).not.toContain(semantic.id)
    // entities 过滤只留匹配实体的候选（两榜同源过滤）。
    const filtered = await store.search(BILLING.query, { entities: ['billing-service'] })
    expect(filtered.map(hit => hit.id)).toEqual([semantic.id])
    // topic 过滤同理。
    expect((await store.search(BILLING.query, { topic: 'ops' })).map(hit => hit.id)).not.toContain(semantic.id)
  })

  it('状态分层仍先于融合分：superseded 版本排在 active 之后', async () => {
    const embedder = makeFakeEmbedder('fake-v1', BILLING.concepts)
    const { store } = await makeStore({ embedder })
    const first = await store.save({ text: BILLING.semantic, scope: 'global', tags: ['billing'], source: 'agent' })
    await store.save({ id: first.id, text: `${BILLING.semantic}（已复核）`, scope: 'global', tags: ['billing'], source: 'agent' })
    const hits = await store.search(BILLING.query)
    expect(hits).toHaveLength(2)
    expect(hits[0]?.text).toContain('已复核')
    // superseded 版本的融合分被状态权重压到 0.3 倍以下。
    expect(hits[1]?.score).toBeLessThanOrEqual(0.3)
  })
})
