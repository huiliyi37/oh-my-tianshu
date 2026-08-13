/**
 * spark 锚点补偿插件（内部能力 · 与 dsh-llm-deepseek 的 wire 截断成对上线）。
 *
 * dsh-llm-deepseek 在 spark route 上把推理回传截断为尾部 N token（丢头部）；
 * 本插件把「截断丢失域」（前 len−N token 段）里的显式排除路径提取为锚点，
 * 随 `agent/pre-step` 注入为 plugin-source user message（form: 'snapshot'），
 * 作为被截断段落的自足替代物——防止模型重复推导已经排除的路径。
 *
 * 关键性质：
 * - **与 wire 截断精确互补**：锚点提取用同一 N 同一 tokenizer（truncateCutStart /
 *   extractExcludedClaims 均来自 dsh-llm-deepseek），N 从 llm-deepseek 的
 *   settings 命名空间读取（同源，无漂移）；无 settings 时回落默认 {flash:300, pro:0}。
 * - **字节稳定**：锚点集合不变 → 与上次注入文本相同 → 跳过（不重复注入），
 *   前缀缓存前提。
 * - **Model-visible ⟺ logged**：注入经 createUserMessage 成为 session 事件
 *   （user/message，source 标记本插件），从日志可重建。
 * - **非 spark 零注入**：route 判定走 request/header 折叠（provider），首个请求前
 *   经 agentDefaultModel 兜底；非 spark route 不注入。
 *
 * @module @huiliyi37/dsh-spark-anchors
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import type { Agent, PreStepDecision } from '@huiliyi37/dsh-agent'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import {
  extractExcludedClaims,
  resolveTruncateN,
  truncateCutStart,
  SPARK_PROVIDER,
} from '@huiliyi37/dsh-llm-deepseek'
import type { SparkTruncatePolicy } from '@huiliyi37/dsh-llm-deepseek'
import { settingsNamespace } from '@huiliyi37/dsh-settings'
import type { SessionEvent } from '@huiliyi37/dsh-session'

/** Cordis plugin name（session 事件的 source.plugin 标记）。 */
export const name = 'spark-anchors'

/** The agent registry that owns pre-step processing. */
export const inject = ['agents']

/** 锚点聚合上限与总开关。 */
export interface Config {
  /** 总开关；false 时不注册监听（缺省 true）。 */
  enabled?: boolean
  /** 去重后锚点条数上限；溢出淘汰最旧（缺省 20）。 */
  maxAnchors?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  maxAnchors: z.number().step(1).min(1).default(20),
})

/** 缺省档位（与 dsh-llm-deepseek 的 spark.truncateN 缺省一致，settings 同源时被覆盖）。 */
const DEFAULT_POLICY: SparkTruncatePolicy = { flash: 300, pro: 0 }
/** llm-deepseek 的 settings 命名空间（N 与 enabled 的唯一事实来源）。 */
const NS = settingsNamespace('llm-deepseek')

/** 从 llm-deepseek settings 命名空间读回的完整 spark 策略（含总开关）。 */
export interface SparkPolicySource {
  /** wire 截断是否启用（llm-deepseek Config.spark.enabled）；false = 不注入锚点。 */
  enabled: boolean
  /** 按模型档的截断 N（flash 300 / pro 0）。 */
  truncateN: SparkTruncatePolicy
}

/**
 * 从会话事件提取 assistant reasoning 文本（按事件序）。
 * @param events - 权威会话事件流。
 * @returns 每条 assistant 消息的完整 reasoning 文本（空文本跳过）。
 */
export function reasoningFromEvents(events: readonly SessionEvent[]): string[] {
  const out: string[] = []
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const text = event.data.message.content
      .filter(block => block.type === 'reasoning')
      .map(block => block.text)
      .join('')
    if (text !== '') out.push(text)
  }
  return out
}

/**
 * 从一条推理文本提取「截断丢失域」的排除路径锚点。
 * 与 wire 截断用同一 N 同一 tokenizer（truncateCutStart）：无截断
 * （N<=0 或 token 不足）→ 无丢失 → 无锚点。提取域 ∪ 保留尾段 = 原始推理。
 * @param reasoning - 单条 assistant reasoning 全文。
 * @param policy - 按模型档的截断 N 策略（与 wire 同源）。
 * @param model - 当前模型 id；未知时用策略默认档。
 * @returns 截断丢失域中的排除路径 claim 列表（无截断时为空）。
 */
export function anchorsFromReasoning(
  reasoning: string,
  policy: SparkTruncatePolicy,
  model: string | undefined,
): string[] {
  const n = resolveTruncateN(model, policy)
  if (n <= 0) return []
  const cut = truncateCutStart(reasoning, n)
  if (cut <= 0) return []
  return extractExcludedClaims(reasoning.slice(0, cut))
}

