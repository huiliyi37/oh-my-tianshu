/**
 * memory-pipeline 的离线 LLM 调用执行体与 phase2 输出解析。
 *
 * invoke 实现与 dsh-memory-consolidate 的插件侧调用同构（ctx.llm 一次有界
 * 流式调用 + BlockAssembler 聚合；缺省关思考；仅对 effort 拒绝重试一次），
 * 但预算字段来自本包 Config，故本地实现而非跨包复用私有函数。
 *
 * @module @huiliyi37/dsh-memory-pipeline/invoke
 */

import { BlockAssembler, createUserMessage, deepFreeze, ReasoningEffortId } from '@huiliyi37/dsh-llm'
import type { FinishReason, GenerateOptions, LlmService } from '@huiliyi37/dsh-llm'
import { deadline } from '@huiliyi37/dsh-timeout'
import type { Context } from '@huiliyi37/cordis'

/** 提取辅助调用的超时 reason code（能力自有，与 session-title 同例）。 */
const INVOKE_TIMEOUT_CODE = 'MEMORY_PIPELINE_TIMEOUT'

/** phase2 整合条目的输入形状（list() 视图的最小字段集）。 */
export interface ConsolidationInputEntry {
  /** 稳定 id（模型在 absorbs 中引用）。 */
  id: string
  /** 条目文本。 */
  text: string
  /** 标签。 */
  tags: string[]
}

/** 一组合并计划：canonical 新条目 + 被吸收的旧条目 id 清单。 */
export interface ConsolidationGroup {
  /** 合并后的 canonical 文本。 */
  text: string
  /** canonical 条目标签（并集语义由调用方保证非空）。 */
  tags: string[]
  /** 置信度 0..1（缺省 0.8）。 */
  confidence?: number
  /** 被吸收的输入条目 id（≥1；应用后逐条 delete）。 */
  absorbs: string[]
}

/** phase2 输出契约系统提示（固定文本；逐字节稳定）。 */
export const PHASE2_SYSTEM_PROMPT = [
  'You consolidate a project memory store by merging duplicate entries.',
  'Return ONLY a JSON object (no Markdown fences, no commentary):',
  '{"groups":[{"text":string,"tags":string[],"confidence":number,"absorbs":string[]}]}',
  'Each group merges two or more INPUT entries that state the same fact or experience:',
  '- "text": one self-contained canonical entry covering every absorbed entry (keep specifics).',
  '- "tags": union of the absorbed entries\' tags (deduplicated, same order).',
  '- "confidence": 0..1 (lower when absorbed entries disagree on details).',
  '- "absorbs": the exact ids of the merged input entries.',
  'Never merge entries about different subjects; when nothing overlaps use {"groups":[]}.',
  'Write "text" in the same language as the absorbed entries.',
].join('\n')

/** 内部信号：provider 在 I/O 前拒绝显式 reasoning effort（适配器未声明能力）。 */
class EffortUnsupported extends Error {}

/** invoke 的预算选项（全部来自 Config）。 */
export interface InvokeOptions {
  /** 显式路由对（回填/整合无会话路由可借，必填成对——apply 时已校验）。 */
  provider: string
  /** 显式路由对。 */
  model: string
  /** 输出 token 上限。 */
  maxOutputTokens: number
  /** reasoning effort（缺省 off：机械摘要不烧思考 token）。 */
  effort: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** 端到端超时毫秒数。 */
  timeoutMs: number
}

/**
 * 构造插件侧的 LLM 调用执行体：经 ctx.llm 做一次有界流式调用。llm 服务在
 * 调用时探测（未装配 = 本次调用失败，由调用方按作业语义降级）。
 * @param ctx - 插件上下文（reflect 取 llm 服务）。
 * @param options - 预算选项。
 * @returns 调用执行体（system/user → 模型文本输出）。
 */
