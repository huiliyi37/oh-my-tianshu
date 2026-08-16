/**
 * metrics 一行条（format/glance-bar.ts）— 纯渲染。
 *
 * segment 组装：model / effort / 缓存% / 上下文% / ◧ tokens / #turn / $cost / elapsed / 停滞。
 * 窄宽 drop 尾部次要段；极窄截断 model 段；任何宽度下不破版。
 */
import { color } from '../engine/ansi.js'
import type { LiveRegionLine } from '../engine/live-engine.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'
import { formatElapsedHuman } from './spinner-status.js'

/**
 * token 计数紧凑显示：<1000 原样；<1M 用 `k`（非整时留 1 位小数）；否则 `M` 留 2 位。
 * @param n - token 数。
 * @returns 紧凑计数文本。
 */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const v = n / 1000
    return Number.isInteger(v) ? `${v}k` : `${v.toFixed(1)}k`
  }
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** glance bar 的渲染输入；各段均可选，缺省段不渲染。 */
export interface FormatGlanceBarInput {
  width?: number
  modelName?: string
  /** 推理努力度（request/header 的 config.reasoningEffort；渲染为 ◎max 形态，窄宽时随 model 后 drop）。 */
  effort?: string
  cacheHitRate?: number
  contextRatio?: number
  tokens?: { used: number; max: number }
  elapsedMs?: number
  density?: 'compact' | 'full'
  turnCount?: number
  cost?: number
  stalled?: boolean
  ascii?: boolean
}

/** 上下文占用警告阈值（≥ 此比例前缀 ⚠ 提示近满；与 Claude Code context 高水位对齐）。 */
export const CONTEXT_WARN_RATIO = 0.95

/**
 * 段组装（纯函数；返回 ANSI 段列表，外层按 ` · ` 拼接）。
 * @param input - metrics 输入；仅组装已提供的段（cost 有值即显示；turn 只在 density full 档）。
 * @returns 无色段文本列表，按固定顺序。
 */
export function glanceBarSegments(input: FormatGlanceBarInput): string[] {
  const segs: string[] = []
  if (input.modelName !== undefined) segs.push(input.modelName)
  if (input.effort !== undefined) segs.push(`◎${input.effort}`)
  if (input.cacheHitRate !== undefined) segs.push(`缓存 ${Math.round(input.cacheHitRate * 100)}%`)
  if (input.contextRatio !== undefined) {
    const warn = input.contextRatio >= CONTEXT_WARN_RATIO
    segs.push(`${warn ? '⚠' : ''}上下文 ${Math.round(input.contextRatio * 100)}%`)
  }
  if (input.tokens !== undefined) {
    const t = `${formatTokenCount(input.tokens.used)}/${formatTokenCount(input.tokens.max)}`
    segs.push(input.ascii ? `[${t}]` : `◧ ${t}`)
  }
  if (input.elapsedMs !== undefined) segs.push(formatElapsedHuman(input.elapsedMs))
  if (input.cost !== undefined) segs.push(`$${input.cost}`)
  if (input.density === 'full' && input.turnCount !== undefined) segs.push(`#${input.turnCount}`)
  if (input.stalled) segs.push('停滞')
  return segs
}

function truncateTo(text: string, columns: number): string {
  let out = ''
  for (const ch of text) {
    if (displayWidth(out + ch) > columns) break
    out += ch
  }
  return out
}

/**
 * 一行条渲染：渐进 drop 次要段，极窄只剩 model 并截断；空 metrics 不占位。
 * @param input - metrics 输入（width ≤ 0 或缺省时不渲染）。
 * @param theme - 当前主题（整行 primary 色）。
 * @returns 单行 live 区内容；无可渲染内容返回空数组。
 */
export function formatGlanceBar(input: FormatGlanceBarInput, theme: RivetTheme): LiveRegionLine[] {
  // width 缺省视为 0 → 不渲染（与 width <= 0 短路同语义；exactOptionalPropertyTypes 下
  // 可选字段不自动窄化，undefined 需显式归一才能参与后续宽度比较）。
  const width = input.width ?? 0
  if (width <= 0) return []
  let current: FormatGlanceBarInput = { ...input, width }
  for (;;) {
    const segs = glanceBarSegments(current)
    if (segs.length === 0) return []
    const text = segs.join(' · ')
    if (displayWidth(text) <= width) {
      return [{ text: color(text, theme.primary) }]
    }
    const next: FormatGlanceBarInput = { ...current }
    if (next.stalled) next.stalled = false
    else if (next.elapsedMs !== undefined) delete next.elapsedMs
    else if (next.cost !== undefined) delete next.cost
    else if (next.turnCount !== undefined) delete next.turnCount
    else if (next.tokens !== undefined) delete next.tokens
    else if (next.contextRatio !== undefined) delete next.contextRatio
    else if (next.cacheHitRate !== undefined) delete next.cacheHitRate
    else if (next.effort !== undefined) delete next.effort
    else {
      // 只剩 model：截断
      /* v8 ignore next -- modelName undefined 时不产生 model 段，删光后 segs 为空提前返回，?? 右分支不可达 */
      const modelOnly = next.modelName ?? ''
      return [{ text: color(truncateTo(modelOnly, width), theme.primary) }]
    }
    current = next
  }
}
