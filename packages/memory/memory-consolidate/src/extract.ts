/**
 * memory-consolidate 的经验提取器接口与缺省确定性启发式实现。
 *
 * 设计契约（Agent Note
 * `.agents/notes/proposed/feature/2026-08-16-adaptive-memory-cache-contract.md`
 * 的阶段三）：提取只在成功门控之后发生；v1 为**确定性启发式、零模型调用**，
 * {@link ExperienceExtractor} 接口即后续 LLM 提取器的挂载点（替换 provider，
 * 插件流程不变）。
 *
 * 启发式清单（全部作用于会话事件日志，产出带来源 seq 的候选）：
 * - R1 显式记忆信号：用户消息含 remember/记住/记下 → observation（topic
 *   explicit）；正文可解析为 `主体 is/= value` 形状时附结构化三元组
 *   （predicate 'stated'），供冲突检测与 supersede。
 * - R2 用户纠正：用户消息以否定/纠正词开头（no/actually/instead/不是/不对…）
 *   → experience（topic correction），sourceSeqs 含前一条 assistant 消息。
 * - R3 错误-解决：某工具的 error 结果后出现同工具成功结果 → experience
 *   （topic error-resolution；实体含工具名与错误码）。
 * - R4 决策陈述：assistant 文本含 decided to/we'll use/决定/采用 等标记 →
 *   observation（topic decision），取含标记的一句。
 * - R5 做法沉淀（保守变体）：显式编码了方法的用户纠正（含 instead/应该/改用
 *   等标记）→ experience（topic procedure），正文为 formatProcedure 的
 *   名称+时机+有序步骤形状；其余会话形状不猜测做法。开关为
 *   ExtractionBounds.proceduresEnabled。
 *
 * @module @huiliyi37/dsh-memory-consolidate/extract
 */

import type { MemoryFactShape, MemoryKind } from '@huiliyi37/dsh-memory'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { unresolvedFailures } from './gate.ts'

/** 提取候选（写入 LTM 前的中间形状；sourceSeqs 在写入时折算为 sourceRefs）。 */
export interface ExtractionCandidate {
  /** 事件种类（observation 或 experience）。 */
  kind: MemoryKind
  /** 主题分区。 */
  topic: string
  /** 候选文本（已按 maxTextChars 截断）。 */
  text: string
  /** 关键词。 */
  keywords: string[]
  /** 实体清单（精确过滤维度）。 */
  entities: string[]
  /** 置信度 0..1（启发式按信号强度赋固定值）。 */
  confidence: number
  /** 结构化三元组（仅 R1 可解析形状产出；供冲突检测/supersede）。 */
  fact?: MemoryFactShape
  /** 来源事件 seq（provenance，写入时配 sessionId 折算 sourceRefs）。 */
  sourceSeqs: number[]
}

/** 提取边界（全部由插件 Config 注入）。 */
export interface ExtractionBounds {
  /** 单条候选文本字符上限。 */
  maxTextChars: number
  /** 单条候选实体数上限。 */
  maxEntities: number
  /** 是否产出 procedure（做法沉淀）条目（两条提取路径共用此开关）。 */
  proceduresEnabled: boolean
}

/** 提取输入：一个已结束会话的完整事件日志。 */
export interface ExtractionInput {
  /** 会话 id（provenance）。 */
  sessionId: string
  /** 完整事件日志（含 seed；只读）。 */
  events: readonly SessionEvent[]
  /** 提取边界。 */
  bounds: ExtractionBounds
}

/**
 * 经验提取器接口：会话日志 → 候选清单。v1 实现为 HeuristicExtractor
 * （确定性、零模型调用）；LLM 提取器可作为后续 provider 实现同一接口，
 * 经插件 apply 的第三参数注入。
 */
export interface ExperienceExtractor {
  /**
   * 从成功门控已通过的会话日志提取候选。
   * @param input - 会话 id、事件日志与边界。
   * @returns 候选清单（顺序即写入顺序）。
   */
  extract(input: ExtractionInput): Promise<ExtractionCandidate[]>
}

