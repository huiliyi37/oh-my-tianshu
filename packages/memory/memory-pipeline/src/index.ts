/**
 * memory-pipeline — 自动记忆管线：启动回填扫描 + 跨会话全局整合。
 *
 * 设计契约：Agent Note
 * `.agents/notes/implemented/feature/2026-08-21-memory-auto-pipeline.md`。
 *
 * 与既有件的分工：
 * - dsh-memory-consolidate 拥有「活会话 disposal 即时抽取」与退役节奏
 *   （retireStale）；本包只做「错过 disposal 的历史会话补抽」与「跨会话
 *   去重整合」，两者经共享台账互不重复（幂等键 = sessionId）。
 * - 抽取器复用 consolidate 导出的实现（ExperienceExtractor 接口 + apply
 *   第三参注入点）；LLM 预算字段命名与 consolidate 对齐。
 *
 * 机制：
 * - 触发：根会话 `agent/session-start`（防抖 startDelayMs；派生会话跳过），
 *   可选 rescanIntervalMs 周期重扫。作业注册到 ctx.tasks（可见可取消）；
 *   tasks 服务缺席时降级为内联后台执行（log-only 提示）。
 * - 回填：SessionPersistence.list() 轻量枚举 → 台账/谱系/工作区过滤 →
 *   inspect() 只读视图 → 成功门 → 抽取 → memory.save(source 'auto')。
 *   单会话至多处理一次；失败退避重试至上限。
 * - 整合：新增候选累计达 phase2MinNewEntries 后，一次有界 LLM 合并调用，
 *   canonical 重写 + 吸收式 delete（只删输入快照内的 id）。
 * - 全部决策 log-only；请求路径零接触。memory 服务缺席在首次作业时
 *   fail loud（装配顺序无关——插件加载先于记忆 provider 不误报）。
 *
 * @module @huiliyi37/dsh-memory-pipeline
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import type { MemoryService } from '@huiliyi37/dsh-memory'
import type { SessionPersistence } from '@huiliyi37/dsh-session-persistence'
import type { TaskService } from '@huiliyi37/dsh-tasks'
import { FallbackExtractor, HeuristicExtractor, LlmExtractor } from '@huiliyi37/dsh-memory-consolidate'
import type { ExperienceExtractor, LlmInvoke } from '@huiliyi37/dsh-memory-consolidate'
import { loadLedger, newWorkerId, saveLedger } from './ledger.ts'
import type { LedgerFile } from './ledger.ts'
import { runBackfillSweep } from './sweep.ts'
import type { SweepReport } from './sweep.ts'
import { runGlobalConsolidation } from './phase2.ts'
import { createLlmInvoke } from './invoke.ts'

declare module '@huiliyi37/dsh-tasks' {
  interface TaskKindMap {
    'memory-pipeline': 'memory-pipeline'
  }
}

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'memory-pipeline'

/** memory 服务键（与 dsh-memory 的 MEMORY_KEY 对齐；经 reflect 动态获取）。 */
const MEMORY_KEY = 'memory'

/** 一小时的毫秒数（minIdleHours 折算用；协议常量）。 */
const HOUR_MS = 3_600_000
/** 一天的毫秒数（maxAgeDays 折算用；协议常量）。 */
const DAY_MS = 86_400_000

/** 提取器选择：'llm'（缺省——回填的价值在模型质量）或 heuristic（零模型调用）。 */
export type ExtractorKind = 'heuristic' | 'llm'

