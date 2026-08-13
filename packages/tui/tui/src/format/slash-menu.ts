/**
 * slash 命令下拉菜单（format/slash-menu.ts）— 纯渲染（grok slash_dropdown 移植）。
 *
 * 输入以 / 开头且有匹配命令时，在输入行上方渲染可滚动命令列表：
 * - 行形态：选中 `❯ /name [argsHint]`（label 列对齐）+ 描述（剩余宽度截断）；
 *   未选中行前缀为两个空格（与 ❯ 同宽对齐）。
 * - 选中行 label 升 primary + bold（主题无背景槽，用前缀标记替代 bg 高亮）。
 * - 超过 maxRows 滚动窗口（selected 保持可见），末尾追加「↑↓ 还有 N 项」提示。
 * - ascii 降级（❯ → >）。宽度守恒：任何输入下每行显示宽度 ≤ width。
 */
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'

/** 菜单最大可见行数（超出滚动窗口）。 */
export const SLASH_MENU_MAX_ROWS = 8

/** label 列宽硬上限（对齐 grok slash_dropdown 的 LABEL_CAP）。 */
const LABEL_CAP = 40

/** label 列占可用宽度的比例上限（对齐 grok 的 3/5，取 0.5 保描述空间）。 */
const LABEL_BUDGET_RATIO = 0.5

/** 菜单项（结构与 engine/input-controller 的 SlashHintEntry 同形）。 */
export interface SlashMenuItem {
  name: string
  description: string
  /** 可选参数提示（如 `<name>`）；有值时并入 label 列。 */
  argsHint?: string
}

/** formatSlashMenu 的渲染输入。 */
export interface FormatSlashMenuInput {
  width: number
  items: readonly SlashMenuItem[]
  /** 选中项下标（滚动窗口保持其可见）。 */
  selected: number
  /** 最大可见行数（缺省 SLASH_MENU_MAX_ROWS；≤0 视为缺省）。 */
  maxRows?: number
  /** ascii 降级（❯ → >）。 */
  ascii?: boolean
}

function truncateTo(text: string, columns: number): string {
  /* v8 ignore next -- 调用点保证 columns ≥ 1（labelW ≥ 1；descW ≥ 2 才调用） */
  if (columns <= 0) return ''
  let out = ''
  for (const ch of text) {
    if (displayWidth(out + ch) > columns) break
    out += ch
  }
  return out
}

/** 滚动窗口起点：total > maxRows 时让 selected 尽量居中，两端 clamp。 */
function windowStart(selected: number, total: number, maxRows: number): number {
  if (total <= maxRows) return 0
  const maxStart = total - maxRows
  return Math.max(0, Math.min(maxStart, selected - Math.floor((maxRows - 1) / 2)))
}

/**
 * 渲染 slash 命令下拉菜单行数组。
 * @param input - 宽度、菜单项、选中下标与行数上限。
 * @param theme - 当前主题（选中 label primary+bold、未选中 muted、描述 muted）。
 * @returns ANSI 行数组；items 为空或 width ≤ 0 返回空数组。
 */
export function formatSlashMenu(input: FormatSlashMenuInput, theme: RivetTheme): string[] {
  const { width, items, selected } = input
  if (width <= 0 || items.length === 0) return []
  const ascii = input.ascii === true
  const maxRows = input.maxRows !== undefined && input.maxRows > 0 ? input.maxRows : SLASH_MENU_MAX_ROWS
  const total = items.length
  // 极端窄宽（前缀 + 至少 2 字符 label 放不下）：退化为一截断前缀行（不破版）。
  if (width < 4) {
    const prefix = ascii ? '> ' : '❯ '
    return [color(truncateTo(prefix, width), theme.muted)]
  }
  const start = windowStart(selected, total, maxRows)
  const visible = items.slice(start, start + maxRows)

  // label 列宽：可见项 label（含 argsHint）的最大显示宽度，按预算与硬上限收敛。
  const labelTexts = visible.map(item => (item.argsHint !== undefined ? `/${item.name} ${item.argsHint}` : `/${item.name}`))
  const labelBudget = Math.min(LABEL_CAP, Math.max(0, Math.floor((width - 2) * LABEL_BUDGET_RATIO)))
  const labelW = Math.min(labelBudget, Math.max(0, ...labelTexts.map(t => displayWidth(t))))

  const out: string[] = []
  visible.forEach((item, i) => {
    const absIdx = start + i
    const isSel = absIdx === selected
    const prefix = isSel ? (ascii ? '> ' : '❯ ') : '  '
    /* v8 ignore next -- visible.map 生成 labelTexts，i 恒在界内；noUncheckedIndexedAccess 防御 */
    const labelPlain = labelTexts[i] ?? ''
    const labelTrimmed = truncateTo(labelPlain, labelW)
    const pad = Math.max(0, labelW - displayWidth(labelTrimmed))
    // 行宽 = prefix(2) + labelW + pad + 2 间隙 + descW = width（desc 显示时）。
    const descW = width - displayWidth(prefix) - labelW - 2
    const desc = descW >= 2 ? truncateTo(item.description, descW) : ''
    const labelAnsi = color(`${prefix}${labelTrimmed}`, isSel ? theme.primary : theme.muted, isSel ? { bold: true } : undefined)
    const descAnsi = desc === '' ? '' : color(`  ${desc}`, theme.muted)
    out.push(`${labelAnsi}${' '.repeat(pad)}${descAnsi}`)
  })
  if (total > maxRows) {
    out.push(color(truncateTo(`  ${ascii ? '^v' : '↑↓'} 还有 ${total - maxRows} 项`, width), theme.muted))
  }
  return out
}
