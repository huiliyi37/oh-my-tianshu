/**
 * workflow-panel — 工作流运行态面板（grok workflows.rs render_list/roster 移植，纯函数层）。
 *
 * projectWorkflow 把多个 run 的运行态视图投影为面板行：
 * - 列表行：状态字形 + badge + objective + meta（phases/agents/elapsed），cancelled 整行 DIM 置灰；
 * - 展开行：opts.expanded 命中的 run 追加 roster（label + phase + 状态）；
 * - 终态汇总：消费 stopReason/agentsStarted（grok 的死字段我们消费），error 消息可选进汇总行。
 * 数据面形状结构兼容 workflow 包 types.ts（WorkflowRunInfo 字段名 id；WorkflowAgentEndInfo
 * 追加 outcome；WorkflowResultInfo 无 value），纯函数层不跨包依赖、无 I/O。
 *
 * @module @huiliyi37/dsh-tianshu-tui/workflow-panel
 */

import { displayWidth } from './width.js'

/** run 终态原因（结构兼容 workflow 包 WorkflowStopReason）。 */
export type WorkflowStopReasonInput = 'completed' | 'cancelled' | 'error'

/** 单个 agent() 调用的结算方式（结构兼容 workflow 包 WorkflowAgentOutcome）。 */
export type WorkflowAgentOutcomeInput = 'completed' | 'failed' | 'cancelled'

/** run 的 meta 块（结构兼容 workflow 包 WorkflowMeta，纯函数层只消费 name/description/phases）。 */
export interface WorkflowMetaInput {
  name: string
  description: string
  phases?: { title: string }[]
}

/** run 标识与 meta（结构兼容 workflow 包 WorkflowRunInfo：字段名 id 非 runId）。 */
export interface WorkflowRunInfoInput {
  id: string
  meta: WorkflowMetaInput
}

/** 一次 agent() 调用的结算信息（结构兼容 workflow 包 WorkflowAgentEndInfo）。 */
export interface WorkflowAgentEndInfoInput {
  /** 1-based 调用序号。 */
  seq: number
  /** 显示标签（label 选项或 prompt 片段）。 */
  label: string
  /** 所属阶段（phase 选项或当前 phase() 标题）。 */
  phase?: string
  /** 子代理 id（roster 定位用，面板不渲染）。 */
  childId: string
  /** 结算方式。 */
  outcome: WorkflowAgentOutcomeInput
}

/** run 终态汇总（结构兼容 workflow 包 WorkflowResultInfo：无 result value）。 */
export interface WorkflowResultInfoInput {
  stopReason: WorkflowStopReasonInput
  /** 失败消息（stopReason 非 completed 时才有）。 */
  error?: string
  /** run 全程接受的 agent() 调用数。 */
  agentsStarted: number
}

/** 单个 run 的运行态视图（面板消费的形状；result 缺省 = 运行中）。 */
export interface WorkflowRunView {
  info: WorkflowRunInfoInput
  /** 已结算的 agent 调用（roster 数据源）。 */
  agents: WorkflowAgentEndInfoInput[]
  /** 终态汇总；undefined = 尚未结算（列表行按运行中渲染）。 */
  result?: WorkflowResultInfoInput
  /** 已运行时长（毫秒）；缺省不渲染时间段。 */
  elapsedMs?: number
}

/** 面板选项。 */
export interface WorkflowPanelOptions {
  /** 终端列数（行截断预算，含标题）。 */
  width: number
  /** 展开显示 roster + 终态汇总的 run id 集合；缺省全部折叠。 */
  expanded?: string[]
}

/** 面板标题行。 */
const TITLE = '📜 工作流'

/** 空态占位行。 */
const EMPTY = '（暂无工作流）'

/** 置灰（细体/暗色）转义序列：cancelled 列表行整行包裹。 */
const DIM = '\x1B[2m'

/** SGR 重置转义序列。 */
const RESET = '\x1B[0m'

/** 运行中字形（result 未结算）。 */
const RUNNING_GLYPH = '⏳'

