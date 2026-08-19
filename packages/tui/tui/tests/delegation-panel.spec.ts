/**
 * delegation-panel.spec.ts — 委派树面板纯函数（grok-build tasks_pane 分组行移植）。
 *
 * 覆盖：标题行与空输入、depth 层级缩进、activity 状态标记（running ● /
 * inactive ○）、mode 标记（one-shot ▶ / continuable ↻）、label 渲染与缺失
 * 回退 id 短哈希、运行态投影段（activity 文本 / token / 工具计数 / 终态词 /
 * 耗时，含 now 实时耗时）、宽度预算（suffix 从右往左丢、label 最后截断）、
 * diagnostic 警示行、极端窄宽不抛错。条目自带 identity/progress/timing——
 * 不再有独立的 identities/timings 投影参数（列表解析已同 cut 解析，见
 * dsh-subagent listDescendants）。
 */
import { describe, expect, it } from 'vitest'
import {
  projectDelegationTree,
  type DelegationProgressProjection,
  type DelegationTreeEntry,
} from '../src/delegation-panel.js'
import { displayWidth } from '../src/width.js'

/** child 条目：running + continuable，depth 1。 */
const childRunningContinuable: DelegationTreeEntry = {
  kind: 'child',
  id: '11111111-2222-4333-8444-555555555555',
  parentId: 'root-session',
  depth: 1,
  activity: 'running',
  hasChildren: true,
  mode: 'continuable',
  label: '主探索',
}

/** child 条目：inactive + one-shot 且无 label（触发短哈希回退），depth 2。 */
const childInactiveOneShotNoLabel: DelegationTreeEntry = {
  kind: 'child',
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  parentId: '11111111-2222-4333-8444-555555555555',
  depth: 2,
  activity: 'inactive',
  hasChildren: false,
  mode: 'one-shot',
}

/** diagnostic 条目。 */
const diagnosticEntry: DelegationTreeEntry = {
  kind: 'diagnostic',
  id: 'dddddddd-0000-4aaa-8bbb-cccccccccccc',
  parentId: 'root-session',
  depth: 1,
  reason: 'corrupt',
}

/** 运行中 progress：一次进行中的 bash 调用。 */
const progressRunningTool: DelegationProgressProjection = {
  turns: 0,
  toolCalls: 1,
  tokensUsed: 12_300,
  lastTool: 'bash',
  toolInFlight: true,
}

const withProgress = (
  base: DelegationTreeEntry,
  progress: DelegationProgressProjection,
): DelegationTreeEntry => (base.kind === 'child' ? { ...base, progress } : base)

describe('projectDelegationTree 标题与空输入', () => {
  it('空 entries 返回空数组（无委派树则不渲染面板）', () => {
    expect(projectDelegationTree([], { width: 80 })).toEqual([])
  })

  it('非空 entries 首行为标题行', () => {
    const rows = projectDelegationTree([childRunningContinuable], { width: 80 })
    expect(rows[0]).toBe('🌳 委派')
  })
})

describe('projectDelegationTree 层级缩进（depth 驱动）', () => {
  it('depth 1 缩进 2 空格，depth 2 缩进 4 空格', () => {
    const rows = projectDelegationTree(
      [childRunningContinuable, childInactiveOneShotNoLabel],
      { width: 80 },
    )
    const line1 = rows.find(r => r.includes('主探索'))
    const line2 = rows.find(r => r.includes('aaaaaaaa'))
    expect(line1).toMatch(/^  ● /)
    expect(line2).toMatch(/^    ○ /)
  })
})

describe('projectDelegationTree activity/mode 标记', () => {
  it('running → ●，continuable → ↻', () => {
    const rows = projectDelegationTree([childRunningContinuable], { width: 80 })
    expect(rows).toContain('  ● ↻ 主探索')
  })

  it('inactive → ○，one-shot → ▶', () => {
    const rows = projectDelegationTree([childInactiveOneShotNoLabel], { width: 80 })
    const line = rows.find(r => r.includes('aaaaaaaa'))
    expect(line).toMatch(/^    ○ ▶ /)
  })
})

