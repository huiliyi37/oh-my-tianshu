/**
 * todos 紧凑待办面板（/todos）。
 *
 * 纯函数层：projectTodosPanel 把保留的 todos 投影快照折叠为紧凑卡行——与
 * /status 的完整 checklist 任务段、/tasks 的 checkbox 窗格同源不同呈现：
 * 一行摘要（三态计数 + 当前进行项）或封顶明细（超出部分折叠尾行）。
 * 输入 null = 会话从未写入待办（渲染空态占位）；空数组 = 模型已清空清单
 * （渲染完成态）。turn/start 把投影清成 null 的黏滞语义由控制器承担
 * （保留快照只吸收非空投影值），本模块只面对折叠后的输入。
 *
 * @module @huiliyi37/dsh-tui/format/todos-panel
 */

import { truncateToLiveWidth } from './live-card.js'
import type { TaskItem } from './task-panel.js'

/** 面板选项。 */
export interface TodosPanelOptions {
  /** 终端列数（行截断预算）。 */
  width: number
  /** true 渲染逐条明细（maxRows 封顶 + 折叠尾行）；false 只渲染一行摘要卡。 */
  expanded: boolean
  /** 明细态最大行数（含摘要行）；缺省 6。 */
  maxRows?: number
}

/** 面板标题前缀。 */
const TITLE = '📋 待办'
/** 明细态缺省最大行数（含摘要行）。 */
const DEFAULT_MAX_ROWS = 6

/** 状态 → 明细行标记（对齐 /tasks checkbox 语汇）。 */
function statusMark(status: TaskItem['status']): string {
  if (status === 'completed') return '[x]'
  if (status === 'in_progress') return '⏳'
  return '[ ]'
}

/** 摘要行：标题 + 三态计数 + 当前进行项（无进行项则省略）。 */
function summaryLine(todos: TaskItem[], width: number): string {
  const counts = { completed: 0, in_progress: 0, pending: 0 }
  for (const todo of todos) counts[todo.status]++
  let line = `${TITLE} ✓${counts.completed} ⏳${counts.in_progress} □${counts.pending}`
  const current = todos.find(todo => todo.status === 'in_progress')
  if (current !== undefined) line += ` · ${current.content}`
  return truncateToLiveWidth(line, width)
}

/**
 * 投影保留的待办快照为紧凑面板行。
 * @param todos - 保留的待办全量快照；null（会话从未写入）→ 空态占位行，
 *   空数组（已清空）→ 完成态行。
 * @param opts - 宽度、明细展开与行数上限。
 * @returns 面板行数组（摘要态恒 1 行；明细态 = 摘要行 + 封顶条目行 + 可选折叠尾行）。
 */
export function projectTodosPanel(todos: TaskItem[] | null, opts: TodosPanelOptions): string[] {
  const width = Math.max(1, opts.width)
  if (todos === null) return [truncateToLiveWidth(`${TITLE} ·（尚无待办）`, width)]
  if (todos.length === 0) return [truncateToLiveWidth(`${TITLE} · 全部完成 ✓`, width)]
  const rows = [summaryLine(todos, width)]
  if (!opts.expanded) return rows
  const maxRows = Math.max(2, opts.maxRows ?? DEFAULT_MAX_ROWS)
  const capacity = maxRows - 1
  const visible = todos.length <= capacity ? todos : todos.slice(0, capacity - 1)
  for (const todo of visible) {
    rows.push(truncateToLiveWidth(` ${statusMark(todo.status)} ${todo.content}`, width))
  }
  if (todos.length > visible.length) rows.push(`└ …(+${todos.length - visible.length})`)
  return rows
}
