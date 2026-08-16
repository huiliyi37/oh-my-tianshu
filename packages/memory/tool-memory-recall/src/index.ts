/**
 * tool-memory-recall — memory_deep_recall：reader 子代理的原始历史召回（阶段三 mode C）。
 *
 * 设计契约：Agent Note
 * `.agents/notes/proposed/feature/2026-08-16-adaptive-memory-cache-contract.md`
 * 的 Retrieval 一节——原始历史只由 reader 子代理阅读，返回固定蒸馏形状
 * （answer / evidence[]（sessionId + eventSeqs + 短引用）/ uncertainties /
 * confidence），原文转录字节永不进入主上下文。
 *
 * 机制：
 * - 模型以一个问题调用 memory_deep_recall；工具经 ctx.subagents 启动一个
 *   进程内一次性 reader 子代理（静态 persona + outputSchema + 只读
 *   toolFilter + maxDepth 1），reader 用 session-query 的只读搜索工具
 *   （session_search 等）检索历史转录，经结构化输出返回蒸馏结果。
 * - 能力按执行时探测：sessionQuery 服务、reader 搜索工具、subagents 服务与
 *   provider 能力任一缺失 → 以平实的模型可见错误报告不可用（fail loud，
 *   不静默退化）。工具 schema 与指引为静态字符串（前缀缓存纪律）。
 * - 蒸馏结果按 Config 预算钳制（answer 字符数、evidence 条数、quote 字符数），
 *   超界截断——返回主上下文的体积恒有界。
 *
 * @module @huiliyi37/dsh-tool-memory-recall
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { defineTool } from '@huiliyi37/dsh-tools'
import type { ObjectJsonSchema } from '@huiliyi37/dsh-tools'
import type { ContentBlock } from '@huiliyi37/dsh-llm'
// Type-only: resolve the optional services probed at execution time
// (ctx.get pattern; both are absent in compositions that do not mount them).
import type {} from '@huiliyi37/dsh-session-query'
import type {} from '@huiliyi37/dsh-subagent'
import type { SubagentResult } from '@huiliyi37/dsh-subagent'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-memory-recall'

/** 本插件依赖的工具注册表与 system prompt 服务（sessionQuery/subagents 执行时探测）。 */
export const inject = ['tools', 'systemPrompt']

/** reader 子代理的静态 persona（子代理自身前缀缓存友好；逐字节稳定）。 */
const READER_PERSONA = [
  'You are a read-only session-history reader. Answer the question by searching prior session transcripts',
  'with the provided read-only search tools: session_search across sessions, session_event_search within',
  'one session, and session_event_read for the exact events behind a hit. Issue several searches to',
  'triangulate when the first hits are thin. Report only what the transcripts show — never guess. Return',
  'the structured result: answer (concise), evidence (each item with the sessionId, the supporting event',
  'seq numbers, and a short verbatim quote), uncertainties (what the transcripts do not establish), and',
  'confidence (0..1). You have no write tools; do not modify anything.',
].join(' ')

/** reader 结构化输出的 schema（固定蒸馏形状；assertObjectJsonSchema 子集）。 */
const RECALL_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'evidence', 'uncertainties', 'confidence'],
  properties: {
    answer: { type: 'string' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sessionId', 'eventSeqs', 'quote'],
        properties: {
          sessionId: { type: 'string' },
          eventSeqs: { type: 'array', items: { type: 'number' } },
          quote: { type: 'string' },
        },
      },
    },
    uncertainties: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
  },
}

/** 静态指引文本（agent 开局看到 deep-recall 能力；逐字节稳定——前缀缓存安全）。 */
const RECALL_GUIDANCE = [
  '深度召回（memory_deep_recall）：需要回答"以前某个会话里具体发生了什么"类问题时使用。',
  '- 它派出只读 reader 子代理检索历史会话转录，只返回蒸馏答案（答案 + 证据引用 + 不确定点 + 置信度）',
  '- 原始转录不会进入本会话上下文；已知条目id/关键词的精确查找仍优先用 memory_search',
].join('\n')

