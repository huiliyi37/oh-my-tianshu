/**
 * adaptive-memory — intent 门控的 STM 快照（前缀缓存安全的自适应记忆，阶段一）。
 *
 * 设计契约：Agent Note
 * `.agents/notes/proposed/feature/2026-08-16-adaptive-memory-cache-contract.md`。
 *
 * 机制：
 * - 每个会话维护 intent 状态（{@link IntentState}；纯启发式推导，零额外模型
 *   调用——推导规则见 intent.ts 的模块文档）。
 * - 评估挂 `system-prompt/assemble` 瀑布而非 agent/pre-step：loop 在每个
 *   step 先 assemble（此刻 context 文本即被解析、RuntimeContextProjection
 *   随即决定是否追加快照），pre-step 瀑布在 assemble 之后才派发——挂在
 *   pre-step 的评估永远赶不上当前 step 的快照。assemble 瀑布是投影之前
 *   最早的插件点，评估后直接改写返回的 assembly 里本贡献的文本。
 * - 每轮评估一次门控（按会话记 evaluatedTurn）：intentKey 变化 / 相关
 *   topic 版本变化 / 新实体出现 / N 轮未刷新，四者其一才重渲染 STM；否则
 *   保持缓存文本逐字节不变。决策记 log-only 会话事件（memory/cache-hit、
 *   memory/cache-miss、memory/stm-selected——不进模型可见面）。
 * - STM 经 `ctx.systemPrompt.context()`（append-on-change 通道）注入，不经
 *   systemPrompt.section()：内容变化时 RuntimeContextProjection 在会话尾部
 *   追加新快照而不是改写前缀；逐字节相同的重渲染不产生任何追加。
 * - 已知滞后：当前轮的用户消息在 assemble 前被 inbox claim、尚未落入会话
 *   日志，所以新目标消息驱动的 intent 切换在下一轮才被评估看到（一轮滞后，
 *   见 README Known Limitations）。
 * - memory 服务经 `ctx.reflect.get('memory', false)` 动态获取；装配本插件
 *   而未装配 dsh-memory 属配置错误，首次评估即 fail loud。
 * - 能力探测（阶段二b）：服务暴露 `topicVersions()` 即走结构化路径——
 *   BM25 search 检索 + 置信度门（high 注入正文 / medium 注入索引行 / low
 *   不注入）+ 按 topic 版本号的失效门控（retrieve.ts/gate.ts）；否则保持
 *   阶段一 fallback（list 全量 + 关键词子串筛选 + relevanceSignature，全部
 *   索引行）。能力按调用探测，绝不假设 provider。
 * - 规则兜底提醒（阶段二b）：观察 tools/result——工具调用触及 STM 索引外
 *   的实体/路径、或结果出现未覆盖的错误码时，置一条 memory:reminder
 *   context 贡献文本（同一 append-on-change 通道的尾部提醒；绝非 system
 *   prompt 编辑），量受每轮/每 intent 预算限制（remind.ts）。
 *
 * @module @huiliyi37/dsh-adaptive-memory
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import type { Agent } from '@huiliyi37/dsh-agent'
import type {} from '@huiliyi37/dsh-system-prompt'
import type { MemoryService } from '@huiliyi37/dsh-memory'
import type { Session } from '@huiliyi37/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@huiliyi37/dsh-tools'
import { extractEntities, findGoalAnchor, intentKeyOf } from './intent.ts'
import { relevanceSignature, renderSTM, selectCandidates, topicVersionsOf } from './render.ts'
import { asStructuredMemory, selectStructured } from './retrieve.ts'
import { consumeReminderBudget, detectReminder, emptyReminderBudget, renderReminder } from './remind.ts'
import type { ReminderBudget } from './remind.ts'
import type { IntentState, StmCandidate, StmRefreshReason } from './types.ts'

export type { IntentState, StmCandidate, StmRefreshReason } from './types.ts'
export { findGoalAnchor, intentKeyOf, extractEntities } from './intent.ts'
export { estimateTokens, relevanceSignature, renderLine, renderSTM, selectCandidates, topicVersionsOf } from './render.ts'
export type { RenderOptions, SelectOptions, StmSignals } from './render.ts'
export { tierOfScore } from './gate.ts'
export type { GateThresholds, StmTier } from './gate.ts'
export { asStructuredMemory, selectStructured } from './retrieve.ts'
export type { StructuredMemoryService, StructuredOptions, StructuredQuery, StructuredSelection } from './retrieve.ts'
export { consumeReminderBudget, detectReminder, emptyReminderBudget, renderReminder } from './remind.ts'
export type { ReminderBudget, ReminderInput, ReminderTrigger } from './remind.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'adaptive-memory'

/** 本插件依赖 system prompt 服务（context 贡献 + assemble 瀑布）。 */
export const inject = ['systemPrompt']