/** R1：显式记忆信号（remember this / remember: … / 记住 / 记下）。 */
const REMEMBER_RE = /(?:\bremember\b|记住|记下)\s*(?:this|that)?\s*[:：,，]?\s*/i

/** R1 结构化解析规则（按序首个命中）：`key: value` / `key = value` / `subject is value` / `主体是值`。 */
const STATED_RULES = [
  /^(.{2,60}?)\s*[:：=]\s*(.{2,200})$/,
  /^(.{2,60}?)\s+(?:is|are)\s+(.{2,200})$/i,
  /^(.{2,60}?)是(.{2,200})$/,
]

/** 把显式记忆正文解析为 stated 三元组（不可解析时返回 undefined）。 */
function statedFact(body: string): MemoryFactShape | undefined {
  for (const rule of STATED_RULES) {
    const match = rule.exec(body)
    if (match !== null) {
      return { subject: (match[1] ?? '').trim(), predicate: 'stated', value: (match[2] ?? '').trim() }
    }
  }
  return undefined
}

/** R2：用户纠正（否定/纠正词开头的用户消息）。 */
const CORRECTION_RE = /^(?:no\b|nope\b|wrong\b|actually\b|instead\b|不是|不对|错了|不应该|应该)/i

/** R4：决策陈述标记。 */
const DECISION_RE = /(?:\bdecided to\b|\bwe'll\b|\bwe will\b|\bdecision:\s*|决定|采用|改用)[^\n。！？.!?]*/i

/** R5：编码了做法的用户纠正标记（instead / 应该 / 应当 / 改用——纠正里含可复用方法）。 */
const METHOD_RE = /\binstead\b|应该|应当|改用/i

/**
 * 做法条目的规范文本形状（启发式 R5 与 LLM 提取器共用）：名称 + 适用时机 +
 * 有序步骤。做法是带来源的建议，不是自动执行的 playbook。
 * @param name - 做法名（短句）。
 * @param when - 适用时机。
 * @param steps - 有序步骤。
 * @returns 做法条目正文。
 */
export function formatProcedure(name: string, when: string, steps: readonly string[]): string {
  return `Procedure: ${name}\nWhen: ${when}\nSteps:\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`
}

/** 文本里的实体提取：反引号标识符与文件路径（去重、限量）。 */
function entitiesOf(text: string, maxEntities: number): string[] {
  const entities: string[] = []
  const push = (value: string): void => {
    if (!entities.includes(value) && entities.length < maxEntities) entities.push(value)
  }
  for (const match of text.matchAll(/`([^`\n]{1,80})`/g)) push(match[1] ?? '')
  for (const match of text.matchAll(/[\w./-]+\.[a-zA-Z]{1,8}\b/g)) push(match[0])
  return entities
}

/** 截断到 maxTextChars（按字符；截断加省略号）。 */
export function truncate(text: string, maxTextChars: number): string {
  const trimmed = text.trim()
  return trimmed.length <= maxTextChars ? trimmed : `${trimmed.slice(0, maxTextChars - 1)}…`
}

/** 用户消息文本（text 块拼接）。 */
function userText(event: SessionEvent<'user/message'>): string {
  return event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/** assistant 消息文本（text 块拼接）。 */
function assistantText(event: SessionEvent<'assistant/message'>): string {
  return event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/** 缺省确定性提取器（v1；零模型调用）。 */
export class HeuristicExtractor implements ExperienceExtractor {
  /** 逐条应用 R1–R4，按日志顺序产出候选。 */
  extract(input: ExtractionInput): Promise<ExtractionCandidate[]> {
    const { events, bounds } = input
    const candidates: ExtractionCandidate[] = []
    for (const [index, event] of events.entries()) {
      if (event.type === 'user/message') {
        const text = userText(event)
        if (REMEMBER_RE.test(text)) {
          const body = truncate(text.replace(REMEMBER_RE, ''), bounds.maxTextChars)
          const fact = statedFact(body)
          candidates.push({
            kind: 'observation',
            topic: 'explicit',
            text: body,
            keywords: ['explicit'],
            entities: entitiesOf(body, bounds.maxEntities),
            confidence: 1,
            ...(fact === undefined ? {} : { fact }),
            sourceSeqs: [event.seq],
          })
          continue
        }
        if (CORRECTION_RE.test(text.trim())) {
          const prior = events.slice(0, index).findLast(
            (candidate): candidate is SessionEvent<'assistant/message'> => candidate.type === 'assistant/message',
          )
          const sourceSeqs = prior === undefined ? [event.seq] : [prior.seq, event.seq]
          candidates.push({
            kind: 'experience',
            topic: 'correction',
            text: truncate(text, bounds.maxTextChars),
            keywords: ['correction'],
            entities: entitiesOf(text, bounds.maxEntities),
            confidence: 0.9,
            sourceSeqs,
          })
          // R5 做法沉淀（保守变体）：只有显式编码了方法的纠正才产出 procedure
          // 条目——纠正本身已是用户背书的方法信号；其余会话形状不做猜测。
          if (bounds.proceduresEnabled && METHOD_RE.test(text)) {
            candidates.push({
              kind: 'experience',
              topic: 'procedure',
              text: truncate(formatProcedure(
                'User-corrected method',
                'When the corrected situation recurs (see the source session for context)',
                [text.trim()],
              ), bounds.maxTextChars),
              keywords: ['procedure'],
              entities: entitiesOf(text, bounds.maxEntities),
              confidence: 0.7,
              sourceSeqs,
            })
          }
        }
      } else if (event.type === 'assistant/message') {
        const text = assistantText(event)
        const decision = DECISION_RE.exec(text)
        if (decision !== null) {
          candidates.push({
            kind: 'observation',
            topic: 'decision',
            text: truncate(decision[0], bounds.maxTextChars),
            keywords: ['decision'],
            entities: entitiesOf(decision[0], bounds.maxEntities),
            confidence: 0.7,
            sourceSeqs: [event.seq],
          })
        }
      }
    }
    // R3 错误-解决：与 gate 相同的配对判定，但产出已解决的对（gate 产出未解决的）。
    const names = new Map<string, string>()
    for (const event of events) {
      if (event.type === 'tool/call') names.set(event.data.callId, event.data.name)
    }
    const results = events.filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    for (const [index, event] of results.entries()) {
      if (event.data.error === undefined) continue
      const toolName = names.get(event.data.message.content[0].toolCallId)
      if (toolName === undefined) continue
      const resolution = results.slice(index + 1).find(candidate =>
        candidate.data.error === undefined && names.get(candidate.data.message.content[0].toolCallId) === toolName)
      if (resolution === undefined) continue
      candidates.push({
        kind: 'experience',
        topic: 'error-resolution',
        text: truncate(
          `Tool ${toolName} failed with ${event.data.error.code} and was resolved by a later successful call`,
          bounds.maxTextChars,
        ),
        keywords: ['error-resolution'],
        entities: [toolName, event.data.error.code].slice(0, bounds.maxEntities),
        confidence: 0.8,
        sourceSeqs: [event.seq, resolution.seq],
      })
    }
    return Promise.resolve(candidates)
  }
}

/**
 * 失败会话的候选（门控未通过时调用）：每个未解决失败信号一条 experience
 * （topic failure-pattern，置信度低），绝不混入成功候选——插件在门控通过时
 * 不调用本函数。
 * @param events - 会话事件日志。
 * @param bounds - 提取边界。
 * @returns failure-pattern 候选清单。
 */
export function failureCandidates(events: readonly SessionEvent[], bounds: ExtractionBounds): ExtractionCandidate[] {
  return unresolvedFailures(events).map(failure => ({
    kind: 'experience',
    topic: 'failure-pattern',
    text: truncate(
      failure.subject === 'test-run'
        ? `Session ended with an unresolved test failure (${failure.detail})`
        : `Session ended with unresolved ${failure.subject} failure (${failure.detail})`,
      bounds.maxTextChars,
    ),
    keywords: ['failure-pattern'],
    entities: [failure.subject].slice(0, bounds.maxEntities),
    confidence: 0.6,
    sourceSeqs: [failure.seq],
  }))
}
