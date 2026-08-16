/**
 * memory-consolidate 的 LLM 提取器（阶段三b）：一次性结构化调用产出
 * 会话摘要 + 模型质量的事实/经验候选 + 可选的做法（procedure）条目。
 *
 * 设计契约（Agent Note
 * `.agents/notes/proposed/feature/2026-08-16-adaptive-memory-cache-contract.md`
 * 的阶段三b）：
 * - 缺省仍是 HeuristicExtractor（零额外模型请求是契约点）；LLM 提取器经插件
 *   Config `extractor: 'llm'` 开启，或作为 apply 第三参数直接注入。
 * - 调用形态：会话结束后一次有界请求（不在请求路径上）——输入是
 *   {@link renderTranscript} 产出的有界转写（Config 上限），输出是固定 JSON
 *   形状，在边界处校验（model/JSON 边界是仓库约定的校验点）。
 * - 产出三类候选：session-summary（observation，回答"之前大概做了什么"）、
 *   fact/experience 候选（同启发式的落库形状）、procedure（experience，做法
 *   沉淀：名称 + 适用时机 + 有序步骤；带来源的建议，不是自动执行的 playbook）。
 * - 失败（无路由、无 llm 服务、超时、输出校验失败）由 {@link FallbackExtractor}
 *   回退到启发式提取，插件记录 log-only 提示——绝不阻断会话拆除。
 *
 * @module @huiliyi37/dsh-memory-consolidate/extract-llm
 */

import type { SessionEvent } from '@huiliyi37/dsh-session'
import type {
  ExperienceExtractor,
  ExtractionCandidate,
  ExtractionInput,
} from './extract.ts'
import { formatProcedure, truncate } from './extract.ts'

/** 一次提取调用的模型路由（provider + model 成对）。 */
export interface LlmRoute {
  /** 提供方路由名。 */
  provider: string
  /** 模型 id。 */
  model: string
}

/** 一次提取调用的输入（system/user 已装配，route 已解析）。 */
export interface LlmInvokeRequest {
  /** 系统提示（固定输出契约）。 */
  system: string
  /** 用户提示（有界转写 + 输出指令）。 */
  user: string
  /** 模型路由（显式配置对，否则取会话最后一条 assistant 消息的来源路由）。 */
  route: LlmRoute
}

/**
 * 提取调用的执行体（插件侧用 ctx.llm 实现；测试侧注入脚本化实现——本类
 * 不直接依赖 cordis Context，保持可无 key 单测）。
 */
export type LlmInvoke = (request: LlmInvokeRequest) => Promise<string>

/** LlmExtractor 的构造选项（全部来自插件 Config + invoke 注入）。 */
export interface LlmExtractorOptions {
  /** 提取调用执行体。 */
  invoke: LlmInvoke
  /** 转写字符上限（超出截断；Config llmMaxInputChars）。 */
  maxInputChars: number
  /** 会话摘要字符上限（Config maxSummaryChars）。 */
  maxSummaryChars: number
  /** 显式路由对（与 model 成对；缺省从会话日志推导）。 */
  provider?: string
  /** 显式路由对（与 provider 成对；缺省从会话日志推导）。 */
  model?: string
  /** 是否接受/产出 procedure 条目（Config proceduresEnabled）。 */
  proceduresEnabled: boolean
}

/** 转写单行长度上限（协议常量：单行截断，总量由 maxInputChars 控制）。 */
const LINE_MAX_CHARS = 400

/** 输出契约系统提示（固定文本；逐字节稳定）。 */
const SYSTEM_PROMPT = [
  'You extract durable memory from a finished coding-assistant session transcript.',
  'Return ONLY a JSON object (no Markdown fences, no commentary) with these keys:',
  '- "summary": 3-6 sentences — what the task was, what was done, the outcome, and the key files.',
  '- "candidates": durable cross-session facts/experiences as an array of',
  '  {"kind":"fact"|"observation"|"experience","topic":string,"text":string,"keywords":string[],',
  '   "entities":string[],"confidence":0..1,"fact":{"subject":string,"predicate":string,"value":string}?,',
  '   "sourceSeqs":number[]?}. Include only non-obvious, reusable knowledge; use [] when none.',
  '- "procedure": null, or {"name":string,"when":string,"steps":string[]} when the session',
  '  demonstrated a reusable method (ordered steps, imperative mood).',
  'Cite transcript lines by their [seq N] prefixes in sourceSeqs. Use the transcript\'s language.',
].join('\n')

