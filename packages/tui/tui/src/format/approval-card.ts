/**
 * 审批卡（format/approval-card.ts）— 纯渲染。
 *
 * 形态对齐输入轨：上下圆角横线、左右不封。标题嵌在顶轨，diff 体在中间，
 * 底行是 y/n/a/esc 键位。小窗口 compact 只保留提示行（diff 仍由
 * formatPermissionDiff 产出，调用方决定是否传入）。
 */
import { color } from '../engine/ansi.js'
import { boxCharsFor } from '../box-chars.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth, truncateToDisplayWidth } from '../width.js'

/** 审批卡键位行（与 handleKey 的 y/n/a/esc 对齐）。 */
export const APPROVAL_KEY_HINTS = '[y] 允许  [n] 拒绝  [a] 本会话放行  [esc] 取消'

/** formatApprovalCard 的渲染输入。 */
export interface FormatApprovalCardInput {
  /** 终端列数（轨线外宽 = columns）。 */
  columns: number
  /** 待审批工具名。 */
  toolName: string
  /** 审批原因（展示在提示行）。 */
  reason?: string
  /** formatPermissionDiff 产出；null/缺省 = 盲批提示。 */
  diffLines?: readonly string[] | null
  /** 紧凑：不渲染 diff 体，只保留提示 + 键位。 */
  compact?: boolean
}

/**
 * 圆角轨包裹一块 live 内容（审批卡 / 提问卡共用）。
 * @param columns - 外宽。
 * @param title - 顶轨内嵌标题（纯文本）。
 * @param body - 已着色的内容行。
 * @param borderColor - 轨线颜色。
 * @returns 顶轨 + body + 底轨；columns < 4 时仅 body。
 */
export function formatRailsBlock(
  columns: number,
  title: string,
  body: readonly string[],
  borderColor: string,
): string[] {
  if (columns < 4) {
    const cap = Math.max(1, columns)
    return body.map(line => truncateToDisplayWidth(line, cap))
  }
  const chars = boxCharsFor('thin')
  const inner = Math.max(0, columns - 2)
  const maxLabel = Math.max(1, inner - 3)
  const label = title === '' ? '' : ` ${truncateToDisplayWidth(title, maxLabel)} `
  const fill = Math.max(0, inner - 1 - displayWidth(label))
  const top = color(`${chars.tl}${chars.h}${label}${chars.h.repeat(fill)}${chars.tr}`, borderColor)
  const bottom = color(`${chars.bl}${chars.h.repeat(inner)}${chars.br}`, borderColor)
  const content = body.map(line => truncateToDisplayWidth(line, columns))
  return [top, ...content, bottom]
}

/**
 * 渲染审批卡：顶轨「审批 · 工具名」+ 提示/diff + 键位 + 底轨。
 * @param input - 列数、工具名、可选原因/diff、是否紧凑。
 * @param theme - 当前主题（轨线与提示用 warning）。
 * @returns ANSI 行数组；columns ≤ 0 返回空数组。
 */
export function formatApprovalCard(input: FormatApprovalCardInput, theme: RivetTheme): string[] {
  if (input.columns <= 0) return []
  const why = input.reason === undefined || input.reason === '' ? '' : `（${input.reason}）`
  const diff = input.diffLines
  const hasDiff = diff !== undefined && diff !== null && diff.length > 0
  const blind = hasDiff ? '' : '（diff 不可见）'
  const prompt = color(`⚠ 允许执行 ${input.toolName}？${why}${blind}`, theme.warning)
  const hints = color(APPROVAL_KEY_HINTS, theme.muted)
  const body: string[] = [prompt]
  if (hasDiff && input.compact !== true) {
    for (const line of diff) body.push(line)
  }
  body.push(hints)
  return formatRailsBlock(
    input.columns,
    `审批 · ${input.toolName}`,
    body,
    theme.warning,
  )
}
