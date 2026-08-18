/**
 * 结构化检索（阶段二b）：memory 服务暴露 topicVersions + scored search 时的
 * STM 候选选择与门控签名。
 *
 * 能力探测在 index.ts（`typeof memory.topicVersions === 'function'`）；本模块
 * 只在结构化 provider（dsh-memory-sqlite）路径上运行：
 * - 检索：以 intent 锚点文本为 query 的 BM25 search（global + 当前会话 scope），
 *   有实体时追加一次空 query 的实体精确过滤 search（合取语义：条目 entities
 *   须含全部给定实体——宁缺毋滥的精确实体兜底）；安全/用户约束类条目经
 *   alwaysIncludeTags 从 list 结果钉入（无 score 也进索引行）。
 * - 置信度门（gate.ts）：high → 候选带 body（条目全文进快照）；medium →
 *   只进索引行；low → 不注入（模型保留 memory_search）。pinned 约束条目
 *   至少保留索引行（安全钉不受门驱逐）。topic 加分（Config topicBoosts）
 *   在门层级判定前加性抬升带 score 命中的得分（小语料 BM25 得分趋零时
 *   抬升 procedure 等高价值 topic；只作用于已有得分，不制造得分）。
 * - 门控签名：注入 id 集 + 全部检索命中（含被门拦下的 low 层）id 集 + 这些
 *   命中覆盖的 topic 版本号——相关 topic 的任何写入/supersede 推进版本号即
 *   触发刷新；无关 topic 的写入不触发（阶段一 relevanceSignature 的结构化
 *   对应物）。跟踪 low 层命中的 topic 是因为内容变更可能让得分跨阈值。
 *
 * @module @huiliyi37/dsh-adaptive-memory/retrieve
 */

import type { MemorySearchResult, MemoryService } from '@huiliyi37/dsh-memory'
import { tierOfScore } from './gate.ts'
import type { GateThresholds, StmTier } from './gate.ts'
import { candidateOf } from './render.ts'
import type { SelectOptions } from './render.ts'
import type { StmCandidate } from './types.ts'

/** 带 topicVersions 能力的 memory 服务（能力探测收窄后的形状）。 */
export type StructuredMemoryService = MemoryService & { topicVersions(): Promise<Record<string, number>> }

/**
 * 能力探测：服务暴露 topicVersions 即视为结构化 provider（scored search 与
 * 版本失效信号随之可用；score 仍在每个结果上单独探测，见 selectStructured）。
 * @param memory - 当前装配的 memory 服务。
 * @returns 收窄后的服务；无能力时为 undefined。
 */
export function asStructuredMemory(memory: MemoryService): StructuredMemoryService | undefined {
  return typeof memory.topicVersions === 'function' ? memory as StructuredMemoryService : undefined
}

/** selectStructured 的检索输入（全部确定性派生自会话日志）。 */
export interface StructuredQuery {
  /** BM25 查询文本（intent 锚点消息原文；CJK 由 store 二元组化）。 */
  query: string
  /** 当前 intent 期间提取的实体（精确过滤维度；空时跳过实体检索）。 */
  entities: string[]
  /** 当前会话的记忆 scope（`session:<id>`）。 */
  sessionScope: string
}

/** selectStructured 的阈值选项（全部来自插件 Config）。 */
export interface StructuredOptions extends SelectOptions {
  /** 置信度门阈值。 */
  thresholds: GateThresholds
  /** 每次 search/list 的候选拉取上限。 */
  retrievalLimit: number
  /**
   * 按 topic 的加分权重（topic → 0..1 的加性 score 提升，封顶 1）：小语料上
   * BM25 归一化得分天然趋零，procedure 等高价值 topic 可经此抬升门层级
   * （如 `{ procedure: 0.2 }`）；只作用于带 score 的检索命中，不制造得分。
   */
  topicBoosts: Record<string, number>
}