/** 单条会话事件 → 转写行（带 [seq N] 前缀供模型引用；不可转写的事件返回 undefined）。 */
function transcriptLine(event: SessionEvent): string | undefined {
  let line: string | undefined
  if (event.type === 'user/message') {
    const text = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    line = text === '' ? undefined : `user: ${text}`
  } else if (event.type === 'assistant/message') {
    const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    line = text === '' ? undefined : `assistant: ${text}`
  } else if (event.type === 'tool/call') {
    line = `tool ${event.data.name}: ${event.data.arguments}`
  } else if (event.type === 'tool/result') {
    const [block] = event.data.message.content
    const text = block.content.flatMap(inner => inner.type === 'text' ? [inner.text] : []).join('\n')
    line = event.data.error === undefined
      ? `tool result: ${text}`
      : `tool result: error ${event.data.error.code}${text === '' ? '' : ` — ${text}`}`
  }
  if (line === undefined) return undefined
  const collapsed = line.replace(/\s+/g, ' ').trim()
  return `[seq ${event.seq}] ${truncate(collapsed, LINE_MAX_CHARS)}`
}

/**
 * 会话事件日志 → 有界转写（user/assistant/tool 行，带 [seq N] 前缀；总量超
 * 过 maxChars 时截断并追加省略标记）。确定性纯函数。
 * @param events - 会话事件日志。
 * @param maxChars - 转写字符上限。
 * @returns 转写文本（无可转写内容时为 ''）。
 */
export function renderTranscript(events: readonly SessionEvent[], maxChars: number): string {
  let text = ''
  for (const event of events) {
    const line = transcriptLine(event)
    if (line === undefined) continue
    const next = text === '' ? line : `${text}\n${line}`
    if (next.length > maxChars) return `${text}\n… (transcript truncated at ${maxChars} chars)`
    text = next
  }
  return text
}

/** 解析模型路由：显式配置对优先，否则取会话最后一条 assistant 消息的来源路由。 */
function resolveRoute(events: readonly SessionEvent[], options: LlmExtractorOptions): LlmRoute {
  if (options.provider !== undefined && options.model !== undefined) {
    return { provider: options.provider, model: options.model }
  }
  for (const event of [...events].reverse()) {
    if (event.type === 'assistant/message') {
      const source = event.data.message.source
      return { provider: source.provider, model: source.model }
    }
  }
  throw new Error('memory-consolidate: LLM 提取无可用路由（配置 provider/model 对，或会话需有 assistant 消息）')
}

/** 校验为字符串数组（非数组/含非字符串 → undefined，调用方按丢弃处理）。 */
function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every(item => typeof item === 'string')) return undefined
  return value
}

/** 校验 sourceSeqs：正整数且都存在于日志 seq 集；非法时回退为整段跨度。 */
function sourceSeqsOf(value: unknown, seqs: ReadonlySet<number>, span: number[]): number[] {
  if (!Array.isArray(value)) return span
  const items: unknown[] = value
  const valid = items.filter((item): item is number =>
    typeof item === 'number' && Number.isInteger(item) && item > 0 && seqs.has(item))
  return valid.length === 0 ? span : [...new Set(valid)].sort((a, b) => a - b)
}

/**
 * 模型输出 → 提取候选（边界校验点）。整体 JSON 非法或缺 summary 即抛错（由
 * FallbackExtractor 回退启发式）；单条候选非法只丢弃该条。
 * @param raw - 模型原始输出文本（允许 ```json 围栏）。
 * @param input - 提取输入（seq 校验与跨度回退用）。
 * @param options - 提取器选项（summary 上限与 procedure 开关）。
 * @returns 候选清单（summary 在前，模型候选居中，procedure 殿后）。
 */