/** 插件配置：reader 规模与返回预算，缺省值在 schema 上。 */
export interface Config {
  /** reader 使用的 ctx.subagents provider 名（缺省 'spawn'，进程内一次性）。 */
  provider?: string
  /** reader 可用的只读搜索工具（缺省 session_query 三件套；缺失即报告不可用）。 */
  readerTools?: string[]
  /** 返回主上下文的 answer 字符上限（缺省 2000；超出截断）。 */
  maxAnswerChars?: number
  /** 返回的 evidence 条数上限（缺省 5；uncertainties 同受此数限制）。 */
  maxEvidence?: number
  /** 单条 evidence quote 的字符上限（缺省 240；超出截断）。 */
  maxQuoteChars?: number
  /** reader 子代理的最大委托深度（缺省 1：reader 位于深度 1，不得再委托）。 */
  maxDepth?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  provider: z.string().default('spawn'),
  // Inline literal: the config catalog walks this schema statically.
  readerTools: z.array(z.string()).default(['session_search', 'session_event_search', 'session_event_read']),
  maxAnswerChars: z.number().default(2000),
  maxEvidence: z.number().default(5),
  maxQuoteChars: z.number().default(240),
  maxDepth: z.number().default(1),
})

/** 解析后的预算（schema 缺省 + 直接 apply 调用的回落，与 tool-memory 同例）。 */
export interface RecallBudgets {
  provider: string
  readerTools: string[]
  maxAnswerChars: number
  maxEvidence: number
  maxQuoteChars: number
  maxDepth: number
}

/** 配置解析（单一缺省来源：schema 缺省与回落值保持一致）。 */
function resolveConfig(config: Config): RecallBudgets {
  return {
    provider: config.provider ?? 'spawn',
    readerTools: config.readerTools ?? ['session_search', 'session_event_search', 'session_event_read'],
    maxAnswerChars: config.maxAnswerChars ?? 2000,
    maxEvidence: config.maxEvidence ?? 5,
    maxQuoteChars: config.maxQuoteChars ?? 240,
    maxDepth: config.maxDepth ?? 1,
  }
}

/** 一条蒸馏证据（sessionId + 事件 seqs + 短引用）。 */
export interface RecallEvidence {
  /** 证据所在会话 id。 */
  sessionId: string
  /** 支撑事件 seq。 */
  eventSeqs: number[]
  /** 原文短引用（按 maxQuoteChars 截断）。 */
  quote: string
}

/** memory_deep_recall 的返回值（固定蒸馏形状，预算钳制后）。 */
export interface RecallResult {
  /** 蒸馏答案（按 maxAnswerChars 截断）。 */
  answer: string
  /** 证据清单（按 maxEvidence 截断）。 */
  evidence: RecallEvidence[]
  /** 转录未能确立的不确定点。 */
  uncertainties: string[]
  /** 置信度 0..1。 */
  confidence: number
}

