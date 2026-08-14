/**
 * live-panels — renderLive 7 面板段纯函数契约测试（Wave 2 TDD：RED → GREEN）。
 *
 * 每面板 `(snapshot) => string[]`（纯文本行，renderLive 组合器负责 `{ text }`
 * 包装与 theme 着色——面板只产出面板行）。7 面板：
 * renderTasksPanel / renderConfigPanel / renderSkillsPanel / renderDelegationPanel
 * / renderWorkflowPanel / renderStatusPanel / renderGlancePanel。
 *
 * 输入 LiveSnapshot 是 renderLive 读取字段子集的快照（控制面/面板显隐/投影源/
 * 输入行五组）。面板是纯函数：同一 snapshot 恒返回同一行序列，无 I/O、无时钟。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import type { LiveSnapshot } from '../src/render/live-snapshot.js'
import {
  renderTasksPanel,
  renderConfigPanel,
  renderSkillsPanel,
  renderDelegationPanel,
  renderWorkflowPanel,
  renderStatusPanel,
  renderGlancePanel,
  renderSessionTabs,
} from '../src/render/live-panels.js'

/** 假主题（与既有 spec 同构：每个 token 一个独特 hex）。 */
const THEME = {
  primary: '#111111',
  secondary: '#222222',
  success: '#333333',
  warning: '#444444',
  error: '#555555',
  dim: '#666666',
  muted: '#777777',
  pulseQuiet: '#888888',
  pulseActive: '#999999',
  pulseAlert: '#aaaaaa',
  userColor: '#bbbbbb',
  assistantColor: '#cccccc',
  systemColor: '#dddddd',
  brandColor: '#eeeeee',
  toolColor: () => '#000000',
  contextColor: () => '#000000',
} as RivetTheme

/** 默认快照：全面板隐藏、空投影（每面板单独打开对应显隐位）。 */
function baseSnapshot(): LiveSnapshot {
  return {
    cols: 100,
    theme: THEME,
    taskPanelVisible: false,
    taskItems: null,
    taskSnapshots: [],
    taskNotice: null,
    statusPanelVisible: false,
    goal: null,
    todos: null,
    plan: null,
    subagentsPanelVisible: false,
    delegationEntries: null,
    subagentIdentities: new Map(),
    subagentTimings: new Map(),
    workflowPanelVisible: false,
    workflowRuns: [],
    configPanelVisible: false,
    configProjection: null,
    skillsPanelVisible: false,
    skillItems: [],
    glanceStatus: '○ 空闲',
    glanceError: null,
    activeSessionId: null,
    sessionTabs: [],
  }
}

describe('renderTasksPanel', () => {
  it('面板隐藏 → 零行', () => {
    expect(renderTasksPanel(baseSnapshot())).toEqual([])
  })

  it('面板打开 + taskItems 投影 → 任务行（标题 + 条目）', () => {
    const snap = { ...baseSnapshot(), taskPanelVisible: true, taskItems: [
      { content: '写测试', status: 'in_progress' as const },
      { content: '跑绿', status: 'completed' as const },
    ] }
    const rows = renderTasksPanel(snap)
    expect(rows[0]).toContain('📋 任务')
    expect(rows.join('\n')).toContain('⏳ 写测试')
    expect(rows.join('\n')).toContain('[x] 跑绿')
  })

  it('面板打开 + taskItems null（服务缺失）→ 不渲染（projectTaskPanel 语义）', () => {
    expect(renderTasksPanel({ ...baseSnapshot(), taskPanelVisible: true, taskItems: null })).toEqual([])
  })

  it('后台任务区：taskSnapshots 逐行渲染（running/completed 标记）', () => {
    const snap = { ...baseSnapshot(), taskPanelVisible: true, taskSnapshots: [
      { id: 't1', kind: 'build', label: 'pnpm build', status: 'running' as const, startedAt: 1 },
      { id: 't2', kind: 'test', label: 'vitest', status: 'completed' as const, startedAt: 2 },
    ] }
    const text = renderTasksPanel(snap).join('\n')
    expect(text).toContain('⏳ pnpm build')
    expect(text).toContain('✓ vitest')
  })
})

describe('renderConfigPanel', () => {
  it('面板隐藏 → 零行', () => {
    expect(renderConfigPanel(baseSnapshot())).toEqual([])
  })

  it('面板打开 + projection → 设置行', () => {
    const snap = {
      ...baseSnapshot(),
      configPanelVisible: true,
      configProjection: {
        settings: [{ ns: 'provider', value: 'deepseek' }],
        permission: null,
        credentials: [],
      },
    }
    const rows = renderConfigPanel(snap)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.join('\n')).toContain('provider')
  })

  it('面板打开 + projection null（服务缺失）→ 零行', () => {
    expect(renderConfigPanel({ ...baseSnapshot(), configPanelVisible: true })).toEqual([])
  })
})

describe('renderSkillsPanel', () => {
  it('面板隐藏 → 零行', () => {
    expect(renderSkillsPanel(baseSnapshot())).toEqual([])
  })

  it('面板打开 + skillItems → 技能行', () => {
    const snap = {
      ...baseSnapshot(),
      skillsPanelVisible: true,
      skillItems: [{
        name: 'galaxy',
        description: '星河集群',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'project',
        provider: 'local',
      }],
    }
    const rows = renderSkillsPanel(snap)
    expect(rows.join('\n')).toContain('galaxy')
  })
})