/** 终态原因 → 列表行状态字形。 */
const RUN_GLYPHS: Record<WorkflowStopReasonInput, string> = {
  completed: '✓',
  cancelled: '⊘',
  error: '✗',
}

/** 终态原因 → 汇总行文本。 */
const STOP_TEXTS: Record<WorkflowStopReasonInput, string> = {
  completed: '已完成',
  cancelled: '已取消',
  error: '出错',
}

/** 结算方式 → roster 行状态文本。 */
const OUTCOME_TEXTS: Record<WorkflowAgentOutcomeInput, string> = {
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

/**
 * run 的状态字形：未结算 → ⏳；否则按终态原因映射。
 * @param view - run 运行态视图。
 * @returns 状态字形。
 */
function runGlyph(view: WorkflowRunView): string {
  const reason = view.result?.stopReason
  return reason === undefined ? RUNNING_GLYPH : RUN_GLYPHS[reason]
}

/**
 * 毫秒 → 人类可读时长（45s / 1m20s / 2h1m）。
 * @param ms - 毫秒数。
 * @returns 格式化时长。
 */
function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60}m`
}

/**
 * 单个 run 的列表行：字形 + [badge] + objective + meta（phases/agents/elapsed）。
 * cancelled 的 run 整行（截断后）DIM 包裹置灰。
 * @param view - run 运行态视图。
 * @param width - 行截断预算。
 * @returns 列表行（可能含 ANSI）。
 */
function projectListRow(view: WorkflowRunView, width: number): string {
  const meta: string[] = []
  if (view.info.meta.phases !== undefined) meta.push(`${view.info.meta.phases.length} 阶段`)
  meta.push(`${view.agents.length} 个 agent`)
  if (view.elapsedMs !== undefined) meta.push(formatElapsed(view.elapsedMs))
  const row = `${runGlyph(view)} [${view.info.meta.name}] ${view.info.meta.description} · ${meta.join(' · ')}`
  const cut = truncateByWidth(row, width)
  return view.result?.stopReason === 'cancelled' ? `${DIM}${cut}${RESET}` : cut
}

/**
 * 展开行：roster 每行「序号. label · phase · 状态」（phase 缺省跳过）。
 * @param view - run 运行态视图。
 * @param width - 行截断预算。
 * @returns roster 行数组（无 agent 时为空数组）。
 */
function projectRosterRows(view: WorkflowRunView, width: number): string[] {
  const rows: string[] = []
  for (const agent of view.agents) {
    const phase = agent.phase === undefined ? '' : ` · ${agent.phase}`
    rows.push(truncateByWidth(`  ├ ${agent.seq}. ${agent.label}${phase} · ${OUTCOME_TEXTS[agent.outcome]}`, width))
  }
  return rows
}

/**
 * 终态汇总行：消费 stopReason/agentsStarted，error 消息可选。
 * @param view - run 运行态视图。
 * @param width - 行截断预算。
 * @returns 汇总行数组（run 未结算时为空数组）。
 */
function projectResultRow(view: WorkflowRunView, width: number): string[] {
  const result = view.result
  if (result === undefined) return []
  const errorPart = result.error === undefined ? '' : ` · ${result.error}`
  return [truncateByWidth(`  └ 终态：${STOP_TEXTS[result.stopReason]}${errorPart} · 启动 ${result.agentsStarted} 个 agent`, width)]
}

/**
 * 投影多个 run 的运行态视图为面板行（标题 + 列表行 + 展开的 roster/终态汇总）。
 * @param runs - run 视图数组；空数组 → 标题 + 空态占位。
 * @param opts - 面板选项（行宽 + 展开集合）。
 * @returns 面板行数组。
 */
export function projectWorkflow(runs: WorkflowRunView[], opts: WorkflowPanelOptions): string[] {
  const rows = [TITLE]
  if (runs.length === 0) {
    rows.push(EMPTY)
    return rows
  }
  const expanded = opts.expanded
  for (const view of runs) {
    rows.push(projectListRow(view, opts.width))
    if (expanded !== undefined && expanded.includes(view.info.id)) {
      rows.push(...projectRosterRows(view, opts.width))
      rows.push(...projectResultRow(view, opts.width))
    }
  }
  return rows
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
