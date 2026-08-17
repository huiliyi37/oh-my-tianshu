/**
 * SqliteMemoryStore — memory 服务的结构化 LTM provider（阶段二a）。
 *
 * 设计契约：Agent Note
 * `.agents/notes/implemented/feature/2026-08-18-memory-sqlite-structured-ltm.md`。存储模型：
 * - **append-only 事件日志**（events）：每次 save/delete/markdown 导入追加一条
 *   事件，永不更新、永不删除——审计链。
 * - **物化当前视图**（facts）：同 (scope, subject, predicate) 的新 value 触发
 *   supersede——旧版本 status='superseded' 并设 valid_to，新版本以 supersedes
 *   指回（invalidate-don't-delete；schema 的部分唯一索引保证同一对至多一条
 *   active）。retrieval 与 list 都读视图；日志只做审计。
 * - **检索**：FTS5 BM25（text + keywords；CJK 经 ftsNormalize 二元组化恢复子串
 *   召回）+ 实体精确过滤 + scope/excludeIds 过滤。score 归一化：
 *   `relevance = -bm25 / (1 + -bm25)`（空查询 relevance = 1），
 *   `score = relevance × statusWeight`（active 1.0 / uncertain 0.6 /
 *   superseded 0.3）。时序有效性是硬排序：结果先按状态分层
 *   （active > uncertain > superseded），层内按 score 降序——当前事实恒排
 *   在被取代版本之前。
 * - **可选向量层（阶段二c）**：配置 embedder 后，save 写库前为文本取一次向量
 *   （写进 embeddings 表，带 embedder 模型戳记），search 把 BM25 名次与向量
 *   余弦名次做 RRF 融合（k=60），`fused = rrfScore / (2/(k+1))`（两榜双顶 = 1，
 *   单榜居首 = 0.5）后照常乘 statusWeight 流入 `score` 字段——读 `score` 的
 *   消费方无感工作（阈值语义变化见 README Known Limitations）。查询向量
 *   每次 search 至多取一次（空查询或无候选不取）；候选向量缺失或戳记不符
 *   （换模型）时按批惰性重嵌——这是文档化的重建路径，一次 search 至多追加
 *   一次重嵌批量调用。未配置 embedder 时行为与 BM25-only 逐字节一致。
 * - **可选关键词扩展（阶段二d）**：配置 keywordExpander 后，save 写库前
 *   为条目取一次扩展词（内置 chat 模型生成的同义/释义/跨语言/相关术语——
 *   不依赖 embedding provider 的语义召回路径），并入落库 keywords（原始
 *   tags 在前保持 tags[0] topic 代理；扩展词在后精确去重），FTS 索引与事件
 *   日志携带合并清单。扩展失败仅经 onExpansionError 记录、按未扩展落库——
 *   扩展是召回增强，永不是正确性依赖。扩展开启时幂等判定只看原始 tags
 *   前缀（扩展词由模型生成、不确定，不参与幂等）；幂等重保存不产生新版本，
 *   本次扩展结果随之丢弃（与写时嵌入同款浪费，README 记录）。未配置
 *   expander 时行为与今日逐字节一致。
 * - **冲突与退役（阶段三）**：`markUncertain` 把无明确 supersede 顺序的冲突
 *   事实降级为 uncertain（不删除、不取代；检索降权保留）；`retireStale` 按
 *   调用方注入的时间与阈值把超期 superseded 版本与跨巩固期未被检索命中的
 *   事实标记为 retired——retired 退出检索与 list，行与事件日志保留。search
 *   命中会把 surfaced 版本的 used_at_consolidation 提到当前巩固期计数
 *   （meta 表），这是"未使用"判定的唯一信号。
 * - **Markdown 共存**：`<mdRoot>/global.md` 与 `sessions/*.md`（dsh-memory 的
 *   Phase-1 文件格式）仍是人类可编辑源；每个公开操作前经 syncMarkdown 按
 *   内容哈希幂等导入（新增/变更 → observation 事件 + active 事实；从文件消失
 *   → supersede）。被 API delete 落 tombstone 的条目不因文件未变而复活；
 *   人类在文件里改掉文本才会以新版本复活。
 *
 * 并发约束与 dsh-memory 相同：单进程串行调用（同一事件循环）；跨进程并发写
 * 不在保证内（README Known Limitations）。
 *
 * @module @huiliyi37/dsh-memory-sqlite/store
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { MarkdownMemoryStore } from '@huiliyi37/dsh-memory'
import type {
  MemoryEntry,
  MemoryRetireOptions,
  MemoryRetireReport,
  MemorySaveInput,
  MemoryScope,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryService,
  MemorySource,
  MemorySourceRef,
} from '@huiliyi37/dsh-memory'
import { cosineSimilarity, reciprocalRankFusion } from '@huiliyi37/dsh-semantic-index'
import type { EmbeddingProvider } from '@huiliyi37/dsh-semantic-index'
import type { KeywordExpander, KeywordExpansionInput } from './expander.ts'
import { buildFtsMatch, ftsNormalize } from './fts.ts'
import { openMemoryDatabase } from './schema.ts'
import type { JournalMode } from './schema.ts'
import type { MemoryEventKind, MemoryFactRow, MemoryFactStatus } from './types.ts'

/** 无 topic/无 tag 条目的缺省主题（协议常量，非可调项）。 */
const DEFAULT_TOPIC = 'general'

/**
 * 状态权重：归一化得分公式的一部分（模块文档与 README 记录公式）；
 * 排序策略常量，非部署可调项。retired 不进检索（查询期过滤），权重仅为完备性。
 */
