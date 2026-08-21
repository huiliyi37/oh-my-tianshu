/**
 * activity-band — 统一活动带（CC 对标：活跃进度收敛为输入轨上方的高度封顶固定带）。
 *
 * `foldActivityItems` 把三类活跃活动（subagent 运行项 / workflow run / 后台任务）
 * 折叠为统一 `ActivityItem[]`（新 `startedAt` 在前）；`formatActivityBand` 渲染为
 * 封顶带：分组计数头 + 每 item 恒 1 行 + 仅最新活跃 subagent 一条 `⎿` 子行 +
 * 常驻入口尾行。纯函数层：同一输入恒返回同一行序列，无 I/O、无时钟副作用
 * （`now`/`tick` 经 opts 注入）。完成项（done/failed）不进带——它们塌成一行
 * commit 进 scrollback（format/subagent-line 与 workflow/end 摘要承担）。
 *
 * 高度约束（防跳）：计数头 ≤1 行、item 行 ≤ maxRows、`⎿` 子行 ≤1 行（仅最新
 * 活跃 subagent）、入口尾行恒 1 行——带高只随「活跃 item 数」变化，数字原地
 * 更新不换行。
 *
 * @module @huiliyi37/dsh-tui/format/activity-band
 */

import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import {
  assembleLiveCardSuffixes,
  liveCardGlyph,
  truncateToLiveWidth,
} from './live-card.js'
import { formatTokenCount } from './glance-bar.js'
import { formatElapsedHuman } from './spinner-status.js'

/** 活动类别（统一模型三来源）。 */
export type ActivityKind = 'subagent' | 'workflow' | 'task'

/** 统一活动项（CC 招2 的 `{id,kind,label,...}` 形状，DSH 纯函数层 fold）。 */
export interface ActivityItem {
  id: string
  kind: ActivityKind
  label: string
  status: 'running' | 'done' | 'failed'
  /** running 起计（排序与 elapsed 数据源；缺失排序垫底）。 */
  startedAt?: number
  /** subagent 工具计数（>0 才渲染；缺失 = 无投影源）。 */
  toolCalls?: number
  /** subagent 最新 token 数（>0 才渲染；缺失 = 无投影源）。 */
  tokensUsed?: number
  /** subagent 最近工具名（`⎿` 子行文本）。 */
  lastTool?: string
  /** workflow 当前 phase 标题（无 phase 事件时缺省）。 */
  phase?: string
  /** workflow 已启动的 agent() 调用数（>0 才渲染）。 */
  agents?: number
}

/** subagent 运行项的 fold 输入（child 投影缓存快照可选——缺失则统计段省略）。 */
export interface SubagentRunInput {
  runId: string
  label: string
  startedAt?: number
  /** child 会话 `subagentProgress` 投影快照（结构兼容；out-of-process 无投影源则缺省）。 */
  progress?: {
    toolCalls: number
    tokensUsed: number
    lastTool?: string
  }
}

/** workflow run 的 fold 输入。 */
export interface WorkflowRunInput {
  id: string
  name: string
  description: string
  phase: string | null
  agentCount: number
  startedAt?: number
}

/** 活跃后台任务的 fold 输入（tasks.list() 的运行中/停止中项）。 */
export interface ActiveTaskInput {
  id: string
  kind: string
  label: string
  startedAt?: number
}

/** foldActivityItems 的输入（全部来自 TuiApp 既有缓存，零新机制）。 */
export interface FoldActivityInput {
  subagentRuns: SubagentRunInput[]
  workflowRuns: WorkflowRunInput[]
  tasks: ActiveTaskInput[]
}

