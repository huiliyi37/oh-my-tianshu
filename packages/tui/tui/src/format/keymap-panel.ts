/**
 * 快捷键面板（grok-build Ctrl+. 键位清单弹层移植）。
 *
 * 纯函数层：KEYMAP_ENTRIES 是当前实现的完整快捷键表单一事实来源，
 * renderKeymapPanel 把条目渲染为两列对齐行（键位左列 + 动作右列），
 * 窄宽降级为单列紧凑行、超宽截断不破版。TuiApp 把它注册为 overlay
 * 渲染器，Ctrl+. 触发进出。
 *
 * @module @huiliyi37/dsh-tianshu-tui/format/keymap-panel
 */

import { displayWidth } from '../width.js'

/** 快捷键面板条目：键位 + 动作说明。 */
export interface KeymapEntry {
  /** 键位组合（如 'Ctrl+P'）。 */
  keys: string
  /** 动作说明（如 '命令面板'）。 */
  action: string
}

/** 当前实现的完整快捷键表（新增键位时在此登记，面板自动跟随）。 */
export const KEYMAP_ENTRIES: KeymapEntry[] = [
  { keys: 'Enter', action: '发送' },
  { keys: 'Shift+Enter', action: '换行（或 \\+Enter 续行）' },
  { keys: 'Ctrl+P', action: '命令面板' },
  { keys: 'Ctrl+O', action: '展开/收起推理块' },
  { keys: 'Ctrl+E', action: '外部编辑器' },
  { keys: 'Ctrl+T', action: '中轮转向' },
  { keys: 'Ctrl+U', action: '删除到行首' },
  { keys: 'Tab', action: '@-路径补全' },
  { keys: 'Ctrl+.', action: '快捷键面板' },
  { keys: 'Esc', action: '取消/关闭' },
]

/** 键位列宽：最长键位 + 2 列间隔。 */
function keyColumnWidth(entries: readonly KeymapEntry[]): number {
  let max = 0
  for (const entry of entries) {
    const w = displayWidth(entry.keys)
    if (w > max) max = w
  }
  return max + 2
}

/**
 * 渲染快捷键面板为行数组：标题 + 两列对齐条目。
 * 宽度不足时动作列按剩余宽度截断；极端窄宽（连键位列都放不下）降级为
 * 紧凑单列 `键位 动作`（不截断键位，动作截断）。
 * @param width - 终端列数。
 * @returns ANSI 行数组（无着色——overlay 面板由上层统一取色）。
 */
export function renderKeymapPanel(width: number): string[] {
  const title = '快捷键'
  const rows: string[] = [title, '']
  if (width < 12) return rows
  const keyCol = keyColumnWidth(KEYMAP_ENTRIES)
  const actionBudget = Math.max(1, width - keyCol)
  for (const entry of KEYMAP_ENTRIES) {
    if (keyCol >= width) {
      // 极端窄宽：紧凑单列，键位不截断、动作截断
      const compact = ` ${entry.keys} ${entry.action}`
      rows.push(compact.slice(0, width))
      continue
    }
    const padded = ` ${entry.keys}${' '.repeat(keyCol - displayWidth(entry.keys))}`
    const action = displayWidth(entry.action) > actionBudget
      ? truncateByWidth(entry.action, actionBudget)
      : entry.action
    rows.push(`${padded}${action}`)
  }
  return rows
}

/** 按显示宽度截断字符串（尾部补 …）。 */
function truncateByWidth(text: string, max: number): string {
  let out = ''
  let w = 0
  for (const ch of text) {
    const cw = displayWidth(ch)
    if (w + cw > max - 1) break
    out += ch
    w += cw
  }
  return `${out}…`
}
