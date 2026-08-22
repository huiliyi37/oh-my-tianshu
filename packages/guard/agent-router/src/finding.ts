/**
 * finding.ts — 有界结构化 finding（Phase 3 闭环的父子边界契约）。
 *
 * 两个闭合、带 discriminant（`kind`）的 outputSchema：code_scout 产出侦查
 * finding，verifier 产出带 verdict 的复核结论。seam 的 JSON Schema 子集不含
 * 长度关键词，限界由 {@link boundFinding} 在父边界一次性强制（控制字符折叠、
 * 单行化、截断）——持久值即模型可见值，逐字可重构；形状非法一律视为无
 * finding（错误、取消、预算终态不伪造结论）。
 *
 * @module @huiliyi37/dsh-agent-router/finding
 */

import type { ObjectJsonSchema } from '@huiliyi37/dsh-tools'

/** 侦查 finding（code_scout profile）。 */
export interface ScoutFinding {
  kind: 'scout'
  /** 有界单行摘要（父边界已折叠控制字符并截断）。 */
  summary: string
  /** 有限条有界单行 finding。 */
  findings: string[]
}

/** 复核结论（verifier profile）：额外携带三值裁定。 */
export interface VerifyFinding {
  kind: 'verify'
  summary: string
  findings: string[]
  verdict: 'supported' | 'unsupported' | 'inconclusive'
}

/** 有界 finding 判别联合。 */
export type RouterFinding = ScoutFinding | VerifyFinding

/** 安全限界（不变量而非可调旋钮）。 */
export const FINDING_SUMMARY_MAX_CHARS = 1200
/** 单条 finding 的字符上限。 */
export const FINDING_ITEM_MAX_CHARS = 400
/** findings 数组的条数上限。 */
export const FINDING_ITEMS_MAX = 8

/** verifier 裁定的闭合枚举。 */
const VERDICTS: ReadonlySet<string> = new Set(['supported', 'unsupported', 'inconclusive'])

/** 两个 profile 的闭合 outputSchema（seam 支持子集：type/enum/properties/required/items/additionalProperties）。 */
export const FINDING_SCHEMA_BY_PROFILE: Record<'code_scout' | 'verifier', ObjectJsonSchema> = {
  code_scout: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'summary', 'findings'],
    properties: {
      kind: { type: 'string', enum: ['scout'] },
      summary: { type: 'string' },
      findings: { type: 'array', items: { type: 'string' } },
    },
  },
  verifier: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'summary', 'findings', 'verdict'],
    properties: {
      kind: { type: 'string', enum: ['verify'] },
      summary: { type: 'string' },
      findings: { type: 'array', items: { type: 'string' } },
      verdict: { type: 'string', enum: ['supported', 'unsupported', 'inconclusive'] },
    },
  },
}

/**
 * 父边界的一次性净化：折叠控制字符与换行为单行空格、裁掉首尾空白、按上限
 * 截断（UTF-16 截断后丢弃尾部孤立代理对，不落半个字符）。持久值即渲染值
 * ——synthesis 逐字取用，不再二次加工。
 * @param raw - 子代理产出的原始字符串。
 * @param maxChars - 截断上限（UTF-16 code unit 数）。
 * @returns 净化后的单行有界字符串。
 */
export function boundFindingText(raw: unknown, maxChars: number): string {
  if (typeof raw !== 'string') return ''
  const singleLine = raw.replace(/[\r\n\t\f\v]+/g, ' ')
  // 去除 C0 控制字符（保留空格）；再截断到上限。
  const printable = singleLine.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (printable.length <= maxChars) return printable
  let cut = printable.slice(0, maxChars)
  // 尾字符是高代理（低代理被截掉）时丢弃，避免持久化半个字符。
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1)
  return cut
}

/**
 * 校验并限界一个结构化捕获：形状合法 → 有界 finding；形状非法（缺字段、
 * kind/verdict 不认识）→ undefined（不伪造 finding）。超长字符串截断而非
 * 拒绝——限界是持久化前提，不是质量门槛。
 * @param value - seam 捕获的结构化输出（wire 边界 unknown）。
 * @returns 有界 finding；形状非法为 undefined。
 */
export function boundFinding(value: unknown): RouterFinding | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const summary = boundFindingText(raw.summary, FINDING_SUMMARY_MAX_CHARS)
  if (summary === '') return undefined
  if (!Array.isArray(raw.findings)) return undefined
  const findings = raw.findings
    .slice(0, FINDING_ITEMS_MAX)
    .map(item => boundFindingText(item, FINDING_ITEM_MAX_CHARS))
    .filter(item => item !== '')
  if (raw.kind === 'scout') {
    // 判别卫生：scout 不允许携带 verdict（那是 verify 分支的专属字段）。
    if (raw.verdict !== undefined) return undefined
    return { kind: 'scout', summary, findings }
  }
  if (raw.kind === 'verify' && typeof raw.verdict === 'string' && VERDICTS.has(raw.verdict)) {
    return { kind: 'verify', summary, findings, verdict: raw.verdict as VerifyFinding['verdict'] }
  }
  return undefined
}
