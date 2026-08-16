/**
 * delegation-panel.spec.ts — 委派树面板纯函数（grok-build tasks_pane 分组行移植）。
 *
 * 覆盖：标题行与空输入、depth 层级缩进、activity 状态标记（running ● /
 * inactive ○）、mode 标记（one-shot ▶ / continuable ↻）、label 渲染与缺失
 * 回退 id 短哈希、耗时（subagentTiming settledMs）、diagnostic 警示行、
 * 窄宽截断、极端窄宽不抛错、identities/timings 投影覆盖。
 */
import { describe, expect, it } from 'vitest'
import { projectDelegationTree, type DelegationIdentityProjection, type DelegationTreeEntry } from '../src/delegation-panel.js'
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

describe('projectDelegationTree 标题与空输入', () => {
  it('空 entries 返回空数组（无委派树则不渲染面板）', () => {
    expect(projectDelegationTree([], new Map(), new Map(), { width: 80 })).toEqual([])
  })

  it('非空 entries 首行为标题行', () => {
    const rows = projectDelegationTree([childRunningContinuable], new Map(), new Map(), { width: 80 })
    expect(rows[0]).toBe('🌳 委派')
  })
})

describe('projectDelegationTree 层级缩进（depth 驱动）', () => {
  it('depth 1 缩进 2 空格，depth 2 缩进 4 空格', () => {
    const rows = projectDelegationTree(
      [childRunningContinuable, childInactiveOneShotNoLabel],
      new Map(),
      new Map(),
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
    const rows = projectDelegationTree([childRunningContinuable], new Map(), new Map(), { width: 80 })
    expect(rows).toContain('  ● ↻ 主探索')
  })

  it('inactive → ○，one-shot → ▶', () => {
    const rows = projectDelegationTree([childInactiveOneShotNoLabel], new Map(), new Map(), { width: 80 })
    const line = rows.find(r => r.includes('aaaaaaaa'))
    expect(line).toMatch(/^    ○ ▶ /)
  })
})

describe('projectDelegationTree label 与短哈希回退', () => {
  it('label 存在时渲染 label', () => {
    const rows = projectDelegationTree([childRunningContinuable], new Map(), new Map(), { width: 80 })
    expect(rows.some(r => r.includes('主探索'))).toBe(true)
  })

  it('label 缺失回退 id 前 8 位短哈希', () => {
    const rows = projectDelegationTree([childInactiveOneShotNoLabel], new Map(), new Map(), { width: 80 })
    expect(rows.some(r => r.includes('aaaaaaaa'))).toBe(true)
    expect(rows.some(r => r.includes('aaaaaaaa-bbbb'))).toBe(false)
  })

  it('session- 前缀 id 的短哈希回退去前缀（uuid8，非 session- 空壳）', () => {
    const entry: DelegationTreeEntry = {
      ...childInactiveOneShotNoLabel,
      id: 'session-77aa88bb-9c00-4d11-8e22-334455667788',
    }
    const rows = projectDelegationTree([entry], new Map(), new Map(), { width: 80 })
    expect(rows.some(r => r.includes('77aa88bb'))).toBe(true)
    expect(rows.some(r => r.includes('session-'))).toBe(false)
  })
})

describe('projectDelegationTree identities 投影覆盖', () => {
  it('identities 的 label 优先于 entry 自带 label', () => {
    const identities = new Map([
      ['11111111-2222-4333-8444-555555555555', { mode: 'continuable', label: '投影新标签', seq: 5 }],
    ]) as ReadonlyMap<string, DelegationIdentityProjection>
    const rows = projectDelegationTree([childRunningContinuable], identities, new Map(), { width: 80 })
    expect(rows.some(r => r.includes('投影新标签'))).toBe(true)
    expect(rows.some(r => r.includes('主探索'))).toBe(false)
  })

  it('identities 提供 label 时无 label 条目不再回退短哈希', () => {
    const identities = new Map([
      ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', { mode: 'one-shot', label: '来自投影', seq: 3 }],
    ]) as ReadonlyMap<string, DelegationIdentityProjection>
    const rows = projectDelegationTree([childInactiveOneShotNoLabel], identities, new Map(), { width: 80 })
    expect(rows.some(r => r.includes('来自投影'))).toBe(true)
    expect(rows.some(r => r.includes('aaaaaaaa'))).toBe(false)
  })
})

describe('projectDelegationTree 耗时（subagentTiming settledMs）', () => {
  it('有 settledMs 时渲染耗时（秒，一位小数）', () => {
    const timings = new Map([
      ['11111111-2222-4333-8444-555555555555', { settledMs: 2300 }],
    ])
    const rows = projectDelegationTree([childRunningContinuable], new Map(), timings, { width: 80 })
    expect(rows.some(r => r.includes('2.3s'))).toBe(true)
  })

  it('无 timing 投影时不渲染耗时', () => {
    const rows = projectDelegationTree([childRunningContinuable], new Map(), new Map(), { width: 80 })
    const line = rows.find(r => r.includes('主探索'))
    expect(line).toBe('  ● ↻ 主探索')
  })

  it('settledMs 为 0 时渲染 0.0s', () => {
    const timings = new Map([
      ['11111111-2222-4333-8444-555555555555', { settledMs: 0 }],
    ])
    const rows = projectDelegationTree([childRunningContinuable], new Map(), timings, { width: 80 })
    expect(rows.some(r => r.includes('0.0s'))).toBe(true)
  })
})

describe('projectDelegationTree diagnostic 警示行', () => {
  it('diagnostic 条目渲染警示行（不伪造 activity/mode）', () => {
    const rows = projectDelegationTree([diagnosticEntry], new Map(), new Map(), { width: 80 })
    const line = rows.find(r => r.includes('dddddddd'))
    expect(line).toMatch(/⚠/)
    expect(line).not.toMatch(/[●○]/)
  })

  it('unavailable reason → 不可用 警示文本', () => {
    const rows = projectDelegationTree(
      [{ kind: 'diagnostic', id: 'uuuuuuuu-0000-4aaa-8bbb-cccccccccccc', parentId: 'root-session', depth: 1, reason: 'unavailable' }],
      new Map(), new Map(), { width: 80 },
    )
    expect(rows.some(r => r.includes('不可用'))).toBe(true)
  })

  it('unsupported reason → 不支持 警示文本', () => {
    const rows = projectDelegationTree(
      [{ kind: 'diagnostic', id: 'ssssssss-0000-4aaa-8bbb-cccccccccccc', parentId: 'root-session', depth: 1, reason: 'unsupported' }],
      new Map(), new Map(), { width: 80 },
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
    const rows = projectDelegationTree([longEntry], new Map(), new Map(), { width: 16 })
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(16)
    }
    const line = rows.find(r => r.includes('…'))
    expect(line).toBeDefined()
  })

  it('极端窄宽（width ≤ 1）不抛错', () => {
    expect(() =>
      projectDelegationTree([childRunningContinuable], new Map(), new Map(), { width: 1 }),
    ).not.toThrow()
  })

  it('宽幅下不截断', () => {
    const rows = projectDelegationTree([childRunningContinuable], new Map(), new Map(), { width: 80 })
    expect(rows).toContain('  ● ↻ 主探索')
  })
})