/** 渲染选项。 */
export interface ActivityBandOptions {
  /** 终端列数（行截断预算）。 */
  width: number
  /** item 行数封顶（正整数；渲染层再钳到 ≥1）。 */
  maxRows: number
  /** 当前墙钟（epoch 毫秒）；缺失时不渲染 elapsed 段。 */
  now?: number
  /** spinner 帧计数（subagent 字形随 tick 旋转）。 */
  tick?: number
  /** ascii 降级（subagent 字形 → `-`/`|` 轮转）。 */
  ascii?: boolean
  /** 着色主题；缺省输出纯文本（单测友好）。 */
  theme?: RivetTheme
}

/** 分组计数头字形。 */
const HEADER_GLYPH = '◐'

/** 类别 → 计数头/文案名。 */
const KIND_NAMES: Record<ActivityKind, string> = {
  subagent: '子代理',
  workflow: '工作流',
  task: '后台任务',
}

/** 类别渲染顺序（计数头与折叠排序共用）。 */
const KIND_ORDER: readonly ActivityKind[] = ['subagent', 'workflow', 'task']

/** 未折叠时的常驻入口尾行（详情视图入口提示）。 */
const ENTRY_PLAIN = '/workflow 管理 · /subagents 树'

/** 折叠时的尾行：超封顶计数 + /workflow 入口。 */
const ENTRY_FOLDED = (n: number): string => `└ …(+${n}) /workflow 管理`

/** 无 lastTool 但有投影源且零工具调用时的子行文案。 */
const INITIALIZING = 'Initializing…'

/**
 * 折叠三类活跃活动为统一活动项（仅 running；新 startedAt 在前，缺省垫底）。
 * @param input - subagent 运行项 / workflow run / 活跃后台任务。
 * @returns 统一活动项数组（running 项，startedAt 降序）。
 */
export function foldActivityItems(input: FoldActivityInput): ActivityItem[] {
  const items: ActivityItem[] = []
  for (const run of input.subagentRuns) {
    items.push({
      id: run.runId,
      kind: 'subagent',
      label: run.label,
      status: 'running',
      ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
      ...(run.progress === undefined ? {} : {
        toolCalls: run.progress.toolCalls,
        tokensUsed: run.progress.tokensUsed,
        ...(run.progress.lastTool === undefined ? {} : { lastTool: run.progress.lastTool }),
      }),
    })
  }
  for (const run of input.workflowRuns) {
    items.push({
      id: run.id,
      kind: 'workflow',
      label: run.description === '' ? `[${run.name}]` : `[${run.name}] ${run.description}`,
      status: 'running',
      ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
      ...(run.phase === null ? {} : { phase: run.phase }),
      agents: run.agentCount,
    })
  }
  for (const task of input.tasks) {
    items.push({
      id: task.id,
      kind: 'task',
      label: `${task.kind}: ${task.label}`,
      status: 'running',
      ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
    })
  }
  return items.sort((a, b) => (b.startedAt ?? Number.NEGATIVE_INFINITY) - (a.startedAt ?? Number.NEGATIVE_INFINITY))
}

/**
 * 渲染统一活动带：分组计数头（活跃 >1 时）+ 每 item 恒 1 行 + 仅最新活跃
 * subagent 一条 `⎿` 子行 + 常驻入口尾行。done/failed 项跳过；超 maxRows 折叠
 * 为 `+N` 尾行（新 startedAt 优先——折叠排序已保证）。空输入/无 running 项
 * 返回空数组（不渲染带）。
 * @param items - 统一活动项（foldActivityItems 输出或等价形状）。
 * @param opts - 行宽、封顶、墙钟、帧与主题。
 * @returns 面板行数组（计数头 ≤1 + item ≤maxRows + 子行 ≤1 + 尾行 1）。
 */
