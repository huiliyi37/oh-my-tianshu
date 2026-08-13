/**
 * 委派树面板（grok-build tasks_pane 分组行移植，纯函数层）。
 *
 * projectDelegationTree 把 listDescendants 的树条目与 subagent 投影
 * （identity/timing）投影为面板行：标题行 + 每层委派一行，depth 驱动层级
 * 缩进，activity 状态标记（running ● / inactive ○），mode 标记（one-shot
 * ▶ / continuable ↻），label 缺失回退 id 前 8 位短哈希，耗时取
 * subagentTiming settledMs（秒，一位小数）。null 投影与缺失 timing 均按
 * 「无数据不渲染该字段」处理；diagnostic 条目渲染警示行（不吞异常、不伪造
 * activity/mode）。空 entries 返回空数组——无委派树则不渲染面板。TuiApp
 * 消费 listDescendants 快照与 sessionProjections 的 subagent/subagentTiming
 * 单元，行渲染进 live 区（接线由其他维度独占）。
 *
 * @module @huiliyi37/dsh-tui/delegation-panel
 */

import { displayWidth } from './width.js'

/** activity 状态：running 在 store 中存活，inactive 仅存在于持久化。 */
export type DelegationActivity = 'running' | 'inactive'

/** 委派模式：one-shot 一次性执行，continuable 可续会话。 */
export type DelegationMode = 'one-shot' | 'continuable'

/**
 * 委派树条目（结构兼容 dsh-subagent 的 SubagentDescendantListEntry——
 * 纯函数层不跨包依赖）。child 臂携带 activity/hasChildren/mode/label；
 * diagnostic 臂说明候选为何没有 child 行。
 */
export type DelegationTreeEntry =
  | {
    readonly kind: 'child'
    /** 子会话 id（稳定跨 Activation）。 */
    readonly id: string
    /** 持久化直接父会话 id。 */
    readonly parentId: string
    /** 距请求根的边数；直接子代为 1。 */
    readonly depth: number
    /** store 快照活动性。 */
    readonly activity: DelegationActivity
    /** 是否有直接后代为 subagent。 */
    readonly hasChildren: boolean
    /** 委派模式。 */
    readonly mode: DelegationMode
    /** 创建标签；缺失时面板回退 id 短哈希。 */
    readonly label?: string
  }
  | {
    readonly kind: 'diagnostic'
    readonly id: string
    readonly parentId: string
    readonly depth: number
    /** 无 child 行的原因（corrupt/unavailable/unsupported）。 */
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
  }

/** 身份投影（结构兼容 dsh-subagent 的 SubagentIdentityProjection）。 */
export type DelegationIdentityProjection = {
  readonly mode: DelegationMode
  /** 创建标签；one-shot 可能缺失。 */
  readonly label?: string
  /** 折叠该身份的 descriptor 事件 seq。 */
  readonly seq: number
}

/** 耗时投影（结构兼容 dsh-subagent 的 SubagentTimingProjection）。 */
export interface DelegationTimingProjection {
  /** 已完成 turn 累积毫秒。 */
  readonly settledMs: number
  /** 当前未结束 turn 的边界（本面板不消费）。 */
  readonly active?: { since: number; through: number }
}

/** 渲染选项。 */
export interface DelegationPanelOptions {
  /** 终端列数（行截断预算，含标题行）。 */
  width: number
}

/** 面板标题行。 */
const TITLE = '🌳 委派'

/** activity → 状态标记。 */
function activityMark(activity: DelegationActivity): string {
  return activity === 'running' ? '●' : '○'
}

/** mode → 模式标记。 */
function modeMark(mode: DelegationMode): string {
  return mode === 'continuable' ? '↻' : '▶'
}

/** diagnostic reason → 警示文本。 */
function reasonLabel(reason: Extract<DelegationTreeEntry, { kind: 'diagnostic' }>['reason']): string {
  if (reason === 'corrupt') return '损坏'
  if (reason === 'unavailable') return '不可用'
  return '不支持'
}

/** id 前 8 位短哈希（label 缺失回退）。 */
function shortHash(id: string): string {
  return id.slice(0, 8)
}

/** settledMs → 秒文本（一位小数）。 */
function formatSettled(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * 投影委派树为面板行。
 * @param entries - listDescendants 树条目（已按 pre-order 排序）；空数组 → 空行数组（面板不渲染）。
 * @param identities - 按 id 键控的 subagent 身份投影（label/mode 覆盖 entry 自带值）。
 * @param timings - 按 id 键控的 subagent 耗时投影（settledMs → 耗时后缀）。
 * @param opts - 渲染选项（含行截断宽度预算）。
 * @returns 面板行数组（标题 + 每层委派一行；空输入返回空数组）。
 */
export function projectDelegationTree(
  entries: DelegationTreeEntry[],
  identities: ReadonlyMap<string, DelegationIdentityProjection>,
  timings: ReadonlyMap<string, DelegationTimingProjection>,
  opts: DelegationPanelOptions,
): string[] {
  if (entries.length === 0) return []
  const rows = [truncateByWidth(TITLE, opts.width)]
  for (const entry of entries) {
    rows.push(renderEntry(entry, identities, timings, opts.width))
  }
  return rows
}

/** 渲染单个条目为一行（child 渲染状态行，diagnostic 渲染警示行）。 */
function renderEntry(
  entry: DelegationTreeEntry,
  identities: ReadonlyMap<string, DelegationIdentityProjection>,
  timings: ReadonlyMap<string, DelegationTimingProjection>,
  width: number,
): string {
  const indent = '  '.repeat(Math.max(0, entry.depth))
  if (entry.kind === 'diagnostic') {
    return truncateByWidth(`${indent}⚠ ${reasonLabel(entry.reason)} ${shortHash(entry.id)}`, width)
  }
  const identity = identities.get(entry.id)
  const mode = identity?.mode ?? entry.mode
  const label = identity?.label ?? entry.label ?? shortHash(entry.id)
  const timing = timings.get(entry.id)
  const timingSuffix = timing === undefined ? '' : ` ${formatSettled(timing.settledMs)}`
  return truncateByWidth(`${indent}${activityMark(entry.activity)} ${modeMark(mode)} ${label}${timingSuffix}`, width)
}

/** 按显示宽度截断字符串（仅发生截断时尾部补 …；极端窄宽退化为 …）。 */
function truncateByWidth(text: string, max: number): string {
  if (max <= 1) return '…'
  let out = ''
  let w = 0
  for (const ch of text) {
    const cw = displayWidth(ch)
    if (w + cw > max - 1) break
    out += ch
    w += cw
  }
  return w < displayWidth(text) ? `${out}…` : out
}