/** 插件配置：全部阈值经 schemastery 校验，缺省值在 schema 上。 */
export interface Config {
  /** 总开关（缺省 false——opt-in，阈值校准前不作为产品默认）。 */
  enabled?: boolean
  /** 根会话启动后到首次扫描的防抖毫秒数（缺省 30000）。 */
  startDelayMs?: number
  /** 周期重扫间隔毫秒数（缺省 0 = 每进程仅首根会话触发一次）。 */
  rescanIntervalMs?: number
  /** 会话最后事件距今的最大年龄天数（超出即终态过期；缺省 14）。 */
  maxAgeDays?: number
  /** 会话最后事件距今的最小闲置小时数（避免抽进行中的会话；缺省 1）。 */
  minIdleHours?: number
  /** 元数据列举上限（缺省 20）。 */
  scanLimit?: number
  /** 单次扫描最多处理的会话数（缺省 3）。 */
  maxClaimedPerSweep?: number
  /** 单会话最大尝试次数（失败退避；缺省 3）。 */
  maxRetriesPerSession?: number
  /** 提取器选择（缺省 'llm'；需成对配置 llmProvider/llmModel）。 */
  extractor?: ExtractorKind
  /** LLM 显式路由对（与 llmModel 成对；回填无会话路由可借，'llm' 时必填）。 */
  llmProvider?: string
  /** LLM 显式路由对（与 llmProvider 成对）。 */
  llmModel?: string
  /** LLM 输入转写字符上限（缺省 20000）。 */
  llmMaxInputChars?: number
  /** LLM 输出 token 上限（缺省 2000）。 */
  llmMaxOutputTokens?: number
  /** reasoning effort（缺省 'off'）。 */
  llmEffort?: string
  /** LLM 端到端超时毫秒数（缺省 30000）。 */
  llmTimeoutMs?: number
  /** 单条候选文本字符上限（缺省 280）。 */
  maxTextChars?: number
  /** 会话摘要条目的字符上限（缺省 600）。 */
  maxSummaryChars?: number
  /** 单条候选实体数上限（缺省 8）。 */
  maxEntities?: number
  /** 是否产出 procedure 条目（缺省 true）。 */
  proceduresEnabled?: boolean
  /** 门控未通过的会话是否记录 failure-pattern 经验（缺省 true）。 */
  recordFailures?: boolean
  /** 单会话写入候选数上限（缺省 8）。 */
  maxCandidatesPerSession?: number
  /** phase2 全局整合开关（缺省 false）。 */
  phase2Enabled?: boolean
  /** 累计新增候选达到该阈值后触发全局整合（缺省 8）。 */
  phase2MinNewEntries?: number
  /** 全局整合输入条目数上限（缺省 40）。 */
  phase2MaxInputEntries?: number
  /** 全局整合输入渲染字符上限（缺省 24000）。 */
  phase2MaxInputChars?: number
  /** 全局整合 canonical 文本字符上限（缺省 600）。 */
  phase2MaxCanonicalChars?: number
  /** 租约时长毫秒数（缺省 600000）。 */
  leaseMs?: number
  /** 台账文件路径（缺省 `<cwd>/.dsh/memory/pipeline/ledger.json`；自定义记忆库根的宿主须对齐）。 */
  ledgerPath?: string
  /** 工作区过滤（缺省当前进程 cwd；仅处理 header.cwd 等于该值的会话）。 */
  workspaceCwd?: string
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  startDelayMs: z.number().default(30_000),
  rescanIntervalMs: z.number().default(0),
  maxAgeDays: z.number().default(14),
  minIdleHours: z.number().default(1),
  scanLimit: z.number().default(20),
  maxClaimedPerSweep: z.number().default(3),
  maxRetriesPerSession: z.number().default(3),
  extractor: z.union(['heuristic', 'llm'] as const).default('llm'),
  llmProvider: z.string(),
  llmModel: z.string(),
  llmMaxInputChars: z.number().default(20_000),
  llmMaxOutputTokens: z.number().default(2000),
  llmEffort: z.string().default('off'),
  llmTimeoutMs: z.number().default(30_000),
  maxTextChars: z.number().default(280),
  maxSummaryChars: z.number().default(600),
  maxEntities: z.number().default(8),
  proceduresEnabled: z.boolean().default(true),
  recordFailures: z.boolean().default(true),
  maxCandidatesPerSession: z.number().default(8),
  phase2Enabled: z.boolean().default(false),
  phase2MinNewEntries: z.number().default(8),
  phase2MaxInputEntries: z.number().default(40),
  phase2MaxInputChars: z.number().default(24_000),
  phase2MaxCanonicalChars: z.number().default(600),
  leaseMs: z.number().default(600_000),
  ledgerPath: z.string(),
  workspaceCwd: z.string(),
})

