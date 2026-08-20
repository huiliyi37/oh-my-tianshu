/**
 * 任务窗格（grok-build /tasks 面板移植）。
 *
 * 纯函数层：projectTaskPanel 把 sessionProjections 注册表的任务投影
 * （全量快照或 null）投影为面板行。null = 从未写过任务（面板不渲染）；
 * 空数组 = 已清空（渲染占位）。行是 checklist（`[ ]` / `⏳` / `[x]`），
 * 不是进程卡——后台任务快照的 ›/⠋/⎿ 语汇在 live-panels 里走 formatLiveCard。
 *
 * @module @huiliyi37/dsh-tui/format/task-panel
 */

import { truncateToLiveWidth } from './live-card.js'

/** 任务条目（与 session-projection 任务单元的 wire 形状一致）。 */
export interface TaskItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** 面板标题行。 */
const TITLE = '📋 任务'

/** 状态 → 标记符号。 */
function statusMark(status: TaskItem['status']): string {
  if (status === 'completed') return '[x]'
  if (status === 'in_progress') return '⏳'
  return '[ ]'
}

/**
 * 投影任务快照为面板行。
 * @param tasks - 任务全量快照；null（从未写入）→ 空数组（不渲染面板）。
 * @param width - 终端列数（行截断预算，含标题）。
 * @returns 面板行数组（含标题与空态占位；null 输入返回空数组）。
 */
export function projectTaskPanel(tasks: TaskItem[] | null, width: number): string[] {
  if (tasks === null) return []
  const rows = [TITLE]
  if (tasks.length === 0) {
    rows.push('（无任务）')
    return rows
  }
  for (const task of tasks) {
    rows.push(truncateToLiveWidth(` ${statusMark(task.status)} ${task.content}`, Math.max(1, width)))
  }
  return rows
}