/** memory 服务键（与 dsh-memory 的 MEMORY_KEY 对齐；经 reflect 动态获取）。 */
const MEMORY_KEY = 'memory'

/** STM 贡献在 dynamic-context 快照中的名字（snapshot sections 的归属标识）。 */
export const STM_CONTEXT_NAME = 'memory:stm'

/** 兜底提醒贡献在 dynamic-context 快照中的名字（尾部提醒；append-only）。 */
export const REMINDER_CONTEXT_NAME = 'memory:reminder'

/** 插件配置：全部预算/阈值经 schemastery 校验，缺省值在 schema 上。 */
export interface Config {
  /** 整份 STM 快照的估算 token 预算（缺省 600；汉字按 1 token、其余按 1/4 估算）。 */
  stmTokenBudget?: number
  /** STM 候选数上限（缺省 12）。 */
  maxEntries?: number
  /** intentKey 保留的关键词数上限（缺省 6）。 */
  maxIntentTokens?: number
  /** 实体提取数上限（缺省 24）。 */
  maxEntities?: number
  /** pressure 阀门：距上次刷新满 N 轮强制重评估（缺省 8）。 */
  reviewIntervalTurns?: number
  /** 目标动词表：含动词的用户消息成为新 intent 锚点（拉丁词按词边界、CJK 按子串匹配）。 */
  goalVerbs?: string[]
  /** 始终入选 STM 候选的 tag（安全/用户约束类条目；缺省 ['safety', 'constraint', 'preference']）。 */
  alwaysIncludeTags?: string[]
  /** 每行摘要的字符数上限（缺省 120）。 */
  summaryMaxChars?: number
  /** 每条目的关键词数上限（缺省 5）。 */
  maxKeywords?: number
  /**
   * 置信度门高阈值（缺省 0.82，占位待调参）：结构化 provider 的归一化
   * score ≥ 此值时条目全文注入 STM；只在 provider 产出 score 时生效。
   */
  confidenceHigh?: number
  /** 置信度门中阈值（缺省 0.55，占位待调参）：score ≥ 此值注入索引行；低于此不注入。 */
  confidenceMedium?: number
  /** 结构化路径每次 search/list 的候选拉取上限（缺省 24）。 */
  retrievalLimit?: number
  /** 兜底提醒每轮上限（缺省 1）。 */
  maxRemindersPerTurn?: number
  /** 兜底提醒每 intent 上限（缺省 3）。 */
  maxRemindersPerIntent?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  stmTokenBudget: z.number().default(600),
  maxEntries: z.number().default(12),
  maxIntentTokens: z.number().default(6),
  maxEntities: z.number().default(24),
  reviewIntervalTurns: z.number().default(8),
  // Inline literal: the config catalog walks this schema statically.
  goalVerbs: z.array(z.string()).default([
    'fix', 'implement', 'add', 'create', 'refactor', 'debug', 'investigate',
    'migrate', 'remove', 'update', 'write', 'build',
    '修复', '实现', '排查', '重构', '新增',
  ]),
  alwaysIncludeTags: z.array(z.string()).default(['safety', 'constraint', 'preference']),
  summaryMaxChars: z.number().default(120),
  maxKeywords: z.number().default(5),
  confidenceHigh: z.number().default(0.82),
  confidenceMedium: z.number().default(0.55),
  retrievalLimit: z.number().default(24),
  maxRemindersPerTurn: z.number().default(1),
  maxRemindersPerIntent: z.number().default(3),
})