export function parseExtractionOutput(
  raw: string,
  input: ExtractionInput,
  options: Pick<LlmExtractorOptions, 'maxSummaryChars' | 'proceduresEnabled'>,
): ExtractionCandidate[] {
  const text = raw.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`memory-consolidate: LLM 提取输出不是合法 JSON: ${String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('memory-consolidate: LLM 提取输出不是 JSON 对象')
  }
  const output = parsed as Record<string, unknown>
  if (typeof output.summary !== 'string' || output.summary.trim() === '') {
    throw new Error('memory-consolidate: LLM 提取输出缺少非空 summary 字段')
  }
  const seqs = new Set(input.events.map(event => event.seq))
  const span = input.events.length === 0
    ? []
    : [input.events[0]?.seq ?? 0, input.events[input.events.length - 1]?.seq ?? 0]
  const candidates: ExtractionCandidate[] = [{
    kind: 'observation',
    topic: 'session-summary',
    text: truncate(output.summary.trim(), options.maxSummaryChars),
    keywords: ['session-summary'],
    entities: [],
    confidence: 0.9,
    sourceSeqs: span,
  }]
  if (Array.isArray(output.candidates)) {
    for (const item of output.candidates) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
      const candidate = item as Record<string, unknown>
      const kind = candidate.kind
      if ((kind !== 'observation' && kind !== 'experience' && kind !== 'fact')
        || typeof candidate.topic !== 'string' || candidate.topic.trim() === ''
        || typeof candidate.text !== 'string' || candidate.text.trim() === '') continue
      const factValue = candidate.fact
      const fact = typeof factValue === 'object' && factValue !== null && !Array.isArray(factValue)
        && typeof (factValue as Record<string, unknown>).subject === 'string'
        && typeof (factValue as Record<string, unknown>).predicate === 'string'
        && typeof (factValue as Record<string, unknown>).value === 'string'
        ? factValue as { subject: string; predicate: string; value: string }
        : undefined
      const confidence = typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence)
        ? Math.min(1, Math.max(0, candidate.confidence))
        : 0.7
      // tags[0] 是消费侧（STM 签名、topicBoosts）的 topic 代理：topic 置首对齐。
      const topic = candidate.topic.trim()
      const keywords = stringArray(candidate.keywords) ?? []
      candidates.push({
        kind,
        topic,
        text: truncate(candidate.text.trim(), input.bounds.maxTextChars),
        keywords: keywords.includes(topic) ? keywords : [topic, ...keywords],
        entities: (stringArray(candidate.entities) ?? []).slice(0, input.bounds.maxEntities),
        confidence,
        ...(fact === undefined ? {} : { fact }),
        sourceSeqs: sourceSeqsOf(candidate.sourceSeqs, seqs, span),
      })
    }
  }
  const procedure = output.procedure
  if (options.proceduresEnabled && typeof procedure === 'object' && procedure !== null && !Array.isArray(procedure)) {
    const value = procedure as Record<string, unknown>
    const steps = stringArray(value.steps)?.filter(step => step.trim() !== '')
    if (typeof value.name === 'string' && value.name.trim() !== ''
      && typeof value.when === 'string' && value.when.trim() !== ''
      && steps !== undefined && steps.length > 0) {
      candidates.push({
        kind: 'experience',
        topic: 'procedure',
        text: truncate(formatProcedure(value.name.trim(), value.when.trim(), steps), input.bounds.maxTextChars),
        keywords: ['procedure'],
        entities: [],
        confidence: 0.75,
        sourceSeqs: span,
      })
    }
  }
  return candidates
}

/**
 * LLM 提取器：有界转写 → 一次性结构化调用 → 边界校验后的候选。零重试——
 * 失败由 FallbackExtractor 回退启发式（巩固是 fire-and-forget，重试只会
 * 放大成本）。
 */
export class LlmExtractor implements ExperienceExtractor {
  private readonly options: LlmExtractorOptions

  /**
   * @param options - invoke 注入 + 输入/输出上限 + 可选显式路由对。
   */
  constructor(options: LlmExtractorOptions) {
    this.options = options
  }

  /**
   * 提取：无可转写内容时空调用（不发请求）；路由不可解析或输出非法时抛错。
   * @param input - 会话 id、事件日志与边界。
   * @returns 校验后的候选清单。
   */
  async extract(input: ExtractionInput): Promise<ExtractionCandidate[]> {
    const transcript = renderTranscript(input.events, this.options.maxInputChars)
    if (transcript === '') return []
    const route = resolveRoute(input.events, this.options)
    const raw = await this.options.invoke({
      system: SYSTEM_PROMPT,
      user: `Extract durable memory from this session transcript:\n\n${transcript}`,
      route,
    })
    return parseExtractionOutput(raw, input, this.options)
  }
}

/**
 * 回退提取器：主提取器（LLM）失败时记一次 log-only 提示后用回退提取器
 * （启发式）完成本次提取——巩固绝不因模型调用失败而丢失候选。
 */
export class FallbackExtractor implements ExperienceExtractor {
  /**
   * @param primary - 主提取器（LLM）。
   * @param fallback - 回退提取器（启发式）。
   * @param onFallback - 回退发生时的 log-only 通知（插件侧接 ctx.logger.warn）。
   */
  constructor(
    private readonly primary: ExperienceExtractor,
    private readonly fallback: ExperienceExtractor,
    private readonly onFallback: (error: unknown) => void,
  ) {}

  /**
   * 先试主提取器；任何失败（路由、调用、校验）都回退并通知一次。
   * @param input - 会话 id、事件日志与边界。
   * @returns 主提取器候选，或失败时回退提取器候选。
   */
  async extract(input: ExtractionInput): Promise<ExtractionCandidate[]> {
    try {
      return await this.primary.extract(input)
    } catch (error) {
      this.onFallback(error)
      return this.fallback.extract(input)
    }
  }
}
