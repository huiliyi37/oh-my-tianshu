/**
 * task-panel.spec.ts — 任务窗格纯函数（grok-build /tasks 面板移植）。
 *
 * 覆盖：null 快照不渲染、空列表占位、三态标记、截断不破版。
 */
import { describe, expect, it } from 'vitest'
import { projectTaskPanel, type TaskItem } from '../src/format/task-panel.js'

const tasks: TaskItem[] = [
  { content: '理解问题', status: 'completed' },
  { content: '调研代码', status: 'in_progress' },
  { content: '实现修复', status: 'pending' },
]

describe('projectTaskPanel', () => {
  it('null 快照（从未写入）返回空数组——面板不渲染', () => {
    expect(projectTaskPanel(null, 80)).toEqual([])
  })

  it('标题 + 三态标记逐行', () => {
    const rows = projectTaskPanel(tasks, 80)
    expect(rows[0]).toBe('📋 任务')
    expect(rows).toContain(' [x] 理解问题')
    expect(rows).toContain(' ⏳ 调研代码')
    expect(rows).toContain(' [ ] 实现修复')
  })

  it('空列表（已清空）渲染占位', () => {
    const rows = projectTaskPanel([], 80)
    expect(rows).toEqual(['📋 任务', '（无任务）'])
  })

  it('窄宽截断不破版', () => {
    const rows = projectTaskPanel(tasks, 10)
    for (const row of rows) {
      expect(row.length).toBeLessThanOrEqual(10)
    }
  })

  it('极端窄宽（≤1）不抛错', () => {
    expect(() => projectTaskPanel(tasks, 1)).not.toThrow()
  })
})
