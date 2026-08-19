/**
 * 委派树面板（grok-build tasks_pane 分组行移植，纯函数层）。
 *
 * projectDelegationTree 把 listDescendants 的树条目投影为活区卡：标题行 +
 * 每层一张卡。depth 驱动缩进。状态形与工具卡同一套（进行中 ⠋ / 成功 › /
 * 失败 ✗）；mode 标记（one-shot ▶ / continuable ↻）留在 title。进行中且有
 * 活动时第二行 `⎿` 承载 activity / token / 工具计数；耗时与终态词留在
 * header suffix。空闲或已结束只留标题行。label 缺失回退 id 前 8 位短哈希。
 * diagnostic 条目渲染警示行（不吞异常、不伪造 activity/mode）。空 entries
 * 返回空数组。TuiApp 消费 listDescendants 快照（条目自带 identity/progress/
 * timing，同一投影 cut）。不处理行选中或鼠标。
 *
 * @module @huiliyi37/dsh-tui/delegation-panel
 */

import type { RivetTheme } from './theme.js'
import { formatTokenCount } from './format/glance-bar.js'
import { formatLiveCard, liveCardGlyph, truncateToLiveWidth, type LiveCardStatus } from './format/live-card.js'

/** activity 状态：running 在 store 中存活，inactive 仅存在于持久化。 */
export type DelegationActivity = 'running' | 'inactive'

/** 委派模式：one-shot 一次性执行，continuable 可续会话。 */
export type DelegationMode = 'one-shot' | 'continuable'

/**
 * 委派树条目（结构兼容 dsh-subagent 的 SubagentDescendantListEntry——
 * 纯函数层不跨包依赖）。child 臂携带 activity/hasChildren/mode/label 与
 * 运行态投影（progress/timing）；diagnostic 臂说明候选为何没有 child 行。
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
    /** 运行态事实（turn/tool 计数、最新 token、当前工具活动）；缺失则无运行信息段。 */
    readonly progress?: DelegationProgressProjection
    /** 已结算耗时（毫秒）；缺失则无耗时段。 */
    readonly timing?: DelegationTimingProjection
  }
  | {
    readonly kind: 'diagnostic'
    readonly id: string
    readonly parentId: string
    readonly depth: number
    /** 无 child 行的原因（corrupt/unavailable/unsupported）。 */
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
  }

/** 运行态投影（结构兼容 dsh-subagent 的 SubagentProgressProjection）。 */
export interface DelegationProgressProjection {
  /** descriptor 之后的 turn/end 计数。 */
  readonly turns: number
  /** tool/call 计数。 */
  readonly toolCalls: number
  /** 最新 assistant/message usage 的 billed 合计。 */
  readonly tokensUsed: number
  /** 最新 usage 的 reasoningTokens（可选）。 */
  readonly reasoningTokens?: number
  /** 最新 tool/call 的工具名（无则缺省）。 */
  readonly lastTool?: string
  /** 最新 tool/call 尚无配对 tool/result。 */
  readonly toolInFlight: boolean
  /** 最新 turn/end 的 reason kind（turn 未结束则缺省）。 */
  readonly lastTurnEnd?: 'completed' | 'aborted' | 'blocked' | 'error' | 'max-tokens' | 'interrupted'
}

/** 耗时投影（结构兼容 dsh-subagent 的 SubagentTimingProjection）。 */
export interface DelegationTimingProjection {
  /** 已完成 turn 累积毫秒。 */
  readonly settledMs: number
  /** 当前未结束 turn 的边界；`now` 存在时用于计算实时耗时。 */
  readonly active?: { since: number; through: number }
}

/** 渲染选项。 */
export interface DelegationPanelOptions {
  /** 终端列数（行截断预算，含标题行）。 */
  width: number
  /** 当前墙钟（epoch 毫秒）；缺失时运行中耗时回落 settledMs。 */
  now?: number
  /** 可选主题；提供时终态 title 涂 muted。 */
  theme?: RivetTheme
}

/** 面板标题行。 */
const TITLE = '🌳 委派'

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

/** 实时耗时：active turn 存在且提供 now 时，已结算 + 进行中部分；否则 settledMs。 */
function liveSettled(timing: DelegationTimingProjection, now: number | undefined): number {
  if (timing.active !== undefined && now !== undefined) {
    return timing.settledMs + Math.max(0, now - timing.active.since)
  }
  return timing.settledMs
}

