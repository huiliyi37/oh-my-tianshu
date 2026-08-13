/**
 * /status 状态面板（grok-build goal_detail 面板移植，纯函数层）。
 *
 * projectStatusPanel 把 goal/todos/plan 三个投影快照渲染为面板行：
 * 目标段（状态标签 + objective + 轮次 + 阻塞原因）、任务段（复用
 * task-panel 三态行）、计划模式段（active/pending 徽标）。null 快照 =
 * 从未写入（该段不渲染）；空数组 = 已清空（任务段渲染占位）。TuiApp 消费
 * sessionProjections 的 goal/todos/plan 单元，/status 命令切换显隐，行
 * 渲染进 live 区（接线在 ui/app.ts 与 registry.ts，由其他维度独占）。
 *
 * @module @huiliyi37/dsh-tui/status-panel
 */

import { displayWidth } from './width.js'
import { projectTaskPanel, type TaskItem } from './format/task-panel.js'

/** goal 投影单元的状态阶段（与 goal 包 wire 形状一致）。 */
export type GoalPhase = 'active' | 'paused' | 'blocked' | 'complete'

/** goal 投影单元的 wire 形状（结构兼容 goal 包 GoalProjection，纯函数层不跨包依赖）。 */
export interface GoalProjectionInput {
  goal: {
    objective: string
    phase: GoalPhase
    /** blocked 时的阻塞原因（可选）。 */
    blockedReason?: { code: string; message: string }
    maxGoalRounds: number
  }
  roundsStarted: number
}

/** plan 投影单元的 wire 形状（结构兼容 plan-mode 包 { active, pending? }）。 */
export interface PlanProjectionInput {
  active: boolean
  /** 用户轮内选择尚未落实（pending 仅此时为 true）。 */
  pending?: boolean
}

/** status_label 三元组：状态 → (文本, 颜色, 阶段)。颜色为语义色名，接线层映射主题色。 */
export interface GoalStatusLabel {
  text: string
  color: 'green' | 'yellow' | 'red' | 'blue'
  stage: GoalPhase
}

/** status_label 映射（参照 grok-build goal_detail：状态 → (文本, 颜色, 阶段)）。 */
const STATUS_LABELS: Record<GoalPhase, GoalStatusLabel> = {
  active: { text: '进行中', color: 'green', stage: 'active' },
  paused: { text: '已暂停', color: 'yellow', stage: 'paused' },
  blocked: { text: '已阻塞', color: 'red', stage: 'blocked' },
  complete: { text: '已完成', color: 'blue', stage: 'complete' },
}

/** 目标段标题行。 */
const GOAL_TITLE = '◆ 目标'

/** 计划段徽标前缀。 */
const PLAN_TITLE = '📐 计划'

/**
 * 状态 → (文本, 颜色, 阶段) 三元组映射（grok-build status_label 模式）。
 * @param phase - goal 投影单元的状态阶段。
 * @returns 状态文本、语义色名与阶段标识。
 */
export function goalStatusLabel(phase: GoalPhase): GoalStatusLabel {
  return STATUS_LABELS[phase]
}

/**
 * 投影 goal/todos/plan 快照为 /status 面板行。
 * @param goal - goal 投影快照；null（从未写入）→ 目标段不渲染。
 * @param todos - 任务快照；null → 任务段不渲染，空数组 → 渲染占位。
 * @param plan - plan 投影快照；null → 计划段不渲染。
 * @param opts - 渲染选项（含行截断宽度预算）。
 * @returns 面板行数组（三段按目标/任务/计划顺序拼接）。
 */
export function projectStatusPanel(
  goal: GoalProjectionInput | null,
  todos: TaskItem[] | null,
  plan: PlanProjectionInput | null,
  opts: { width: number },
): string[] {
  const rows: string[] = []
  if (goal !== null) rows.push(...projectGoalSection(goal, opts.width))
  rows.push(...projectTaskPanel(todos, Math.max(1, opts.width)))
  if (plan !== null) rows.push(...projectPlanSection(plan, opts.width))
  return rows
}

/** 目标段：状态行 + objective + 轮次 + 阻塞原因。 */
function projectGoalSection(goal: GoalProjectionInput, width: number): string[] {
  const rows: string[] = []
  const label = goalStatusLabel(goal.goal.phase)
  rows.push(truncateByWidth(`${GOAL_TITLE} · ${label.text}`, width))
  rows.push(truncateByWidth(goal.goal.objective, width))
  rows.push(truncateByWidth(`↻ 轮次 ${goal.roundsStarted}/${goal.goal.maxGoalRounds}`, width))
  if (goal.goal.phase === 'blocked' && goal.goal.blockedReason !== undefined) {
    rows.push(truncateByWidth(`🚧 ${goal.goal.blockedReason.message}`, width))
  }
  return rows
}

/** 计划段：active/pending 徽标单行。 */
function projectPlanSection(plan: PlanProjectionInput, width: number): string[] {
  const mode = plan.active ? '进行中' : '关闭'
  const pending = plan.pending === true ? ' · 待生效' : ''
  return [truncateByWidth(`${PLAN_TITLE} · ${mode}${pending}`, width)]
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