/**
 * 聚合锚点：按事件序收集 → 去重（保留首现序）→ cap（溢出淘汰最旧，
 * 保留最近 maxAnchors 条）。
 * @param events - 权威会话事件流。
 * @param policy - 按模型档的截断 N 策略（与 wire 同源）。
 * @param model - 当前模型 id；未知时用策略默认档。
 * @param maxAnchors - 锚点上限；溢出时淘汰最旧。
 * @returns 去重后的锚点列表（最多 maxAnchors 条，事件序）。
 */
export function collectAnchors(
  events: readonly SessionEvent[],
  policy: SparkTruncatePolicy,
  model: string | undefined,
  maxAnchors: number,
): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const reasoning of reasoningFromEvents(events)) {
    for (const claim of anchorsFromReasoning(reasoning, policy, model)) {
      if (!seen.has(claim)) {
        seen.add(claim)
        unique.push(claim)
      }
    }
  }
  return unique.slice(-maxAnchors)
}

/**
 * 渲染锚点为模型可见的动态上下文文本。
 * @param anchors - 去重后的锚点列表。
 * @returns 单块可注入文本（标题行 + `- ` 列表）。
 */
export function renderAnchors(anchors: readonly string[]): string {
  return 'Paths already ruled out (spark anchors):\n' + anchors.map(a => `- ${a}`).join('\n')
}

/**
 * 从 llm-deepseek settings 命名空间读完整 spark 策略（enabled + truncateN，
 * 与 wire 截断同源）。无 settings 服务或命名空间未注册时回落
 * `{ enabled: false, truncateN: DEFAULT_POLICY }`——**保守不注入**：
 * 锚点必须与 wire 截断同源门控，判定不了 enabled 就不注入（fail-closed）。
 */
function readSparkPolicy(ctx: Context): SparkPolicySource {
  const settings = ctx.get('settings')
  if (settings === undefined) return { enabled: false, truncateN: DEFAULT_POLICY }
  const section = settings.get(NS) as { spark?: { enabled?: boolean; truncateN?: SparkTruncatePolicy } } | undefined
  if (section?.spark === undefined) return { enabled: false, truncateN: DEFAULT_POLICY }
  return {
    enabled: section.spark.enabled ?? false,
    truncateN: section.spark.truncateN ?? DEFAULT_POLICY,
  }
}

/** 最近一次本插件注入的 user message 文本（会话事件扫描，resume 安全、无内存状态）。 */
function lastInjectedText(agent: Agent): string | undefined {
  for (const event of [...agent.session.events].reverse()) {
    if (event.type !== 'user/message') continue
    const source = event.data.source
    if (source.kind === 'plugin' && source.plugin === name) {
      return event.data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
    }
  }
  return undefined
}

/**
 * 注册 pre-step 锚点注入监听。
 * @param ctx - plugin context; the listener is disposed with it.
 * @param config - total switch and aggregation cap; invalid caps fail plugin load.
 */
export function apply(ctx: Context, config: Config): void {
  const maxAnchors = config.maxAnchors ?? 20
  if (!Number.isSafeInteger(maxAnchors) || maxAnchors <= 0) {
    throw new Error(`spark-anchors: maxAnchors must be a positive integer, got ${String(maxAnchors)}`)
  }
  if (config.enabled === false) return

  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    // route 判定：request/header 折叠（provider）优先；首个请求前（无 header）
    // 经 agentDefaultModel 兜底。非 spark route 零注入。
    const header = agent.session.requestHeader()
    const provider = header?.config.provider
      ?? ctx.get('agentDefaultModel')?.currentSelection().provider
    if (provider !== SPARK_PROVIDER) return decision
    const model = header?.config.model
      ?? ctx.get('agentDefaultModel')?.currentSelection().model
    // enabled 门控与 wire 截断同源（llm-deepseek settings 的 spark.enabled）：
    // wire 不截断时（enabled=false 或缺省），锚点注入会破坏「与截断精确互补」
    // 承诺——模型看到完整推理外加冗余排除句列表，前缀缓存每步变化。因此
    // enabled !== true 一律不注入（fail-closed）。
    const policy = readSparkPolicy(ctx)
    if (policy.enabled !== true) return decision
    const anchors = collectAnchors(agent.session.events, policy.truncateN, model, maxAnchors)
    if (anchors.length === 0) return decision
    const text = renderAnchors(anchors)
    // 字节稳定：锚点集合不变 → 文本相同 → 跳过；变化才注入新快照。
    if (lastInjectedText(agent) === text) return decision
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: {
            kind: 'plugin',
            plugin: name,
            form: 'snapshot',
            sections: [{ name: 'excluded-paths', text }],
          },
        }),
      ],
    }
  }, { prepend: true })
}