/** activity 文本：`Running: <tool>` / `Done: <tool>`；无 lastTool 返回空串。 */
function activityText(progress: DelegationProgressProjection): string {
  if (progress.lastTool === undefined) return ''
  return progress.toolInFlight ? `Running: ${progress.lastTool}` : `Done: ${progress.lastTool}`
}

/** token 段：`12.3k tok`；零值返回空串。 */
function tokensText(progress: DelegationProgressProjection): string {
  if (progress.tokensUsed <= 0) return ''
  return `${formatTokenCount(progress.tokensUsed)} tok`
}

/** 工具计数段：`5 工具`；零值返回空串。 */
function toolsText(progress: DelegationProgressProjection): string {
  if (progress.toolCalls <= 0) return ''
  return `${progress.toolCalls} 工具`
}

/** 终态段：reason kind → 状态词；未知 kind 返回空串（不猜测）。 */
function terminalText(progress: DelegationProgressProjection): string {
  switch (progress.lastTurnEnd) {
    case 'completed': return '✓ 已完成'
    case 'aborted': return '◌ 已中断'
    case 'error': return '✗ 出错'
    case 'max-tokens': return '✗ 达上限'
    case 'blocked': return '⏸ 阻塞'
    case 'interrupted': return '◌ 中断'
    default: return ''
  }
}

/**
 * 投影委派树为面板行。
 * @param entries - listDescendants 树条目（已按 pre-order 排序）；空数组 → 空行数组（面板不渲染）。
 * @param opts - 渲染选项（宽度、可选墙钟、可选主题）。
 * @returns 面板行数组（标题 + 每层一张卡；空输入返回空数组）。
 */
export function projectDelegationTree(
  entries: DelegationTreeEntry[],
  opts: DelegationPanelOptions,
): string[] {
  if (entries.length === 0) return []
  const rows = [truncateToLiveWidth(TITLE, opts.width)]
  for (const entry of entries) {
    rows.push(...renderEntry(entry, opts))
  }
  return rows
}

/** lastTurnEnd 中与失败状态形对齐的 kind。 */
function isErrorTurn(kind: DelegationProgressProjection['lastTurnEnd'] | undefined): boolean {
  return kind === 'error' || kind === 'aborted' || kind === 'interrupted'
}

/** 渲染单个条目为一张卡（child）或一行警示（diagnostic）。 */
function renderEntry(entry: DelegationTreeEntry, opts: DelegationPanelOptions): string[] {
  const indent = '  '.repeat(Math.max(0, entry.depth))
  if (entry.kind === 'diagnostic') {
    return [truncateToLiveWidth(`${indent}⚠ ${reasonLabel(entry.reason)} ${shortHash(entry.id)}`, opts.width)]
  }
  const { progress, timing } = entry
  const title = `${modeMark(entry.mode)} ${entry.label ?? shortHash(entry.id)}`
  const finished = entry.activity === 'inactive' || progress?.lastTurnEnd !== undefined
  const inFlight = progress?.toolInFlight === true
  const activity = progress === undefined ? '' : activityText(progress)
  const terminal = progress === undefined ? '' : terminalText(progress)

  const status: LiveCardStatus = inFlight
    ? 'running'
    : isErrorTurn(progress?.lastTurnEnd)
      ? 'error'
      : 'success'

  const suffixes: string[] = []
  if (finished && terminal !== '') suffixes.push(terminal)
  if (timing !== undefined) suffixes.push(formatSettled(liveSettled(timing, opts.now)))

  const bodyParts: string[] = []
  if (!finished && progress !== undefined && (inFlight || activity !== '')) {
    if (activity !== '') bodyParts.push(activity)
    const tokens = tokensText(progress)
    if (tokens !== '') bodyParts.push(tokens)
    const tools = toolsText(progress)
    if (tools !== '') bodyParts.push(tools)
  }

  return formatLiveCard({
    glyph: liveCardGlyph(status),
    title,
    suffixes,
    ...(bodyParts.length > 0 ? { body: [bodyParts.join(' · ')] } : {}),
    width: opts.width,
    indent,
    dim: finished,
    ...(opts.theme === undefined ? {} : { theme: opts.theme }),
  })
}
