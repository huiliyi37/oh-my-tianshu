/**
 * LiveSnapshot — renderLive 读取字段子集的快照类型（Wave 2 提取）。
 *
 * renderLive 从 TuiApp 读取 ~25 个字段（控制面/面板显隐/投影源/输入行五组）
 * 组装为 LiveSnapshot，交给 render/live-panels 的 7 面板纯函数。快照在
 * renderLive 每帧组装一次（与现状逐字段读取等价）；面板只消费快照，不反向
 * import app.ts——依赖方向保持 `app.ts → render/` 单向。
 *
 * 快照字段按面板分组：glance（状态行/错误行/metrics 行）、tasks（任务窗格
 * + 后台任务区 + 完成通知）、status（goal/todos/plan）、delegation（委派树）、
 * workflow（运行中 + 已结算 run 视图）、config、skills。
 *
 * @module @huiliyi37/dsh-tui/render/live-snapshot
 */

import type { TaskItem } from '../format/task-panel.js'
import type { RivetTheme } from '../theme.js'
import type { GoalProjectionInput, PlanProjectionInput, SessionTotalsInput } from '../status-panel.js'
import type {
  DelegationIdentityProjection,
  DelegationTimingProjection,
  DelegationTreeEntry,
} from '../delegation-panel.js'
import type { WorkflowRunView } from '../workflow-panel.js'
import type { ConfigPanelProjection } from '../config-panel.js'
import type { SkillSummaryInput } from '../skill-panel.js'

/** T2.3：tasks.list() 返回项的最小 wire 形状（status/detail/startedAt 渲染所需）。 */
export interface TaskSnapshotView {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  readonly detail?: string
  readonly startedAt: number
}

/**
 * renderLive 单帧快照：7 面板段的全部输入（控制面/面板显隐/投影源/输入行）。
 * 每帧由 renderLive 组装；面板只读。
 */
export interface LiveSnapshot {
  /** 终端列数（行截断预算）。 */
  cols: number
  /** 当前主题（面板行着色；纯面板只读不 set）。 */
  theme: RivetTheme

  // glance 面板（状态行 / 错误行；metrics 行自 C4 概念稿 C 起由 renderLive
  // 在输入行下方常驻渲染，不经快照）
  /** 状态行文本（formatTurnStatus 输出；已着色 ANSI 行或 null 不渲染）。 */
  glanceStatus: string | null
  /** agent 错误行（glance 控制器 current().error；无错误 null）。 */
  glanceError: string | null

  // tasks 面板（任务窗格 + 后台任务区 + 完成通知）
  /** 任务窗格显隐（/tasks 切换）。 */
  taskPanelVisible: boolean
  /** 任务窗格投影快照（服务缺失/未写入 null → 不渲染）。 */
  taskItems: TaskItem[] | null
  /** 后台任务同步快照（tasks.list()；逐行渲染）。 */
  taskSnapshots: TaskSnapshotView[]
  /** 任务完成通知（onTaskDone 一次性提示行；渲染后由组合器清空）。 */
  taskNotice: string | null

  // status 面板（goal/todos/plan 投影）
  /** /status 面板显隐。 */
  statusPanelVisible: boolean
  /** goal 投影快照（未写入 null）。 */
  goal: GoalProjectionInput | null
  /** todos 投影快照（未写入 null）。 */
  todos: TaskItem[] | null
  /** plan 投影快照（未写入 null）。 */
  plan: PlanProjectionInput | null
  /** 会话级汇总段（summary-state 本地 fold；无已完成轮时 turns 为 0，面板段不渲染）。 */
  sessionTotals: SessionTotalsInput

  // delegation 面板（委派树）
  /** /subagents 面板显隐。 */
  subagentsPanelVisible: boolean
  /** 委派树条目（listDescendants 预取；null = 服务缺失/未预取 → 降级不渲染）。 */
  delegationEntries: DelegationTreeEntry[] | null
  /** 按 id 键控的 subagent 身份投影（label/mode 覆盖）。 */
  subagentIdentities: ReadonlyMap<string, DelegationIdentityProjection>
  /** 按 id 键控的 subagent 耗时投影。 */
  subagentTimings: ReadonlyMap<string, DelegationTimingProjection>

  // workflow 面板（运行中 + 已结算 run）
  /** /workflow 面板显隐。 */
  workflowPanelVisible: boolean
  /** 运行中 + 已结算 run 的视图数组（组合器已把 Map 折叠为视图；含终态汇总）。 */
  workflowRuns: WorkflowRunView[]

  // config 面板
  /** /config 面板显隐。 */
  configPanelVisible: boolean
  /** config 面板投影（服务缺失 null → 不渲染）。 */
  configProjection: ConfigPanelProjection | null

  // skills 面板
  /** /skills 面板显隐。 */
  skillsPanelVisible: boolean
  /** skill 快照缓存（ctx.skills.list；空数组 = 无技能或未加载）。 */
  skillItems: SkillSummaryInput[]

  // P3：会话 tab 栏（多会话 side conversation）
  /** 当前活跃会话 id（tab 高亮；未 attach null）。 */
  activeSessionId: string | null
  /** 全部 live 会话的 tab 投影（id + agent 状态）。 */
  sessionTabs: Array<{ id: string; status: 'idle' | 'running' }>
}
