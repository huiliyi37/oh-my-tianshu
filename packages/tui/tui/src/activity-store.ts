/**
 * activity-store — 活动条目聚合存储（纯内存，无 IO）。
 *
 * - projectActivity：ActivityState → 展示条目（idle 丢弃）。
 * - mergeActivityItems：多组条目按 id 合并——label 保留首个，其余字段
 *   后续出现者覆盖/填补；跨组顺序保持。
 * - ActivityStore：按 id 保存 upsert 历史，project 时合并去重。
 */
import type { ActivityState } from './activity-status.js'

/** 单条活动展示条目（elapsedMs/subLabel/toolUseCount 可选补充信息）。 */
export interface ActivityItem {
  id: string
  kind: 'tool'
  label: string
  status: 'running' | 'done' | 'failed'
  elapsedMs?: number
  subLabel?: string
  toolUseCount?: number
}

/**
 * ActivityState → 展示条目；idle 丢弃。
 * @param state - 活动状态（activity-status 折叠结果）。
 * @param id - 条目 id（跨组合并去重键）。
 * @param now - 当前时间戳（active 时计算进行中耗时）。
 * @param toolUseCount - 工具调用计数（有值时附到条目）。
 * @returns 展示条目；idle 返回 undefined。
 */
export function projectActivity(
  state: ActivityState,
  id: string,
  now: number,
  toolUseCount?: number,
): ActivityItem | undefined {
  if (state.phase === 'idle' || state.status === 'idle') return undefined
  const elapsedMs = state.status === 'active'
    ? Math.max(0, now - state.startedAt)
    : state.completedAt !== undefined ? Math.max(0, state.completedAt - state.startedAt) : 0
  return {
    id,
    kind: 'tool',
    label: state.label ?? 'working',
    status: state.status === 'completed' ? 'done' : state.status === 'failed' ? 'failed' : 'running',
    ...(elapsedMs !== 0 ? { elapsedMs } : {}),
    ...(toolUseCount !== undefined ? { toolUseCount } : {}),
  }
}

/**
 * 按 id 合并多组条目：label 保留首个出现值，其余字段后续覆盖/填补；顺序保持。
 * @param groups - 多组条目（按组内、跨组顺序遍历）。
 * @returns 合并去重后的条目，按首次出现顺序。
 */
export function mergeActivityItems(groups: readonly (readonly ActivityItem[])[]): ActivityItem[] {
  const byId = new Map<string, { item: ActivityItem; order: number }>()
  let order = 0
  for (const group of groups) {
    for (const item of group) {
      const existing = byId.get(item.id)
      if (existing === undefined) {
        byId.set(item.id, { item: { ...item }, order: order++ })
      } else {
        // label 保留首个；其余字段取后者
        existing.item = { ...existing.item, ...item, label: existing.item.label }
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.order - b.order).map(e => e.item)
}

/** 按 id 存储 upsert 历史；project 合并去重。 */
export class ActivityStore {
  private readonly history = new Map<string, ActivityItem[]>()

  /**
   * 追加一条条目到该 id 的历史（不覆盖旧值，project 时才合并）。
   * @param item - 待追加条目。
   */
  upsert(item: ActivityItem): void {
    const list = this.history.get(item.id) ?? []
    list.push(item)
    this.history.set(item.id, list)
  }

  /**
   * 该 id 最近一次 upsert 的条目。
   * @param id - 条目 id。
   * @returns 最新条目；无历史返回 undefined。
   */
  get(id: string): ActivityItem | undefined {
    const list = this.history.get(id)
    return list === undefined ? undefined : list[list.length - 1]
  }

  /**
   * 删除该 id 的全部历史。
   * @param id - 条目 id。
   */
  remove(id: string): void {
    this.history.delete(id)
  }

  /** 清空全部历史。 */
  clear(): void {
    this.history.clear()
  }

  /**
   * 每个 id 的历史作为一组，合并去重后按插入顺序输出。
   * @returns 合并后的展示条目列表。
   */
  project(): ActivityItem[] {
    const groups: ActivityItem[][] = []
    for (const list of this.history.values()) groups.push(list)
    return mergeActivityItems(groups)
  }
}