/** 结构化选择结果：渲染候选 + 门控签名 + intent 状态的 topicVersions 切片。 */
export interface StructuredSelection {
  /** 排序后的注入候选（high 层带 body；pinned 约束条目在前）。 */
  candidates: StmCandidate[]
  /** 门控签名（确定性；见模块文档）。 */
  signature: string
  /** 检索命中覆盖的 topic → 版本号（IntentState.topicVersions；仅门控用）。 */
  topicVersions: Record<string, string>
}

/** 一条检索命中 + 门层级（pinned = 约束钉入，至少保留索引行）。 */
interface ScoredHit {
  entry: MemorySearchResult
  pinned: boolean
  tier: StmTier
}

/** 命中条目的层级：无 score ⇒ pinned 留索引行、其余 low；pinned 不被门驱逐。 */
function tierOf(hit: MemorySearchResult, pinned: boolean, thresholds: GateThresholds): StmTier {
  const tier = hit.score === undefined ? 'low' : tierOfScore(hit.score, thresholds)
  return tier === 'low' && pinned ? 'medium' : tier
}

/**
 * 结构化 STM 候选选择：search 检索 + 约束钉入 + 置信度门 + 版本签名。
 * @param memory - 结构化 memory 服务（asStructuredMemory 收窄后）。
 * @param input - 检索输入（锚点 query + 实体 + 会话 scope）。
 * @param opts - 阈值选项（插件 Config）。
 * @returns 渲染候选与门控签名。
 */
export async function selectStructured(
  memory: StructuredMemoryService,
  input: StructuredQuery,
  opts: StructuredOptions,
): Promise<StructuredSelection> {
  const scopes = ['global', input.sessionScope]
  const hits = new Map<string, MemorySearchResult>()
  for (const scope of scopes) {
    for (const hit of await memory.search(input.query, { scope, limit: opts.retrievalLimit })) {
      if (!hits.has(hit.id)) hits.set(hit.id, hit)
    }
  }
  if (input.entities.length > 0) {
    for (const scope of scopes) {
      for (const hit of await memory.search('', { scope, entities: input.entities, limit: opts.retrievalLimit })) {
        if (!hits.has(hit.id)) hits.set(hit.id, hit)
      }
    }
  }
  const pinned = (entry: MemorySearchResult): boolean =>
    entry.tags.some(tag => opts.alwaysIncludeTags.includes(tag))
  for (const scope of scopes) {
    for (const entry of await memory.list({ scope, limit: opts.retrievalLimit })) {
      if (pinned(entry) && !hits.has(entry.id)) hits.set(entry.id, entry)
    }
  }

  const rows: ScoredHit[] = [...hits.values()].map((entry) => {
    const isPinned = pinned(entry)
    // topic 加分（Config topicBoosts）：只抬升已有 score 的命中，封顶 1。
    const boost = opts.topicBoosts[entry.tags[0] ?? 'general'] ?? 0
    const scored = boost > 0 && entry.score !== undefined
      ? { ...entry, score: Math.min(1, entry.score + boost) }
      : entry
    return { entry: scored, pinned: isPinned, tier: tierOf(scored, isPinned, opts.thresholds) }
  })
  const injected = rows.filter(row => row.tier !== 'low')
  injected.sort((a, b) =>
    Number(b.pinned) - Number(a.pinned)
    || (b.entry.score ?? -1) - (a.entry.score ?? -1)
    || a.entry.id.localeCompare(b.entry.id))

  const candidates = injected.map(row =>
    candidateOf(row.entry, opts, row.tier === 'high' ? row.entry.text : undefined))

  const versions = await memory.topicVersions()
  const topics = [...new Set(rows.map(row => row.entry.tags[0] ?? 'general'))].sort()
  const topicVersions: Record<string, string> = {}
  for (const topic of topics) topicVersions[topic] = String(versions[topic] ?? 0)
  const retrievedIds = rows.map(row => row.entry.id).sort()
  const signature = `in:[${candidates.map(c => c.id).join(',')}];`
    + `ret:[${retrievedIds.join(',')}];`
    + `v:${topics.map(topic => `${topic}@${versions[topic] ?? 0}`).join(',')}`
  return { candidates, signature, topicVersions }
}
