/**
 * intent 推导（纯函数）：从会话事件确定性地推导目标锚点、intentKey 与实体。
 *
 * 阶段一启发式（全部确定性、无模型调用；每个旋钮都是插件 Config 字段）：
 * - 目标锚点：首条用户消息；之后的用户消息含目标动词（goalVerbs，拉丁词按
 *   词边界、CJK 按子串匹配）时成为新锚点——普通追问不切换 intent。
 * - intentKey：锚点文本的关键词签名——小写化、按 Unicode 字母/数字切词，
 *   拉丁词长 ≥3、汉字词长 ≥2 才保留，去重后取前 maxIntentTokens 个连字符连接。
 * - 实体：锚点之后的 tool/call 参数里的路径形 token（含 `/` 的段）与
 *   tool/result 的错误码（error.code 字段 + 文本里的 `E[A-Z]{3,}` 形）。
 *
 * @module @huiliyi37/dsh-adaptive-memory/intent
 */

import type { SessionEvent } from '@huiliyi37/dsh-session'

/** 目标锚点：一条被视为新 intent 起点的用户消息。 */
export interface GoalAnchor {
  /** 锚点消息的原文。 */
  text: string
  /** 锚点序号（1 起；intentId 取 `intent-<序号>`，是纯事件日志函数）。 */
  anchorIndex: number
  /** 锚点消息所在的轮次（无 turn/start 前缀时按 1 计）。 */
  turn: number
  /** 锚点消息的事件序号（实体提取的下界，不含锚点之前的事件）。 */
  seq: number
}

/** 路径形 token：至少一段 `/` 分隔（tool/call 参数 JSON 里的子串匹配）。 */
const PATH_RE = /(?:[\w@.+-]+\/)+[\w@.+-]+/g
/** 错误码形 token：ENOENT / ECONNREFUSED 风格。 */
const ERROR_CODE_RE = /\bE[A-Z]{3,}[A-Z0-9]*\b/g
/** 切词：Unicode 字母/数字连续段。 */
const WORD_RE = /[\p{L}\p{N}]+/gu
/** 汉字检测（CJK 词的最小长度更短）。 */
const HAN_RE = /\p{Script=Han}/u

/** 单条用户消息的全部文本块拼接。 */
function userText(data: Extract<SessionEvent, { type: 'user/message' }>['data']): string {
  return data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/** 目标动词匹配：拉丁动词按词边界（小写化后），CJK 动词按子串。 */
function hasGoalVerb(text: string, goalVerbs: readonly string[]): boolean {
  const lower = text.toLowerCase()
  return goalVerbs.some((verb) => {
    if (verb.length === 0) return false
    if (/^[\x20-\x7E]+$/.test(verb)) {
      return new RegExp(`\\b${verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)
    }
    return lower.includes(verb.toLowerCase())
  })
}

/**
 * 从会话事件推导当前目标锚点（纯函数）。
 * @param events - 会话事件日志（按序）。
 * @param goalVerbs - 目标动词表（插件 Config）。
 * @returns 当前锚点；尚无用户消息时为 undefined。
 */
export function findGoalAnchor(events: readonly SessionEvent[], goalVerbs: readonly string[]): GoalAnchor | undefined {
  let anchor: GoalAnchor | undefined
  let turn = 1
  for (const event of events) {
    if (event.type === 'turn/start') {
      turn = event.data.turn
      continue
    }
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    if (anchor === undefined || hasGoalVerb(userText(event.data), goalVerbs)) {
      anchor = {
        text: userText(event.data),
        anchorIndex: (anchor?.anchorIndex ?? 0) + 1,
        turn,
        seq: event.seq,
      }
    }
  }
  return anchor
}

/**
 * 规范化 intentKey：锚点文本的关键词签名（确定性；空签名回落 'general'）。
 * @param text - 锚点消息原文。
 * @param maxTokens - 保留的关键词数上限（插件 Config）。
 * @returns 连字符连接的关键词签名。
 */
export function intentKeyOf(text: string, maxTokens: number): string {
  const tokens: string[] = []
  for (const match of text.toLowerCase().matchAll(WORD_RE)) {
    const token = match[0]
    const keep = HAN_RE.test(token) ? token.length >= 2 : token.length >= 3
    if (keep && !tokens.includes(token)) tokens.push(token)
    if (tokens.length >= maxTokens) break
  }
  return tokens.length === 0 ? 'general' : tokens.join('-')
}

/**
 * 提取实体：锚点之后工具调用/结果里的路径与错误码（首次出现序， capped）。
 * @param events - 会话事件日志（按序）。
 * @param fromSeq - 实体提取下界（锚点事件的 seq；更早的事件忽略）。
 * @param maxEntities - 实体数上限（插件 Config）。
 * @returns 实体清单（去重、按首次出现排序）。
 */
export function extractEntities(events: readonly SessionEvent[], fromSeq: number, maxEntities: number): string[] {
  const entities: string[] = []
  const push = (value: string | undefined): void => {
    if (value === undefined || value.length > 200) return
    if (!entities.includes(value) && entities.length < maxEntities) entities.push(value)
  }
  const pushMatches = (text: string, re: RegExp): void => {
    for (const match of text.matchAll(re)) push(match[0])
  }
  for (const event of events) {
    if (event.seq <= fromSeq) continue
    if (event.type === 'tool/call') {
      pushMatches(event.data.arguments, PATH_RE)
    } else if (event.type === 'tool/result') {
      push(event.data.error?.code)
      // ToolResultMessage.content 是单个 tool-result 块，文本在内层 content 里。
      const [block] = event.data.message.content
      for (const inner of block.content) {
        if (inner.type === 'text') pushMatches(inner.text, ERROR_CODE_RE)
      }
    }
  }
  return entities
}