export function formatActivityBand(items: ActivityItem[], opts: ActivityBandOptions): string[] {
  const active = items.filter(item => item.status === 'running')
  if (active.length === 0) return []
  const rows: string[] = []
  if (active.length > 1) {
    rows.push(truncateToLiveWidth(formatHeader(active), opts.width))
  }
  const maxRows = Math.max(1, opts.maxRows)
  const shown = active.slice(0, maxRows)
  // ⎿ 子行只挂最新活跃 subagent（折叠排序后首个子代理项）；被截断则不渲染。
  const newestSubagentIdx = active.findIndex(item => item.kind === 'subagent')
  for (let i = 0; i < shown.length; i++) {
    const item = shown[i]
    if (item === undefined) continue
    rows.push(projectItemRow(item, opts))
    if (i === newestSubagentIdx) {
      const subline = projectSubagentSubline(item, opts)
      if (subline !== null) rows.push(subline)
    }
  }
  const entry = active.length > shown.length
    ? ENTRY_FOLDED(active.length - shown.length)
    : ENTRY_PLAIN
  rows.push(dim(entry, opts))
  return rows
}

/** 分组计数头：`◐ N 子代理 · M 工作流 · K 后台任务`（零计数组省略）。 */
function formatHeader(items: ActivityItem[]): string {
  const parts: string[] = []
  for (const kind of KIND_ORDER) {
    const count = items.filter(item => item.kind === kind).length
    if (count > 0) parts.push(`${count} ${KIND_NAMES[kind]}`)
  }
  return `${HEADER_GLYPH} ${parts.join(' · ')}`
}

/** 单个活动项行：glyph + label + 统计段（后缀从右往左丢，label 最后截）。 */
function projectItemRow(item: ActivityItem, opts: ActivityBandOptions): string {
  const theme = opts.theme
  const glyph = item.kind === 'subagent'
    ? liveCardGlyph('running', {
      ...(opts.tick === undefined ? {} : { tick: opts.tick }),
      ...(opts.ascii === undefined ? {} : { ascii: opts.ascii }),
    })
    : item.kind === 'workflow' ? '⏳' : '›'
  const base = theme === undefined
    ? `${glyph} ${item.label}`
    : `${color(glyph, theme.primary)} ${item.label}`
  const suffixes: string[] = []
  if (item.kind === 'subagent') {
    const toolCalls = item.toolCalls
    if (toolCalls !== undefined && toolCalls > 0) suffixes.push(`${toolCalls} 工具`)
    const tokensUsed = item.tokensUsed
    if (tokensUsed !== undefined && tokensUsed > 0) suffixes.push(`${formatTokenCount(tokensUsed)} tok`)
  } else if (item.kind === 'workflow') {
    if (item.phase !== undefined) suffixes.push(item.phase)
    const agents = item.agents
    if (agents !== undefined && agents > 0) suffixes.push(`${agents} 个 agent`)
  }
  const startedAt = item.startedAt
  const now = opts.now
  if (startedAt !== undefined && now !== undefined) {
    suffixes.push(formatElapsedHuman(Math.max(0, now - startedAt)))
  }
  const painted = theme === undefined
    ? suffixes
    : suffixes.map(suffix => color(suffix, theme.muted))
  return assembleLiveCardSuffixes(base, painted, opts.width)
}

/**
 * 最新活跃 subagent 的 `⎿` 子行：有 lastTool → 最近工具；无 lastTool 但
 * 投影源存在且零工具调用 → Initializing…；无投影源 → null（不渲染）。
 * @param item - 最新活跃 subagent 项。
 * @param opts - 行宽与主题。
 * @returns 子行（dim）或 null。
 */
function projectSubagentSubline(item: ActivityItem, opts: ActivityBandOptions): string | null {
  if (item.lastTool !== undefined) {
    return dim(`⎿ ${item.lastTool}`, opts)
  }
  if (item.toolCalls === 0) return dim(`⎿ ${INITIALIZING}`, opts)
  return null
}

/** 尾行/子行涂 dim（无主题时纯文本）。 */
function dim(text: string, opts: ActivityBandOptions): string {
  return truncateToLiveWidth(
    opts.theme === undefined ? text : color(text, opts.theme.dim),
    opts.width,
  )
}