/** 解析后的配置（schema 缺省 + 直接 apply 调用的 `??` 回落保持一致）。 */
interface ResolvedConfig {
  enabled: boolean
  startDelayMs: number
  rescanIntervalMs: number
  maxAgeMs: number
  minIdleMs: number
  scanLimit: number
  maxClaimedPerSweep: number
  maxRetriesPerSession: number
  extractor: ExtractorKind
  llmProvider?: string
  llmModel?: string
  llmMaxInputChars: number
  llmMaxOutputTokens: number
  llmEffort: string
  llmTimeoutMs: number
  maxTextChars: number
  maxSummaryChars: number
  maxEntities: number
  proceduresEnabled: boolean
  recordFailures: boolean
  maxCandidatesPerSession: number
  phase2Enabled: boolean
  phase2MinNewEntries: number
  phase2MaxInputEntries: number
  phase2MaxInputChars: number
  phase2MaxCanonicalChars: number
  leaseMs: number
  ledgerPath: string
  workspaceCwd: string
}

/**
 * 配置解析与校验（加载时 fail loud）：路由半对、倒置时间窗、非正上限、
 * 'llm' 缺路由对都在 apply 时抛错。
 */
function resolveConfig(config: Config): ResolvedConfig {
  const hasProvider = config.llmProvider !== undefined
  const hasModel = config.llmModel !== undefined
  if (hasProvider !== hasModel) {
    throw new Error('memory-pipeline: llmProvider 与 llmModel 必须成对配置')
  }
  const resolved: ResolvedConfig = {
    enabled: config.enabled ?? false,
    startDelayMs: config.startDelayMs ?? 30_000,
    rescanIntervalMs: config.rescanIntervalMs ?? 0,
    maxAgeMs: (config.maxAgeDays ?? 14) * DAY_MS,
    minIdleMs: (config.minIdleHours ?? 1) * HOUR_MS,
    scanLimit: config.scanLimit ?? 20,
    maxClaimedPerSweep: config.maxClaimedPerSweep ?? 3,
    maxRetriesPerSession: config.maxRetriesPerSession ?? 3,
    extractor: config.extractor ?? 'llm',
    ...(hasProvider ? { llmProvider: config.llmProvider, llmModel: config.llmModel } : {}),
    llmMaxInputChars: config.llmMaxInputChars ?? 20_000,
    llmMaxOutputTokens: config.llmMaxOutputTokens ?? 2000,
    llmEffort: config.llmEffort ?? 'off',
    llmTimeoutMs: config.llmTimeoutMs ?? 30_000,
    maxTextChars: config.maxTextChars ?? 280,
    maxSummaryChars: config.maxSummaryChars ?? 600,
    maxEntities: config.maxEntities ?? 8,
    proceduresEnabled: config.proceduresEnabled ?? true,
    recordFailures: config.recordFailures ?? true,
    maxCandidatesPerSession: config.maxCandidatesPerSession ?? 8,
    phase2Enabled: config.phase2Enabled ?? false,
    phase2MinNewEntries: config.phase2MinNewEntries ?? 8,
    phase2MaxInputEntries: config.phase2MaxInputEntries ?? 40,
    phase2MaxInputChars: config.phase2MaxInputChars ?? 24_000,
    phase2MaxCanonicalChars: config.phase2MaxCanonicalChars ?? 600,
    leaseMs: config.leaseMs ?? 600_000,
    ledgerPath: config.ledgerPath ?? `${process.cwd()}/.dsh/memory/pipeline/ledger.json`,
    workspaceCwd: config.workspaceCwd ?? process.cwd(),
  }
  if (resolved.minIdleMs > resolved.maxAgeMs) {
    throw new Error('memory-pipeline: minIdleHours 不得超过 maxAgeDays（闲置窗必须落在年龄窗内）')
  }
  for (const [field, value] of [
    ['startDelayMs', resolved.startDelayMs],
    ['rescanIntervalMs', resolved.rescanIntervalMs],
    ['scanLimit', resolved.scanLimit],
    ['maxClaimedPerSweep', resolved.maxClaimedPerSweep],
    ['maxRetriesPerSession', resolved.maxRetriesPerSession],
    ['maxCandidatesPerSession', resolved.maxCandidatesPerSession],
    ['phase2MinNewEntries', resolved.phase2MinNewEntries],
    ['phase2MaxInputEntries', resolved.phase2MaxInputEntries],
    ['phase2MaxCanonicalChars', resolved.phase2MaxCanonicalChars],
    ['leaseMs', resolved.leaseMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`memory-pipeline: ${field} 必须是非负安全整数`)
    }
  }
  // 路由对完整性始终校验（半对 = 畸形输入）；'llm' 需要路由对的完整校验只在
  // 启用态生效——缺省 enabled:false 时缺省 extractor 'llm' 不应迫使每个宿主
  // 都配置路由（opt-in 契约点，Agent Note 有记）。
  if (resolved.enabled && resolved.extractor === 'llm' && !hasProvider) {
    throw new Error('memory-pipeline: extractor "llm" 需要成对配置 llmProvider/llmModel（回填无会话路由可借）')
  }
  return resolved
}