/** 截断（按字符；截断加省略号）。 */
function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`
}

/**
 * 校验并钳制 reader 的结构化输出（模型产出的 JSON——真实边界，必须运行时
 * 校验；钳制保证返回主上下文的体积恒有界）。
 * @param value - reader 返回的结构化值。
 * @param config - 解析后的预算。
 * @returns 校验钳制后的蒸馏结果。
 */
export function distillRecallResult(value: unknown, config: RecallBudgets): RecallResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('memory_deep_recall: reader returned no structured result object')
  }
  const record = value as Record<string, unknown>
  if (typeof record.answer !== 'string'
    || !Array.isArray(record.evidence)
    || !Array.isArray(record.uncertainties)
    || typeof record.confidence !== 'number'
    || !Number.isFinite(record.confidence)) {
    throw new Error('memory_deep_recall: reader structured result is missing answer/evidence/uncertainties/confidence')
  }
  const evidence: RecallEvidence[] = []
  for (const item of record.evidence.slice(0, config.maxEvidence)) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const entry = item as Record<string, unknown>
    if (typeof entry.sessionId !== 'string' || typeof entry.quote !== 'string') continue
    const seqs = Array.isArray(entry.eventSeqs)
      ? entry.eventSeqs.filter((seq): seq is number => typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0)
      : []
    evidence.push({ sessionId: entry.sessionId, eventSeqs: seqs, quote: truncate(entry.quote, config.maxQuoteChars) })
  }
  const uncertainties = record.uncertainties
    .filter((item): item is string => typeof item === 'string')
    .slice(0, config.maxEvidence)
    .map(item => truncate(item, config.maxQuoteChars))
  return {
    answer: truncate(record.answer, config.maxAnswerChars),
    evidence,
    uncertainties,
    confidence: Math.min(1, Math.max(0, record.confidence)),
  }
}

/** 收集并释放一个前台 reader run（结果通道拥有 run 故障；dispose 总是执行）。 */
async function settleReaderRun(run: { result: Promise<SubagentResult>; dispose(): Promise<void> }): Promise<SubagentResult> {
  const [execution] = await Promise.allSettled([run.result])
  const [disposal] = await Promise.allSettled([run.dispose()])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `memory_deep_recall: reader run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/**
 * 注册 memory_deep_recall 工具 + system prompt 静态指引。
 * @param ctx - 插件上下文（注入 tools/systemPrompt；sessionQuery/subagents 执行时探测）。
 * @param config - provider 名、reader 工具集与返回预算。
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.systemPrompt.section({
    name: 'tool:memory-recall',
    order: 131,
    text: RECALL_GUIDANCE,
  })

  ctx.tools.register(defineTool({
    name: 'memory_deep_recall',
    description:
      '深度召回：回答关于历史会话具体经过的问题（"上次为什么改用 X"、"某错误当时怎么解决的"）。'
      + '派出只读 reader 子代理检索历史会话转录，返回蒸馏答案（answer + evidence + uncertainties + confidence）；'
      + '原始转录不进入本会话上下文。',
    parameters: {
      question: { type: 'string', required: true, description: '要问历史的问题（具体、自成一体）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          answer: { type: 'string', required: true },
          evidence: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sessionId: { type: 'string', required: true },
                eventSeqs: { type: 'array', required: true, items: { type: 'number' } },
                quote: { type: 'string', required: true },
              },
            },
          },
          uncertainties: { type: 'array', required: true, items: { type: 'string' } },
          confidence: { type: 'number', required: true },
        },
      },
      render: (_args, value: RecallResult) => {
        const blocks: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: value.answer }]
        for (const item of value.evidence) {
          blocks.push({ type: 'text', text: `- [${item.sessionId}#${item.eventSeqs.join(',')}] ${item.quote}` })
        }
        for (const item of value.uncertainties) {
          blocks.push({ type: 'text', text: `（不确定）${item}` })
        }
        blocks.push({ type: 'text', text: `置信度 ${value.confidence.toFixed(2)}` })
        return blocks
      },
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error('memory_deep_recall 需要调用方 agent（exec.agent 为 undefined）')
      }
      // 能力探测：任一缺失即平实报告不可用（模型可见，fail loud）。
      if (ctx.get('sessionQuery') === undefined) {
        throw new Error('memory_deep_recall 不可用：未装配 session-query 能力（sessionQuery 服务缺失）')
      }
      const subagents = ctx.get('subagents')
      if (subagents === undefined) {
        throw new Error('memory_deep_recall 不可用：未装配 subagents 服务')
      }
      const missingTools = resolved.readerTools.filter(tool => ctx.tools.get(tool) === undefined)
      if (missingTools.length > 0) {
        throw new Error(
          `memory_deep_recall 不可用：reader 只读搜索工具未注册（${missingTools.join(', ')}；`
          + '装配 @huiliyi37/dsh-tool-session-query）',
        )
      }
      const provider = subagents.getProvider(resolved.provider)
      if (provider === undefined) {
        throw new Error(`memory_deep_recall 不可用：subagent provider "${resolved.provider}" 未注册`)
      }
      for (const capability of ['toolFilter', 'outputSchema', 'persona', 'depthLimit'] as const) {
        if (!provider.capabilities[capability]) {
          throw new Error(
            `memory_deep_recall 不可用：provider "${resolved.provider}" 不支持 ${capability} 能力`,
          )
        }
      }
      const prompt: ContentBlock[] = [{ type: 'text', text: args.question }]
      const run = await subagents.start(resolved.provider, {
        label: 'memory recall reader',
        prompt,
        parent,
        signal: exec.signal,
        outputSchema: RECALL_OUTPUT_SCHEMA,
        toolFilter: { allow: [...resolved.readerTools] },
        persona: READER_PERSONA,
        maxDepth: resolved.maxDepth,
      })
      const result = await settleReaderRun(run)
      if (result.stopReason !== 'completed') {
        throw new Error(`memory_deep_recall: reader 子代理未正常结束（${result.stopReason}）`)
      }
      return distillRecallResult(result.structured, resolved)
    },
  }))
}