describe('projectDelegationTree label 与短哈希回退', () => {
  it('label 存在时渲染 label', () => {
    const rows = projectDelegationTree([childRunningContinuable], { width: 80 })
    expect(rows.some(r => r.includes('主探索'))).toBe(true)
  })

  it('label 缺失回退 id 前 8 位短哈希', () => {
    const rows = projectDelegationTree([childInactiveOneShotNoLabel], { width: 80 })
    expect(rows.some(r => r.includes('aaaaaaaa'))).toBe(true)
    expect(rows.some(r => r.includes('aaaaaaaa-bbbb'))).toBe(false)
  })
})

describe('projectDelegationTree 运行态投影段', () => {
  it('进行中工具 → `Running: <tool>` 段', () => {
    const rows = projectDelegationTree([withProgress(childRunningContinuable, progressRunningTool)], { width: 80 })
    const line = rows.find(r => r.includes('主探索'))
    expect(line).toContain('Running: bash')
  })

  it('工具已完成 → `Done: <tool>` 段', () => {
    const done: DelegationProgressProjection = {
      ...progressRunningTool, toolInFlight: false,
    }
    const rows = projectDelegationTree([withProgress(childRunningContinuable, done)], { width: 80 })
    expect(rows.some(r => r.includes('Done: bash'))).toBe(true)
  })

  it('token 段复用紧凑格式（12.3k tok），工具计数段渲染', () => {
    const rows = projectDelegationTree([withProgress(childRunningContinuable, progressRunningTool)], { width: 80 })
    const line = rows.find(r => r.includes('主探索'))
    expect(line).toContain('12.3k tok')
    expect(line).toContain('1 工具')
  })

  it('终态词：completed → `✓ 已完成`；error → `✗ 出错`', () => {
    const done: DelegationProgressProjection = {
      ...progressRunningTool, toolInFlight: false, lastTurnEnd: 'completed',
    }
    const rows = projectDelegationTree([withProgress(childRunningContinuable, done)], { width: 80 })
    expect(rows.some(r => r.includes('✓ 已完成'))).toBe(true)
    const failed: DelegationProgressProjection = {
      ...progressRunningTool, toolInFlight: false, lastTurnEnd: 'error',
    }
    const rows2 = projectDelegationTree([withProgress(childRunningContinuable, failed)], { width: 80 })
    expect(rows2.some(r => r.includes('✗ 出错'))).toBe(true)
  })
})

describe('projectDelegationTree 耗时', () => {
  it('entry.timing settledMs 渲染耗时（秒，一位小数）', () => {
    const entry: DelegationTreeEntry = { ...childRunningContinuable, timing: { settledMs: 2300 } }
    const rows = projectDelegationTree([entry], { width: 80 })
    expect(rows.some(r => r.includes('2.3s'))).toBe(true)
  })

  it('无 progress/timing 时不渲染运行信息段', () => {
    const rows = projectDelegationTree([childRunningContinuable], { width: 80 })
    const line = rows.find(r => r.includes('主探索'))
    expect(line).toBe('  ● ↻ 主探索')
  })

  it('active turn + now → 实时耗时 = settledMs + (now - since)', () => {
    const entry: DelegationTreeEntry = {
      ...childRunningContinuable,
      timing: { settledMs: 1000, active: { since: 10_000, through: 10_000 } },
    }
    const rows = projectDelegationTree([entry], { width: 80, now: 13_000 })
    expect(rows.some(r => r.includes('4.0s'))).toBe(true)
  })

  it('active turn 无 now → 回落 settledMs', () => {
    const entry: DelegationTreeEntry = {
      ...childRunningContinuable,
      timing: { settledMs: 1000, active: { since: 10_000, through: 10_000 } },
    }
    const rows = projectDelegationTree([entry], { width: 80 })
    expect(rows.some(r => r.includes('1.0s'))).toBe(true)
  })
})