/** 按配置解析有效提取器（显式注入优先；'llm' 装配回退启发式的组合）。 */
function resolveExtractor(
  config: ResolvedConfig,
  injector: LlmInvoke | undefined,
  onFallback: (error: unknown) => void,
  extractor: ExperienceExtractor | undefined,
): ExperienceExtractor {
  if (extractor !== undefined) return extractor
  if (config.extractor === 'heuristic') return new HeuristicExtractor()
  const invoke: LlmInvoke = injector ?? (() => Promise.reject(new Error('memory-pipeline: LLM invoke 未初始化')))
  return new FallbackExtractor(
    new LlmExtractor({
      invoke,
      maxInputChars: config.llmMaxInputChars,
      maxSummaryChars: config.maxSummaryChars,
      ...(config.llmProvider === undefined ? {} : { provider: config.llmProvider, model: config.llmModel }),
      proceduresEnabled: config.proceduresEnabled,
    }),
    new HeuristicExtractor(),
    onFallback,
  )
}

/**
 * 装配 memory-pipeline：触发监听 + 作业调度。enabled=false 时完全不挂
 * 监听（opt-in 契约点）。
 * @param ctx - 插件上下文。
 * @param config - 管线配置（缺省值见 schema；enabled 缺省 false）。
 * @param hooks - 测试注入点：invoke（脚本化 LLM）与 extractor（脚本化抽取器）。
 */