describe('renderDelegationPanel', () => {
  it('面板隐藏 → 零行', () => {
    expect(renderDelegationPanel(baseSnapshot())).toEqual([])
  })

  it('面板打开 + delegationEntries → 委派树行（标题 + 条目）', () => {
    const snap = {
      ...baseSnapshot(),
      subagentsPanelVisible: true,
      delegationEntries: [
        { kind: 'child' as const, id: 's1', parentId: 'root', depth: 1, activity: 'running' as const, hasChildren: false, mode: 'one-shot' as const },
      ],
      subagentIdentities: new Map([['s1', { mode: 'one-shot' as const, seq: 1 }]]),
      subagentTimings: new Map([['s1', { settledMs: 1500 }]]),
    }
    const rows = renderDelegationPanel(snap)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.join('\n')).toContain('🌳 委派')
  })

  it('面板打开 + entries null（未预取）→ 零行（降级）', () => {
    expect(renderDelegationPanel({ ...baseSnapshot(), subagentsPanelVisible: true })).toEqual([])
  })
})

describe('renderWorkflowPanel', () => {
  it('面板隐藏 → 零行', () => {
    expect(renderWorkflowPanel(baseSnapshot())).toEqual([])
  })

  it('面板打开 + workflowRuns → 工作流行', () => {
    const snap = {
      ...baseSnapshot(),
      workflowPanelVisible: true,
      workflowRuns: [{
        info: { id: 'wf-1', meta: { name: '评审', description: '' } },
        agents: [],
      }],
    }
    const rows = renderWorkflowPanel(snap)
    expect(rows.join('\n')).toContain('wf-1')
  })
})

describe('renderStatusPanel', () => {
  it('面板隐藏 → 零行', () => {
    expect(renderStatusPanel(baseSnapshot())).toEqual([])
  })

  it('面板打开 + goal/todos/plan → 状态面板行', () => {
    const snap = {
      ...baseSnapshot(),
      statusPanelVisible: true,
      goal: {
        goal: { objective: '拆分 app.ts', phase: 'active' as const, maxGoalRounds: 3 },
        roundsStarted: 1,
      },
      todos: [{ content: 'Wave 1', status: 'completed' as const }],
      plan: { active: true },
    }
    const rows = renderStatusPanel(snap)
    expect(rows.join('\n')).toContain('◆ 目标')
    expect(rows.join('\n')).toContain('拆分 app.ts')
    expect(rows.join('\n')).toContain('📐 计划')
  })

  it('面板打开 + 全 null 投影 → 任务段占位 + 无目标/计划段', () => {
    const rows = renderStatusPanel({ ...baseSnapshot(), statusPanelVisible: true })
    expect(rows.join('\n')).toContain('（无任务）')
    expect(rows.join('\n')).not.toContain('◆ 目标')
  })
})

describe('renderGlancePanel', () => {
  it('状态行恒渲染（无错误）', () => {
    const rows = renderGlancePanel(baseSnapshot())
    expect(rows).toEqual(['○ 空闲'])
  })

  it('错误行仅在有错误时追加', () => {
    const rows = renderGlancePanel({ ...baseSnapshot(), glanceError: 'auth failed' })
    expect(rows).toEqual(['○ 空闲', 'auth failed'])
  })

  it('glanceStatus 为 null（turn_status 无可渲染内容）时状态行不占位', () => {
    const rows = renderGlancePanel({ ...baseSnapshot(), glanceStatus: null })
    expect(rows).toEqual([])
  })

  it('C4 概念稿 C：metrics 由 renderLive 底部常驻渲染，glance 面板不再承载', () => {
    // glanceMetrics 已从 LiveSnapshot 移除（死字段清理）——快照无该字段即
    // 证明 metrics 不经面板层；底部渲染路径在 app.spec（三行底部区用例）。
    const snap = baseSnapshot()
    expect('glanceMetrics' in snap).toBe(false)
    const rows = renderGlancePanel(snap)
    expect(rows).toEqual(['○ 空闲'])
  })
})

describe('renderSessionTabs（chrome 瘦身：单会话不占行）', () => {
  it('空列表（未 attach）→ 零行', () => {
    expect(renderSessionTabs(baseSnapshot())).toEqual([])
  })

  it('单会话 → 零行（tab 只在有切换目标时才有信息量）', () => {
    const snap = {
      ...baseSnapshot(),
      activeSessionId: 'session-aaaabbbbcccc-rest',
      sessionTabs: [{ id: 'session-aaaabbbbcccc-rest', status: 'idle' as const }],
    }
    expect(renderSessionTabs(snap)).toEqual([])
  })

  it('多会话 → 单行：活跃 ▸ 前缀、其余 · 前缀、运行中 ⏳ 后缀', () => {
    const snap = {
      ...baseSnapshot(),
      activeSessionId: 'session-aaaabbbbcccc-rest',
      sessionTabs: [
        { id: 'session-aaaabbbbcccc-rest', status: 'idle' as const },
        { id: 'session-ddddeeeeffff-rest', status: 'running' as const },
      ],
    }
    const rows = renderSessionTabs(snap)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('▸ aaaabbbbcccc')
    expect(rows[0]).toContain('· ddddeeeeffff ⏳')
  })
})
