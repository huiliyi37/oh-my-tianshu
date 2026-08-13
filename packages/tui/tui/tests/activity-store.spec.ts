import { describe, expect, it } from 'vitest'
import type { ActivityState } from '../src/activity-status.ts'
import { ActivityStore, mergeActivityItems, projectActivity } from '../src/activity-store.ts'

function activeToolState(over: Partial<ActivityState> = {}): ActivityState {
  return {
    phase: 'tool',
    label: 'Running bash',
    startedAt: 1000,
    lastEventAt: 1000,
    status: 'active',
    ...over,
  }
}

describe('projectActivity', () => {
  it('projects an active tool activity into a running item with elapsed', () => {
    const item = projectActivity(activeToolState(), 'tool-1', 4000)
    expect(item).toEqual({
      id: 'tool-1',
      kind: 'tool',
      label: 'Running bash',
      status: 'running',
      elapsedMs: 3000,
    })
  })

  it('maps completed to done and failed to failed', () => {
    const done = projectActivity(activeToolState({ status: 'completed', completedAt: 5000 }), 't1', 6000)
    expect(done?.status).toBe('done')
    expect(done?.elapsedMs).toBe(4000)
    const failed = projectActivity(activeToolState({ status: 'failed', completedAt: 2000 }), 't2', 6000)
    expect(failed?.status).toBe('failed')
  })

  it('drops idle activities from projection', () => {
    expect(projectActivity(activeToolState({ phase: 'idle', status: 'idle' }), 't1', 1000)).toBeUndefined()
  })

  it('carries toolUseCount when provided', () => {
    const item = projectActivity(activeToolState(), 't1', 1000, 3)
    expect(item?.toolUseCount).toBe(3)
  })

  it('omits toolUseCount when not provided', () => {
    const item = projectActivity(activeToolState(), 't1', 1000)
    expect(item?.toolUseCount).toBeUndefined()
    expect('toolUseCount' in item!).toBe(false)
  })

  it('falls back to a generic label when the state has none', () => {
    // label 缺省（无字段）→ projectActivity 回退 'working'；helper 默认 label
    // 是 'Running bash'，此处直接构造无 label 的 ActivityState 表达该语义。
    const state: ActivityState = { phase: 'tool', startedAt: 1000, lastEventAt: 1000, status: 'active' }
    const item = projectActivity(state, 't1', 1000)
    expect(item?.label).toBe('working')
  })

  it('omits elapsedMs when the terminal state has no completion time', () => {
    const item = projectActivity(activeToolState({ status: 'completed' }), 't1', 6000)
    expect(item?.status).toBe('done')
    expect(item?.elapsedMs).toBeUndefined()
    expect('elapsedMs' in item!).toBe(false)
  })
})

describe('mergeActivityItems', () => {
  it('dedupes by id keeping the first label and status', () => {
    const a = { id: 'x', kind: 'tool' as const, label: 'first', status: 'running' as const }
    const b = { id: 'x', kind: 'tool' as const, label: 'second', status: 'done' as const }
    const merged = mergeActivityItems([[a], [b]])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.label).toBe('first')
    expect(merged[0]?.status).toBe('done')
  })

  it('preserves input order across groups', () => {
    const a = { id: 'a', kind: 'tool' as const, label: 'A', status: 'running' as const }
    const b = { id: 'b', kind: 'tool' as const, label: 'B', status: 'running' as const }
    const c = { id: 'c', kind: 'tool' as const, label: 'C', status: 'running' as const }
    expect(mergeActivityItems([[a, b], [c]]).map(i => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('a later item fills missing fields without overriding present ones', () => {
    const a = { id: 'x', kind: 'tool' as const, label: 'L', status: 'running' as const }
    const b = { id: 'x', kind: 'tool' as const, label: 'L', status: 'running' as const, subLabel: 's1' }
    const merged = mergeActivityItems([[a], [b]])
    expect(merged[0]?.subLabel).toBe('s1')
  })
})

describe('ActivityStore', () => {
  it('upserts, projects in insertion order, removes and clears', () => {
    const store = new ActivityStore()
    store.upsert({ id: 'a', kind: 'tool', label: 'A', status: 'running' })
    store.upsert({ id: 'b', kind: 'tool', label: 'B', status: 'done' })
    expect(store.project().map(i => i.id)).toEqual(['a', 'b'])
    expect(store.get('a')?.label).toBe('A')
    store.upsert({ id: 'a', kind: 'tool', label: 'A2', status: 'done' })
    expect(store.get('a')?.label).toBe('A2')
    store.remove('b')
    expect(store.project().map(i => i.id)).toEqual(['a'])
    store.clear()
    expect(store.project()).toEqual([])
  })

  it('returns undefined for an unknown id', () => {
    const store = new ActivityStore()
    expect(store.get('missing')).toBeUndefined()
  })

  it('merge on project dedupes repeated upserts of the same id', () => {
    const store = new ActivityStore()
    store.upsert({ id: 'x', kind: 'tool', label: 'first', status: 'running' })
    store.upsert({ id: 'x', kind: 'tool', label: 'second', status: 'done', toolUseCount: 2 })
    const items = store.project()
    expect(items).toHaveLength(1)
    expect(items[0]?.toolUseCount).toBe(2)
    expect(items[0]?.label).toBe('first')
  })
})