export function createLlmInvoke(ctx: Context, options: InvokeOptions): (system: string, user: string) => Promise<string> {
  return async (system: string, user: string): Promise<string> => {
    const llm = ctx.reflect.get('llm', false) as LlmService | undefined
    if (llm === undefined) {
      throw new Error('memory-pipeline: 需要装配 llm 服务（当前未装配）')
    }
    const attempt = async (withEffort: boolean): Promise<string> => {
      using callDeadline = deadline(undefined, options.timeoutMs, INVOKE_TIMEOUT_CODE)
      const generateOptions: GenerateOptions = deepFreeze({
        provider: options.provider,
        model: options.model,
        messages: [createUserMessage({
          content: [{ type: 'text', text: user }],
          source: { kind: 'plugin', plugin: 'dsh-memory-pipeline' },
        })],
        system,
        maxTokens: options.maxOutputTokens,
        ...(withEffort ? { reasoningEffort: ReasoningEffortId(options.effort) } : {}),
        signal: callDeadline.signal,
      })
      const assembler = new BlockAssembler()
      for await (const chunk of llm.stream(generateOptions)) {
        assembler.push(chunk)
      }
      const finish: FinishReason = assembler.finish
      if (finish.kind !== 'stop') {
        if ((finish.kind === 'error' || finish.kind === 'aborted')
          && finish.failure.code === 'UNSUPPORTED_REASONING_EFFORT') {
          throw new EffortUnsupported()
        }
        throw new Error(
          finish.kind === 'error' || finish.kind === 'aborted'
            ? `memory-pipeline: LLM 调用失败（${finish.failure.code}: ${finish.failure.message}）`
            : `memory-pipeline: LLM 调用以 ${finish.kind} 结束`,
        )
      }
      const text = assembler.blocks()
        .flatMap(block => block.type === 'text' ? [block.text] : [])
        .join('')
      if (text.trim() === '') throw new Error('memory-pipeline: LLM 调用未产出文本')
      return text
    }
    try {
      return await attempt(true)
    } catch (error) {
      // 仅匹配 effort 拒绝这一种情况重试（去掉 effort 字段），不是 blanket retry。
      if (error instanceof EffortUnsupported) return await attempt(false)
      throw error
    }
  }
}

/** 剥离容错的 Markdown 围栏（模型偶发包裹时仍可解析）。 */
function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/u)
  return (fenced?.[1] ?? text).trim()
}

/**
 * 解析 phase2 输出为合并计划组。形状不符抛错（调用方记 failed 并保留台账，
 * 不落任何部分写入——先整体解析成功再应用）。
 * @param raw - 模型原始输出文本。
 * @param validIds - 输入条目 id 集合（absorbs 必须是其子集）。
 * @param maxCanonicalChars - canonical 文本字符上限。
 * @returns 校验通过的合并计划组。
 */
export function parseConsolidationGroups(raw: string, validIds: ReadonlySet<string>, maxCanonicalChars: number): ConsolidationGroup[] {
  const parsed: unknown = JSON.parse(stripFences(raw))
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { groups?: unknown }).groups)) {
    throw new Error('memory-pipeline: phase2 输出缺少 groups 数组')
  }
  const groups: ConsolidationGroup[] = []
  const claimed = new Set<string>()
  for (const item of (parsed as { groups: unknown[] }).groups) {
    if (typeof item !== 'object' || item === null) throw new Error('memory-pipeline: phase2 group 形状不符')
    const group = item as Record<string, unknown>
    const text = group.text
    const tags = group.tags
    const absorbs = group.absorbs
    if (typeof text !== 'string' || text.trim() === '' || text.length > maxCanonicalChars) {
      throw new Error(`memory-pipeline: phase2 canonical 文本缺失或超出 ${String(maxCanonicalChars)} 字符上限`)
    }
    if (!Array.isArray(tags) || !tags.every(tag => typeof tag === 'string')) {
      throw new Error('memory-pipeline: phase2 tags 必须是字符串数组')
    }
    if (!Array.isArray(absorbs) || absorbs.length === 0 || !absorbs.every(id => typeof id === 'string')) {
      throw new Error('memory-pipeline: phase2 absorbs 必须是非空字符串数组')
    }
    for (const id of absorbs) {
      if (!validIds.has(id)) throw new Error(`memory-pipeline: phase2 absorbs 引用了未知条目 "${id}"`)
      if (claimed.has(id)) throw new Error(`memory-pipeline: phase2 absorbs 重复引用条目 "${id}"`)
      claimed.add(id)
    }
    const confidence = group.confidence
    groups.push({
      text,
      tags,
      absorbs,
      ...(typeof confidence === 'number' && confidence >= 0 && confidence <= 1 ? { confidence } : {}),
    })
  }
  return groups
}
