/**
 * memory-consolidate — 会话结束时的经验巩固（阶段三）。
 *
 * 设计契约：Agent Note
 * `.agents/notes/proposed/feature/2026-08-16-adaptive-memory-cache-contract.md`
 * 的阶段三（experience extraction behind success gates；conflict detection and
 * retirement）。
 *
 * 机制：
 * - 挂在 `session/disposed`（会话离开 store 的终态信号，一次会话恰好一次；
 *   `session/flush` 是每请求多次的持久化检查点，不是任务结束信号）。监听器
 *   内的异步巩固以 log-only 方式失败——catch 后 ctx.logger.warn，绝不阻断
 *   会话拆除。
 * - 成功门控（gate.ts）：缺省 standard（末轮无未解决工具错误/测试失败 +
 *   至少一个 completed turn）；strict 扩大到全会话。门控未通过的会话只记录
 *   failure-pattern 经验条目，绝不混入成功事实。
 * - 提取（extract.ts）：v1 确定性启发式（零模型调用）；ExperienceExtractor
 *   接口是后续 LLM 提取器的挂载点（apply 第三参数注入）。
 * - 冲突：同一次巩固内同 (subject, predicate) 不同 value 的候选无明确
 *   supersede 顺序——第二个写入后把该对标记 uncertain（store 的
 *   markUncertain 可选能力，探测调用）。跨会话的同对不同 value 有明确时间
 *   顺序，走 store 固有的 supersede。
 * - 退役：每次巩固后调用 store 的 retireStale 可选能力（探测调用），阈值
 *   全部来自 Config。
 * - 巩固产物写入 global scope、source 'auto'，sourceRefs 携带
 *   sessionId + 事件 seqs（审计链可回溯）。提取文本不进模型可见面——巩固
 *   只写 LTM；决策经 logger 记录（会话已 dispose，不再追加会话事件）。
 *
 * @module @huiliyi37/dsh-memory-consolidate
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import type { MemoryService } from '@huiliyi37/dsh-memory'
import type { Session } from '@huiliyi37/dsh-session'
import { evaluateSuccessGate } from './gate.ts'
import type { GateLevel } from './gate.ts'
import { HeuristicExtractor, failureCandidates } from './extract.ts'
import type { ExperienceExtractor, ExtractionCandidate } from './extract.ts'

export { evaluateSuccessGate, toolResultText, unresolvedFailures } from './gate.ts'
export type { GateLevel, GateVerdict, UnresolvedFailure } from './gate.ts'
export { HeuristicExtractor, failureCandidates } from './extract.ts'
export type {
  ExperienceExtractor,
  ExtractionBounds,
  ExtractionCandidate,
  ExtractionInput,
} from './extract.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'memory-consolidate'

/** memory 服务键（与 dsh-memory 的 MEMORY_KEY 对齐；经 reflect 动态获取）。 */
const MEMORY_KEY = 'memory'

/** 一天毫秒数（supersededRetentionDays 折算用；协议常量）。 */
const DAY_MS = 86_400_000

/** 插件配置：全部阈值经 schemastery 校验，缺省值在 schema 上。 */
export interface Config {
  /** 总开关（缺省 true；false 时完全不监听会话结束）。 */
  enabled?: boolean
  /** 成功门控级别（缺省 'standard'：末轮范围；'strict'：全会话范围）。 */
  gate?: GateLevel
  /** 门控未通过的会话是否记录 failure-pattern 经验（缺省 true）。 */
  recordFailures?: boolean
  /** 是否巩固子代理会话（缺省 false：reader 等子会话的一次性工作不产生经验）。 */
  consolidateChildSessions?: boolean
  /** 单次巩固写入的候选数上限（缺省 8）。 */
  maxCandidatesPerSession?: number
  /** 单条候选文本字符上限（缺省 280）。 */
  maxTextChars?: number
  /** 单条候选实体数上限（缺省 8）。 */
  maxEntities?: number
  /** 退役开关（缺省 true；store 不支持 retireStale 能力时自动跳过）。 */
  retirementEnabled?: boolean
  /** superseded 版本保留天数（缺省 30；超过即退役）。 */
  supersededRetentionDays?: number
  /** 巩固期未使用阈值（缺省 8；连续这么多次巩固未被检索命中的事实退役）。 */
  unusedConsolidations?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  gate: z.union(['standard', 'strict'] as const).default('standard'),
  recordFailures: z.boolean().default(true),
  consolidateChildSessions: z.boolean().default(false),
  maxCandidatesPerSession: z.number().default(8),
  maxTextChars: z.number().default(280),
  maxEntities: z.number().default(8),
  retirementEnabled: z.boolean().default(true),
  supersededRetentionDays: z.number().default(30),
  unusedConsolidations: z.number().default(8),
})

/** 解析后的配置（schema 缺省 + 直接 apply 调用的 `??` 回落，与 tool-memory 同例）。 */
interface ResolvedConfig {
  enabled: boolean
  gate: GateLevel
  recordFailures: boolean
  consolidateChildSessions: boolean
  maxCandidatesPerSession: number
  maxTextChars: number
  maxEntities: number
  retirementEnabled: boolean
  supersededRetentionDays: number
  unusedConsolidations: number
}