describe('projectDelegationTree 宽度预算（suffix 从右往左丢）', () => {
  it('行放不下时先丢尾部 suffix，再截 label', () => {
    const entry: DelegationTreeEntry = {
      ...childRunningContinuable,
      progress: progressRunningTool,
      timing: { settledMs: 2300 },
    }
    // 宽 22：`  ● ↻ 主探索 · Running: bash · 12.3k tok · 1 工具 · 2.3s`
    const full = '  ● ↻ 主探索 · Running: bash · 12.3k tok · 1 工具 · 2.3s'
    expect(displayWidth(full)).toBeGreaterThan(22)
    const rows = projectDelegationTree([entry], { width: 22 })
    const line = rows[1]
    expect(displayWidth(line)).toBeLessThanOrEqual(22)
    // label 完整保留，尾部 suffix 被丢
    expect(line).toContain('主探索')
    expect(line).not.toContain('2.3s')
    // 再窄：suffix 全丢，label 被截
    const rows2 = projectDelegationTree([entry], { width: 10 })
    const line2 = rows2[1]
    expect(displayWidth(line2)).toBeLessThanOrEqual(10)
    expect(line2).not.toContain('Running')
    expect(line2).not.toContain('tok')
  })

  it('宽幅下完整渲染', () => {
    const entry: DelegationTreeEntry = {
      ...childRunningContinuable,
      progress: progressRunningTool,
      timing: { settledMs: 2300 },
    }
    const rows = projectDelegationTree([entry], { width: 80 })
    expect(rows[1]).toBe('  ● ↻ 主探索 · Running: bash · 12.3k tok · 1 工具 · 2.3s')
  })
})

describe('projectDelegationTree diagnostic 警示行', () => {
  it('diagnostic 条目渲染警示行（不伪造 activity/mode）', () => {
    const rows = projectDelegationTree([diagnosticEntry], { width: 80 })
    const line = rows.find(r => r.includes('dddddddd'))
    expect(line).toMatch(/⚠/)
    expect(line).not.toMatch(/[●○]/)
  })

  it('unavailable reason → 不可用 警示文本', () => {
    const rows = projectDelegationTree(
      [{ kind: 'diagnostic', id: 'uuuuuuuu-0000-4aaa-8bbb-cccccccccccc', parentId: 'root-session', depth: 1, reason: 'unavailable' }],
      { width: 80 },
    )
    expect(rows.some(r => r.includes('不可用'))).toBe(true)
  })

  it('unsupported reason → 不支持 警示文本', () => {
    const rows = projectDelegationTree(
      [{ kind: 'diagnostic', id: 'ssssssss-0000-4aaa-8bbb-cccccccccccc', parentId: 'root-session', depth: 1, reason: 'unsupported' }],
      { width: 80 },
    )
    expect(rows.some(r => r.includes('不支持'))).toBe(true)
  })
})

describe('projectDelegationTree 窄宽截断', () => {
  it('长 label 在窄宽下截断补 …，且不超 width', () => {
    const longEntry: DelegationTreeEntry = {
      kind: 'child',
      id: '99999999-8888-4777-8666-555555555555',
      parentId: 'root-session',
      depth: 1,
      activity: 'running',
      hasChildren: false,
      mode: 'continuable',
      label: '这是一个非常非常长的委派任务描述，用来验证窄宽截断降级逻辑是否正常工作',
    }
    const rows = projectDelegationTree([longEntry], { width: 16 })
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(16)
    }
    const line = rows.find(r => r.includes('…'))
    expect(line).toBeDefined()
  })

  it('极端窄宽（width ≤ 1）不抛错', () => {
    expect(() =>
      projectDelegationTree([childRunningContinuable], { width: 1 }),
    ).not.toThrow()
  })

  it('宽幅下不截断', () => {
    const rows = projectDelegationTree([childRunningContinuable], { width: 80 })
    expect(rows).toContain('  ● ↻ 主探索')
  })
})