/** 一个会话的 STM 缓存：门控比较的基准 + 同步渲染源。 */
interface SessionStm {
  /** 上次刷新后的 intent 状态。 */
  intent: IntentState
  /** 上次渲染的 STM 文本（'' = 无贡献；hit 期间逐字节保持）。 */
  text: string
  /** 上次刷新的候选项门控签名。 */
  signature: string
  /** 上次刷新时的实体快照（new-entity 阀门的比较基准）。 */
  entitySnapshot: string[]
  /** 最近一次完成评估的轮次（每轮评估一次，不论 hit/miss）。 */
  evaluatedTurn: number
}

/** 解析后的配置（schema 缺省 + 直接 apply 调用的 `??` 回落，与 tool-memory 同例）。 */
interface ResolvedConfig {
  stmTokenBudget: number
  maxEntries: number
  maxIntentTokens: number
  maxEntities: number
  reviewIntervalTurns: number
  goalVerbs: string[]
  alwaysIncludeTags: string[]
  summaryMaxChars: number
  maxKeywords: number
  confidenceHigh: number
  confidenceMedium: number
  retrievalLimit: number
  maxRemindersPerTurn: number
  maxRemindersPerIntent: number
}

/** 配置解析（单一缺省来源：schema 缺省与回落值保持一致；阈值倒挂 fail loud）。 */
function resolveConfig(config: Config): ResolvedConfig {
  const resolved = {
    stmTokenBudget: config.stmTokenBudget ?? 600,
    maxEntries: config.maxEntries ?? 12,
    maxIntentTokens: config.maxIntentTokens ?? 6,
    maxEntities: config.maxEntities ?? 24,
    reviewIntervalTurns: config.reviewIntervalTurns ?? 8,
    goalVerbs: config.goalVerbs ?? [
      'fix', 'implement', 'add', 'create', 'refactor', 'debug', 'investigate',
      'migrate', 'remove', 'update', 'write', 'build',
      '修复', '实现', '排查', '重构', '新增',
    ],
    alwaysIncludeTags: config.alwaysIncludeTags ?? ['safety', 'constraint', 'preference'],
    summaryMaxChars: config.summaryMaxChars ?? 120,
    maxKeywords: config.maxKeywords ?? 5,
    confidenceHigh: config.confidenceHigh ?? 0.82,
    confidenceMedium: config.confidenceMedium ?? 0.55,
    retrievalLimit: config.retrievalLimit ?? 24,
    maxRemindersPerTurn: config.maxRemindersPerTurn ?? 1,
    maxRemindersPerIntent: config.maxRemindersPerIntent ?? 3,
  }
  if (resolved.confidenceHigh < resolved.confidenceMedium) {
    throw new Error(
      `adaptive-memory: confidenceHigh (${resolved.confidenceHigh}) 不得低于 confidenceMedium (${resolved.confidenceMedium})`,
    )
  }
  return resolved
}

/** 取 memory 服务（未装配 = 配置错误，fail loud）。 */
function requireMemory(ctx: Context): MemoryService {
  const memory = ctx.reflect.get(MEMORY_KEY, false) as MemoryService | undefined
  if (memory === undefined) {
    throw new Error('adaptive-memory: memory 服务不可用（装配 adaptive-memory 需同时装配 @huiliyi37/dsh-memory）')
  }
  return memory
}

/** 会话当前轮次（最后一个 turn/start；无事件时按 1 计）。 */
function currentTurn(session: Session): number {
  for (const event of [...session.events].reverse()) {
    if (event.type === 'turn/start') return event.data.turn
  }
  return 1
}