export function apply(ctx: Context, config: Config, hooks?: { invoke?: LlmInvoke; extractor?: ExperienceExtractor }): void {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) return
  const workerId = newWorkerId()
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let rescanTimer: ReturnType<typeof setTimeout> | undefined
  let loadedLedger: LedgerFile | undefined

  ctx.effect(() => () => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    if (rescanTimer !== undefined) clearTimeout(rescanTimer)
  }, 'memory-pipeline: timers')

  /**
   * 执行一个管线作业：tasks 服务在场则注册为可见可取消的后台任务，缺席
   * 则降级为内联后台执行（log-only）。done 绝不 reject（运行时约定）。
   */
  const runJob = (label: string, job: (signal: AbortSignal) => Promise<string>): void => {
    const abort = new AbortController()
    const done = job(abort.signal)
      .then(summary => ({ status: 'completed' as const, detail: summary }))
      .catch((error: unknown) => ({ status: 'failed' as const, detail: String(error).slice(0, 300) }))
    const tasks = ctx.reflect.get('tasks', false) as TaskService | undefined
    if (tasks === undefined) {
      ctx.logger.warn(`memory-pipeline: tasks 服务未装配，${label} 内联执行（不可取消）`)
      void done.then((outcome) => { ctx.logger.info(`memory-pipeline: ${label} — ${outcome.detail}`) })
      return
    }
    tasks.start({
      kind: 'memory-pipeline',
      label,
      outputLimitBytes: 4096,
      run: () => ({
        cancel: (reason?: string) => { abort.abort(reason ?? 'cancelled') },
        done,
      }),
    })
  }

  const persistLedger = async (): Promise<void> => {
    if (loadedLedger !== undefined) await saveLedger(resolved.ledgerPath, loadedLedger)
  }

  const sweepOnce = async (signal: AbortSignal): Promise<string> => {
    const persistence = ctx.reflect.get('sessionPersistence', false) as SessionPersistence | undefined
    if (persistence === undefined) throw new Error('memory-pipeline: sessionPersistence 服务不可用（回填扫描需要持久会话存储）')
    const memory = ctx.reflect.get(MEMORY_KEY, false) as MemoryService | undefined
    if (memory === undefined) throw new Error(`memory-pipeline: ${MEMORY_KEY} 服务不可用（装配 memory-pipeline 需同时装配 memory provider）`)
    loadedLedger = await loadLedger(resolved.ledgerPath)
    const report: SweepReport = await runBackfillSweep({
      persistence,
      memory,
      extractor: resolveExtractor(
        resolved,
        hooks?.invoke,
        (error: unknown) => { ctx.logger.warn(`memory-pipeline: LLM 提取失败，回退启发式提取：${String(error)}`) },
        hooks?.extractor,
      ),
      ledger: loadedLedger,
      options: {
        maxTextChars: resolved.maxTextChars,
        maxEntities: resolved.maxEntities,
        proceduresEnabled: resolved.proceduresEnabled,
        recordFailures: resolved.recordFailures,
        maxCandidatesPerSession: resolved.maxCandidatesPerSession,
        scanLimit: resolved.scanLimit,
        minIdleMs: resolved.minIdleMs,
        maxAgeMs: resolved.maxAgeMs,
        maxRetriesPerSession: resolved.maxRetriesPerSession,
        workspaceCwd: resolved.workspaceCwd,
        leaseMs: resolved.leaseMs,
      },
      now: Date.now,
      log: ctx.logger,
      signal,
    }, workerId)
    await persistLedger()
    if (resolved.phase2Enabled && report.savedCandidates >= resolved.phase2MinNewEntries && !signal.aborted) {
      runJob('memory-pipeline: global consolidation', phase2Signal => consolidateOnce(phase2Signal))
    }
    return `listed=${String(report.listed)} extracted=${String(report.extractedSessions)} saved=${String(report.savedCandidates)} idle=${String(report.skippedIdle)} expired=${String(report.skippedExpired)} failed=${String(report.failed)}`
  }

  const consolidateOnce = async (signal: AbortSignal): Promise<string> => {
    const memory = ctx.reflect.get(MEMORY_KEY, false) as MemoryService | undefined
    if (memory === undefined) throw new Error(`memory-pipeline: ${MEMORY_KEY} 服务不可用（装配 memory-pipeline 需同时装配 memory provider）`)
    if (resolved.llmProvider === undefined || resolved.llmModel === undefined) {
      throw new Error('memory-pipeline: phase2 需要成对配置 llmProvider/llmModel')
    }
    loadedLedger = await loadLedger(resolved.ledgerPath)
    const applied = await runGlobalConsolidation({
      memory,
      ledger: loadedLedger,
      options: {
        maxInputEntries: resolved.phase2MaxInputEntries,
        maxInputChars: resolved.phase2MaxInputChars,
        maxCanonicalChars: resolved.phase2MaxCanonicalChars,
        leaseMs: resolved.leaseMs,
      },
      invoke: createLlmInvoke(ctx, {
        provider: resolved.llmProvider,
        model: resolved.llmModel,
        maxOutputTokens: resolved.llmMaxOutputTokens,
        effort: resolved.llmEffort,
        timeoutMs: resolved.llmTimeoutMs,
      }),
      now: Date.now,
      log: ctx.logger,
      signal,
    }, workerId)
    await persistLedger()
    return `groups=${String(applied)}`
  }

  const scheduleSweep = (): void => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      runJob('memory-pipeline: backfill sweep', sweepOnce)
    }, resolved.startDelayMs)
  }

  ctx.on('agent/session-start', ({ agent }) => {
    // 派生会话（fork / 子代理）跳过：与 memory-consolidate 的谱系判定一致。
    if (agent.session.header.parentSession !== undefined) return
    scheduleSweep()
    if (resolved.rescanIntervalMs > 0 && rescanTimer === undefined) {
      const chain = (): void => {
        rescanTimer = setTimeout(() => {
          runJob('memory-pipeline: backfill sweep (periodic)', sweepOnce)
          chain()
        }, resolved.rescanIntervalMs)
      }
      chain()
    }
  })
}