const STATUS_WEIGHT: Record<MemoryFactStatus, number> = { active: 1, uncertain: 0.6, superseded: 0.3, retired: 0 }

/** 状态分层序号（时序有效性的硬排序：active > uncertain > superseded > retired）。 */
const STATUS_TIER: Record<MemoryFactStatus, number> = { active: 0, uncertain: 1, superseded: 2, retired: 3 }

/** RRF 阻尼常数（混合检索的协议常量，取 canonical 缺省 60，非部署可调项）。 */
const RRF_K = 60

/** 两榜 RRF 的满分（两榜双顶 = 2/(k+1)）；归一化除数，使 fused score ∈ (0, 1]。 */
const RRF_MAX = 2 / (RRF_K + 1)

/** facts 的全部列（SELECT 清单与行映射共用）。 */
const FACT_SELECT = [
  'f.version_id', 'f.id', 'f.scope', 'f.subject', 'f.predicate', 'f.value', 'f.text',
  'f.keywords', 'f.entities', 'f.topic', 'f.source', 'f.valid_from', 'f.valid_to',
  'f.confidence', 'f.status', 'f.supersedes', 'f.source_event_id', 'f.created_at',
  'f.used_at_consolidation',
].join(', ')

/** search 内部的打分中行（relevance 供 BM25 名次与无 embedder 的缺省 score 路径使用）。 */
interface ScoredFact {
  fact: MemoryFactRow
  relevance: number
  entry: MemoryEntry & { score: number }
}

/** facts 表的数据库行形状（snake_case 原始列）。 */
interface DbFactRow {
  version_id: string
  id: string
  scope: string
  subject: string
  predicate: string
  value: string
  text: string
  keywords: string
  entities: string
  topic: string
  source: string
  valid_from: number
  valid_to: number | null
  confidence: number
  status: string
  supersedes: string | null
  source_event_id: string
  created_at: number
  used_at_consolidation: number
}

/** SqliteMemoryStore 的构造参数（插件 apply 负责从 Config 解析出显式值）。 */
export interface SqliteMemoryStoreOptions {
  /** 数据库文件路径（`:memory:` 仅供测试）。 */
  dbPath: string
  /** Markdown 共存目录（`<root>/.dsh/memory`；缺省不导入）。 */
  mdRoot?: string | undefined
  /** SQLite journal 模式。 */
  journalMode: JournalMode
  /** 单个 Markdown 文件的导入字节上限（超限 fail loud）。 */
  importMaxFileBytes: number
  /** 可选嵌入 provider（缺省 undefined = 禁用，检索为纯 BM25，零额外调用）。 */
  embedder?: EmbeddingProvider | undefined
  /** 可选关键词扩展器（缺省 undefined = 禁用，落库关键词即原始 tags，零额外调用）。 */
  keywordExpander?: KeywordExpander | undefined
  /** 扩展失败的 log-only 通知（插件侧接 ctx.logger.warn；缺省静默丢弃）。 */
  onExpansionError?: ((error: unknown) => void) | undefined
}

/** 校验 scope 形状：'global' 或 'session:<非空>'（与 dsh-memory 同一契约）。 */
function assertScope(scope: string): asserts scope is MemoryScope {
  if (scope === 'global') return
  if (scope.startsWith('session:') && scope.length > 'session:'.length) return
  throw new Error(`invalid memory scope: ${JSON.stringify(scope)} (expected 'global' or 'session:<id>')`)
}

/** scope → 事件行的 session_id（仅 session scope 派生）。 */
function sessionIdOf(scope: MemoryScope): string | null {
  return scope.startsWith('session:') ? scope.slice('session:'.length) : null
}

/** 两个字符串数组的顺序敏感相等。 */
function arrayEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/** 合并落库关键词：原始 tags 在前（tags[0] 是消费侧 topic 代理），扩展词在后精确去重。 */
function mergeKeywords(keywords: string[], expansion: string[]): string[] {
  if (expansion.length === 0) return keywords
  const seen = new Set(keywords)
  const merged = [...keywords]
  for (const term of expansion) {
    if (seen.has(term)) continue
    seen.add(term)
    merged.push(term)
  }
  return merged
}

/** 数据库行 → 内存事实行（JSON 列反序列化）。 */
function rowToFact(row: DbFactRow): MemoryFactRow {
  return {
    versionId: row.version_id,
    id: row.id,
    scope: row.scope as MemoryScope,
    subject: row.subject,
    predicate: row.predicate,
    value: row.value,
    text: row.text,
    keywords: JSON.parse(row.keywords) as string[],
    entities: JSON.parse(row.entities) as string[],
    topic: row.topic,
    source: row.source as MemorySource,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    confidence: row.confidence,
    status: row.status as MemoryFactStatus,
    supersedes: row.supersedes,
    sourceEventId: row.source_event_id,
    createdAt: row.created_at,
    usedAtConsolidation: row.used_at_consolidation,
  }
}

/** 物化事实行 → seam 条目（updatedAt 仅在有前序版本时存在）。 */
function toEntry(fact: MemoryFactRow): MemoryEntry {
  return {
    id: fact.id,
    text: fact.text,
    scope: fact.scope,
    tags: [...fact.keywords],
    createdAt: fact.createdAt,
    ...(fact.supersedes === null ? {} : { updatedAt: fact.validFrom }),
    source: fact.source,
  }
}

/** 条目 scope → 其所属的 Markdown 文件路径（导入归因用）。 */
function markdownFileFor(mdRoot: string, scope: MemoryScope): string {
  if (scope === 'global') return join(mdRoot, 'global.md')
  return join(mdRoot, 'sessions', `${scope.slice('session:'.length)}.md`)
}