/** 门控判定：返回刷新原因；保持（cache-hit）时返回 undefined。 */
function refreshReason(
  prev: SessionStm | undefined,
  intentKey: string,
  signature: string,
  entities: string[],
  turn: number,
  config: ResolvedConfig,
): StmRefreshReason | undefined {
  if (prev === undefined) return 'initial'
  if (prev.intent.intentKey !== intentKey) return 'intent-change'
  if (prev.signature !== signature) return 'topic-version'
  if (entities.some(entity => !prev.entitySnapshot.includes(entity))) return 'new-entity'
  if (turn - prev.intent.lastReviewedTurn >= config.reviewIntervalTurns) return 'pressure-turns'
  return undefined
}

/**
 * 每轮一次的 STM 评估：推导 intent、检索候选、按门控决定刷新或保持，并把
 * 决策记入 log-only 会话事件。每轮只评估一次（按 evaluatedTurn 去重）。
 * 能力探测：服务暴露 topicVersions 走结构化检索 + 版本门控，否则走阶段一
 * fallback（关键词筛选 + relevanceSignature）。intent 切换时清掉旧 intent
 * 挂起的兜底提醒。
 * @param ctx - 插件上下文（reflect 取 memory 服务）。
 * @param agent - 本次 assembly 的 agent（会话与事件日志的属主）。
 * @param states - 会话 STM 缓存表。
 * @param reminders - 会话提醒预算表（intent 切换的清理点）。
 * @param config - 解析后的配置。
 */
async function reviewStm(
  ctx: Context,
  agent: Agent,
  states: WeakMap<Session, SessionStm>,
  reminders: WeakMap<Session, ReminderBudget>,
  config: ResolvedConfig,
): Promise<void> {
  const session = agent.session
  const turn = currentTurn(session)
  const prev = states.get(session)
  if (prev !== undefined && prev.evaluatedTurn >= turn) return
  const anchor = findGoalAnchor(session.events, config.goalVerbs)
  if (anchor === undefined) return // 尚无用户目标（当前轮消息尚未落日志）：不评估、不记事件
  const memory = requireMemory(ctx)

  const intentKey = intentKeyOf(anchor.text, config.maxIntentTokens)
  const entities = extractEntities(session.events, anchor.seq, config.maxEntities)
  const structured = asStructuredMemory(memory)
  let candidates: StmCandidate[]
  let signature: string
  let topicVersions: Record<string, string>
  if (structured !== undefined) {
    const selection = await selectStructured(structured, {
      query: anchor.text,
      entities,
      sessionScope: `session:${session.id}`,
    }, {
      alwaysIncludeTags: config.alwaysIncludeTags,
      maxKeywords: config.maxKeywords,
      summaryMaxChars: config.summaryMaxChars,
      thresholds: { high: config.confidenceHigh, medium: config.confidenceMedium },
      retrievalLimit: config.retrievalLimit,
    })
    candidates = selection.candidates
    signature = selection.signature
    topicVersions = selection.topicVersions
  } else {
    const entries = [
      ...await memory.list({ scope: 'global' }),
      ...await memory.list({ scope: `session:${session.id}` }),
    ]
    candidates = selectCandidates(entries, {
      intentTokens: intentKey === 'general' ? [] : intentKey.split('-'),
      entities,
    }, config)
    signature = relevanceSignature(candidates)
    topicVersions = topicVersionsOf(candidates)
  }

  const reason = refreshReason(prev, intentKey, signature, entities, turn, config)
  const intentId = `intent-${anchor.anchorIndex}`
  const budget = reminders.get(session)
  if (budget !== undefined && budget.intentId !== '' && budget.intentId !== intentId) {
    // intent 切换：旧 intent 的挂起提醒不带入新 intent（预算计数同时复位）。
    budget.intentId = intentId
    budget.intentCount = 0
    budget.text = ''
  }
  if (reason === undefined) {
    if (prev !== undefined) prev.evaluatedTurn = turn
    session.append('memory/cache-hit', { intentId, intentKey, turn })
    return
  }

  const intent: IntentState = {
    intentId,
    intentKey,
    startedAtTurn: anchor.turn,
    lastReviewedTurn: turn,
    entities,
    topicVersions,
  }
  states.set(session, {
    intent,
    text: renderSTM(candidates, { tokenBudget: config.stmTokenBudget, maxEntries: config.maxEntries }),
    signature,
    entitySnapshot: entities,
    evaluatedTurn: turn,
  })
  session.append('memory/cache-miss', { intentId, intentKey, turn, reason })
  session.append('memory/stm-selected', { intentId, intentKey, turn, entryIds: candidates.map(c => c.id) })
}