/** 配置解析（单一缺省来源：schema 缺省与回落值保持一致）。 */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    enabled: config.enabled ?? true,
    gate: config.gate ?? 'standard',
    recordFailures: config.recordFailures ?? true,
    consolidateChildSessions: config.consolidateChildSessions ?? false,
    maxCandidatesPerSession: config.maxCandidatesPerSession ?? 8,
    maxTextChars: config.maxTextChars ?? 280,
    maxEntities: config.maxEntities ?? 8,
    retirementEnabled: config.retirementEnabled ?? true,
    supersededRetentionDays: config.supersededRetentionDays ?? 30,
    unusedConsolidations: config.unusedConsolidations ?? 8,
  }
}

/** 取 memory 服务（未装配 = 配置错误，fail loud——在 disposed 监听器内被捕获并记日志）。 */
function requireMemory(ctx: Context): MemoryService {
  const memory = ctx.reflect.get(MEMORY_KEY, false) as MemoryService | undefined
  if (memory === undefined) {
    throw new Error('memory-consolidate: memory 服务不可用（装配 memory-consolidate 需同时装配 memory provider）')
  }
  return memory
}

/**
 * 巩固一个已结束的会话：门控 → 提取 → 写入（含同次冲突 uncertain 标记）→ 退役。
 * @param ctx - 插件上下文（reflect 取 memory 服务；logger 记决策）。
 * @param session - 已 dispose 的会话（事件日志只读）。
 * @param extractor - 提取器（v1 缺省 HeuristicExtractor）。
 * @param config - 解析后的配置。
 */
async function consolidateSession(
  ctx: Context,
  session: Session,
  extractor: ExperienceExtractor,
  config: ResolvedConfig,
): Promise<void> {
  const memory = requireMemory(ctx)
  const events = session.events
  const verdict = evaluateSuccessGate(events, config.gate)
  const bounds = { maxTextChars: config.maxTextChars, maxEntities: config.maxEntities }
  const candidates = verdict.passed
    ? await extractor.extract({ sessionId: session.id, events, bounds })
    : config.recordFailures
      ? failureCandidates(events, bounds)
      : []
  const capped = candidates.slice(0, config.maxCandidatesPerSession)
  // 同一次巩固内同 (subject, predicate) 的候选值表：不同 value = 无明确
  // supersede 顺序的冲突 → 写入后标记 uncertain（不替模型二选一）。
  const statedPairs = new Map<string, string>()
  let uncertain = 0
  for (const candidate of capped) {
    const conflict = candidate.fact !== undefined
      && statedPairs.get(`${candidate.fact.subject}\n${candidate.fact.predicate}`) !== undefined
      && statedPairs.get(`${candidate.fact.subject}\n${candidate.fact.predicate}`) !== candidate.fact.value
    if (candidate.fact !== undefined) {
      statedPairs.set(`${candidate.fact.subject}\n${candidate.fact.predicate}`, candidate.fact.value)
    }
    await saveCandidate(memory, session, candidate)
    if (conflict && candidate.fact !== undefined && typeof memory.markUncertain === 'function') {
      if (await memory.markUncertain('global', candidate.fact.subject, candidate.fact.predicate)) uncertain += 1
    }
  }
  if (config.retirementEnabled && typeof memory.retireStale === 'function') {
    const report = await memory.retireStale({
      now: Date.now(),
      supersededRetentionMs: config.supersededRetentionDays * DAY_MS,
      unusedConsolidations: config.unusedConsolidations,
    })
    ctx.logger.info(
      `memory-consolidate: session "${session.id}" consolidated (gate ${verdict.passed ? 'passed' : 'failed'}):`
      + ` ${capped.length} candidate(s), ${uncertain} marked uncertain,`
      + ` retired ${report.retiredSuperseded} superseded + ${report.retiredUnused} unused`
      + ` (consolidation ${report.consolidations})`,
    )
  } else {
    ctx.logger.info(
      `memory-consolidate: session "${session.id}" consolidated (gate ${verdict.passed ? 'passed' : 'failed'}):`
      + ` ${capped.length} candidate(s), ${uncertain} marked uncertain`,
    )
  }
}

/** 写入一条候选（global scope、source 'auto'、provenance 折算 sourceRefs）。 */
async function saveCandidate(memory: MemoryService, session: Session, candidate: ExtractionCandidate): Promise<void> {
  await memory.save({
    text: candidate.text,
    scope: 'global',
    tags: candidate.keywords,
    source: 'auto',
    kind: candidate.kind,
    topic: candidate.topic,
    entities: candidate.entities,
    confidence: candidate.confidence,
    ...(candidate.fact === undefined ? {} : { fact: candidate.fact }),
    sourceRefs: [{ sessionId: session.id, eventSeqs: candidate.sourceSeqs }],
  })
}

/**
 * 装配 memory-consolidate：session/disposed 上的会话结束巩固。
 * @param ctx - 插件上下文。
 * @param config - 门控/提取/退役阈值（缺省值见 schema）。
 * @param extractor - 提取器（缺省 HeuristicExtractor；LLM 提取器的挂载点）。
 */
export function apply(ctx: Context, config: Config, extractor: ExperienceExtractor = new HeuristicExtractor()): void {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) return
  ctx.on('session/disposed', (session) => {
    // 子代理会话（reader 等）的一次性工作缺省不巩固（Config 可开）。
    if (!resolved.consolidateChildSessions && session.header.parentSession !== undefined) return
    // 巩固失败绝不阻断会话拆除：异步捕获、log-only。
    void consolidateSession(ctx, session, extractor, resolved).catch((error: unknown) => {
      ctx.logger.warn(`memory-consolidate: session "${session.id}" consolidation failed: ${String(error)}`)
    })
  })
}