/** 枚举共存 Markdown 文件（global.md + sessions/*.md；确定性排序）。 */
async function listMarkdownFiles(mdRoot: string): Promise<string[]> {
  const files: string[] = []
  try {
    const sessionsDir = join(mdRoot, 'sessions')
    for (const name of await readdir(sessionsDir)) {
      if (name.endsWith('.md')) files.push(join(sessionsDir, name))
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    await stat(join(mdRoot, 'global.md'))
    files.push(join(mdRoot, 'global.md'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return files.sort()
}

/** search/list 共用的过滤子句构造（参数化；scope 语义与 dsh-memory 对齐）。 */
function buildFactFilters(opts: MemorySearchOptions): { where: string; params: Array<string | number> } {
  // retired 事实退出检索与 list（事件日志保留审计；只有物化视图变化）。
  const clauses: string[] = ["f.status <> 'retired'"]
  const params: Array<string | number> = []
  const scope = opts.scope
  if (scope === 'global') {
    clauses.push('f.scope = ?')
    params.push('global')
  } else if (scope === 'session') {
    clauses.push("f.scope GLOB 'session:*'")
  } else if (scope !== undefined && scope.startsWith('session:')) {
    const id = scope.slice('session:'.length)
    if (id === '') clauses.push('0')
    else {
      clauses.push('f.scope = ?')
      params.push(scope)
    }
  } else if (scope !== undefined) {
    clauses.push('0')
  }
  if (opts.topic !== undefined) {
    clauses.push('f.topic = ?')
    params.push(opts.topic)
  }
  for (const entity of opts.entities ?? []) {
    clauses.push('EXISTS (SELECT 1 FROM json_each(f.entities) WHERE json_each.value = ?)')
    params.push(entity)
  }
  for (const excluded of opts.excludeIds ?? []) {
    if (excluded === '') continue
    // 精确 id 或 id 前缀（STM 只展示短 id，模型以前缀回传）。
    clauses.push('instr(f.id, ?) <> 1')
    params.push(excluded)
  }
  return { where: clauses.join(' AND '), params }
}

/** number[] → Float32 BLOB（embeddings.vector 列的存储形状）。 */
function encodeVector(vector: number[]): Uint8Array {
  return new Uint8Array(Float32Array.from(vector).buffer)
}

/** embeddings.vector BLOB → number[]（slice 拷贝保证 Float32 视图 4 字节对齐）。 */
function decodeVector(blob: Uint8Array): number[] {
  const copy = blob.slice()
  return Array.from(new Float32Array(copy.buffer, 0, copy.byteLength / Float32Array.BYTES_PER_ELEMENT))
}

/**
 * SQLite 结构化 LTM 存储：memory 服务的第二个 provider（第一个为
 * dsh-memory 的 MarkdownMemoryStore）。全部写操作在单事务内完成；
 * 每个公开操作前先同步 Markdown 共存源（幂等、按内容哈希短路）。
 */
export class SqliteMemoryStore implements MemoryService {
  private readonly dbPath: string
  private readonly mdRoot: string | undefined
  private readonly journalMode: JournalMode
  private readonly importMaxFileBytes: number
  private readonly embedder: EmbeddingProvider | undefined
  private readonly keywordExpander: KeywordExpander | undefined
  private readonly onExpansionError: ((error: unknown) => void) | undefined
  private db: DatabaseSync | undefined
  private opening: Promise<DatabaseSync> | undefined
  private importChain: Promise<void> = Promise.resolve()
  /** 文件 mtime+size 快照（内容哈希前的廉价短路；仅进程内）。 */
  private readonly fileSnapshots = new Map<string, { mtimeMs: number; size: number }>()

  /** @param options - 显式解析后的存储参数（缺省解析是插件 apply 的职责）。 */
  constructor(options: SqliteMemoryStoreOptions) {
    this.dbPath = options.dbPath
    this.mdRoot = options.mdRoot
    this.journalMode = options.journalMode
    this.importMaxFileBytes = options.importMaxFileBytes
    this.embedder = options.embedder
    this.keywordExpander = options.keywordExpander
    this.onExpansionError = options.onExpansionError
  }

  async save(entry: MemorySaveInput): Promise<MemoryEntry> {
    assertScope(entry.scope)
    await this.syncMarkdown()
    await this.database()
    const now = Date.now()
    const generated = randomUUID()
    const id = entry.id ?? generated
    const subject = entry.fact?.subject ?? id
    const predicate = entry.fact?.predicate ?? 'note'
    const value = entry.fact?.value ?? entry.text
    const topic = entry.topic ?? entry.tags[0] ?? DEFAULT_TOPIC
    const baseKeywords = [...entry.tags]
    const entities = [...(entry.entities ?? [])]
    const kind: MemoryEventKind = entry.kind ?? (entry.fact === undefined ? 'observation' : 'fact')
    const confidence = entry.confidence ?? 1
    const sourceRefs = entry.sourceRefs ?? []
    // 写时嵌入：每次 save 至多一次 embedder 调用（在事务外取向量，失败则不落库）；
    // 幂等重保存不产生新版本，向量随之丢弃（README 记录该浪费）。
    const vector = this.embedder === undefined ? undefined : (await this.embed([entry.text]))[0] as number[]
    // 写时关键词扩展（阶段二d）：每次 save 至多一次 expander 调用（事务外）；
    // 失败 log-only 后按未扩展落库（增强而非正确性依赖），幂等重保存同样丢弃结果。
    const keywords = mergeKeywords(baseKeywords, await this.expandKeywords({ text: entry.text, keywords: baseKeywords, topic }))
    return this.transact(() => {
      // uncertain 头也算"当前版本"：新证据到达即取代它（不确定性被新事实解决），
      // 物化视图里同一对只留一个当前版本。
      const existing = this.findActiveByPair(entry.scope, subject, predicate)
        ?? this.findUncertainByPair(entry.scope, subject, predicate)
      if (existing !== null
        && existing.status === 'active'
        && existing.value === value
        && existing.text === entry.text
        && this.keywordsIdempotent(existing.keywords, baseKeywords)
        && arrayEqual(existing.entities, entities)) {
        // 幂等：同 (scope, subject, predicate) 的同内容重保存不产生新版本
        // （模型重试 memory_save / 导入重放均安全）。
        return toEntry(existing)
      }
      const eventId = this.insertEvent({
        kind, text: entry.text, scope: entry.scope, topic, keywords, entities, confidence, sourceRefs, createdAt: now,
      })
      // 结构化保存省略 id 时继承被取代条目的逻辑 id（逻辑事实的同一性）。
      const logicalId = entry.id ?? existing?.id ?? id
      const fact = this.insertFactVersion({
        id: logicalId, scope: entry.scope, subject, predicate, value, text: entry.text,
        keywords, entities, topic, source: entry.source, confidence,
      }, existing, now, eventId)
      if (vector !== undefined) this.upsertEmbedding(fact.versionId, vector)
      this.bumpTopic(topic)
      if (existing !== null && existing.topic !== topic) this.bumpTopic(existing.topic)
      return toEntry(fact)
    })
  }

  async search(query: string, opts: MemorySearchOptions = {}): Promise<MemorySearchResult[]> {
    await this.syncMarkdown()
    const db = await this.database()
    const { where, params } = buildFactFilters(opts)
    const match = buildFtsMatch(query)
    const rows = match === null
      ? db.prepare(`SELECT ${FACT_SELECT}, NULL AS rank FROM facts f WHERE ${where}`)
        .all(...params) as unknown as Array<DbFactRow & { rank: null }>
      : db.prepare(
        `SELECT ${FACT_SELECT}, bm25(memory_fts) AS rank FROM memory_fts`
        + ' JOIN facts f ON f.version_id = memory_fts.fact_version'
        + ` WHERE memory_fts MATCH ? AND ${where}`,
      ).all(match, ...params) as unknown as Array<DbFactRow & { rank: number }>
    const scored: ScoredFact[] = rows.map((row) => {
      const fact = rowToFact(row)
      const raw = row.rank === null ? null : Math.max(0, -row.rank)
      const relevance = raw === null ? 1 : raw / (1 + raw)
      return { fact, relevance, entry: { ...toEntry(fact), score: 0 } }
    })
    if (this.embedder !== undefined && match !== null) {
      await this.applyVectorFusion(db, query, where, params, scored)
    } else {
      for (const item of scored) item.entry.score = item.relevance * STATUS_WEIGHT[item.fact.status]
    }
    scored.sort((a, b) =>
      (STATUS_TIER[a.fact.status] - STATUS_TIER[b.fact.status])
      || (b.entry.score - a.entry.score)
      || (b.fact.createdAt - a.fact.createdAt)
      || a.fact.versionId.localeCompare(b.fact.versionId))
    const sliced = scored.slice(opts.offset ?? 0)
    const limited = opts.limit === undefined ? sliced : sliced.slice(0, opts.limit)
    if (limited.length > 0) {
      // 命中即"使用"：把 surfaced 版本的 used_at_consolidation 提到当前巩固期
      // 计数——未使用退役（retireStale）的唯一使用信号。视图派生计数，非审计数据。
      const counter = this.consolidationCounter()
      const mark = db.prepare('UPDATE facts SET used_at_consolidation = ? WHERE version_id = ? AND used_at_consolidation < ?')
      for (const item of limited) mark.run(counter, item.fact.versionId, counter)
    }
    return limited.map(item => item.entry)
  }

  async list(opts: { scope?: string; limit?: number; offset?: number } = {}): Promise<MemoryEntry[]> {
    await this.syncMarkdown()
    const db = await this.database()
    const { where, params } = buildFactFilters(opts.scope === undefined ? {} : { scope: opts.scope })
    // 物化当前视图：active + uncertain（superseded 只留在日志/检索的降权尾部）。
    const clauses = ["f.status IN ('active', 'uncertain')", where]
    const rows = db.prepare(
      `SELECT ${FACT_SELECT} FROM facts f WHERE ${clauses.join(' AND ')}`
      + ' ORDER BY f.created_at DESC, f.version_id ASC LIMIT ? OFFSET ?',
    ).all(...params, opts.limit ?? -1, opts.offset ?? 0) as unknown as DbFactRow[]
    return rows.map(row => toEntry(rowToFact(row)))
  }

  async delete(id: string): Promise<void> {
    await this.syncMarkdown()
    await this.database()
    const now = Date.now()
    this.transact(() => {
      // 不存在的 id 静默 no-op（幂等，同 dsh-memory 契约）。
      this.tombstoneByLogicalId(id, now)
    })
  }

  /** topic → 单调版本号（每次该 topic 下事实写入/废止 +1）。 */
  async topicVersions(): Promise<Record<string, number>> {
    await this.syncMarkdown()
    const db = await this.database()
    const rows = db.prepare('SELECT name, version FROM topics').all() as unknown as Array<{ name: string; version: number }>
    return Object.fromEntries(rows.map(row => [row.name, row.version]))
  }

  /**
   * 把 (scope, subject, predicate) 的当前 active 事实降级为 uncertain：巩固流程
   * 检测到无明确 supersede 顺序的冲突观察时调用——不删除、不取代，只降级
   * （检索降权保留）；日志追加一条 observation 事件记录冲突（审计链不断）。
   */
  async markUncertain(scope: MemoryScope, subject: string, predicate: string): Promise<boolean> {
    assertScope(scope)
    await this.syncMarkdown()
    await this.database()
    return this.transact(() => {
      const head = this.findActiveByPair(scope, subject, predicate)
      if (head === null) return false
      const now = Date.now()
      this.requireDb().prepare("UPDATE facts SET status = 'uncertain' WHERE version_id = ?").run(head.versionId)
      this.insertEvent({
        kind: 'observation',
        text: `conflicting observations marked (${subject}, ${predicate}) uncertain: ${head.text}`,
        scope, topic: head.topic, keywords: head.keywords, entities: head.entities,
        confidence: head.confidence, sourceRefs: [], createdAt: now,
      })
      this.bumpTopic(head.topic)
      return true
    })
  }

  /**
   * 巩固期退役（每次调用 = 一个巩固期，计数 +1）：
   * - superseded 且 valid_to 早于 now − supersededRetentionMs 的版本退役；
   * - active/uncertain 且连续 unusedConsolidations 个巩固期未被检索命中的事实退役
   *   （使用信号 = search 命中时刷新的 used_at_consolidation）。
   * 退役只改物化视图（status='retired' + tombstone 事件 + topic 版本），事件日志
   * 与事实行保留；retired 退出检索与 list。每次调用前照常同步 Markdown 共存源。
   */
  async retireStale(options: MemoryRetireOptions): Promise<MemoryRetireReport> {
    await this.syncMarkdown()
    await this.database()
    return this.transact(() => {
      const consolidations = this.bumpConsolidation()
      const cutoff = options.now - options.supersededRetentionMs
      const staleSuperseded = this.requireDb().prepare(
        `SELECT ${FACT_SELECT} FROM facts f WHERE f.status = 'superseded' AND f.valid_to IS NOT NULL AND f.valid_to < ?`,
      ).all(cutoff) as unknown as DbFactRow[]
      const unused = this.requireDb().prepare(
        `SELECT ${FACT_SELECT} FROM facts f WHERE f.status IN ('active', 'uncertain') AND ? - f.used_at_consolidation >= ?`,
      ).all(consolidations, options.unusedConsolidations) as unknown as DbFactRow[]
      for (const row of [...staleSuperseded, ...unused]) {
        const fact = rowToFact(row)
        this.requireDb().prepare("UPDATE facts SET status = 'retired', valid_to = COALESCE(valid_to, ?) WHERE version_id = ?")
          .run(options.now, fact.versionId)
        this.insertEvent({
          kind: 'tombstone', text: fact.text, scope: fact.scope, topic: fact.topic,
          keywords: fact.keywords, entities: fact.entities, confidence: fact.confidence,
          sourceRefs: [], createdAt: options.now,
        })
        this.bumpTopic(fact.topic)
      }
      return { consolidations, retiredSuperseded: staleSuperseded.length, retiredUnused: unused.length }
    })
  }

  /** 当前巩固期计数（meta 表；未初始化按 0）。 */
  private consolidationCounter(): number {
    const row = this.requireDb().prepare("SELECT value FROM meta WHERE key = 'consolidations'").get() as
      | { value: number }
      | undefined
    return row?.value ?? 0
  }

  /** 巩固期计数 +1 并返回新值（retireStale 的唯一递增点）。 */
  private bumpConsolidation(): number {
    this.requireDb().prepare(
      "INSERT INTO meta (key, value) VALUES ('consolidations', 1)"
      + ' ON CONFLICT(key) DO UPDATE SET value = value + 1',
    ).run()
    return this.consolidationCounter()
  }

  /**
   * 同步 Markdown 共存源（幂等；按 mtime/size 快照 → 内容哈希两级短路）。
   * 公开操作前自动调用；也可显式调用以强制立即同步。
   */
  async syncMarkdown(): Promise<void> {
    const run = this.importChain.then(() => this.syncMarkdownInner())
    // 本轮同步的失败不毒化后续同步（下一次调用从当前状态重试）；错误仍抛给本轮调用方。
    this.importChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** 关闭数据库句柄（幂等；插件 dispose 与测试收尾用）。 */
  async close(): Promise<void> {
    await this.importChain
    const db = this.db
    this.db = undefined
    this.opening = undefined
    db?.close()
  }

  /** 打开数据库（惰性、一次性；并发调用共享同一 Promise）。 */
  private database(): Promise<DatabaseSync> {
    this.opening ??= openMemoryDatabase(this.dbPath, this.journalMode).then((db) => {
      this.db = db
      return db
    })
    return this.opening
  }

  /** 已打开的数据库句柄（仅在 database() 之后的同步路径调用）。 */
  private requireDb(): DatabaseSync {
    if (this.db === undefined) throw new Error('memory-sqlite: database not open')
    return this.db
  }

  /** 单事务执行同步写（BEGIN IMMEDIATE；异常回滚并上抛）。 */
  private transact<T>(fn: () => T): T {
    const db = this.requireDb()
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * 取扩展词：无 expander 返回空；扩展失败（模型调用/输出校验）只经
   * onExpansionError 记录并返回空——扩展是召回增强，save 绝不因它失败。
   */
  private async expandKeywords(input: KeywordExpansionInput): Promise<string[]> {
    const expander = this.keywordExpander
    if (expander === undefined) return []
    try {
      return await expander(input)
    } catch (error) {
      this.onExpansionError?.(error)
      return []
    }
  }

  /**
   * 幂等判定的关键词比较：无 expander 时要求逐字节相等（缺省行为不变）；
   * 有 expander 时落库 keywords = [原始 tags, ...扩展词]，扩展词由模型生成、
   * 不确定，不参与幂等——只比原始 tags 前缀，同内容重保存（模型重试
   * memory_save）不产生新版本。
   */
  private keywordsIdempotent(stored: string[], baseKeywords: readonly string[]): boolean {
    if (this.keywordExpander === undefined) return arrayEqual(stored, baseKeywords)
    return stored.length >= baseKeywords.length && arrayEqual(stored.slice(0, baseKeywords.length), baseKeywords)
  }

  /** 调 embedder 并校验返回数量（provider 边界：数量不符 fail loud）。 */
  private async embed(texts: string[]): Promise<number[][]> {    const embedder = this.embedder
    if (embedder === undefined) throw new Error('memory-sqlite: embedder not configured')
    const vectors = await embedder.embed(texts)
    if (vectors.length !== texts.length) {
      throw new Error(`memory-sqlite: embedder "${embedder.id}" returned ${vectors.length} vector(s) for ${texts.length} text(s)`)
    }
    return vectors
  }

  /** 写入/更新一个事实版本的向量行（带当前 embedder 戳记；须在事务内调用）。 */
  private upsertEmbedding(versionId: string, vector: number[]): void {
    const embedder = this.embedder
    if (embedder === undefined) return
    this.requireDb().prepare(
      'INSERT INTO embeddings (fact_version, embedder, dim, vector) VALUES (?, ?, ?, ?)'
      + ' ON CONFLICT(fact_version) DO UPDATE SET embedder = excluded.embedder, dim = excluded.dim, vector = excluded.vector',
    ).run(versionId, embedder.id, vector.length, encodeVector(vector))
  }

  /**
   * 取候选版本的向量：戳记与当前 embedder 匹配的直接读库；缺失（Markdown 导入
   * 路径不在写时嵌入）或戳记不符（换模型）的按批重嵌并回写——文档化的惰性
   * 重建路径，一次 search 至多追加一次重嵌批量调用。
   */
  private async candidateVectors(candidates: Array<{ versionId: string; text: string }>): Promise<Map<string, number[]>> {
    const embedder = this.embedder
    if (embedder === undefined) return new Map()
    const stmt = this.requireDb().prepare('SELECT embedder, dim, vector FROM embeddings WHERE fact_version = ?')
    const vectors = new Map<string, number[]>()
    const stale: Array<{ versionId: string; text: string }> = []
    for (const candidate of candidates) {
      const row = stmt.get(candidate.versionId) as unknown as
        | { embedder: string; dim: number; vector: Uint8Array }
        | undefined
      if (row !== undefined && row.embedder === embedder.id) vectors.set(candidate.versionId, decodeVector(row.vector))
      else stale.push(candidate)
    }
    if (stale.length > 0) {
      const fresh = await this.embed(stale.map(item => item.text))
      // 重嵌回写是派生数据的修复（与 used_at_consolidation 同为视图侧写），不动日志。
      for (const [index, item] of stale.entries()) {
        const vector = fresh[index]
        if (vector === undefined) throw new Error('memory-sqlite: embedder returned fewer vectors than requested')
        this.upsertEmbedding(item.versionId, vector)
        vectors.set(item.versionId, vector)
      }
    }
    return vectors
  }

  /**
   * 向量通道（阶段二c）：对同一组过滤条件（scope/topic/entities/excludeIds/非
   * retired）做全量候选的余弦名次，与 BM25 名次做 RRF 融合（名次融合而非分数
   * 混合——BM25 与余弦量纲不可比），结果重写为融合全集（BM25 命中 ∪ 向量
   * 命中）并回填 score。查询向量每次 search 至多取一次（无候选不取）；候选
   * 向量缺失或戳记不符时按批惰性重嵌（candidateVectors）。
   */
  private async applyVectorFusion(
    db: DatabaseSync,
    query: string,
    where: string,
    params: Array<string | number>,
    scored: ScoredFact[],
  ): Promise<void> {
    const allRows = db.prepare(`SELECT ${FACT_SELECT} FROM facts f WHERE ${where}`)
      .all(...params) as unknown as DbFactRow[]
    if (allRows.length === 0) return
    const queryVector = (await this.embed([query]))[0] as number[]
    const candidates = allRows.map(row => rowToFact(row))
    const vectors = await this.candidateVectors(candidates.map(fact => ({ versionId: fact.versionId, text: fact.text })))
    const bm25List = [...scored]
      .sort((a, b) => b.relevance - a.relevance)
      .map(item => ({ id: item.fact.versionId }))
    const vectorList = candidates
      .map((fact) => {
        const stored = vectors.get(fact.versionId)
        /* v8 ignore next -- candidateVectors 为每个 allRows id 写入 map；空数组只收窄 */
        const vector = stored ?? []
        return { id: fact.versionId, cosine: cosineSimilarity(queryVector, vector) }
      })
      .filter(item => item.cosine > 0)
      .sort((a, b) => b.cosine - a.cosine)
      .map(item => ({ id: item.id }))
    const byVersion = new Map(candidates.map(fact => [fact.versionId, fact]))
    scored.length = 0
    for (const hit of reciprocalRankFusion([bm25List, vectorList], RRF_K)) {
      const fact = byVersion.get(hit.id)
      /* v8 ignore next -- RRF id 来自 candidates，Map 必有；continue 只收窄 */
      if (fact === undefined) continue
      // 归一化：两榜双顶 = 1，单榜居首 = 0.5——流入 score 字段供置信度门消费。
      scored.push({ fact, relevance: 0, entry: { ...toEntry(fact), score: (hit.rrfScore / RRF_MAX) * STATUS_WEIGHT[fact.status] } })
    }
  }

  /** 追加一条事件日志。 */
  private insertEvent(input: {
    kind: MemoryEventKind
    text: string
    scope: MemoryScope
    topic: string
    keywords: string[]
    entities: string[]
    confidence: number
    sourceRefs: MemorySourceRef[]
    createdAt: number
  }): string {
    const id = randomUUID()
    this.requireDb().prepare(
      'INSERT INTO events (id, session_id, scope, kind, text, keywords, entities, topic, confidence, source_refs, created_at)'
      + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id, sessionIdOf(input.scope), input.scope, input.kind, input.text,
      JSON.stringify(input.keywords), JSON.stringify(input.entities), input.topic,
      input.confidence, JSON.stringify(input.sourceRefs), input.createdAt,
    )
    return id
  }

  /**
   * 插入一个新事实版本：head 为 active 时先将其 supersede（valid_to =
   * validFrom）并以 supersedes 指回；FTS 伴随行同事务插入。
   */
  private insertFactVersion(
    input: {
      id: string
      scope: MemoryScope
      subject: string
      predicate: string
      value: string
      text: string
      keywords: string[]
      entities: string[]
      topic: string
      source: MemorySource
      confidence: number
    },
    head: MemoryFactRow | null,
    validFrom: number,
    eventId: string,
  ): MemoryFactRow {
    const db = this.requireDb()
    // head 为 active 或 uncertain 时都先废止（新证据取代旧当前版本）。
    const supersedes = head !== null ? head.versionId : null
    if (supersedes !== null) {
      db.prepare("UPDATE facts SET status = 'superseded', valid_to = ? WHERE version_id = ?").run(validFrom, supersedes)
    }
    const versionId = randomUUID()
    const createdAt = head?.createdAt ?? validFrom
    const usedAtConsolidation = this.consolidationCounter()
    db.prepare(
      'INSERT INTO facts (version_id, id, scope, subject, predicate, value, text, keywords, entities, topic,'
      + ' source, valid_from, valid_to, confidence, status, supersedes, source_event_id, created_at, used_at_consolidation)'
      + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, \'active\', ?, ?, ?, ?)',
    ).run(
      versionId, input.id, input.scope, input.subject, input.predicate, input.value, input.text,
      JSON.stringify(input.keywords), JSON.stringify(input.entities), input.topic, input.source,
      validFrom, input.confidence, supersedes, eventId, createdAt, usedAtConsolidation,
    )
    db.prepare('INSERT INTO memory_fts (text, keywords, fact_version) VALUES (?, ?, ?)').run(
      ftsNormalize(input.text), ftsNormalize(input.keywords.join(' ')), versionId,
    )
    return {
      versionId, id: input.id, scope: input.scope, subject: input.subject, predicate: input.predicate,
      value: input.value, text: input.text, keywords: [...input.keywords], entities: [...input.entities],
      topic: input.topic, source: input.source, validFrom, validTo: null, confidence: input.confidence,
      status: 'active', supersedes, sourceEventId: eventId, createdAt, usedAtConsolidation,
    }
  }

  /** 按 (scope, subject, predicate) 找当前 active 版本（走部分唯一索引）。 */
  private findActiveByPair(scope: MemoryScope, subject: string, predicate: string): MemoryFactRow | null {
    const row = this.requireDb().prepare(
      `SELECT ${FACT_SELECT} FROM facts f`
      + " WHERE f.scope = ? AND f.subject = ? AND f.predicate = ? AND f.status = 'active'",
    ).get(scope, subject, predicate) as unknown as DbFactRow | undefined
    return row === undefined ? null : rowToFact(row)
  }

  /** 按 (scope, subject, predicate) 找最新 uncertain 版本（save 的新证据取代对象）。 */
  private findUncertainByPair(scope: MemoryScope, subject: string, predicate: string): MemoryFactRow | null {
    const row = this.requireDb().prepare(
      `SELECT ${FACT_SELECT} FROM facts f`
      + " WHERE f.scope = ? AND f.subject = ? AND f.predicate = ? AND f.status = 'uncertain'"
      + ' ORDER BY f.valid_from DESC, f.rowid DESC LIMIT 1',
    ).get(scope, subject, predicate) as unknown as DbFactRow | undefined
    return row === undefined ? null : rowToFact(row)
  }

  /** 按 (scope, subject, predicate) 找最新版本（任意状态；导入幂等判定用）。 */
  private findHeadByPair(scope: MemoryScope, subject: string, predicate: string): MemoryFactRow | null {
    const row = this.requireDb().prepare(
      `SELECT ${FACT_SELECT} FROM facts f WHERE f.scope = ? AND f.subject = ? AND f.predicate = ?`
      + ' ORDER BY f.valid_from DESC, f.rowid DESC LIMIT 1',
    ).get(scope, subject, predicate) as unknown as DbFactRow | undefined
    return row === undefined ? null : rowToFact(row)
  }

  /** 把某逻辑 id 的全部 active 版本落 tombstone（supersede + 事件 + topic 版本）。 */
  private tombstoneByLogicalId(id: string, stamp: number): void {
    const rows = this.requireDb().prepare(
      `SELECT ${FACT_SELECT} FROM facts f WHERE f.id = ? AND f.status = 'active'`,
    ).all(id) as unknown as DbFactRow[]
    for (const row of rows) {
      const fact = rowToFact(row)
      this.requireDb().prepare("UPDATE facts SET status = 'superseded', valid_to = ? WHERE version_id = ?")
        .run(stamp, fact.versionId)
      this.insertEvent({
        kind: 'tombstone', text: fact.text, scope: fact.scope, topic: fact.topic,
        keywords: fact.keywords, entities: fact.entities, confidence: fact.confidence,
        sourceRefs: [], createdAt: stamp,
      })
      this.bumpTopic(fact.topic)
    }
  }

  /** topic 版本 +1（不存在则从 1 起）。 */
  private bumpTopic(topic: string): void {
    this.requireDb().prepare(
      'INSERT INTO topics (name, version) VALUES (?, 1)'
      + ' ON CONFLICT(name) DO UPDATE SET version = version + 1',
    ).run(topic)
  }

  /** imports 表全量记录（path → 哈希与已导入条目 id）。 */
  private importRecords(): Map<string, { hash: string; entryIds: string[] }> {
    const rows = this.requireDb().prepare('SELECT path, hash, entry_ids FROM imports').all() as unknown as Array<{
      path: string
      hash: string
      entry_ids: string
    }>
    return new Map(rows.map(row => [row.path, { hash: row.hash, entryIds: JSON.parse(row.entry_ids) as string[] }]))
  }

  /** Markdown 同步主流程（串在 importChain 上；无 mdRoot 时 no-op）。 */
  private async syncMarkdownInner(): Promise<void> {
    if (this.mdRoot === undefined) return
    await this.database()
    const mdRoot = this.mdRoot
    const files = await listMarkdownFiles(mdRoot)
    const imported = this.importRecords()
    // 文件整体消失：其导入的条目全部 supersede（人类删除即失效）。
    for (const [path, record] of imported) {
      if (!files.includes(path)) {
        this.transact(() => {
          for (const entryId of record.entryIds) this.tombstoneByLogicalId(entryId, Date.now())
          this.requireDb().prepare('DELETE FROM imports WHERE path = ?').run(path)
        })
      }
    }
    const changed: Array<{ path: string; hash: string }> = []
    for (const file of files) {
      const st = await stat(file)
      const snapshot = this.fileSnapshots.get(file)
      if (snapshot !== undefined && snapshot.mtimeMs === st.mtimeMs && snapshot.size === st.size) continue
      const content = await readFile(file, 'utf8')
      const bytes = Buffer.byteLength(content)
      if (bytes > this.importMaxFileBytes) {
        throw new Error(
          `memory-sqlite: markdown file "${file}" is ${bytes} bytes, exceeding importMaxFileBytes=${this.importMaxFileBytes}`,
        )
      }
      const hash = createHash('sha1').update(content).digest('hex')
      this.fileSnapshots.set(file, { mtimeMs: st.mtimeMs, size: st.size })
      if (imported.get(file)?.hash === hash) continue
      changed.push({ path: file, hash })
    }
    if (changed.length === 0) return
    // 复用 dsh-memory 的解析器：整目录解析一次，按 scope 归因回各文件。
    const entries = await new MarkdownMemoryStore(mdRoot).list()
    const byFile = new Map<string, MemoryEntry[]>()
    for (const entry of entries) {
      const path = markdownFileFor(mdRoot, entry.scope)
      const bucket = byFile.get(path) ?? []
      bucket.push(entry)
      byFile.set(path, bucket)
    }
    for (const { path, hash } of changed) {
      this.importFile(path, byFile.get(path) ?? [], hash)
    }
  }

  /** 导入一个变更文件：upsert 其中条目 + 失效已移除条目 + 记录导入幂等位。 */
  private importFile(path: string, entries: MemoryEntry[], hash: string): void {
    this.transact(() => {
      const prev = this.importRecords().get(path)
      const currentIds = new Set(entries.map(entry => entry.id))
      for (const entry of entries) this.upsertImported(entry)
      for (const prevId of prev?.entryIds ?? []) {
        if (!currentIds.has(prevId)) this.tombstoneByLogicalId(prevId, Date.now())
      }
      this.requireDb().prepare(
        'INSERT INTO imports (path, hash, entry_ids, imported_at) VALUES (?, ?, ?, ?)'
        + ' ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, entry_ids = excluded.entry_ids, imported_at = excluded.imported_at',
      ).run(path, hash, JSON.stringify([...currentIds].sort()), Date.now())
    })
  }

  /**
   * 导入单条 Markdown 条目：以条目 id 为 subject、'note' 为 predicate。
   * 最新版本文本与 tags 相同 → 跳过（幂等；tombstone 过的同内容条目不复活）。
   */
  private upsertImported(entry: MemoryEntry): void {
    assertScope(entry.scope)
    const head = this.findHeadByPair(entry.scope, entry.id, 'note')
    if (head !== null && head.text === entry.text && arrayEqual(head.keywords, entry.tags)) return
    const stamp = entry.updatedAt ?? entry.createdAt
    const topic = entry.tags[0] ?? DEFAULT_TOPIC
    const eventId = this.insertEvent({
      kind: 'observation', text: entry.text, scope: entry.scope, topic,
      keywords: entry.tags, entities: [], confidence: 1, sourceRefs: [], createdAt: stamp,
    })
    this.insertFactVersion({
      id: entry.id, scope: entry.scope, subject: entry.id, predicate: 'note', value: entry.text,
      text: entry.text, keywords: entry.tags, entities: [], topic, source: entry.source, confidence: 1,
    }, head, stamp, eventId)
    this.bumpTopic(topic)
    if (head !== null && head.topic !== topic) this.bumpTopic(head.topic)
  }
}
