/**
 * status-panel.spec.ts — /status 状态面板纯函数（grok-build goal_detail 移植）。
 *
 * 覆盖：三段渲染（目标/任务/计划模式）、goal null/各 phase/blockedReason、
 * plan active/pending 徽标、窄宽截断、极端窄宽不抛错。
 */
import { describe, expect, it } from 'vitest'
import { projectStatusPanel, goalStatusLabel, type GoalProjectionInput } from '../src/status-panel.js'
import type { TaskItem } from '../src/format/task-panel.js'
import { displayWidth } from '../src/width.js'

const goal: GoalProjectionInput = {
  goal: {
    objective: '实现 /status 状态面板',
    phase: 'active',
    maxGoalRounds: 5,
  },
  roundsStarted: 2,
}

const todos: TaskItem[] = [
  { content: '理解问题', status: 'completed' },
  { content: '调研代码', status: 'in_progress' },
  { content: '实现修复', status: 'pending' },
]

describe('goalStatusLabel', () => {
  it('active → 进行中 / green / active', () => {
    expect(goalStatusLabel('active')).toEqual({ text: '进行中', color: 'green', stage: 'active' })
  })

  it('paused → 已暂停 / yellow / paused', () => {
    expect(goalStatusLabel('paused')).toEqual({ text: '已暂停', color: 'yellow', stage: 'paused' })
  })

  it('blocked → 已阻塞 / red / blocked', () => {
    expect(goalStatusLabel('blocked')).toEqual({ text: '已阻塞', color: 'red', stage: 'blocked' })
  })

  it('complete → 已完成 / blue / complete', () => {
    expect(goalStatusLabel('complete')).toEqual({ text: '已完成', color: 'blue', stage: 'complete' })
  })
})

describe('projectStatusPanel 目标段', () => {
  it('goal null 时不渲染目标段', () => {
    const rows = projectStatusPanel(null, todos, { active: false }, { width: 80 })
    expect(rows.some(r => r.includes('目标'))).toBe(false)
  })

  it('目标段：状态行 + objective + 轮次（active）', () => {
    const rows = projectStatusPanel(goal, [], { active: false }, { width: 80 })
    expect(rows).toContain('◆ 目标 · 进行中')
    expect(rows).toContain('实现 /status 状态面板')
    expect(rows).toContain('↻ 轮次 2/5')
  })

  it('blocked + blockedReason 渲染阻塞行', () => {
    const blockedGoal: GoalProjectionInput = {
      goal: {
        objective: '被卡住的目标',
        phase: 'blocked',
        maxGoalRounds: 3,
        blockedReason: { code: 'api_error', message: '上游 API 超时' },
      },
      roundsStarted: 1,
    }
    const rows = projectStatusPanel(blockedGoal, [], { active: false }, { width: 80 })
    expect(rows).toContain('◆ 目标 · 已阻塞')
    expect(rows).toContain('🚧 上游 API 超时')
  })

  it('blocked 无 blockedReason 时不渲染阻塞行', () => {
    const blockedGoal: GoalProjectionInput = {
      goal: { objective: '被卡住的目标', phase: 'blocked', maxGoalRounds: 3 },
      roundsStarted: 1,
    }
    const rows = projectStatusPanel(blockedGoal, [], { active: false }, { width: 80 })
    expect(rows).toContain('◆ 目标 · 已阻塞')
    expect(rows.some(r => r.startsWith('🚧'))).toBe(false)
  })

  it('paused / complete 状态文本', () => {
    const paused = projectStatusPanel(
      { goal: { objective: 'x', phase: 'paused', maxGoalRounds: 2 }, roundsStarted: 0 },
      [], { active: false }, { width: 80 },
    )
    expect(paused).toContain('◆ 目标 · 已暂停')

    const complete = projectStatusPanel(
      { goal: { objective: 'x', phase: 'complete', maxGoalRounds: 2 }, roundsStarted: 2 },
      [], { active: false }, { width: 80 },
    )
    expect(complete).toContain('◆ 目标 · 已完成')
  })
})

describe('projectStatusPanel 任务段（复用 task-panel 三态行）', () => {
  it('todos null 时不渲染任务段', () => {
    const rows = projectStatusPanel(goal, null, { active: false }, { width: 80 })
    expect(rows.some(r => r.includes('任务'))).toBe(false)
  })

  it('todos 空数组渲染占位', () => {
    const rows = projectStatusPanel(goal, [], { active: false }, { width: 80 })
    expect(rows).toContain('（无任务）')
  })

  it('todos 有任务渲染三态行', () => {
    const rows = projectStatusPanel(goal, todos, { active: false }, { width: 80 })
    expect(rows).toContain(' [x] 理解问题')
    expect(rows).toContain(' ⏳ 调研代码')
    expect(rows).toContain(' [ ] 实现修复')
  })
})

describe('projectStatusPanel 计划模式段', () => {
  it('plan null 时不渲染计划段', () => {
    const rows = projectStatusPanel(goal, todos, null, { width: 80 })
    expect(rows.some(r => r.includes('计划'))).toBe(false)
  })

  it('active 无 pending → 进行中', () => {
    const rows = projectStatusPanel(goal, [], { active: true }, { width: 80 })
    expect(rows).toContain('📐 计划 · 进行中')
  })

  it('active + pending → 进行中 · 待生效', () => {
    const rows = projectStatusPanel(goal, [], { active: true, pending: true }, { width: 80 })
    expect(rows).toContain('📐 计划 · 进行中 · 待生效')
  })

  it('inactive 无 pending → 关闭', () => {
    const rows = projectStatusPanel(goal, [], { active: false }, { width: 80 })
    expect(rows).toContain('📐 计划 · 关闭')
  })

  it('inactive + pending → 关闭 · 待生效', () => {
    const rows = projectStatusPanel(goal, [], { active: false, pending: true }, { width: 80 })
    expect(rows).toContain('📐 计划 · 关闭 · 待生效')
  })
})

describe('窄宽截断', () => {
  it('长 objective 在窄宽下截断补 …', () => {
    const longGoal: GoalProjectionInput = {
      goal: {
        objective: '这是一个非常非常长的目标描述，用来验证窄宽截断降级逻辑是否正常工作',
        phase: 'active',
        maxGoalRounds: 5,
      },
      roundsStarted: 1,
    }
    const rows = projectStatusPanel(longGoal, todos, { active: true, pending: true }, { width: 12 })
    const objectiveRow = rows.find(r => r.includes('…'))
    expect(objectiveRow).toBeDefined()
    expect(displayWidth(objectiveRow!)).toBeLessThanOrEqual(12)
  })

  it('窄宽下所有行不超过 width', () => {
    const rows = projectStatusPanel(goal, todos, { active: true, pending: true }, { width: 16 })
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(16)
    }
  })

  it('极端窄宽（width ≤ 1）不抛错', () => {
    expect(() => projectStatusPanel(goal, todos, { active: true }, { width: 1 })).not.toThrow()
  })

  it('宽幅下不截断', () => {
    const rows = projectStatusPanel(goal, todos, { active: true }, { width: 80 })
    expect(rows).toContain('实现 /status 状态面板')
    expect(rows).toContain('↻ 轮次 2/5')
  })
})

describe('全 null 输入', () => {
  it('goal/todos/plan 全空 → 空数组', () => {
    expect(projectStatusPanel(null, null, null, { width: 80 })).toEqual([])
  })
})