/**
 * 装配 adaptive-memory：注册 STM context 贡献 + assemble 瀑布上的每轮评估。
 * @param ctx - 插件上下文（注入 systemPrompt）。
 * @param config - 预算与阈值（缺省值见 schema）。
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  // 会话 STM 缓存为 apply 实例局部（多 ctx/并行测试互不串扰；context text
  // 是同步签名，只能读缓存——检索与渲染在 assemble 瀑布的异步评估里完成，
  // 评估后由瀑布监听器把新文本写进返回的 assembly）。
  const states = new WeakMap<Session, SessionStm>()
  // 会话提醒预算同为 apply 实例局部；tools/result 观察写入，assemble 时读出。
  const reminders = new WeakMap<Session, ReminderBudget>()

  ctx.systemPrompt.context({
    name: STM_CONTEXT_NAME,
    order: 120,
    text: (context) => {
      const session = context.agent?.session
      return session === undefined ? '' : states.get(session)?.text ?? ''
    },
  })

  ctx.systemPrompt.context({
    name: REMINDER_CONTEXT_NAME,
    order: 130,
    text: (context) => {
      const session = context.agent?.session
      return session === undefined ? '' : reminders.get(session)?.text ?? ''
    },
  })

  // 规则兜底提醒：观察冻结的最终工具结果（contained observation），命中
  // 启发式且预算允许时挂起一条提醒文本——经 memory:reminder 贡献在下一次
  // assemble 追加进快照（append-only，不编辑 system prompt），决策记
  // log-only 的 memory/reminder 事件。
  ctx.on('tools/result', (exec: ToolExecution, result: ToolExecutionResult) => {
    const agent = exec.agent
    if (agent === undefined) return
    const session = agent.session
    const trigger = detectReminder({
      toolName: exec.name,
      argumentsJson: JSON.stringify(exec.arguments),
      isError: result.isError,
      errorCode: result.isError ? result.error.info?.code : undefined,
      resultText: result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'),
    }, states.get(session)?.text ?? '')
    if (trigger === undefined) return
    const turn = currentTurn(session)
    const intentId = states.get(session)?.intent.intentId ?? 'pre-intent'
    const budget = reminders.get(session) ?? emptyReminderBudget()
    reminders.set(session, budget)
    if (!consumeReminderBudget(budget, turn, intentId, resolved.maxRemindersPerTurn, resolved.maxRemindersPerIntent)) {
      return
    }
    budget.text = renderReminder(trigger)
    session.append('memory/reminder', { intentId, turn, kind: trigger.kind, subject: trigger.subject })
  })

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next()
    const agent = context.agent
    if (agent === undefined) return result
    await reviewStm(ctx, agent, states, reminders, resolved)
    // 文本提供者在瀑布之前就已解析（读到的是旧缓存）；评估后把最新文本写回
    // 返回的 assembly——瀑布返回值是权威 assembly。空文本的 contribution 在
    // 渲染时被过滤（renderContextSections），写 '' 即等于撤回。
    const text = states.get(agent.session)?.text ?? ''
    const entry = result.contexts.find(item => item.name === STM_CONTEXT_NAME)
    if (entry !== undefined) entry.text = text
    else if (text !== '') result.contexts.push({ name: STM_CONTEXT_NAME, text })
    const reminderText = reminders.get(agent.session)?.text ?? ''
    const reminderEntry = result.contexts.find(item => item.name === REMINDER_CONTEXT_NAME)
    if (reminderEntry !== undefined) reminderEntry.text = reminderText
    else if (reminderText !== '') result.contexts.push({ name: REMINDER_CONTEXT_NAME, text: reminderText })
    return result
  })
}
