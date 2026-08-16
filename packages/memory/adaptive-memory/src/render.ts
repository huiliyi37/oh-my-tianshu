/**
 * STM 渲染（纯函数）：候选筛选、确定性渲染、门控签名。
 *
 * canonicalization 不变量（前缀缓存安全的根基）：
 * - renderSTM 是输入的确定性函数——相同输入跨调用逐字节一致；
 * - 易变字段（versionStamp、accessCount、时间戳）绝不进入输出；
 * - 因此逐字节相同的重渲染 ⇒ context 贡献内容不变 ⇒ RuntimeContextProjection
 *   不追加新快照（零前缀失效）。
 *
 * 阶段一的相关性是关键词子串匹配（intent 词 + 实体 vs 条目文本/tags）；
 * 结构化 provider（dsh-memory-sqlite）的 BM25 检索与置信度门在
 * retrieve.ts/gate.ts（阶段二b）：高置信候选带 body（条目全文），渲染为
 * 缩进正文块；预算不足时降级为索引行。
 *
 * @module @huiliyi37/dsh-adaptive-memory/render
 */

import type { MemoryEntry } from '@huiliyi37/dsh-memory'
import type { StmCandidate } from './types.ts'

/** STM 快照头（模型可见；逐字节稳定——无时间戳/会话 id 等易变标量）。 */
const STM_HEADER = '相关项目记忆（按当前任务筛选；用 memory_search 检索全文，excludeIds 传下列短 id 可排除已载条目）：'

/** 相关性信号：intentKey 关键词 + 实体（路径/错误码）。 */
export interface StmSignals {
  /** intentKey 拆分出的关键词（小写）。 */
  intentTokens: string[]
  /** 当前 intent 期间提取的实体。 */
  entities: string[]
}

/** selectCandidates 的阈值选项（全部来自插件 Config）。 */
export interface SelectOptions {
  /** 始终入选的 tag（安全/用户约束类条目；缺省约束条目优先保住预算）。 */
  alwaysIncludeTags: string[]
  /** 每条目的关键词数上限。 */
  maxKeywords: number
  /** 每行摘要的字符数上限（截断补 '…'）。 */
  summaryMaxChars: number
}

/** renderSTM 的预算选项（全部来自插件 Config）。 */
export interface RenderOptions {
  /** 整份 STM 快照的估算 token 预算（header 也计入；超限的行被跳过）。 */
  tokenBudget: number
  /** STM 行数上限。 */
  maxEntries: number
}

/**
 * 估算 token 数（确定性启发式：汉字按 1 token，其余字符按 1/4 token）。
 * @param text - 待估算文本。
 * @returns 估算 token 数（上取整）。
 */
export function estimateTokens(text: string): number {
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length
  return Math.ceil(han + (text.length - han) / 4)
}

/** 条目 → 单行摘要（首行、折叠空白、截断补 '…'；确定性）。 */
function summaryOf(text: string, maxChars: number): string {
  const firstLine = (text.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim()
  return firstLine.length <= maxChars ? firstLine : `${firstLine.slice(0, maxChars)}…`
}

/**
 * 条目 → STM 候选项（两条检索路径共用：fallback 的关键词筛选与结构化检索）。
 * @param entry - 记忆条目。
 * @param opts - 阈值选项（插件 Config）。
 * @param body - 高置信层注入的条目全文（缺省 = 只渲染索引行）。
 * @returns 渲染输入候选项。
 */
export function candidateOf(entry: MemoryEntry, opts: SelectOptions, body?: string): StmCandidate {
  return {
    id: entry.id,
    topic: entry.tags[0] ?? '-',
    summary: summaryOf(entry.text, opts.summaryMaxChars),
    keywords: entry.tags.slice(0, opts.maxKeywords),
    versionStamp: entry.updatedAt ?? entry.createdAt,
    ...(body === undefined || body === '' ? {} : { body }),
  }
}

/** 条目的相关性得分：命中的不同信号数（子串匹配，大小写不敏感）。 */
function scoreOf(entry: MemoryEntry, signals: string[]): number {
  const haystack = `${entry.text}\n${entry.tags.join(' ')}`.toLowerCase()
  let score = 0
  for (const signal of signals) {
    if (signal.length >= 2 && haystack.includes(signal.toLowerCase())) score += 1
  }
  return score
}

/**
 * 筛选候选条目：当前 intent 相关（得分 >0）+ 安全/用户约束类（tags 命中
 * alwaysIncludeTags）。排序确定性：约束条目优先，再按得分降序，同分按 id 升序。
 * @param entries - 记忆条目（global + 当前会话 scope）。
 * @param signals - 相关性信号（intent 关键词 + 实体）。
 * @param opts - 阈值选项（插件 Config）。
 * @returns 排序后的候选项（渲染输入；未按预算截断——预算是 renderSTM 的职责）。
 */
export function selectCandidates(
  entries: readonly MemoryEntry[],
  signals: StmSignals,
  opts: SelectOptions,
): StmCandidate[] {
  const needles = [...signals.intentTokens, ...signals.entities]
  const scored = entries.flatMap((entry) => {
    const constraint = entry.tags.some(tag => opts.alwaysIncludeTags.includes(tag))
    const score = scoreOf(entry, needles)
    if (!constraint && score === 0) return []
    return [{ entry, constraint, score, candidate: candidateOf(entry, opts) }]
  })
  scored.sort((a, b) =>
    Number(b.constraint) - Number(a.constraint)
    || b.score - a.score
    || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0))
  return scored.map(item => item.candidate)
}

/**
 * 渲染一行 STM：`短id | topic | 单行摘要 | 关键词`（短 id 取完整 id 前 8 位）。
 * @param candidate - 候选条目。
 * @returns 单行文本（不含前导 '- '）。
 */
export function renderLine(candidate: StmCandidate): string {
  const keywords = candidate.keywords.length === 0 ? '-' : candidate.keywords.join(', ')
  return `${candidate.id.slice(0, 8)} | ${candidate.topic} | ${candidate.summary} | ${keywords}`
}

/**
 * 渲染一个候选项：无 body ⇒ 索引行（`- 短id | topic | 摘要 | 关键词`）；
 * 有 body ⇒ 正文块（`- 短id | topic（全文）` + 缩进两格的正文行；行尾空白
 * 裁掉以保持字节稳定）。
 */
function renderBlock(candidate: StmCandidate): string {
  if (candidate.body === undefined) return `- ${renderLine(candidate)}`
  const lines = candidate.body.split('\n').map(line => `  ${line.trimEnd()}`)
  return `- ${candidate.id.slice(0, 8)} | ${candidate.topic}（全文）\n${lines.join('\n')}`
}

/**
 * 渲染 STM 快照（确定性纯函数；易变字段不进输出）。
 *
 * 预算施加在完整结果上：header 超预算或零候选 ⇒ 返回 ''（无贡献）；
 * 逐个候选加入——正文块超预算时降级为索引行，索引行仍超预算则跳过该候选
 * 继续（短行不被长行挤死），候选数封顶 maxEntries。
 * @param candidates - 排序后的候选项（selectCandidates/selectStructured 的输出）。
 * @param opts - 预算选项（插件 Config）。
 * @returns STM 快照文本；无有效贡献时为 ''。
 */
export function renderSTM(candidates: readonly StmCandidate[], opts: RenderOptions): string {
  if (candidates.length === 0) return ''
  let text = STM_HEADER
  if (estimateTokens(text) > opts.tokenBudget) return ''
  let included = 0
  for (const candidate of candidates) {
    if (included >= opts.maxEntries) break
    let next = `${text}\n${renderBlock(candidate)}`
    if (candidate.body !== undefined && estimateTokens(next) > opts.tokenBudget) {
      // 正文块放不下时降级为索引行（宁可要索引也不丢候选）。
      next = `${text}\n- ${renderLine(candidate)}`
    }
    if (estimateTokens(next) > opts.tokenBudget) continue
    text = next
    included += 1
  }
  return included === 0 ? '' : text
}

/** 按 topic 分组的确定性版本摘要（topic 排序、组内 `id@版本戳` 排序）。 */
function groupVersions(candidates: readonly StmCandidate[]): Record<string, string> {
  const topics: Record<string, string[]> = {}
  for (const candidate of candidates) {
    ;(topics[candidate.topic] ??= []).push(`${candidate.id}@${candidate.versionStamp}`)
  }
  const grouped: Record<string, string> = {}
  for (const topic of Object.keys(topics).sort()) {
    grouped[topic] = (topics[topic] ?? []).sort().join(',')
  }
  return grouped
}

/**
 * 门控签名：候选项的确定性指纹（id 序 + 各 topic 的 id@版本戳摘要）。
 * 版本戳参与门控比较但绝不渲染——签名变化 ⇒ 'topic-version' 刷新。
 * @param candidates - 排序后的候选项。
 * @returns 逐字节确定的签名字符串。
 */
export function relevanceSignature(candidates: readonly StmCandidate[]): string {
  const topicPart = Object.entries(groupVersions(candidates))
    .map(([topic, versions]) => `${topic}:[${versions}]`)
    .join(';')
  return `ids:[${candidates.map(c => c.id).join(',')}];${topicPart}`
}

/**
 * topicVersions 状态切片：topic → 该 topic 候选项的确定性版本摘要。
 * @param candidates - 排序后的候选项。
 * @returns topic 版本表（仅门控用，不渲染）。
 */
export function topicVersionsOf(candidates: readonly StmCandidate[]): Record<string, string> {
  return groupVersions(candidates)
}
