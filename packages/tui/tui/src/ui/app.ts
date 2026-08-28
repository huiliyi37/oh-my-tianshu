/**
 * TuiApp — 会话界面主装配（中等 MVP）。
 *
 * 装配关系（渲染核心 + 适配层 + 本装配）：
 * - CommitEngine：scrollback 转录区（不可回退的已提交行）
 * - LiveEngine：底部 live 区（输入行 + 状态行 + 流式尾巴）
 * - InputHandler：raw-mode 键盘事件 → 键路由
 * - InputLine：输入缓冲区/光标/历史
 * - BlockStreamWriter + StreamRenderer：assistant 流式块 → markdown 提交
 * - adapter.transcript：会话事件日志 → TranscriptView 投影
 * - adapter.send：提交/取消 → AgentControls
 * - adapter.sessions：会话列表/新建/切换/退出 flush
 * - adapter.live：agent 实时状态（status/inbox/error）
 *
 * 反目标（不做）：设置/权限审批/主题定制/插件管理、slash 命令全集、
 * worker/星域面板。本装配只覆盖目标 1-6。
 *
 * @module @huiliyi37/dsh-tui/ui
 */

import { randomUUID } from 'node:crypto'
import { execFileSync, execSync } from 'node:child_process'
import { estimateCost } from '../format/pricing.js'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReadStream, WriteStream } from 'node:tty'
import type { Context } from '@huiliyi37/cordis'
import { SessionId, lastActivityTime, type SessionEvent } from '@huiliyi37/dsh-session'
import type { CallId, ImageBlock, ReasoningEffortId, TokenUsage } from '@huiliyi37/dsh-llm'
import type { IntentBridgeService } from '@huiliyi37/dsh-intent-bridge' // 'intent-bridge/handoff' event + ctx.intentBridge declaration merge
import { installModelSelection, type Agent, type AgentHandle, type ModelSelection, type ModelSelectionRef } from '@huiliyi37/dsh-agent'
// 空类型导入引入 Context 上 agentDefaultModel 服务的声明合并（headless 同款）。
import type {} from '@huiliyi37/dsh-agent-default-model'
import { CommitEngine } from '../engine/commit-engine.js'
import { ANSI, color, imageProtocol, osc52Clipboard } from '../engine/ansi.js'
import {
  LiveEngine,
  LIVE_TOOL_CARD_MAX,
  liveHasSpinner,
  liveIdleKey,
  liveMaxRowsFor,
  nextDynamicBudget,
  padDynamicRegion,
  shouldSkipIdleAssemble,
  workingRowsCap,
  type LiveRegionLine,
} from '../engine/live-engine.js'
import { WriteBatcher } from '../engine/write-batcher.js'
import { InputHandler, type KeyPress, type KeyName } from '../engine/input-handler.js'
import { InputLine, inputViewportMaxLines } from '../engine/input-line.js'
import { InputController, type SlashHintEntry } from '../engine/input-controller.js'
import { ResizeHandler } from '../engine/resize-handler.js'
import { BlockStreamWriter } from '../block-stream-writer.js'
import { StreamRenderer } from '../engine/stream-renderer.js'
import { TuiPerfMonitor, isTuiPerfEnabled } from '../engine/perf-monitor.js'
import { loadClipboardImageAttachment, loadImageAttachment, looksLikeImagePath, MAX_IMAGES } from '../engine/image-attach.js'
import { InputHistoryStore } from '../engine/input-history-store.js'
import { readImageFromClipboard, readTextFromClipboard, FOCUS_DEBOUNCE_MS } from '../engine/clipboard-image.js'
import {
  encodeTermImage,
  parseImageDataUrl,
  prepareTermImageForCommit,
  type PreparedTermImage,
} from '../engine/term-image.js'
import {
  FALLBACK_MAX_ROWS,
  hexToRgb,
  NEUTRAL_PREVIEW_BACKGROUND,
  PREVIEW_MAX_COLS,
  PREVIEW_MAX_ROWS,
  renderHalfBlockPreview,
} from '../engine/image-preview.js'
import { createTranscript, type Transcript, type TranscriptMessage, type TranscriptToolCall } from '../adapter/transcript.js'
import { resolveToolViews, type ToolPresenterSource } from '../adapter/tool-view.js'
import { trackAgent, type LiveAgent } from '../adapter/live.js'
import { controlsFromHandle, controlsFromRegistry, type AgentControls } from '../adapter/send.js'
import { listSessions, flushAll, getSession, loadHistory, type SessionSummary } from '../adapter/sessions.js'
import { supportsOsc52 } from '../term-caps.js'
import { getTheme, getActiveThemeName, setTheme, THEME_NAMES, type RivetTheme, type ThemeName } from '../theme.js'
import { displayWidth, ambiguousWideEnabled } from '../width.js'
import { PickerController, type PickerItem } from '../picker.js'
import { DEEPSEEK_KEY_TARGET, KeyDialogController, probeDeepSeekKey, type KeyDialogCredentials, type KeyDialogTarget } from './key-dialog.js'
import { buildProviderItems, resolveKeyRef, type WizardProviderEntry } from './key-wizard.js'
import { detectTerminalBackground, autoThemeFor } from '../theme-detect.js'
import { formatUserMessage } from '../format/user-message.js'
import { formatSteerMessage } from '../format/steer-message.js'
import { formatToolCardLive, toolCardTitle } from '../format/tool-card.js'
import { lspBadgeText } from '../format/lsp-diagnostics.js'
import { formatToolViewCard } from '../format/tool-view-card.js'
import { formatReasoningBlock, formatReasoningLive, reasoningTailBudget } from '../format/reasoning.js'
import { accumulateUsage, formatSessionCostReport, type SessionCostBucket } from '../format/session-cost.js'
import { renderKeymapPanel } from '../format/keymap-panel.js'
import { renderSessionExport } from '../format/export.js'
import type { TaskItem } from '../format/task-panel.js'
import {
  createLspBridge,
  officialLspSource,
  type LspBridge,
  type LspDiagnosticSource,
  type LspDiagnosticView,
  type OfficialLspServiceFacet,
} from '../lsp/lsp-bridge.js'
import type { MultiLspOptions } from '../lsp/multi-manager.js'
// T1.2：/status 状态面板渲染函数（status-panel.ts 由 status_panel 维度提供；
// 数据源为投影总线缓存——纯函数只读，不发明事件词汇）。Wave 2：面板行渲染
// 统一由 render/live-panels 的 7 面板纯函数承担，app.ts 只 import 类型做快照组装。
import type { GoalProjectionInput, PlanProjectionInput } from '../status-panel.js'
// 投影层接线（见本包 docs 目录的 projection-layer.md）：turn 级工具统计（turn/end 摘要行）
// 与会话级汇总（/status 会话段）——纯 fold 模型，输入即 session 事件流。
import { applyTurnEvent, emptyTurnSummary, type TurnSummaryState } from '../turn-summary.js'
import { applySummaryEvent, emptySummaryState, summarizeSession, type SummaryState } from '../summary-state.js'
import { formatTurnSummary as renderTurnSummaryLine } from '../format/turn-summary.js'
import { getToolFamily } from '../format/tool-meta.js'
import type {
  DelegationProgressProjection,
  DelegationTreeEntry,
  ExternalRunEntry,
} from '../delegation-panel.js'
import type { WorkflowRunView, WorkflowResultInfoInput } from '../workflow-panel.js'
import { foldActivityItems, type ActiveTaskInput, type ActivityItem, type SubagentRunInput, type WorkflowRunInput } from '../format/activity-band.js'
import { formatElapsedHuman } from '../format/spinner-status.js'
import {
  projectQuestionPanel,
} from '../question-panel.js'
import { ConfigPanelController, type ConfigCategory, type ConfigField, type ConfigFieldAction, type ConfigPanelData } from '../config-panel.js'
import type { SkillSummaryInput } from '../skill-panel.js'
/** Wave 2：renderLive 面板纯函数 + 单帧快照类型（app.ts → render/ 单向依赖）。 */
import {
  renderGlancePanel,
  renderTodosPanel,
  renderTasksPanel,
  renderStatusPanel,
  renderDelegationPanel,
  renderWorkflowPanel,
  renderSkillsPanel,
  renderLspPanel,
  renderActivityBand,
} from '../render/live-panels.js'
import type { LiveSnapshot } from '../render/live-snapshot.js'
/** T1.1：6 域投影 key（与 sessionProjections 注册表的 wire key 对齐）。 */
type ProjectionKey = 'todos' | 'plan' | 'goal' | 'subagent' | 'subagentTiming' | 'cacheHealth'

/** plan 投影的 wire 形状（与 plan-mode 的 PlanProjection 对齐；不引入依赖）。 */
interface PlanProjectionWire {
  active: boolean
  pending: boolean
}

/** T1.1：sessionProjections 5 域最小服务面（不引入 dsh-session-projection 依赖）。 */
interface ProjectionFacet {
  snapshot(session: unknown): { values: Partial<Record<ProjectionKey, unknown>> }
  onChanged(listener: (
    session: { id: SessionId },
    key: string,
    value: unknown,
    seq: number,
  ) => void): () => void
}

/** T2.1：委派树 listDescendants 返回项（复用 delegation-panel 的纯数据形状）。 */
type DelegationEntry = DelegationTreeEntry

/** T2.1：subagents 服务最小面（listDescendants 预取；事件经 ctx.on('subagent/…')）。 */
interface SubagentsFacet {
  listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<DelegationEntry[]>
  /** 终止一个 live continuable 子代理的当前 turn（one-shot 目标是服务层 no-op）。 */
  interrupt(targetSessionId: SessionId, authority: { kind: 'user'; parentSessionId: SessionId }): void
  /**
   * G3：活跃外部（无本地 Session）run 的等价状态面。服务一经装配即有此面
   * （同一构建内 SubagentService 定义唯一、版本随 workspace 锁定），类型化
   * 同进程边界不做投机缺省。
   */
  activeExternalRuns(): ExternalRunEntry[]
}

/**
 * 投影总线的 subagentProgress 值结构校验：sessionProjections 经
 * `ctx.reflect.get` 取得，`onChanged` 以 `unknown` 交付投影值（通用总线
 * 边界，非类型化同进程通道），入缓存前按结构收窄。
 */
function isSubagentProgressValue(value: unknown): value is DelegationProgressProjection {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.toolCalls === 'number'
    && typeof v.tokensUsed === 'number'
    && typeof v.toolInFlight === 'boolean'
}

/** T2.3：tasks 服务最小面（不引入 dsh-tasks 依赖；id 运行时即 string）。 */
interface TasksFacet {
  list(): TaskSnapshotView[]
  kill(id: string, caller?: unknown, reason?: string): 'requested' | 'already-finished'
  onTaskDone(listener: (snapshot: TaskSnapshotView) => void): () => void
  attachSurface(name: string): () => void
}

/** T2.3：tasks.list() 返回项的最小 wire 形状（status/detail/startedAt 渲染所需）。 */
interface TaskSnapshotView {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  readonly detail?: string
  readonly startedAt: number
}

/** T2.2：workflow/start|phase|log|agent-start|agent-end|end 事件 payload 的最小 wire 形状。 */
interface WorkflowRunInfoWire {
  readonly id: string
  /** run 的 meta 块（workflow/start 携带；可选——旧形状事件无 meta 时回退 id）。 */
  readonly meta?: WorkflowMetaWire
}
interface WorkflowMetaWire {
  readonly name: string
  readonly description?: string
  readonly phases?: { title: string }[]
}
/** 规范化后的 run meta（创建时 name/description 必有值；与 WorkflowMetaInput 形状一致）。 */
interface WorkflowMetaNormalized {
  readonly name: string
  readonly description: string
  readonly phases?: { title: string }[]
}
interface WorkflowAgentWire {
  readonly seq: number
  readonly label: string
  readonly phase?: string
  /** 子代理会话 id（workflow/agent-start 载荷；roster 关联用，旧形状可缺省）。 */
  readonly childId?: string
}
interface WorkflowAgentEndWire extends WorkflowAgentWire {
  readonly outcome: 'completed' | 'failed' | 'cancelled'
}
interface WorkflowResultWire {
  readonly stopReason: string
  readonly error?: string
}

/** 单个 run 保留的最近叙述行上限（workflow/log drop-oldest 防刷屏）。 */
const WORKFLOW_LOG_CAP = 20

/** T2.2：运行中 workflow 缓存项（key = payload.id；随 start 建、end 移除）。 */
interface WorkflowRunState {
  readonly id: string
  /** run 的 meta 块（start 事件携带，创建时规范化——name 缺省回退 id，description 缺省空串）。 */
  readonly meta: WorkflowMetaNormalized
  /** run 开始时间（start 事件落地；elapsedMs 数据源）。 */
  readonly startedAt: number
  /** 最近一次 workflow/phase 标题；无 phase 事件时为 null。 */
  phase: string | null
  /** 已建立的 agent() 调用（agent-start 追加，agent-end 标记 outcome）。 */
  /** 已建立的 agent() 调用（agent-start 追加 childId，agent-end 标记 outcome）。 */
  agents: { seq: number; label: string; childId?: string; outcome?: 'completed' | 'failed' | 'cancelled' }[]
  /** 脚本叙述行（workflow/log；cap 20 drop-oldest 防刷屏）。 */
  logs: string[]
}
import { WorkflowStatusLine } from '../statusline.js'
import {
  BUILTIN_COMMAND_NAMES,
  SlashCommandRegistry,
  createBuiltinCommands,
  resolveSlashCommand,
  suggestCommands,
  type ModelFacet,
} from '../commands/registry.js'
import { FOOTER_INFO_LEVELS, prefsEnabled, readPrefs, writePrefs, type TuiPrefs } from '../prefs.js'
import { writeBell } from '../term-bell.js'
import { formatQueueLine, SubmitQueueController, cancelAndSendInput } from '../controllers/submit-queue.js'
import { renderTranscript, parseToolArguments, toolResultText, type RenderedRow } from './render.js'
import { CommandPalette } from '../command-palette.js'
import { OverlayController } from '../engine/overlay-controller.js'
import { MetricsGlanceController } from '../engine/metrics-glance-controller.js'
import type { FormatGlanceBarInput } from '../format/glance-bar.js'
import { formatPermissionDiff } from '../format/permission-diff.js'
import { formatApprovalCard } from '../format/approval-card.js'
import { HistorySearchOverlay } from '../format/history-search-overlay.js'
import { RewindOverlay, type RewindMode, type RewindResult } from '../format/rewind-overlay.js'
import { openInEditorDetailed, getEditorCommand } from '../external-editor.js'
import { FluencyTracker } from '../fluency-hook.js'
import { expandMentions } from '../mention-expand.js'
import { formatRestorableSessions, formatSessionAge, formatRestorablePickerList, projectRestorableSessions, wasCrashRepaired, type RestorableSession } from '../restore-session.js'
import { shortSessionLabel } from '../session-label.js'
import { sessionTitleFor } from '../adapter/session-title.js'
// 副作用声明合并：让 ctx.on('approval/request') 的 handler 参数由 cordis 事件
// 类型推导（user-approval 的 module augmentation）。不 import 具体类型——
// 该包的 lib 声明带 .ts 后缀相对导入，跨包 tsc 解析会触发 rootDir 冲突。
import type {} from '@huiliyi37/dsh-user-approval'
// T2.1/T2.2：subagent/workflow 事件从属主 import（module augmentation 同源，
// 避免本地 wire 声明与属主 Events 合并成 union 污染全局 ctx.on 类型；
// handler 参数仍按本地结构子集标注，属主类型逆变兼容）。
import type {} from '@huiliyi37/dsh-subagent'
import type {} from '@huiliyi37/dsh-workflow'
// hook/result 事件的属主声明(hook-protocol)——module augmentation 同源,
// 让 switch 的 'hook/result' case 与 data.systemMessage 获得类型。
import type {} from '@huiliyi37/dsh-hook-protocol'
// Type-only：让 ctx.get('modelRoles') 解析到角色 pin 服务（可选缝，从不硬依赖）。
import type { ModelRole } from '@huiliyi37/dsh-model-roles'
import {
  FOLLOW_DEFAULT_VALUE,
  MODEL_ROLES_UNAVAILABLE,
  MODEL_ROLE_LABELS,
  buildRoleModelPickerItems,
  parseRouteKey,
  rolePinEcho,
  roleUnpinEcho,
  roleVisionWarning,
  type RoleCatalogProvider,
} from '../model-roles.js'

/** Phase 8：审批 answerer 的请求/结果类型由 ApprovalController 持有（单向依赖）。 */
import {
  ApprovalController,
  type PendingApprovalRequest,
  type ApprovalOutcome,
} from '../controllers/approval-controller.js'
import {
  WelcomeIntroController,
  type WelcomeIntroSettleReason,
} from '../controllers/welcome-intro-controller.js'
import { QuestionController } from '../controllers/question-controller.js'
import { BtwController } from '../controllers/btw-controller.js'
import { SessionManager } from '../controllers/session-manager.js'
import { renderBtwPanel } from '../format/btw-panel.js'
import { formatFoxFrame } from '../format/fox.js'
import {
  CHROME_GUTTER,
  formatWelcome,
  pickWelcomeTip,
  resolveWelcomeArtWidth,
} from '../format/welcome.js'
import { formatTopBar } from '../format/top-bar.js'
import { formatSeparator } from '../format/separator.js'
import { formatTurnStatus } from '../format/turn-status.js'
import { formatPromptFooter } from '../format/prompt-footer.js'
import { formatInputFrame, promptBorderColor } from '../format/input-frame.js'
import { formatTopStatusBar } from '../format/top-status-bar.js'
import { formatSlashMenu, SLASH_MENU_MAX_ROWS } from '../format/slash-menu.js'
import { formatSubagentRunning, formatSubagentDone } from '../format/subagent-line.js'
import { glanceBarSegments } from '../format/glance-bar.js'
import { MemoryBrowserOverlay } from '../format/memory-overlay.js'
import { TranscriptViewer } from '../format/transcript-viewer.js'
import { settingsNamespace } from '@huiliyi37/dsh-settings'
import { findRecommendedRoute, routeResolvesDirectory, subagentRoutingNudgeText, type RoutingDirectoryProvider } from '../subagent-routing-config.js'
import { zenPhaseLabel } from '../preset-surface.js'
import { formatCacheMissReason, isReportableMiss } from '../cache-telemetry.js'
import type { CacheHealthWire } from '../cache-telemetry.js'

/**
 * A1：CommandService 的最小消费面（不引入 dsh-commands 依赖）。
 * execute 的返回形状对齐 CommandExecution：undefined = 命令未知名。
 * images 为 composer 图片（ImageBlock dataUrl 形态），随命令信封透传；
 * 未声明 input.images 的命令由 executor 拒绝为 error result。
 * find 供 isKnownCommand 把插件注册的命令（/goal、/plan）与单段文件路径
 * 区分开——缺省时退化为仅内置注册表判定（A1 之前的旧行为）。
 */
interface CommandServiceFacet {
  execute(
    agent: unknown,
    line: string,
    signal: AbortSignal,
    images?: readonly ImageBlock[],
  ): Promise<{ result: { kind: 'success' | 'error'; text?: string } } | undefined>
  find?(agent: unknown, name: string): unknown
}

/** P2：memory 服务最小消费面（不引入 dsh-memory 依赖；reflect 动态获取）。 */
interface MemoryServiceFacet {
  list(opts?: { scope?: string; limit?: number; offset?: number }): Promise<Array<{
    id: string
    text: string
    tags: string[]
    createdAt: number
    scope: string
  }>>
  delete(id: string): Promise<void>
}

/** credentials.describe 最小面（不引入 dsh-credentials peer；ref 为 POSIX 标识符）。 */
interface CredentialsDescribeFacet {
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable?: boolean }>
}

/**
 * /key 向导消费的 settings 最小面（不引入 dsh-settings peer；describe 的 ns
 * 对象原样保留供 mutate 回传，绕开 branded namespace 的构造）。
 */
interface KeyWizardSettingsFacet {
  /** 各命名空间的已解析段（ns 对象 + value）。 */
  describe(options?: { redactSecrets?: boolean }): Array<{ ns: unknown; value: unknown }>
  /** 路径操作写入（用户层合并，热生效）。 */
  mutate(ns: unknown, ops: readonly { op: 'set'; path: readonly string[]; value: unknown }[]): Promise<void>
}

/** llm.resolveModelInfo 识图最小面（可选服务仍经 reflect 降级读取）。 */
interface LlmModelInfoFacet {
  resolveModelInfo(provider: string, model: string): Promise<{
    supportsVision?: boolean
  }>
}

/** Fixed welcome-opening policy selected at runner load. */
export type WelcomeAnimationMode = 'auto' | 'off'

/** TuiApp 构造选项。 */
export interface TuiAppOptions {
  ctx: Context
  stdout: WriteStream
  stdin: ReadStream
  /** 启动时切入的会话 id；缺省优先恢复最近会话（live store 为空才新建）。 */
  initialSessionId?: SessionId
  /** 主题名；'auto' 走系统终端配色探测，缺省 'auto'。 */
  theme?: string
  /** 欢迎策略；`auto` 与 `off` 都立即提交所选档的静态狐狸。 */
  welcomeAnimation?: WelcomeAnimationMode
  /** Ctrl+C 连按窗口内第二次的退出回调（不要求空输入；raw-mode 下 Ctrl+C 是数据字节非 SIGINT）。 */
  onExit?: () => void
  /** /restart：请求重启当前 dsh 进程（装配方负责 dispose + spawn 同 argv + 退出）。 */
  onRestart?: () => void
  /** 外部编辑器触发键（KeyName）；缺省 'ctrl_e'（ctrl+o 已恢复为推理展开，Phase 6.4）。 */
  editorKey?: KeyName
  /** 外部编辑器命令；缺省 $VISUAL/$EDITOR/平台缺省（测试注入点）。 */
  editorCommand?: string
  /** 输入历史文件路径；缺省 $DSH_HOME/input-history.json（测试注入点）。 */
  historyPath?: string
  /** 本地偏好文件路径（~/.dsh-tui/prefs.json）；缺省按 VITEST 密封规则解析（测试注入点）。 */
  prefsPath?: string | null
  /** 是否启用 Vim 键位（Phase 6.5）；缺省 false。 */
  vimEnabled?: boolean
  /**
   * 主控模型的识图能力与视觉桥状态（图片附件的用户气泡提示数据源；
   * 由装配方按 agent 配置注入——TUI 是纯表现层，不自行查询模型能力）。
   */
  vision?: {
    /** 主控模型是否原生支持识图（图片直发）。 */
    supportsVision?: boolean
    /** 是否配置了独立识图桥模型（主控不识图时经桥转文字描述）。 */
    bridgeEnabled?: boolean
    /** 识图桥来源（configured=显式配置 / auto=自动选用）。 */
    bridgeSource?: 'configured' | 'auto' | 'none'
  }
  /** LSP 诊断桥（本地语言服务；懒启动——首个触碰文件才 spawn server）。
   *  诊断只进 TUI 本地展示缓存，不写会话事件、不注册任何模型面。 */
  lsp?: {
    /** 是否启用诊断拉取；缺省 true。 */
    enabled?: boolean
    /** 单次诊断拉取超时（毫秒）；缺省 2000。 */
    timeoutMs?: number
    /** 测试注入：语言 server spawn（透传 LspBridgeOptions.spawnFor）。 */
    spawnFor?: MultiLspOptions['spawnFor']
    /** 测试注入：server 可用性探测（透传 LspBridgeOptions.which）。 */
    which?: MultiLspOptions['which']
  }
  /** 统一活动带：活跃 item 行数封顶（正整数；超限折叠 +N 尾行）；缺省 5。 */
  activityBandMaxRows?: number
  /** 统一活动带开关；false 回退旧散行渲染（逃生门，对比/回退用）；缺省 true。 */
  activityBand?: boolean
}

/** live 区预留行（顶轨 + 输入 + 底轨 + footer）。 */
const LIVE_RESERVED_ROWS = 4
/** 低于该行数时 live 区沿用紧凑布局。 */
const LIVE_COMPACT_MIN_ROWS = 22
/**
 * Welcome metadata is decorative and must never hold the interactive surface
 * hostage. This fixed UX guard is deliberately not a deployment tuning knob.
 */
const WELCOME_MODEL_METADATA_TIMEOUT_MS = 1_000

/** 双击 Esc 触发 rewind 的窗口（ms；对齐 Claude Code 的 Esc+Esc 时间回溯）。
 *  比 Ctrl+C 双击退出的 2s 短——rewind 是高频操作，双击节奏更跟手。 */
const REWIND_DOUBLE_ESC_MS = 1000

/** rewind 检查点：真人用户说过的非空 `user/message`，不含插件注入与空助手行。 */
function isUserRewindCheckpoint(message: TranscriptMessage): boolean {
  return message.kind === 'user'
    && message.text !== ''
    && message.event.type === 'user/message'
    && message.event.data.source.kind === 'user'
}

/** A3：`oh-my-tianshu tui --help` 输出的用法文本（port of dsh-tianshu-tui#21）。 */
const USAGE_TEXT = `oh-my-tianshu tui — oh-my-tianshu 交互式终端界面 / interactive terminal UI

用法 / Usage:
  oh-my-tianshu tui                   启动交互式 TUI / start the interactive TUI
  oh-my-tianshu tui "<提示词>"        启动并直接发送提示词 / start and send a prompt
  oh-my-tianshu tui --session <id>    恢复指定会话 / resume the session with <id>
  oh-my-tianshu tui --help            显示本帮助 / show this help
  oh-my-tianshu tui --version         输出版本 / print the version

快捷键 / Keys: ctrl+n 新会话 · ctrl+s 恢复 · ctrl+p 命令面板 · / slash 命令 · esc 打断 · shift+enter 换行模式 · ctrl+j 换行 · ctrl+o 展开推理 · shift+tab 模式循环 · ctrl+c 连按退出进程
`

/** C3 项 3：写工具名判定（与 fs-snapshot 的 trackEdit 钩子同一集合）。 */
function isWriteToolCall(name: string): boolean {
  return name === 'write' || name === 'edit' || name === 'str_replace_editor'
}

/**
 * 提交前规范化图片数组：只保留合法 data URL（parseImageDataUrl 校验），
 * 截断到 MAX_IMAGES 上限。空/全非法返回 undefined（与无图提交同形）。
 * @param images - 输入框携带的图片 data URL 列表
 * @returns 规范化后的图片列表；无有效图片时 undefined
 */
function normalizeSubmitImages(images?: string[]): string[] | undefined {
  if (images === undefined || images.length === 0) return undefined
  const valid = images.filter(u => parseImageDataUrl(u) !== null).slice(0, MAX_IMAGES)
  return valid.length === 0 ? undefined : valid
}

/** 判断输入是否更像文件路径而非 slash 命令（移植自本体 looksLikeFilePath）：
 *  /src/main.ts、/tmp/foo bar、~/xxx、Windows 盘符 C:\... 走普通文本流程；
 *  /exit 等已知命令、/h 等命令前缀仍视为命令（触发解析/提示）。
 *  单段绝对路径（/etc、/mnt）依赖 isKnownCommand 谓词区分命令与路径。 */
function looksLikeFilePath(
  input: string,
  isKnownCommand?: (name: string) => boolean,
  isCommandPrefix?: (name: string) => boolean,
): boolean {
  if (input.startsWith('~/')) return true
  // Windows 盘符路径 C:\... 或 C:/...（不是 slash 命令）
  if (/^[a-zA-Z]:[\\/]/.test(input)) return true
  if (!input.startsWith('/')) return false
  const rest = input.slice(1)
  const slashIdx = rest.indexOf('/')
  if (slashIdx !== -1) {
    const spaceIdx = rest.indexOf(' ')
    return spaceIdx === -1 || slashIdx < spaceIdx
  }
  // 单段 /xxx：可能是命令（/exit）也可能是路径（/etc, /mnt）
  if (isKnownCommand) {
    const firstToken = rest.split(/\s/)[0] ?? ''
    if (firstToken === '') return false
    if (isCommandPrefix?.(firstToken)) return false
    return !isKnownCommand(firstToken)
  }
  return false
}

/**
 * 读取当前 git 分支（C4 概念稿 A top bar；attach 时一次，静默）。
 * detached HEAD 或非仓库返回 undefined（不渲染分支段）。
 */
function gitBranch(): string | undefined {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      windowsHide: true,
    }).trim()
    return out === '' || out === 'HEAD' ? undefined : out
  } catch {
    return undefined
  }
}

/**
 * git 未提交改动文件数（`git status --short` 非空行计数；footer ●N 数据源）。
 * 非仓库/命令失败返回 0（静默降级，同 gitBranch）。
 * @returns 未提交文件数；0 = 干净或不可检测。
 */
function gitDirtyCount(): number {
  try {
    const out = execSync('git status --short', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      windowsHide: true,
    })
    return out.split('\n').filter(l => l.trim() !== '').length
  } catch {
    return 0
  }
}

/**
 * 解析 slash 命令（最小唯一前缀匹配，委托 registry 解析核心）。
 * 兼容导出（steer.spec.ts 消费）；TuiApp 内部走实例注册表（含扩展命令）。
 * @param input - 输入行提交的原始文本（已 trim）。
 * @returns 匹配的命令名与剥离后的参数文本；未匹配返回 null。
 */
export function parseSlashCommand(input: string): { kind: string; text: string } | null {
  const parsed = resolveSlashCommand(input, BUILTIN_COMMAND_NAMES)
  return parsed === null ? null : { kind: parsed.command.name, text: parsed.text }
}

/** 命令 → InputController 提示条目的投影（slash hint / Tab 补全数据源）。 */
/**
 * Spread one selection into create/resume/exec options without inventing an omitted effort.
 * @param selection - current or persisted provider/model/effort.
 * @returns the same fields, with `reasoningEffort` present only when selected.
 */
function callConfigFrom(selection: ModelSelection): {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
} {
  return {
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
  }
}

function toSlashHint(command: { name: string; description: string; argsHint?: string }): SlashHintEntry {
  return {
    name: command.name,
    description: command.description,
    ...(command.argsHint === undefined ? {} : { argsHint: command.argsHint }),
  }
}

/**
 * 会话界面主装配。生命周期：构造 → attach()（接管终端）→ dispose()（恢复终端）。
 * attach 前不写终端；dispose 后终端恢复 raw-mode 前状态。
 */
/**
 * 读发行版本:向上找 `@huiliyi37/oh-my-tianshu`(CLI 发行)的 package.json,
 * 并在每层检查 scope 兄弟目录(运行时 oh-my-tianshu 与 dsh-tui 在
 * `@huiliyi37/` 下同级);找不到回退 `@huiliyi37/dsh-tui`(TUI 包,源码/单测
 * 场景)。欢迎页副标题展示用。
 */
/** /config 概览字段的值显示：标量直出、对象紧凑 JSON、null → —（防渲染崩溃的形状回退同旧面板）。 */
function formatConfigValue(value: unknown): string {
  if (value === undefined || value === null) return '—'
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return String(value)
    case 'symbol':
    case 'function':
    case 'bigint':
      return typeof value
    default:
      return JSON.stringify(value)
  }
}

/** /config 概览字段的 secrets 脱敏标记（有值槽计数 / 空槽占位）。 */
function configSecretMark(secrets: { set: boolean }[] | undefined): string {
  if (secrets === undefined || secrets.length === 0) return ''
  const set = secrets.filter(secret => secret.set).length
  return set > 0 ? ` 🔒 ${set} 密钥已脱敏` : ' 🔒 密钥槽'
}

function readDistributionVersion(): string | undefined {  const start = fileURLToPath(new URL('.', import.meta.url))
  let fallback: string | undefined
  let dir = start
  for (let i = 0; i < 8; i++) {
    // 当前目录是 scope 根时,横向检查发行包兄弟
    try {
      const distPkg = JSON.parse(readFileSync(join(dir, '@huiliyi37', 'oh-my-tianshu', 'package.json'), 'utf8')) as { version?: unknown }
      if (typeof distPkg.version === 'string') return distPkg.version
    } catch {
      /* 非 scope 根/未装配发行包,继续向上 */
    }
    // 当前目录自身是包:发行包直接返回,TUI 包记回退
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
      if (pkg.name === '@huiliyi37/oh-my-tianshu' && typeof pkg.version === 'string') return pkg.version
      if (pkg.name === '@huiliyi37/dsh-tui' && typeof pkg.version === 'string') fallback = pkg.version
    } catch {
      /* 非包目录,继续向上 */
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return fallback
}

/**
 * TUI 应用装配体：把渲染引擎（live/commit/输入行）、会话适配层与命令面
 * 组装为一个可挂载/可 dispose 的终端应用（tui-runner 插件的宿主对象）。
 */
export class TuiApp {
  private readonly ctx: Context
  private readonly stdout: WriteStream
  private readonly stdin: ReadStream
  private readonly commit: CommitEngine
  private readonly live: LiveEngine
  private readonly input: InputHandler
  private readonly inputLine: InputLine
  private readonly resize: ResizeHandler
  private readonly blockWriter: BlockStreamWriter
  private readonly streamRenderer: StreamRenderer
  /** 渲染性能监测（--debug-perf / RIVET_DEBUG_TELEMETRY=1 时激活；默认零开销）。 */
  private readonly perfMonitor: TuiPerfMonitor
  /** 输入状态控制器（slash 提示 / Tab 补全数据源，W-B5 提取的输入状态）。 */
  private readonly inputController: InputController
  /** Slash 命令注册表：内置命令 + 'tui.commands' 服务面（外部插件可扩展）。 */
  private readonly slash: SlashCommandRegistry
  /** Ctrl+P 命令面板（overlay 渲染经 OverlayController 进出 alt screen）。 */
  private palette: CommandPalette | null = null
  /** API key 就绪标志（footer 右侧段；attach 时经 credentials.describe 刷新）。 */
  private apiKeyReady = Boolean(process.env.DEEPSEEK_API_KEY)
  private overlay: OverlayController | null = null
  /**
   * overlay 激活期间暂存的 scrollback 条目。alt screen 下 stdout 写入会盖住
   * 面板，且退出时终端恢复的是进入 overlay 前的主屏。
   */
  private deferredScrollback: Array<{ text: string; trailingNewline?: boolean }> = []
  /** C3 项 3：rewind overlay（/rewind 双阶段回退面板）。 */
  private rewindOverlay: RewindOverlay | null = null
  /** #31：交互式选择器 overlay（/model /theme /session 无参打开；上下键选择）。 */
  private picker: PickerController | null = null
  /** /key：API Key 设置对话框 overlay（掩码输入 + 探测 + credentials.set 落盘）。 */
  private keyDialog: KeyDialogController | null = null
  /** 首启引导守护：本 run 已自动弹过一次 key 对话框（restore 等后续流程不再重复弹）。 */
  private keyPromptShown = false
  /** 欢迎结算前挂起的缺 key 自动弹窗；input settlement 会取消该意图。 */
  private autoKeyDialogPending = false
  /** 当前进程 attach 的欢迎开场所有者；prepare 完成前为 null。 */
  private welcomeIntro: WelcomeIntroController | null = null
  /** attach 准备期始终缓冲输入；会话挂载后才同时缓冲后续 scrollback。 */
  private welcomePreparing = false
  /** 会话挂载完成后才拦截后续 scrollback；恢复历史必须先按权威顺序直接回放。 */
  private welcomeScrollbackBarrier = false
  private pendingWelcomeSettleReason: WelcomeIntroSettleReason | null = null
  private pendingWelcomeActions: Array<() => void | Promise<void>> = []
  private pendingWelcomeHadInput = false
  /** 双击 Esc 触发 rewind：第一次 Esc 的时间戳（0 = 无待定；窗口内第二次 Esc
   *  打开 rewind overlay，对齐 Claude Code 的 Esc+Esc 时间回溯）。 */
  private escRewindPendingSince = 0
  /** 最近一次 Ctrl+C 字节（0x03）处理时间戳；0 = 未处理过（SIGINT 防抖用）。 */
  private lastCtrlCAt = 0
  /** git 未提交改动文件数（gitDirtyCount 快照；attach + turn/end 刷新，0 = 干净/非仓库）。 */
  private gitDirty = 0
  /** A5：手动展开的进行中工具卡 callId（空输入 Enter 切换；turn/end 复位）。 */
  private expandedToolCallId: string | null = null
  /** P2：memory 浏览器 overlay（/memory 记忆列表/过滤/删除）。 */
  private memoryOverlay: MemoryBrowserOverlay | null = null
  /** T5：全屏转录查看器 overlay（/scroll scrollback 翻页/轮次跳转/搜索）。 */
  private transcriptViewer: TranscriptViewer | null = null
  /** Phase 9d：流利度追踪（tool 事件 → 渲染策略；stale 提示消费于 renderLive）。 */
  private readonly fluency = new FluencyTracker()
  /** Phase 5.3：底部 glance（状态/错误行派生 + 节流；renderLive 消费 current()）。 */
  private readonly glance: MetricsGlanceController
  /** Phase 5.3：glance metrics 行的 model 名缓存（会话挂载时更新一次；
   *  renderLive 每帧读缓存，不重复查询 agentDefaultModel——模型定路是
   *  mount 时的决策，渲染不该引入额外的 currentSelection 读取）。 */
  private glanceModelName: string | null = null
  /** 推理努力度缓存（挂载时 request/header 优先、currentSelection 兜底；
   *  request/header 事件更新——与 glanceModelName 同生命周期）。 */
  private glanceEffort: string | null = null
  /** 会话内最后一条 assistant/message 的 usage（缓存命中/上下文占比数据源；
   *  streamFeed 折叠，随会话挂载/卸载）。 */
  private usageFold: TokenUsage | null = null
  /** 会话成本累计（assistant/message usage 按模型分桶；/cost 数据源，
   *  随会话卸载复位）。 */
  private sessionCosts = new Map<string, SessionCostBucket>()
  /** 当前模型路由的上下文窗口（request/context 事件折叠；adapter 未报时 null）。 */
  private contextWindow: number | null = null


  private transcript: Transcript | null = null
  private liveAgent: LiveAgent | null = null
  private controls: AgentControls | null = null
  /** 运行中提交的本地排队（turn/end 投递、↑ 取回；见 controllers/submit-queue，回流 dsh-tui 9d7f421）。 */
  private readonly submitQueue = new SubmitQueueController()
  /** 委派树的路由 nudge 已出（每会话一次；见 subagent-routing-config）。 */
  private subagentRoutingNudgeShown = false
  /** 工作流阶段/活动投影（Phase 5.1/6.2）；随会话挂载/卸载，dispose 时解绑订阅。 */
  private statusLine: WorkflowStatusLine | null = null
  /** 流式提交供给的 session/event 订阅；随会话挂载/卸载。 */
  private streamFeed: (() => void) | null = null
  /** 本层经 create/resume 铸造的 handle；非 registry 兜底的裸 agent。dispose 时释放。 */
  private ownedHandle: AgentHandle | null = null
  private readonly initialSessionId: SessionId | undefined
  private readonly themeName: string
  private readonly onExit: (() => void) | undefined
  private readonly onRestart: (() => void) | undefined
  /** 外部编辑器触发键（Phase 6.4）；缺省 ctrl_e（ctrl+o 已恢复为推理展开）。 */
  private readonly editorKey: KeyName
  /** 外部编辑器命令注入（测试用）；缺省走环境变量/平台缺省。 */
  private readonly editorCommand: string | undefined
  private readonly vimEnabled: boolean
  /** T1.1：6 域投影缓存（snapshot 全量 + onChanged 按 key 分流；服务缺失时为 null → 整体降级）。 */
  private projectionCache: Partial<Record<ProjectionKey, unknown>> | null = null
  /** cacheHealth 投影最新快照（状态栏 miss 标记与诊断日志数据源；未装配时 null）。 */
  private cacheHealth: CacheHealthWire | null = null
  /** 已报告的缓存 miss 指纹（reason + turn），去重防同因重复刷屏。 */
  private lastReportedMiss: { reason: string; turn: number } | null = null
  /** T4：任务窗格——sessionProjections 任务单元投影快照（服务缺失时为 null）。 */
  private taskItems: TaskItem[] | null = null
  /** T4：任务窗格显隐（/tasks 切换）。 */
  private taskPanelVisible = false
  /** T2.1：委派树面板显隐（/subagents 切换）。 */
  private subagentsPanelVisible = false
  /** T2.2：workflow 运行中面板显隐（/workflow 切换）。 */
  private workflowPanelVisible = false
  /** T2.1：委派树缓存（listDescendants 预取 + subagent/start|end 事件刷新；
   *  null = subagents 服务缺失/未预取 → 面板降级不可用）。 */
  private delegationEntries: DelegationEntry[] | null = null
  /** 对话流 subagent 运行态（runId → 标签/起点/子会话 id；end 时结算并提交 scrollback）。 */
  private subagentRuns = new Map<string, { label: string; startedAt: number; childId: string }>()
  /** 活动带 child 投影缓存（运行中 subagent 的子会话 id → subagentProgress 快照；
   *  带行统计段与完成行统计数据源；subagent/end 时取快照后清除）。 */
  private childProgress = new Map<string, DelegationProgressProjection>()
  /** G3：活跃外部 run 快照（/subagents 面板 ⤷ 段；subagent/start|end 事件刷新）。 */
  private externalRuns: ExternalRunEntry[] = []
  /** T2.2：运行中 workflow 缓存（key = payload.id；start 建、end 移除）。 */
  private readonly workflowRuns = new Map<string, WorkflowRunState>()
  /** T2.2：已结算 run 视图缓存（workflow/end 折叠；/workflow 面板渲染运行中+已完成）。 */
  private readonly completedWorkflowRuns = new Map<string, WorkflowRunView>()
  /** T2.3：后台任务同步快照（tasks.list() 每次事件/会话挂载刷新）。 */
  private taskSnapshots: TaskSnapshotView[] = []
  /** T2.3：onTaskDone 完成通知（live 区提示行；一次性，渲染后清空）。 */
  private taskNotice: string | null = null
  /** /config 交互式设置面板控制器（overlay 'config-panel'；数据注入 + 编辑分派）。 */
  private configPanel: ConfigPanelController | null = null
  /** 编辑器关闭后回开 /config 面板的编舞旗标（dispatchConfigEdit 置位、finishConfigReturn 消费）。 */
  private configReturnPending = false
  /** T3.3：/skills 面板显隐（/skills 切换）。 */
  private skillsPanelVisible = false
  /** T3.3：skill 快照缓存（ctx.skills.list；空数组 = 无技能或未加载）。 */
  private skillItems: SkillSummaryInput[] = []
  /** T3.1：userInteraction provider 注册 disposer；attach 注册、dispose 释放。 */
  private interactionDisposer: (() => void) | null = null
  /** T3.1：挂起提问状态机（pendingQuestion + questionFeedbackMode；Wave 1 提取）。 */
  private readonly question: QuestionController
  /** C3 项 4：审批挂起状态机（pendingApproval + alwaysApprove；Wave 1 提取）。 */
  private readonly approval: ApprovalController
  /** P1：/btw 侧问状态机（临时 btw agent 旁路；Esc 折叠答案入 scrollback）。 */
  private readonly btw: BtwController
  /** P3：多会话快照层（live store 派生；tab 栏数据源）。 */
  private readonly sessionManager: SessionManager
  /** T2.1：subagent 生命周期事件订阅 disposer；随会话挂载/卸载。 */
  private subagentDisposer: (() => void) | null = null
  /** T2.2：workflow 事件订阅 disposer；attach 订阅、dispose 释放（跨会话运行）。 */
  private workflowDisposer: (() => void) | null = null
  /** T2.3：tasks onTaskDone 订阅 disposer；随会话挂载/卸载。 */
  private taskDoneDisposer: (() => void) | null = null
  /** T2.3：tasks attachSurface('tui') 控制面 disposer；attach 声明、dispose 释放。 */
  private taskSurfaceDisposer: (() => void) | null = null
  /** T1.4：plan 投影 active 态（驱动 statusline [plan] 徽标；服务缺失时为 false）。 */
  private planState: { active: boolean; pending: boolean } = { active: false, pending: false }
  /** C2 项 4：当前会话的模型选择 ref（newSession/switchSession 挂载）。 */
  private modelRef: ModelSelectionRef | null = null
  /** installModelSelection 的 disposer；切会话时卸掉，避免 live agent 叠装监听。 */
  private modelSelectionDisposer: (() => void) | null = null
  /** C2 项 2：历史搜索 overlay（Ctrl+F；attach 时注册，消息快照激活时提供）。 */
  private searchOverlay: HistorySearchOverlay | null = null
  /** T1.2：/status 面板显隐（/status 切换；数据源为投影缓存）。 */
  private statusPanelVisible = false
  /** /todos 紧凑待办面板显隐（/todos 切换；数据源为 todos 投影的保留快照）。 */
  private todosPanelVisible = false
  /** /todos 明细展开（false = 单行摘要卡）。 */
  private todosExpanded = false
  /**
   * todos 保留快照：只吸收非空投影值。todos 投影在 turn/start 时被 fold 重置
   * 为 null（tool-todo 的投影语义：清单随回合开始清空），若面板直接跟随投影，
   * 每回合开始都会闪烁消失——保留快照让已显示的清单跨回合黏滞，null 只在
   * 会话首次写入前出现（渲染「尚无待办」空态）。
   */
  private todosRetained: TaskItem[] | null = null
  /** LSP：/lsp 面板显隐（/lsp 切换）。 */
  private lspPanelVisible = false
  /** LSP：诊断桥（懒创建——首次工具触碰文件或 /lsp 打开时实例化；dispose 销毁）。 */
  private lspBridge: LspBridge | null = null
  /** LSP：装配配置（enabled/timeoutMs/spawnFor/which；缺省启用）。 */
  private readonly lspConfig: {
    enabled: boolean
    timeoutMs: number
    spawnFor?: MultiLspOptions['spawnFor']
    which?: MultiLspOptions['which']
  }
  /** 统一活动带：活跃 item 行数封顶（Config 校验后注入；缺省 5）。 */
  private readonly activityBandMaxRows: number
  /** 统一活动带开关；false 回退旧散行渲染（逃生门）。 */
  private readonly activityBandEnabled: boolean
  /** T4：任务投影变更订阅 disposer；随会话卸载释放。 */
  private projectionDisposer: (() => void) | null = null
  /** T5：紧凑渲染模式（/density 切换）——工具卡仅标题行。 */
  private compactMode = false
  /** 本地偏好文件路径；null = 持久化禁用（VITEST 密封），/info 仅会话内生效。 */
  private readonly prefsPath: string | null
  /** 已加载偏好（footerInfo 等）；persistPrefs 时合并写回 prefsPath。 */
  private prefs: TuiPrefs = {}
  /** reasoning 流缓冲（reasoning-delta 累积）；段结束 commitReasoningBlock 落底清空。 */
  private reasoningText = ''
  /** 当前推理段起点（首个 reasoning-delta 的事件时间，Unix epoch ms）；live/落底耗时数据源。 */
  private reasoningStartedAt: number | null = null
  /** 最近一次已落底推理块（折叠头行 + 保留全文；Ctrl+O 展开查看）。会话切换清理。 */
  private lastReasoningBlock: { text: string; elapsedMs?: number } | null = null
  /** Ctrl+O 展开/收起最近推理块（live 区展示全文；scrollback 保持折叠头行）。 */
  private reasoningExpanded = false
  /** 进行中工具的 presentCall 标题覆盖（callId → title）；result/abort/换会话清理。 */
  private readonly pendingCallTitles = new Map<CallId, string>()
  private activeSessionId: SessionId | null = null
  /** switchSession 代际号：连续切换时旧代作废，迟到的 resume 不再挂载。 */
  private switchEpoch = 0
  /** 输入历史（持久化存储：$DSH_HOME/input-history.json，跨会话；异步加载）。 */
  private historyStore: InputHistoryStore
  private history: string[] = []
  /** composer 半块缩略图：键为渲染时的最后一张附件；附件变化异步重算。 */
  private attachmentPreview: { dataUrl: string; lines: string[] } | null = null
  /** 缩略图渲染代际：附件快速增删时丢弃迟到结果。 */
  private attachmentPreviewEpoch = 0
  private tick = 0
  private ticker: ReturnType<typeof setInterval> | null = null
  /** 上一帧空闲键；overlay A6 停写时置 null，避免退出后误跳过重绘。 */
  private lastIdleKey: string | null = null
  /** ticker 回调里为真：只在这条路径上允许空闲跳过；按键/事件 flush 必须组装。 */
  private renderLiveFromTicker = false
  private disposed = false
  /** Cancels bounded startup lookups before teardown can return. */
  private readonly lifetimeAbort = new AbortController()
  /** OSC52 不支持警告：每进程首次触发时提示一次（P1-1；newSession 不重置，避免重复打扰）。 */
  private osc52WarningShown = false
  /** bracketed paste 处理器 disposer（attach 注册，dispose 释放）。 */
  private pasteDisposer: (() => void) | null = null
  /** intent-bridge handoff listener (re-registered on attach, cleared on dispose). */
  private intentBridgeDisposer: (() => void) | null = null
  /**
   * 动态段高水位（display rows），跨轮保留。回缩会使输入框上跳，并把旧轨线
   * 留在空隙里（重影）。新会话 / 切会话时归零。
   */
  private dynamicRowsHighWater = 0
  /** 渲染帧合并器：事件路径走 schedule（16ms 合并），critical 路径走 flushLiveRender。 */
  private renderBatcher: WriteBatcher
  /** 上次输入框获得焦点的时间戳（Ctrl+V 剪贴板读图防抖；overlay 关闭后
   *  FOCUS_DEBOUNCE_MS 内走文本路径，避免把 overlay 里的图误附进输入框）。 */
  private lastInputFocusAt = 0
  /** 主控模型是否原生支持识图（图片附件气泡提示；装配方经 options.vision 注入）。 */
  private supportsVision = false
  /** 是否配置独立识图桥模型（主控不识图时经桥转文字描述后发送）。
   *  装配方经 options.vision 注入；未注入时提交图片前按 visionBridge 服务
   *  存在性探测补齐（resolveVisionBridge）。 */
  private visionBridgeEnabled = false
  /** 识图桥来源（'configured' / 'auto' / 'none'；气泡提示文案用）。 */
  private visionBridgeSource: 'configured' | 'auto' | 'none' | undefined
  /** 投影层：turn 级工具统计 fold（turn/end 摘要行数据源；mountSession 复位）。 */
  private turnSummary: TurnSummaryState = emptyTurnSummary(0)
  /** 投影层：会话级跨 turn 汇总 fold（/status 会话段数据源；mountSession 重放重建）。 */
  private sessionSummary: SummaryState = emptySummaryState(SessionId(''))

  constructor(options: TuiAppOptions) {
    this.ctx = options.ctx
    this.stdout = options.stdout
    this.stdin = options.stdin
    // 本地偏好：构造期同步读取（小 JSON，阻塞可忽略）；禁用（VITEST 密封）时空偏好。
    this.prefsPath = prefsEnabled(options.prefsPath)
    if (this.prefsPath !== null) this.prefs = readPrefs(this.prefsPath)
    this.historyStore = new InputHistoryStore(options.historyPath)
    this.initialSessionId = options.initialSessionId
    this.themeName = options.theme ?? 'auto'
    this.onExit = options.onExit
    this.onRestart = options.onRestart
    this.editorKey = options.editorKey ?? 'ctrl_e'
    this.editorCommand = options.editorCommand
    this.vimEnabled = options.vimEnabled ?? false
    this.supportsVision = options.vision?.supportsVision ?? false
    this.visionBridgeEnabled = options.vision?.bridgeEnabled ?? false
    this.visionBridgeSource = options.vision?.bridgeSource
    this.lspConfig = {
      enabled: options.lsp?.enabled ?? true,
      timeoutMs: options.lsp?.timeoutMs ?? 2_000,
      ...(options.lsp?.spawnFor === undefined ? {} : { spawnFor: options.lsp.spawnFor }),
      ...(options.lsp?.which === undefined ? {} : { which: options.lsp.which }),
    }
    this.activityBandMaxRows = options.activityBandMaxRows ?? 5
    this.activityBandEnabled = options.activityBand ?? true
    this.commit = new CommitEngine({ stdout: options.stdout })
    this.live = new LiveEngine({
      stdout: options.stdout,
      reservedRows: LIVE_RESERVED_ROWS,
      maxRows: liveMaxRowsFor(options.stdout.rows),
    })
    this.input = new InputHandler({ stdin: options.stdin, mode: 'input' })
    // 历史异步加载：加载完成即同步进输入行（↑/↓ 导航热接上，无需重启）。
    void this.historyStore.load().then((store) => {
      /* v8 ignore next 1 -- 构造与 load 之间 dispose 的竞态无法在同步测试中构造 */
      if (this.disposed) return
      const loaded = store.snapshot()
      // 空档（首启/坏档降级）没有新事实：不重置导航历史、不触发重绘——
      // 测试装配大量构造 TuiApp，无谓的重绘会扰动计时敏感用例。
      if (loaded.length === 0) return
      this.history = loaded
      this.inputLine.setHistory(loaded)
      this.flushLiveRender()
    })
    this.inputLine = new InputLine({
      history: this.history,
      vimEnabled: this.vimEnabled,
      onSubmit: (text, images) => {
        // A5：空输入 Enter 切换最后一张进行中工具卡的展开/收起（Claude Code
        // 同款；非空输入仍是提交路径）。工具卡已结算时 callId 不匹配自然失效。
        if (text === '' && (images === undefined || images.length === 0)) {
          const pending = this.transcript?.view.tools.filter(t => t.result === undefined) ?? []
          const latest = pending[pending.length - 1]
          if (latest !== undefined) {
            this.expandedToolCallId = this.expandedToolCallId === latest.callId ? null : latest.callId
            this.flushLiveRender()
            return
          }
        }
        this.handleSubmit(text, images)
      },
      onTabComplete: () => this.handleTabComplete(),
      // slash 菜单状态随输入变化刷新（键入/粘贴/外部 setValue 统一入口；
      // 渲染由各调用路径 flushLiveRender 承担，此处不触发重绘）。
      // 输入变化前重投影：外部插件可经 tui.commands 服务在构造后追加斜杠命令
      // （如 /next-workflow 的中文菜单项），快照必须随注册刷新。
      onChange: (value) => { this.syncSlashHints(); this.inputController.refreshSlash(value) },
      // 附件增删 → composer 半块缩略图（异步渲染，完成时自行触发重绘）。
      onImagesChange: (images) => { void this.refreshAttachmentPreview(images) },
    })
    this.resize = new ResizeHandler({ stdout: options.stdout })
    // 渲染帧合并器（T9）：事件路径（流式块）走 schedule 16ms 合并，
    // critical 路径保持同步 renderLive（flushNow 语义）。
    this.renderBatcher = new WriteBatcher(() =>{  this.renderLive() })
    this.blockWriter = new BlockStreamWriter(
      { minChars: 60, maxChars: 200, idleMs: 180 },
      (block) => {
        /* v8 ignore next -- BlockStreamWriter flush 的 block 恒非空，push 恒返回 true */
        if (!this.streamRenderer.push(block)) this.renderBatcher.schedule()
      },
    )
    this.perfMonitor = new TuiPerfMonitor({ enabled: isTuiPerfEnabled() })
    this.streamRenderer = new StreamRenderer({
      commit: (ansi) => {
        // mid-stream 协议已由 commitToScrollback 统一执行（先清 live 区再写
        // scrollback），重绘在原子编舞内同步完成——不可走 schedule 延迟帧：
        // 擦除即时而重绘延后会让输入框落底后缺席若干帧（闪烁根因）。
        this.commitToScrollback({ text: ansi, trailingNewline: true })
      },
      getColumns: () => this.stdout.columns,
      getTheme: () => getTheme(),
      getThemeKey: () => 'tui-conversation',
      perfMonitor: this.perfMonitor,
    })
    // Phase 6.1：命令注册表 + 内置命令装配。注册即副作用：ctx.provide 把
    // 'tui.commands' 暴露为服务，其他插件经 ctx.get('tui.commands') 扩展命令。
    this.inputController = new InputController()
    this.slash = new SlashCommandRegistry()
    // T2.1/T2.2/T2.3：/tasks（含 kill 子命令）、/subagents、/workflow 的命令定义在
    // createBuiltinCommands（registry 维度），TuiApp 只注入显隐切换 deps。
    for (const command of createBuiltinCommands({
      newSession: () => this.newSession(),
      forkSession: () => this.forkSession(),
      switchLiveModel: selection => this.switchLiveModel(selection),
      clearScrollback: () => {
        // 命令切换的 live 信息面板（/skills /lsp /tasks /status
        // /subagents /workflow）随清屏一并收起：这些面板渲染在 live 区，
        // 只清 scrollback 不清可见性标志的话，2J 清屏后的全量重绘会把面板
        // 内容原样画回来——用户看到的便是「/clear 清不掉命令输出」。
        // /config 已改为 overlay 面板（非 live 区），无需在此收起。
        this.skillsPanelVisible = false
        this.lspPanelVisible = false
        this.taskPanelVisible = false
        this.statusPanelVisible = false
        this.todosPanelVisible = false
        this.subagentsPanelVisible = false
        this.workflowPanelVisible = false
        this.commit.reset()
        // 真实清屏（对齐 README「清空滚动区视图」）：2J 擦可见屏、3J 清终端
        // 滚动缓冲（不支持的终端无害忽略）、光标回顶；live 区状态复位后从
        // 顶部全量重绘（lineCache 清空 → 下一帧按首帧语义绘制）。
        this.live.reset()
        this.stdout.write(`${ANSI.ERASE_SCREEN}\x1b[3J\x1b[H`)
        this.flushLiveRender()
      },
      toggleTaskPanel: () => {
        this.taskPanelVisible = !this.taskPanelVisible
        // 任务窗格的数据源是 sessionProjections 总线；服务缺失时窗格恒空白，
        // 回显警告让用户知道为什么（后台任务区由 tasks 服务独立供给，不受影响）。
        if (this.taskPanelVisible && this.ctx.reflect.get('sessionProjections', false) === undefined) {
          this.echoWarn('⚠ sessionProjections 服务不可用（未装配 session-projection 插件），任务窗格无数据')
        }
        this.renderBatcher.schedule()
      },
      toggleSubagentsPanel: () => {
        this.subagentsPanelVisible = !this.subagentsPanelVisible
        if (this.subagentsPanelVisible && this.ctx.reflect.get('subagents', false) === undefined) {
          this.echoWarn('⚠ subagents 服务不可用（未装配 subagent 插件），委派树面板无数据')
        }
        // 路由发现性 nudge（回流 opencode-tui 01313be6c，触发点适配为本仓的
        // 委派树查看时刻）：选择关且无授权路由时每会话提示一次。
        if (this.subagentsPanelVisible && !this.subagentRoutingNudgeShown) {
          const selection = this.subagentModelSelectionSettings()?.current()
          if (selection !== undefined && !selection.enabled && selection.allowedModels.length === 0) {
            this.subagentRoutingNudgeShown = true
            this.commitToScrollback({ text: subagentRoutingNudgeText(), trailingNewline: true })
          }
        }
        this.renderBatcher.schedule()
      },
      toggleWorkflowPanel: () => {
        this.workflowPanelVisible = !this.workflowPanelVisible
        if (this.workflowPanelVisible && this.ctx.reflect.get('workflowEngine', false) === undefined) {
          this.echoWarn('⚠ workflow 引擎不可用（未装配 workflow 插件），面板无运行数据')
        }
        this.renderBatcher.schedule()
      },
      rewindSession: () => this.rewindSession(),
      askBtw: question => this.askBtw(question),
      openMemoryBrowser: () => this.openMemoryBrowser(),
      openTranscriptViewer: () => this.openTranscriptViewer(),
      switchSession: id => this.switchSession(SessionId(id)),
      exportTranscript: path => this.exportTranscript(path),
      requestExit: () => { this.onExit?.() },
      requestRestart: () => { this.onRestart?.() },
      setYoloMode: (flag) => { this.setYoloMode(flag) },
      // /preset：当前会话 agent（recompose/composedPreset 的 agentCtx 来源）；
      // activeSessionId 为 null（未 attach）时返回 null，命令层拒绝切换。
      currentAgent: (): Agent | null => {
        const id = this.activeSessionId
        if (id === null) return null
        return this.ctx.agents.get(id) ?? null
      },
      // /preset：blank 判定（recompose 调用方契约——换工具集会留下历史
      // tool call 与新组成不匹配）：无消息且无未结算工具调用。
      isBlankSession: () => this.isBlankSession(),
      // /cost：当前会话累计用量与成本报告（Map 保持首次出现序）。
      sessionCostReport: () => formatSessionCostReport([...this.sessionCosts.values()]),
      // #31：交互式选择器（/model /theme /session 无参打开）。
      openModelPicker: () => { void this.openModelPicker() },
      openRoleModelPicker: (role) => { void this.openRoleModelPicker(role) },
      openThemePicker: () => { this.openThemePicker() },
      openSessionPicker: () => { void this.openSessionPicker() },
      // /key /login：API Key 设置对话框（保存成功经 onSaved 回调刷新 apiKeyReady）。
      openKeyDialog: () => { void this.openKeyDialog() },
      // /help：注册表所有者即 TuiApp（this.slash），经 deps 注入——不暴露为 ctx
      // 服务（Cordis 注入代理对未声明属性抛 without inject，见 #36）。
      listCommands: () => this.slash.list(),
    })) {
      this.slash.register(command)
    }
    // /steer 复用既有中轮转向入口（Phase 6.2）。
    this.slash.register({
      name: 'steer',
      description: '中轮转向（中途纠正方向）',
      argsHint: '<text>',
      run: (args) => { this.handleSteer(args.text) },
    })
    // T1.2：/status 状态面板显隐切换（数据源为投影总线缓存的 goal/todos/plan
    // 三域；渲染函数 import 自 status-panel.ts——registry 条目注册归
    // command_wiring 维度）。subagent/subagentTiming 两域由 /subagents 面板消费。
    this.slash.register({
      name: 'status',
      description: '切换状态面板（goal/todos/plan 投影快照）',
      run: () => {
        this.statusPanelVisible = !this.statusPanelVisible
        if (this.statusPanelVisible && this.ctx.reflect.get('sessionProjections', false) === undefined) {
          this.echoWarn('⚠ sessionProjections 服务不可用（未装配 session-projection 插件），目标/任务/计划投影段无数据（会话汇总段为本地投影，不受影响）')
        }
        this.renderBatcher.schedule()
      },
    })
    // todos 紧凑待办面板显隐切换：无参切换显隐，all 展开/收起明细。数据源是
    // todos 投影的保留快照（turn/start 清空不回退显示），与 /status 的完整
    // checklist 任务段、/tasks 窗格同源不同呈现——摘要卡服务「一眼当前进度」，
    // 明细行只封顶展示，完整清单仍在 /status。
    this.slash.register({
      name: 'todos',
      description: '切换待办紧凑面板（无参显隐；all 展开明细）',
      argsHint: '[all]',
      run: ({ text }) => {
        const sub = text.trim()
        if (sub !== '' && sub !== 'all') {
          this.echoWarn('用法: /todos [all]')
          return
        }
        if (sub === 'all') {
          this.todosExpanded = !this.todosExpanded
          this.todosPanelVisible = this.todosPanelVisible || this.todosExpanded
        } else {
          this.todosPanelVisible = !this.todosPanelVisible
          if (!this.todosPanelVisible) this.todosExpanded = false
        }
        if (this.todosPanelVisible && this.ctx.reflect.get('sessionProjections', false) === undefined) {
          this.echoWarn('⚠ sessionProjections 服务不可用（未装配 session-projection 插件），待办面板无数据')
        }
        this.renderBatcher.schedule()
      },
    })
    // LSP：/lsp 诊断面板显隐切换（本地语言服务；懒创建 bridge——打开面板
    // 即实例化；server 未安装时回显警告，面板渲染「未安装」空态）。
    this.slash.register({
      name: 'lsp',
      description: '切换 LSP 诊断面板（本地语言服务）',
      run: () => {
        this.toggleLspPanel()
        this.renderBatcher.schedule()
      },
    })
    // /config 交互式设置面板：双栏 overlay（模型/权限/凭据/概览四类目，
    // Enter 即时编辑——写面全部热生效，无草稿保存机制）。数据由
    // buildConfigPanelData 现取，编辑分派见 dispatchConfigEdit。
    this.slash.register({
      name: 'config',
      description: '设置面板（模型角色 / 权限预设 / 供应商密钥 / 设置概览）',
      run: async () => {
        await this.openConfigPanel()
      },
    })
    // T3.3：/skills 技能浏览面板显隐切换（数据源为 ctx.skills.list 快照；
    // 服务缺失时面板恒空，回显警告）。
    this.slash.register({
      name: 'skills',
      description: '切换技能浏览面板',
      run: () => {
        this.skillsPanelVisible = !this.skillsPanelVisible
        if (this.skillsPanelVisible) {
          if (this.ctx.reflect.get('skills', false) === undefined) {
            this.echoWarn('⚠ skills 服务不可用（未装配 skill 插件），技能面板无数据')
          }
          this.refreshSkillItems()
        }
        this.renderBatcher.schedule()
      },
    })
    // BEL 完成响铃开关（回流 dsh-tui 704a833）：子代理/工作流/后台任务完成时
    // 写 BEL，SSH 会话下唯一可达的完成提示；持久化到 prefs bellEnabled。
    // 注册在 /info /density 之前——菜单环绕末项契约测试锚定 /density。
    this.slash.register({
      name: 'bell',
      description: '切换完成事件终端响铃（BEL，SSH 下同样可达）',
      run: ({ echo }) => {
        this.prefs.bellEnabled = this.prefs.bellEnabled === false
        this.persistPrefs()
        echo(this.prefs.bellEnabled === false ? '完成响铃：关' : '完成响铃：开')
      },
    })
    // /info 注册在 /density 前——菜单环绕末项契约测试锚定 /density。
    // 输入区信息密度档位：full 全部 chrome（顶栏身份+metrics、footer 提示行）/
    // compact 保留顶栏身份段与 API/git，隐 metrics / off 顶栏与 footer 全关。
    // 对齐 kimi-code 输入区分层；持久化到 ~/.dsh-tui/prefs.json（与官方宿主
    // 插件同文件同 key 语义）。
    this.slash.register({
      name: 'info',
      description: '切换输入区信息密度（full 全部 / compact 精简 / off 关闭）',
      run: ({ echo }) => {
        const current = this.prefs.footerInfo ?? 'full'
        // current 恒在档位表内（parse 校验 + 本档位循环），取模结果必非空。
        const next = FOOTER_INFO_LEVELS[(FOOTER_INFO_LEVELS.indexOf(current) + 1) % FOOTER_INFO_LEVELS.length] ?? 'full'
        this.prefs.footerInfo = next
        this.persistPrefs()
        this.renderBatcher.schedule()
        echo(`输入区信息密度：${next}（${FOOTER_INFO_LEVELS.join(' / ')}）`)
      },
    })
    // T5：/density 紧凑渲染开关（grok-build /compact-mode 语义；命令名避开
    // /compact 前缀歧义——resolveSlashCommand 最小唯一前缀会拒掉歧义输入）。
    this.slash.register({
      name: 'density',
      description: '切换紧凑渲染模式（工具卡仅标题行）',
      run: () => {
        this.compactMode = !this.compactMode
        this.renderBatcher.schedule()
      },
    })
    // 命令提示数据源投影到 InputController（slash hint / Tab 补全目标）。
    this.syncSlashHints()
    this.ctx.provide('tui.commands', this.slash)
    // Phase 5.3：glance 数据源是惰性闭包（statusLine/liveAgent 随会话挂载），
    // 构造期只固定取数路径，会话切换后自动读到新投影。throttleMs: 0——
    // TuiApp 渲染节奏由 ticker（120ms）与事件驱动，两次 refresh 间隔恒大于
    // 控制器默认窗口，节流层在这里是冗余的；显式关闭让事件后的 renderLive
    // 立即读到最新派生（与装配前内联派生语义一致）。onChange 不接——
    // renderLive 每帧主动 refresh + current，推送回调只会引入重入。
    this.glance = new MetricsGlanceController({
      getStatusText: () => this.statusLine?.current ?? null,
      getLiveState: () => this.liveAgent?.state,
      getColumns: () => this.stdout.columns,
      throttleMs: 0,
    })
    // T3.1/C3 项 4：挂起状态机控制器（Wave 1 提取）。onEscapeImmediate 保持
    // 挂起态 ESC 语义（挂起期间 ESC 非 CSI 前缀）；onChanged 触发重绘——
    // 状态变化与 renderLive 的绑定收敛在装配点，controller 不碰渲染。
    this.question = new QuestionController({
      onEscapeImmediate: (flag) => { this.input.setEscapeImmediate(flag) },
      onChanged: () => { this.flushLiveRender() },
    })
    this.approval = new ApprovalController({
      getCurrentSessionId: () => this.activeSessionId,
      onChanged: () => { this.flushLiveRender() },
    })
    // P1：/btw 侧问状态机。activeSessionId 动态读取（attach 前为 null，
    // /btw 命令层拦截回显）；onAnswer 折叠答案进 scrollback（Esc 关闭 done
    // 态时触发——答案持久化在用户确认折叠时，与 grok-build 语义对齐）。
    this.btw = new BtwController({
      ctx: this.ctx,
      activeSessionId: () => this.activeSessionId,
      onChanged: () => { this.flushLiveRender() },
      onAnswer: (entry) => {
        this.commitToScrollback({
          text: `[btw] ${entry.question}\n${entry.answer}`,
          trailingNewline: true,
        })
      },
    })
    // P3：多会话快照层（不持有会话生命周期；tab 栏渲染时 list() 派生）。
    this.sessionManager = new SessionManager(this.ctx)
  }

  /** Phase 8：审批 answerer 订阅的 disposer（dispose 时解绑）。 */
  private approvalDisposer: (() => void) | null = null

  /**
   * `[p]` 落盘进行中：忽略审批键，且 `await` 后只结算仍是同一 `req` 的挂起卡。
   */
  private persistInFlight: { req: PendingApprovalRequest } | null = null

  /** 当前会话 id（null = 尚未 attach）。 */
  get sessionId(): SessionId | null { return this.activeSessionId }

  /**
   * 欢迎页数字键直达的编号行（prepareWelcome 投影列表时填充；
   * 索引 = 行号 - 1）。仅在欢迎阶段（welcomeDigitsActive）路由数字键。
   */
  private welcomeSessionRows: RestorableSession[] = []
  /**
   * 欢迎阶段标记：冷启动欢迎页列出可恢复会话后置真，首次输入任意字符或
   * 会话切换后置假。置真期间空输入行 + 纯数字键 = 恢复对应编号会话；置假后
   * 数字键一律回输入行（不劫持正常打字）。
   */
  private welcomeDigitsActive = false

  /**
   * 接管终端：切主题（'auto' 探测背景）、装配会话、注册键路由与 resize、启动渲染 ticker。
   * @param initialSessionId - 覆盖构造选项的起始会话；缺省用构造 initialSessionId，
   *   再缺省恢复最近会话（live store 为空才新建）。
   */
  async attach(initialSessionId?: SessionId): Promise<void> {
    if (this.disposed) throw new Error('TuiApp already disposed')
    // A3 + 1.4：处理 launcher 转发的命令行参数（`oh-my-tianshu tui <args>`）：
    // --help/-h 输出用法、--version/-v 输出版本后经 appExit 退出；纯位置参数
    // 作为初始 prompt（attach 完成后发送）；--session <id> 提取为恢复目标。
    // 含其它 flag 时不发 prompt（与既有组合语义一致）。port of dsh-tianshu-tui#21。
    const cmdline = this.ctx.reflect.get('cmdlineArgs', false) as { get(): string[] } | undefined
    const args = cmdline?.get() ?? []
    // 提取 --session <id>（恢复既有会话；值从参数流移除，不参与 flag 判定）。
    let cliSessionId: SessionId | undefined
    const rest: string[] = []
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '--session') {
        const value = args[i + 1]
        if (value !== undefined) {
          cliSessionId = SessionId(value)
          i += 1
          continue
        }
      }
      /* v8 ignore next -- 循环下标在 length 守卫内必有值；noUncheckedIndexedAccess 防御 */
      if (arg !== undefined) rest.push(arg)
    }
    const flags = rest.filter(a => a.startsWith('-'))
    const wantHelp = flags.includes('--help') || flags.includes('-h')
    const wantVersion = flags.includes('--version') || flags.includes('-v')
    const initialPrompt = flags.length === 0 ? rest.filter(a => !a.startsWith('-')).join(' ') : ''
    if (wantHelp || wantVersion) {
      const exit = this.ctx.reflect.get('appExit', false) as ((code?: number) => void) | undefined
      this.stdout.write(wantHelp
        ? USAGE_TEXT
        : `oh-my-tianshu tui ${readDistributionVersion() ?? 'unknown'}\n`)
      if (exit !== undefined) { exit(0); return }
      // 无 appExit（测试/裸装配）：fallback 直接退出进程——--help/--version 是
      // 一次性诊断输出，不进入交互，无需 flush（与 index.ts requestHostExit 同款）。
      process.exit(0)
    }
    // bracketed paste：粘贴的多行文本被终端包裹为整段（行尾 CR 不再逐行触发
    // Enter 提交）；onPaste 处理器把整段插入输入行（超阈值折叠为标记）。
    this.stdout.write(ANSI.BRACKETED_PASTE_ON)
    this.stdout.write(ANSI.KITTY_KEYBOARD_DISAMBIGUATE_ON)
    this.welcomePreparing = true
    this.welcomeScrollbackBarrier = false
    this.pasteDisposer?.()
    this.pasteDisposer = this.input.onPaste((text) => {
      if (this.welcomePreparing) {
        this.pendingWelcomeSettleReason ??= 'input'
        this.pendingWelcomeHadInput = true
        this.pendingWelcomeActions.push(() => this.handlePaste(text))
        return
      }
      void this.handlePaste(text)
    })
    this.input.onAnyKey((key) => {
      if (this.welcomePreparing) {
        this.pendingWelcomeSettleReason ??= 'input'
        this.pendingWelcomeHadInput = true
        this.pendingWelcomeActions.push(() => { this.handleKey(key) })
        return
      }
      this.handleKey(key)
    })
    this.resize.onResize(() => {
      this.live.setMaxRows(liveMaxRowsFor(this.stdout.rows))
      if (this.welcomePreparing) {
        this.pendingWelcomeSettleReason ??= 'resize'
        return
      }
      if (this.settleWelcome('resize')) return
      // overlay 激活时主屏 live 不写；resize 只重绘 alt screen 面板。
      if (this.overlay !== null && this.overlay.activeId() !== null) {
        this.overlay.rerender()
        return
      }
      this.flushLiveRender()
    })
    // 意图对齐桥：仅在服务装配且 enabled 时订阅 handoff。disabled / 未装配
    // 时订了也收不到事件，却让 attach 留下一条死监听。
    this.intentBridgeDisposer?.()
    this.intentBridgeDisposer = null
    const intentBridge = this.ctx.reflect.get('intentBridge', false) as IntentBridgeService | undefined
    if (intentBridge !== undefined && intentBridge.enabled) {
      this.intentBridgeDisposer = this.ctx.on('intent-bridge/handoff', ({ mainSessionId }) => {
        this.switchSessionGuarded(SessionId(mainSessionId))
      })
    }
    // 目标 6：'auto' 才走系统终端配色探测（OSC 11 → dark/light）；显式主题直接生效。
    // 探测期间挂起按键流：探测响应走同一 stdin，若同挂会让响应字节泄漏进输入行。
    if (this.themeName === 'auto') {
      this.input.suspend()
      try {
        const background = await detectTerminalBackground()
        /* v8 ignore next -- autoThemeFor 恒返回有效主题名，setTheme 恒 true，graphite 兜底不可达 */
        if (!setTheme(autoThemeFor(background))) setTheme('graphite')
      } finally {
        this.input.resume()
      }
    } else {
      setTheme(this.themeName)
    }

    // A1/A2：创建/恢复会话与首帧渲染前，等 settings/credentials 服务激活
    // （有界；未注册跳过）——否则 newSession/resume 在创建时快照到的是 config
    // 默认模型（settings 未加载），且欢迎页误报 API Key ✗。
    await this.waitForServicesReady(['settings', 'credentials'])
    let target = cliSessionId ?? initialSessionId ?? this.initialSessionId ?? this.ctx.sessions.list()[0]?.id
    if (cliSessionId !== undefined) {
      // 1.4：--session 指向未知/损坏会话 fails loud + 入口指引——回落到正常
      // 启动路径，欢迎页可恢复列表即指引（不静默吞掉错误）。损坏占位单列
      // 提示：它列在恢复面上，「不存在」对它是误导。
      const row = (await listSessions(this.ctx)).find(s => s.id === cliSessionId)
      const corrupt = row?.corrupt === true
      if (row === undefined || corrupt) {
        target = initialSessionId ?? this.initialSessionId ?? this.ctx.sessions.list()[0]?.id
        this.commitToScrollback({
          text: color(corrupt
            ? `⚠ 会话工件损坏，不可恢复: ${cliSessionId}`
            : `⚠ 会话不存在: ${cliSessionId} —— 可用入口: 欢迎页数字键 / /session list / ctrl+s 恢复最近`, this.theme.warning),
          trailingNewline: true,
        })
      }
    }
    if (target !== undefined) await this.switchSession(target)
    else await this.newSession()
    if (this.isDisposed()) return
    this.welcomeScrollbackBarrier = true

    // 欢迎准备只提交 top bar；restore/tip 与环境字段冻结进 controller，
    // 最终欢迎统一由 settleWelcome 一次性落 scrollback。
    await this.prepareWelcome()
    if (this.isDisposed()) return
    // git 未提交计数快照（footer ●N 数据源）：attach 一次 + 每 turn/end 刷新。
    this.gitDirty = gitDirtyCount()

    // Phase 8：审批 answerer——waterfall 必须 next() 委托（非当前会话的
    // 请求交给链上其他 answerer；当前会话的请求挂起等用户 y/N。重复
    // attach 先解绑旧 disposer（与 interactionDisposer 对称）。
    this.approvalDisposer?.()
    this.approvalDisposer = this.ctx.on('approval/request', (req: PendingApprovalRequest, next: () => Promise<ApprovalOutcome>) => {
      return this.handleApprovalRequest(req, next)
    })
    // Ctrl+P 命令面板装配：数据源取 slash 注册表实时快照；主题动态读取（切主题后立即生效）。
    this.palette = new CommandPalette({
      getCommands: () => this.slash.list(),
      getTheme: () => this.theme,
    })
    this.overlay = new OverlayController({
      stdout: this.stdout,
      getSize: () => ({ cols: this.stdout.columns, rows: this.stdout.rows }),
      live: this.live,
      onOverlayChange: (active) => {
        if (active) return
        // 退出 alt screen 后：把 overlay 期间暂存的 scrollback 补写回主屏，
        // 再同步重绘 live 区（不能只等 120ms ticker——主屏刚恢复时 live 区是旧帧）。
        this.flushDeferredScrollback()
        this.flushLiveRender()
        // 焦点去抖接线（终端 raw mode 无窗口焦点事件，overlay 关闭为最近似）：
        // 此后 FOCUS_DEBOUNCE_MS 内的 Ctrl+V 只走文本——刚关掉的对话框里那次
        // 粘贴不应再把剪贴板图读一次。
        this.lastInputFocusAt = Date.now()
      },
    })
    this.overlay.register('command-palette', this.palette)
    // Ctrl+. 快捷键面板（grok-build 键位清单弹层）：静态两列表，进出 alt screen。
    this.overlay.register('keymap', {
      render: cols => renderKeymapPanel(cols),
    })
    // C2 项 2：历史搜索 overlay（Ctrl+F）——消息快照在激活时由装配方提供。
    this.searchOverlay = new HistorySearchOverlay()
    this.overlay.register('search', this.searchOverlay)
    // C3 项 3：rewind overlay（/rewind）——消息快照 + 执行回调在激活时提供。
    this.rewindOverlay = new RewindOverlay(undefined, {
      // onSettled：异步执行落到 done 时补一帧完成/失败页（按键重绘只画得出执行帧）。
      onSettled: () => { this.overlay?.rerender() },
    })
    this.overlay.register('rewind', this.rewindOverlay)
    // #31：交互式选择器 overlay（/model /theme /session 无参打开；上下键选择）。
    this.picker = new PickerController({ getTheme: () => this.theme })
    this.overlay.register('picker', this.picker)
    // P2：memory 浏览器 overlay（/memory）——条目快照 + 数据源在激活时注入。
    this.memoryOverlay = new MemoryBrowserOverlay()
    this.overlay.register('memory', this.memoryOverlay)
    // T5：全屏转录查看器 overlay（/scroll）——scrollback 快照在激活时注入。
    this.transcriptViewer = new TranscriptViewer()
    this.overlay.register('transcript', this.transcriptViewer)
    // /key：API Key 设置对话框 overlay——异步状态翻转（探测/落盘完成）经 onChange
    // 重绘；保存成功经 onSaved 刷新 apiKeyReady（footer 在 overlay 关闭时统一重绘）。
    this.keyDialog = new KeyDialogController({
      getTheme: () => this.theme,
      onChange: () => {
        if (this.overlay?.activeId() === 'key-dialog') this.overlay.rerender()
      },
      onSaved: () => { void this.refreshApiKeyReady() },
    })
    this.overlay.register('key-dialog', this.keyDialog)
    // /config 交互式设置面板（编辑分派 + 关闭都由 actions 面承担；键路由
    // 见 activeId() === 'config-panel' 分支）。
    this.configPanel = new ConfigPanelController({
      getTheme: () => this.theme,
      edit: (action) => { this.dispatchConfigEdit(action) },
      close: () => { this.overlay?.deactivate() },
    })
    this.overlay.register('config-panel', this.configPanel)
    this.input.setMode('input')
    this.ticker = setInterval(() => {
      if (this.hasVisibleSpinner()) this.tick++
      this.renderLiveFromTicker = true
      try {
        this.renderLive()
      } finally {
        this.renderLiveFromTicker = false
      }
    }, 120)
    this.ticker.unref()
    // T3.1：userInteraction provider 注册（升级结构化提问；唯一 provider——
    // 若已存在注册则替换而非叠加）。
    this.interactionDisposer?.()
    const userInteraction = this.ctx.reflect.get('userInteraction', false) as
      | { registerProvider(provider: { ask(request: unknown): Promise<unknown> }): () => void } | undefined
    if (userInteraction !== undefined) {
      this.interactionDisposer = userInteraction.registerProvider({
        ask: request => this.handleQuestionRequest(request),
      })
    }
    const pendingWelcome = this.finishWelcomePreparation()
    if (this.welcomeIntro?.active === true && !this.canAnimateWelcome()) {
      this.settleWelcome('skipped')
    }
    // A3：纯位置参数作为初始 prompt（`oh-my-tianshu tui "修复这个 bug"`）。
    if (initialPrompt !== '') {
      this.handleSubmit(initialPrompt)
    }
    await this.replayPendingWelcomeActions(pendingWelcome.actions)
    if (this.isDisposed()) return
    if (initialPrompt === '' && !pendingWelcome.hadInput && this.welcomeIntro?.active === true) {
      // 静态 welcome 已结算后再开自动 key overlay。
      this.autoKeyDialogPending = true
    } else if (initialPrompt === '' && !pendingWelcome.hadInput) {
      // skipped/static 保持既有立即弹窗；携带 initial prompt 的启动不打扰。
      this.maybeAutoOpenKeyDialog()
    }
  }

  /** 建立 controller 后原子结束准备期：先 settle，再按 append-only 顺序补写后台条目。 */
  private finishWelcomePreparation(): {
    actions: Array<() => void | Promise<void>>
    hadInput: boolean
  } {
    const reason = this.pendingWelcomeSettleReason
    const actions = this.pendingWelcomeActions
    const hadInput = this.pendingWelcomeHadInput
    this.pendingWelcomeSettleReason = null
    this.pendingWelcomeActions = []
    this.pendingWelcomeHadInput = false
    this.welcomePreparing = false
    this.welcomeScrollbackBarrier = false
    if (reason !== null) this.settleWelcome(reason)
    return { actions, hadInput }
  }

  /** 准备期动作在 canonical welcome 排序稳定后按跨来源到达顺序重放。 */
  private async replayPendingWelcomeActions(
    actions: Array<() => void | Promise<void>>,
  ): Promise<void> {
    for (const action of actions) {
      if (this.isDisposed()) return
      const pending = action()
      if (pending !== undefined) await pending
    }
  }

  /** T3.1：结构化提问 answerer——薄转发 QuestionController（渲染/ESC/重绘由控制器回调承担）。 */
  private handleQuestionRequest(request: unknown): Promise<unknown> {
    return this.question.ask(request)
  }

  /**
   * bracketed paste 文本落地（右键粘贴/终端菜单粘贴）：先尝试剪贴板读图
   * （命中则附图并吞掉这段 paste——粘贴进来的文本是图片字节的乱码，不插图
   * 会污染输入框）；再识别图片路径加载为附件；最后才是普通文本插入。
   * @param text - 终端传来的粘贴文本
   */
  private async handlePaste(text: string): Promise<void> {
    this.settleWelcome('input')
    // /key 对话框激活：bracketed paste 整段进 Key 字段（对话框剥空白），
    // 不碰剪贴板读图/图片路径识别。
    if (this.overlay?.activeId() === 'key-dialog' && this.keyDialog !== null) {
      this.keyDialog.pasteText(text)
      this.overlay.rerender()
      return
    }
    // 剪贴板当前是图片 → 附图并吞掉（与 Ctrl+V 互斥：右键粘贴产生 paste
    // 事件、Ctrl+V 产生 ctrl_v 按键，不会同时触发）。readImageFromClipboard
    // 无图/失败时返回 null（自然落入文本粘贴）；此处 catch 只接管线处理
    // 失败（超限压缩失败等）——回显原因，不把位图乱码插进输入行。
    if (this.inputLine.images.length < MAX_IMAGES) {
      const imgResult = await readImageFromClipboard()
      if (imgResult) {
        try {
          await this.attachClipboardImage(imgResult.dataUrl, imgResult.name)
          return
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          this.commitToScrollback({ text: color(`⚠ 剪贴板图片处理失败: ${message}`, this.theme.warning), trailingNewline: true })
          this.flushLiveRender()
          return
        }
      }
    }
    const trimmed = text.trim()
    // 粘贴内容看起来像图片路径 → 尝试加载为附件；失败回退为普通文本。
    if (trimmed && looksLikeImagePath(trimmed) && !trimmed.includes('\n')) {
      if (this.inputLine.images.length >= MAX_IMAGES) {
        this.commitToScrollback({ text: color(`⚠ 最多附加 ${MAX_IMAGES} 张图片`, this.theme.warning), trailingNewline: true })
        this.flushLiveRender()
        return
      }
      try {
        const attachment = await loadImageAttachment(resolve(trimmed))
        this.inputLine.addImage(attachment.dataUrl)
        this.flushLiveRender()
        return
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.commitToScrollback({ text: color(`⚠ 图片加载失败: ${message}`, this.theme.warning), trailingNewline: true })
        this.flushLiveRender()
        // fallthrough to normal text paste
      }
    }
    this.inputLine.insertText(text)
    this.flushLiveRender()
  }

  /**
   * Ctrl+V 处理：优先读剪贴板图片 → 失败则 fallback 到文本粘贴。
   * 焦点防抖：输入框在最近 FOCUS_DEBOUNCE_MS 内刚「重获焦点」（overlay
   * 关闭近似——终端 raw mode 下无窗口焦点事件）时跳过读图，避免把粘贴进
   * 对话框/选择器的那次 Ctrl+V 再当一次读图。
   */
  private async handleCtrlV(): Promise<void> {
    if (Date.now() - this.lastInputFocusAt < FOCUS_DEBOUNCE_MS) {
      const text = await readTextFromClipboard()
      if (text) {
        this.inputLine.insertText(text)
        this.flushLiveRender()
      }
      return
    }
    try {
      const result = await readImageFromClipboard()
      if (result) {
        if (this.inputLine.images.length >= MAX_IMAGES) {
          this.commitToScrollback({ text: color(`⚠ 最多附加 ${MAX_IMAGES} 张图片`, this.theme.warning), trailingNewline: true })
          this.flushLiveRender()
          return
        }
        await this.attachClipboardImage(result.dataUrl, result.name)
        return
      }
    } catch (err) {
      // 管线处理失败（超限压缩失败等）——回显原因；剪贴板读图本身失败
      // （readImageFromClipboard 内部吞掉返回 null）走下方文本 fallback。
      const message = err instanceof Error ? err.message : String(err)
      this.commitToScrollback({ text: color(`⚠ 剪贴板图片处理失败: ${message}`, this.theme.warning), trailingNewline: true })
      this.flushLiveRender()
      return
    }
    const text = await readTextFromClipboard()
    if (text) {
      this.inputLine.insertText(text)
      this.flushLiveRender()
    } else {
      // P1-1：无图且无文本——回显一行提示。「无内容」覆盖剪贴板为空与读图/读文
      // 失败两种情形，不误指为工具链缺失；括号保留读图工具链的诊断信息。
      this.echoWarn('⚠ 剪贴板无内容可粘贴（读图需 osascript / wl-paste / xclip / PowerShell）')
    }
  }

  /** key 对话框的 Ctrl+V：只读剪贴板文本（Key 字段不接受图片）；空读不动作。 */
  private async pasteClipboardIntoKeyDialog(dialog: KeyDialogController): Promise<void> {
    const text = await readTextFromClipboard()
    if (!text) return
    dialog.pasteText(text)
    if (this.overlay?.activeId() === 'key-dialog') this.overlay.rerender()
  }

  /**
   * 剪贴板位图附件化：dataUrl 解回字节后走与文件路径同一条预算管线
   * （magic 校验 + 原样直发 + 三级自适应压缩）——超限大图在此被压缩或
   * 响亮失败，而不是挂上后在提交时被静默丢弃。
   * @param dataUrl - 剪贴板读图结果（data:image/...;base64,...）。
   * @param name - 附件显示名。
   */
  private async attachClipboardImage(dataUrl: string, name: string): Promise<void> {
    const comma = dataUrl.indexOf(',')
    const buf = Buffer.from(comma === -1 ? dataUrl : dataUrl.slice(comma + 1), 'base64')
    const attachment = await loadClipboardImageAttachment(buf, name.length > 0 ? name : 'clipboard.png')
    this.inputLine.addImage(attachment.dataUrl)
    this.flushLiveRender()
  }

  /**
   * 设置当前主控模型的识图能力与桥接状态（图片附件气泡提示数据源）。
   * 由装配方按 agent 配置注入；TUI 是纯表现层，不自行查询模型能力。
   * @param supportsVision - 主控模型是否原生支持识图（图片直发）
   * @param bridgeEnabled - 是否配置了独立识图桥模型（主控不识图时经桥转描述）
   * @param bridgeSource - 识图桥来源（configured/auto/none；气泡提示文案用）
   */
  setVisionInfo(
    supportsVision: boolean,
    bridgeEnabled: boolean,
    bridgeSource?: 'configured' | 'auto' | 'none',
  ): void {
    this.supportsVision = supportsVision
    this.visionBridgeEnabled = bridgeEnabled
    this.visionBridgeSource = bridgeSource
  }

  /**
   * 宿主视觉桥探测：视觉桥插件（dsh-vision-bridge）装配时应 provide('visionBridge')
   * 服务，存在即视为桥可用（来源按 configured 处理，装配方注入过 bridgeSource 时
   * 保留注入值）。显式注入 vision.bridgeEnabled 时短路；否则每次提交图片前补探，
   * 覆盖桥插件晚于 tui-runner 激活的装配时序（reflect.get 是字典读，代价可忽略）。
   * @returns 当前是否有可用识图桥。
   */
  private resolveVisionBridge(): boolean {
    if (this.visionBridgeEnabled) return true
    if (this.ctx.reflect.get('visionBridge', false) !== undefined) {
      this.visionBridgeEnabled = true
      this.visionBridgeSource = this.visionBridgeSource ?? 'configured'
    }
    return this.visionBridgeEnabled
  }

  /** T3.1：结算挂起的提问（用户选择/取消）——薄转发。 */
  private settleQuestion(answer: unknown): void {
    this.question.settle(answer)
  }

  /** T3.1：取消挂起的提问（Esc/Ctrl+C）——薄转发。 */
  private cancelQuestion(): void {
    this.question.cancel()
  }

  /**
   * 查 DEEPSEEK_API_KEY 是否已配置：优先 credentials.describe（含 file / .env 层），
   * 服务缺失或抛错时回退 process.env。欢迎页与 footer 共用，避免只看环境变量的误报。
   */
  private async refreshApiKeyReady(): Promise<void> {
    const credentials = this.ctx.reflect.get('credentials', false) as CredentialsDescribeFacet | undefined
    const ref = this.defaultProviderKeyRef()
    if (credentials !== undefined) {
      try {
        const info = await credentials.describe(ref)
        this.apiKeyReady = info.configured
        return
      } catch {
        // 服务面不匹配时回退 env
      }
    }
    this.apiKeyReady = Boolean(process.env[ref])
  }

  /**
   * 默认模型供应商的凭据引用：目录 + settings 解析（组合层 profile 的
   * apiKeyEnv 优先，再派生）；llm/settings 缺席或无默认时退 DeepSeek 缺省
   * （首启引导与既有装配的行为不变——默认供应商就是 DeepSeek 路由）。
   */
  private defaultProviderKeyRef(): string {
    const provider = this.defaultModelProvider()
    const entry = provider === undefined
      ? undefined
      : this.keyWizardDirectory().find(candidate => candidate.provider === provider)
    if (entry === undefined) return 'DEEPSEEK_API_KEY'
    return resolveKeyRef(entry.provider, this.profileApiKeyEnv(this.readResolvedSettingsSections(), entry))
  }

  /**
   * 等一组 cordis 服务激活（fiber init 完成）后再继续。
   * 已注册（非严格取得到）但未激活（严格取不到）的服务有界轮询等待；
   * 未注册的服务直接跳过（本 profile 没有该服务，无数据可等）。
   * @param names - 服务名列表。
   * @param timeoutMs - 每个服务的等待上限（默认 5s）。
   */
  private async waitForServicesReady(names: readonly string[], timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (const name of names) {
      // 未注册（非严格取不到）：本 profile 无该服务，没有数据可等，直接跳过。
      if (this.ctx.reflect.get(name, false) === undefined) continue
      // 已注册但 fiber 未激活（init 未完成）：有界轮询等待激活完成。
      while (this.ctx.reflect.get(name) === undefined && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
  }

  /**
   * 按当前主控模型刷新识图标志。llm 服务缺失或查询失败时保持原值；
   * supportsVision 为 true 才直发图片，否则走桥或「未发送」。
   */
  private refreshVisionForSelection(selection: { provider: string; model: string }): void {
    const llm = this.ctx.reflect.get('llm', false) as LlmModelInfoFacet | undefined
    if (llm === undefined) return
    void llm.resolveModelInfo(selection.provider, selection.model).then((info) => {
      if (this.disposed) return
      this.supportsVision = info.supportsVision === true
    }).catch(() => {
      // 目录查询失败时保持启动时的识图标志
    })
  }

  /**
   * Resolve the effort users will actually send, preserving an explicit route
   * override before consulting adapter metadata. Catalog failures leave the
   * welcome label at its existing automatic fallback.
   */
  private async resolveWelcomeReasoningEffort(
    selection: { provider: string; model: string; reasoningEffort?: string },
  ): Promise<ReasoningEffortId | string | undefined> {
    if (selection.reasoningEffort !== undefined) return selection.reasoningEffort
    const llm = this.ctx.get('llm')
    if (llm === undefined) return undefined
    const lifetimeSignal = this.lifetimeAbort.signal
    if (lifetimeSignal.aborted) return undefined

    const lookupAbort = new AbortController()
    const abortForLifetime = (): void => { lookupAbort.abort(lifetimeSignal.reason) }
    lifetimeSignal.addEventListener('abort', abortForLifetime, { once: true })
    const timer = setTimeout(() => {
      lookupAbort.abort(new Error('welcome model metadata lookup exceeded its UX boundary'))
    }, WELCOME_MODEL_METADATA_TIMEOUT_MS)
    timer.unref()

    let removeAbortRaceListener = (): void => {}
    try {
      const aborted = new Promise<undefined>((resolve) => {
        const onAbort = (): void => { resolve(undefined) }
        lookupAbort.signal.addEventListener('abort', onAbort, { once: true })
        removeAbortRaceListener = () => {
          lookupAbort.signal.removeEventListener('abort', onAbort)
        }
      })
      const resolved = Promise.resolve()
        .then(() => llm.resolveModelInfo(
          selection.provider,
          selection.model,
          lookupAbort.signal,
        ))
        .then(
          info => info.reasoning?.defaultEffort,
          () => undefined,
        )
      return await Promise.race([resolved, aborted])
    } finally {
      clearTimeout(timer)
      removeAbortRaceListener()
      lifetimeSignal.removeEventListener('abort', abortForLifetime)
    }
  }

  /** Reads lifecycle state across async boundaries without assuming no concurrent dispose. */
  private isDisposed(): boolean {
    return this.disposed
  }

  /** 当前会话工作区：header.cwd 优先，缺省回退启动目录。 */
  private sessionCwd(): string {
    if (this.activeSessionId === null) return process.cwd()
    const cwd = getSession(this.ctx, this.activeSessionId)?.header.cwd
    return cwd === undefined || cwd === '' ? process.cwd() : cwd
  }

  // —— LSP 诊断桥（本地语言服务；展示层私有状态，不写会话事件）——

  /**
   * 懒创建诊断桥：首次工具触碰文件或 /lsp 打开时实例化（rootUri = 当时
   * 会话 cwd）；缓存更新回调触发 renderLive（WriteBatcher 节流）。
   */
  private ensureLspBridge(): LspBridge {
    if (this.lspBridge !== null) return this.lspBridge
    const cwd = this.sessionCwd()
    // 双数据源探测（语义同视觉桥 resolveVisionBridge）：
    // 1. 社区插件（omdsh-dev/dsh-lsp）provide('lsp') 服务——形状
    //    { getDiagnostics/isAvailable/dispose }，与模型工具面共享 server 集；
    // 2. 官方 ctx.lsp seam（deepseek-harness 的 dsh-lsp）——形状
    //    { registerProvider/query }，经 officialLspSource 适配 getDiagnostics
    //    操作（官方 seam 未含该操作时适配恒空，未来官方采纳后自动生效）；
    // 3. 均未装配 → 内置桥（降级路径，保持现状行为）。
    const lspService = this.ctx.reflect.get('lsp', false) as
      | { getDiagnostics?: unknown; query?: unknown } | undefined
    let source: LspDiagnosticSource | undefined
    if (lspService !== undefined) {
      if (typeof lspService.getDiagnostics === 'function') {
        // 社区插件形状：直接消费（getDiagnostics/isAvailable/dispose 全兼容）
        source = lspService as unknown as LspDiagnosticSource
      } else if (typeof lspService.query === 'function') {
        // 官方 seam 形状：query(getDiagnostics) 适配
        source = officialLspSource(lspService as OfficialLspServiceFacet, cwd)
      }
    }
    this.lspBridge = createLspBridge({
      cwd,
      timeoutMs: this.lspConfig.timeoutMs,
      ...(this.lspConfig.spawnFor === undefined ? {} : { spawnFor: this.lspConfig.spawnFor }),
      ...(this.lspConfig.which === undefined ? {} : { which: this.lspConfig.which }),
      ...(source === undefined ? {} : { source }),
    })
    this.lspBridge.onUpdate(() => { this.renderBatcher.schedule() })
    return this.lspBridge
  }

  /**
   * 从工具参数提取文件路径并触发诊断拉取（write/read/edit 族；无 path 参数
   * 的工具如 bash 不触发）。嵌套工具调用（multi_tool_use 的 tool_uses）递归
   * 展开。只读展示：拉取失败/超时静默，不阻塞工具流。
   * @param argumentsRaw - tool/call 事件参数原文。
   */
  private touchLspPaths(argumentsRaw: string): void {
    if (!this.lspConfig.enabled) return
    const args = parseToolArguments(argumentsRaw)
    if (args === undefined) return
    const paths: string[] = []
    for (const key of ['path', 'file_path', 'file'] as const) {
      const value = args[key]
      if (typeof value === 'string' && value !== '') paths.push(value)
    }
    const nested = args.tool_uses
    if (Array.isArray(nested)) {
      for (const use of nested) {
        if (use !== null && typeof use === 'object' && typeof (use as { arguments?: unknown }).arguments === 'string') {
          this.touchLspPaths((use as { arguments: string }).arguments)
        }
      }
    }
    if (paths.length === 0) return
    const bridge = this.ensureLspBridge()
    for (const path of paths) bridge.touchFile(path)
  }

  /** /lsp 面板数据源：桥未创建（从未触碰文件）→ []。 */
  private lspDiagnosticsView(): LspDiagnosticView[] {
    return this.lspBridge === null ? [] : [...this.lspBridge.entries()]
  }

  /**
   * 工具卡标题徽标：参数里的文件有已就绪诊断 → `⚠ 1错 2警`；否则 null
   * （拉取中/无诊断/桥未创建/无 path 参数均不显示，不干扰标题）。
   */
  private lspBadgeFor(args: Record<string, unknown> | undefined): string | null {
    if (!this.lspConfig.enabled || this.lspBridge === null || args === undefined) return null
    const paths = (['path', 'file_path', 'file'] as const)
      .map(key => args[key])
      .filter((v): v is string => typeof v === 'string' && v !== '')
    if (paths.length === 0) return null
    for (const path of paths) {
      const diags = this.lspBridge.diagnosticsFor(path)
      if (diags !== undefined) {
        const badge = lspBadgeText(diags)
        if (badge !== null) return `⚠ ${badge}`
      }
    }
    return null
  }

  /** /lsp：切换诊断面板显隐（懒创建 bridge；空态文案由面板纯函数承担）。 */
  private toggleLspPanel(): void {
    this.lspPanelVisible = !this.lspPanelVisible
    if (this.lspPanelVisible) this.ensureLspBridge()
  }

  /**
   * Ctrl+S / 欢迎「恢复」：切到 listSessions 里最近的非当前会话（含 persistence）。
   * live store 没有时走 switchSession → resume。
   */
  private async restoreRecentOtherSession(): Promise<void> {
    // Ctrl+S 落到最近一个「可恢复」的其他会话：损坏占位跳过（选中只会失败）；
    // listSessions 失败静默降级（void 触发的按键面，无 catch 会成 unhandled rejection）。
    const others = (await listSessions(this.ctx).catch(() => []))
      .filter(s => s.id !== this.activeSessionId && !s.corrupt)
    const target = others[0]?.id
    if (target === undefined) return
    this.switchSessionGuarded(target)
  }

  /**
   * slash 注册表当前命令名集合（现取——/lsp 等动态注册命令不误判为路径）。
   * 内置表未命中时再查 cordis CommandService：/plan 等仅由插件注册的命令
   * 携带参数（/plan off）也是命令而非单段文件路径。
   */
  private isKnownCommand(name: string): boolean {
    if (this.slash.list().some(c => c.name === name)) return true
    if (this.activeSessionId === null) return false
    const commands = this.ctx.reflect.get('commands', false) as CommandServiceFacet | undefined
    if (commands === undefined || typeof commands.find !== 'function') return false
    const agent = this.ctx.agents.get(this.activeSessionId)
    if (agent === undefined) return false
    return commands.find(agent, name) !== undefined
  }

  /** name 是否为某个已注册命令的前缀（/h → help；模糊输入仍视为命令）。 */
  private isCommandPrefix(name: string): boolean {
    return this.slash.list().some(c => c.name.startsWith(name))
  }

  /**
   * Windows 双触发防护：最近 800ms 内 Ctrl+C 字节（0x03）已处理（打断/退出）时，
   * 紧随的 SIGINT 应被忽略——否则刚打断的 TUI 被 teardown 拆掉（输入框消失、
   * 进程存活）。装配层（index.ts）的 SIGINT handler 先查此门再决定是否退出。
   * @param now - 当前时间戳（注入便于测试）。
   * @returns true = SIGINT 应忽略（0x03 刚处理过）。
   */
  shouldDeferSigint(now: number): boolean {
    return now - this.lastCtrlCAt < 800
  }

  /**
   * Prepares one immutable welcome snapshot and commits only the top bar.
   *
   * Restore projection, selected tip, route metadata, cwd, and version are
   * queried once here. The final welcome remains pending until
   * {@link settleWelcome} wins the lifecycle.
   */
  private async prepareWelcome(): Promise<void> {
    await this.refreshApiKeyReady()
    if (this.isDisposed()) return
    const current = this.modelRef?.current ?? this.ctx.agentDefaultModel.currentSelection()
    const reasoningEffort = await this.resolveWelcomeReasoningEffort(current)
    if (this.isDisposed()) return
    const cwd = this.sessionCwd()
    const topBarLines = this.formatWelcomeTopBar(current, cwd)
    if (topBarLines.length > 0) {
      this.live.clearForCommit()
      this.commit.writeBatch(topBarLines.map(text => ({ text })))
    }

    const active = this.activeSessionId
    const summaries = await listSessions(this.ctx)
    if (this.isDisposed()) return
    const others = summaries.filter(s => s.id !== active)
    const resumeAvailable = others.length > 0

    // 1.1：可恢复会话编号列表（数字键直达）。标题经 loadHistory + sessionTitleFor
    // 计算——仅对展示行数（WELCOME_RESTORE_MAX_ROWS）做 IO，折叠计数取全量。
    // 冷启动默认行为（新建 vs 自动恢复）是未定决策点：列表只补可见性，不改默认。
    const WELCOME_RESTORE_MAX_ROWS = 3
    const liveIds = new Set(this.ctx.sessions.list().map(s => s.id))
    const restoreRows = projectRestorableSessions(others, { liveIds }).slice(0, WELCOME_RESTORE_MAX_ROWS)
    const restoreRowsWithTitles = await Promise.all(restoreRows.map(async (s) => {
      const events = await loadHistory(this.ctx, s.id).catch(() => [])
      return { ...s, title: sessionTitleFor(events) }
    }))
    if (this.isDisposed()) return
    this.welcomeSessionRows = restoreRowsWithTitles
    this.welcomeDigitsActive = restoreRowsWithTitles.length > 0

    const listVisible = this.welcomeSessionRows.length > 0
    const restoreLines = formatRestorablePickerList(this.welcomeSessionRows, {
      now: Date.now(),
      maxRows: WELCOME_RESTORE_MAX_ROWS,
    })
    const distVersion = readDistributionVersion()
    const tip = pickWelcomeTip(undefined, {
      resumeVisible: resumeAvailable && !listVisible,
    })
    this.welcomeIntro = new WelcomeIntroController({
      modelId: current.model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      cwd,
      ...(distVersion === undefined ? {} : { version: distVersion }),
      restoreLines,
      tip,
    }, performance.now())
  }

  /** Formats the startup top bar against the terminal's current dimensions. */
  private formatWelcomeTopBar(
    current = this.modelRef?.current ?? this.ctx.agentDefaultModel.currentSelection(),
    cwd = this.sessionCwd(),
  ): string[] {
    const cols = this.stdout.columns
    const gutter = cols >= CHROME_GUTTER * 2 + 8 ? CHROME_GUTTER : 0
    const branch = gitBranch()
    const topBarLines = formatTopBar({
      width: cols - gutter,
      cwd,
      modelName: `${current.provider}/${current.model}`,
      ...(branch === undefined ? {} : { branch }),
    }, this.theme).map(line => gutter > 0 ? `${' '.repeat(gutter)}${line}` : line)
    return topBarLines
  }

  /** Maps the attached output's color depth to the fox renderer's 0–3 levels. */
  private welcomeColorLevel(): number {
    if (!this.stdout.isTTY) return 0
    const getColorDepth = (this.stdout as WriteStream & {
      getColorDepth?: () => number
    }).getColorDepth
    if (typeof getColorDepth !== 'function') return 0
    const depth = getColorDepth.call(this.stdout)
    if (depth >= 24) return 3
    if (depth >= 8) return 2
    if (depth >= 4) return 1
    return 0
  }

  /** Whether this attach can play a live opening. Always false; `auto` and `off` share one static path. */
  private canAnimateWelcome(): boolean {
    return false
  }

  /**
   * Sole final welcome commit point.
   *
   * The controller transition wins before terminal writes. Final composition
   * always uses current dimensions/theme and the generated canonical frame,
   * never the last preview frame.
   *
   * @param reason - Lifecycle event that requested final settlement.
   * @returns True only when this call performed the final commit.
   */
  private settleWelcome(reason: WelcomeIntroSettleReason): boolean {
    const intro = this.welcomeIntro
    if (intro === null || !intro.settle(reason)) return false
    const openDelayedKeyDialog = this.autoKeyDialogPending && reason !== 'input'
    this.autoKeyDialogPending = false

    this.live.clearForCommit()
    const artWidth = resolveWelcomeArtWidth(this.stdout.columns, this.stdout.rows)
    const artLines = artWidth === 28 || artWidth === 36
      ? formatFoxFrame({
        colorLevel: this.welcomeColorLevel(),
        width: artWidth,
      })
      : []
    const snapshot = intro.snapshot
    const finalLines = formatWelcome({
      width: this.stdout.columns,
      rows: this.stdout.rows,
      art: { lines: artLines, width: artWidth ?? 0 },
      modelId: snapshot.modelId,
      ...(snapshot.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: snapshot.reasoningEffort }),
      cwd: snapshot.cwd,
      ...(snapshot.version === undefined ? {} : { version: snapshot.version }),
      restoreLines: snapshot.restoreLines,
      tip: snapshot.tip,
    }, this.theme)
    this.commit.writeBatch(finalLines.map(text => ({ text })))
    this.flushLiveRender()

    if (openDelayedKeyDialog && !this.disposed) this.maybeAutoOpenKeyDialog()
    return true
  }

  /**
   * 新建会话：经 ctx.agents.create 铸造 session+agent，本层持有 handle。
   * 模型定路取 agentDefaultModel 当前选择（settings 用户层实时生效），并经
   * installModelSelection 耦合 prompt 装配与请求路由（headless 同款接线）。
   * 会话 id 由本层铸造（session-<uuid>），create 返回的 handle 由 ownedHandle 持有、
   * detach/dispose 时释放；controls 走 controlsFromHandle（驱动 handle.agent）。
   * 先卸载当前挂载（与 switchSession 对称）：否则 transcript/liveAgent/
   * statusLine/streamFeed 被覆盖即泄漏监听器，旧 ownedHandle 丢失即泄漏 agent。
   * @returns 新会话的 id（本层铸造的 session-<uuid>）。
   */
  async newSession(): Promise<SessionId> {
    // 1.1：新建会话结束欢迎阶段（数字键列表只在冷启动首屏有效）。
    this.welcomeDigitsActive = false
    // P3 side conversation：切换时保留旧会话 agent（keepHandle 让渡 registry）——
    // /session new 后旧会话可切回。退出（dispose）时 detachProjections 默认
    // 释放全部 handle（见 dispose 路径）。
    await this.detachProjections({ keepHandle: true })
    this.dynamicRowsHighWater = 0
    const id = SessionId(`session-${randomUUID()}`)
    const selection = this.ctx.agentDefaultModel.currentSelection()
    // C2 项 4：持有可变 ModelSelectionRef——/model 热切当前会话（改 current，
    // 下一次 agent 步进的 prompt assembly 自动生效）。
    this.modelRef = { current: selection, assembled: undefined }
    const ref = this.modelRef
    // 意图对齐桥装配时，新会话先进对齐会话（辅模型多轮澄清）；主会话在对齐
    // 完成（intent-bridge/handoff）时由 bridge 创建并自动切回。对齐会话的
    // 模型路由由 bridge 配置（alignProvider/alignModel）；主会话跟随当前
    // 模型选择与 reasoningEffort（exec override），cwd 与常规新会话一致。
    // 经 reflect.get 读取：runtimeCtx 只 inject sessions/agents/agentDefaultModel，
    // 属性访问未声明的 intentBridge 在 Cordis 4 抛 without inject（真实装配已复现）。
    // enabled:false 的挂载保留服务但 createAlignedSession 会抛——检查主开关，
    // 关闭时回退常规新建（直连进禅）。
    const intentBridge = this.ctx.reflect.get('intentBridge', false) as IntentBridgeService | undefined
    if (intentBridge !== undefined && intentBridge.enabled) {
      const align = await intentBridge.createAlignedSession({
        cwd: process.cwd(),
        exec: callConfigFrom(selection),
      })
      this.ownedHandle = align.handle
      this.controls = controlsFromHandle(align.handle)
      this.activeSessionId = SessionId(align.sessionId)
      this.mountSession(this.activeSessionId, { restored: false })
      return this.activeSessionId
    }
    const presetId = this.defaultPresetId()
    const handle = await this.ctx.agents.create({
      sessionId: id,
      meta: { cwd: process.cwd(), ...(presetId === undefined ? {} : { agentPreset: presetId }) },
      agentOptions: callConfigFrom(selection),
      setup: async (agentCtx) => {
        this.bindModelSelection(agentCtx, ref)
        await this.mountDefaultPreset(agentCtx)
      },
    })
    this.ownedHandle = handle
    this.controls = controlsFromHandle(handle)
    this.activeSessionId = id
    this.mountSession(id, { restored: false })
    return id
  }

  /**
   * C2 项 4：热切当前会话的模型。改 modelRef.current——下一次 agent 步进
   * （prompt assembly）自动生效，不中断当前步骤。无挂载会话时返回 false。
   * @param selection - 新的 provider/model。
   * @returns 是否已热切（modelRef 存在）。
   */
  switchLiveModel(selection: ModelSelection): boolean {
    if (this.modelRef === null) return false
    this.modelRef.current = selection
    this.glanceModelName = selection.model
    this.glanceEffort = selection.reasoningEffort ?? null
    this.refreshVisionForSelection(selection)
    return true
  }

  /**
   * Fold the durable header's explicit route, else the current default selection.
   * @param id - mounted session id.
   * @returns provider/model and an explicit effort when the header recorded one.
   */
  private selectionForSession(id: SessionId): ModelSelection {
    const persisted = getSession(this.ctx, id)?.requestHeader()?.config
    if (persisted === undefined) return this.ctx.agentDefaultModel.currentSelection()
    return {
      provider: persisted.provider,
      model: persisted.model,
      ...persisted.reasoningEffort === undefined ? {} : { reasoningEffort: persisted.reasoningEffort },
    }
  }

  /**
   * Install one selection onto an agent scope and replace any previous install.
   * @param agentCtx - the selected agent's scoped context.
   * @param ref - the mutable selection this front door owns.
   */
  private bindModelSelection(agentCtx: Context, ref: ModelSelectionRef): void {
    this.modelSelectionDisposer?.()
    this.modelSelectionDisposer = installModelSelection(agentCtx, ref)
  }

  /** The deployment's default preset id, or undefined when no roster is composed. */
  private defaultPresetId(): string | undefined {
    const facet = this.ctx.reflect.get('agentPresets', false) as { defaultId?: string } | undefined
    return facet?.defaultId
  }

  /** Join a freshly-created agent to the default preset; no-op without a roster. */
  private async mountDefaultPreset(agentCtx: Context): Promise<void> {
    const facet = this.ctx.reflect.get('agentPresets', false) as
      | { mount?(ctx: Context, id?: string): Promise<unknown> }
      | undefined
    if (facet?.mount === undefined) return
    await facet.mount(agentCtx)
  }

  /**
   * A3：分叉当前会话（SessionStore.fork 复制历史到新 child session，带
   * parentSession 血缘）并切换到分叉（agent-ensure 走 switchSession 的
   * resume/registry 兜底路径）。无活跃会话时抛错（命令分发层回显失败）。
   * @param opts - 可选 directive：fork 后作为首条消息提交给新会话（分叉探索方向）。
   * @returns 分叉会话 id。
   */
  async forkSession(opts?: { directive?: string }): Promise<SessionId> {
    if (this.activeSessionId === null) {
      throw new Error('当前无会话可分叉')
    }
    const child = this.ctx.sessions.fork(this.activeSessionId)
    await this.switchSession(child.id)
    if (opts?.directive !== undefined && opts.directive !== '') {
      this.controls?.followup(opts.directive)
    }
    return child.id
  }

  /**
   * C3 项 3：打开 rewind overlay（/rewind）。检查点 = transcript 里真人用户
   * 说过的非空 `user/message`；执行回调做「文件回退 + 会话截断 + 持久化截断」。
   * @returns 是否已打开（无活跃会话或无可回退用户消息时 false）。
   */
  rewindSession(): boolean {
    const overlay = this.overlay
    const rewind = this.rewindOverlay
    if (overlay === null || rewind === null) return false
    if (this.activeSessionId === null) return false
    const messages = (this.transcript?.view.messages ?? []).filter(isUserRewindCheckpoint)
    if (messages.length === 0) {
      this.echoWarn('没有可回退的用户消息')
      return false
    }
    rewind.setMessages(messages, (mode, atSeq) => this.executeRewind(mode, atSeq))
    overlay.activate('rewind')
    return true
  }

  /**
   * #31：打开模型选择器。数据源 = llm 服务的 provider/model 目录（动态现取）；
   * llm 服务缺失时 fails loud（不静默）。确认后走 /model 同路径
   * （saveSelection + switchLiveModel 热切）。
   */
  private async openModelPicker(): Promise<void> {
    const overlay = this.overlay
    const picker = this.picker
    if (overlay === null || picker === null) return
    const llm = this.ctx.reflect.get('llm', false) as
      | { listProviders(): Array<{ id: string; name: string }>; listModels(provider: string): Promise<Array<{ id: string; name: string }>> }
      | undefined
    if (llm === undefined) {
      this.echoWarn('⚠ llm 服务不可用（未装配 llm 插件），模型选择器不可用')
      return
    }
    const current = (this.ctx as unknown as { agentDefaultModel?: ModelFacet }).agentDefaultModel
      ?.currentSelection()
    const currentKey = current === undefined ? null : `${current.provider}/${current.model}`
    const items: PickerItem[] = []
    let selectedIndex = 0
    for (const provider of llm.listProviders()) {
      // listModels 为 adapter 通告目录（advisory）；失败/空目录跳过该 provider。
      const models = await llm.listModels(provider.id).catch(() => [])
      for (const model of models) {
        const key = `${provider.id}/${model.id}`
        const item: PickerItem = {
          label: key === currentKey ? `${key}（当前）` : key,
          value: key,
          current: key === currentKey,
        }
        if (key === currentKey) selectedIndex = items.length
        items.push(item)
      }
    }
    if (items.length === 0) {
      this.echoWarn('⚠ 无可用模型（llm 目录为空），模型选择器不可用')
      return
    }
    picker.open('选择模型', items, (item) => {
      const selection = parseRouteKey(item.value)
      if (selection === undefined) return
      this.switchLiveModel(selection)
      void this.ctx.agentDefaultModel.saveSelection(selection)
      this.commitToScrollback({ text: `模型已切换: ${selection.provider}/${selection.model}`, trailingNewline: true })
    }, selectedIndex)
    overlay.activate('picker')
  }

  /**
   * /model vision|secondary|subagent：打开角色模型选择器。条目构建与回显文案在
   * model-roles.ts 纯函数层；此处只做服务现取与接线。首行「跟随默认（清除 pin）」
   * 选中即 unpin（目录为空时仍可达，故不做主模型选择器的空目录拒绝）；确认后
   * pin/unpin 经 modelRoles 服务写 settings 用户层（热生效，无需重启）。
   * @param role - 目标角色（命令层已解析为保留字）。
   */
  private async openRoleModelPicker(role: ModelRole): Promise<void> {
    const overlay = this.overlay
    const picker = this.picker
    if (overlay === null || picker === null) return
    const roles = this.ctx.get('modelRoles')
    if (roles === undefined) {
      this.echoWarn(MODEL_ROLES_UNAVAILABLE)
      return
    }
    const llm = this.ctx.reflect.get('llm', false) as
      | { listProviders(): Array<{ id: string }>; listModels(provider: string): Promise<Array<{ id: string; supportsVision?: boolean }>> }
      | undefined
    if (llm === undefined) {
      this.echoWarn('⚠ llm 服务不可用（未装配 llm 插件），模型选择器不可用')
      return
    }
    // 目录现取（与主模型选择器同源）：listModels 为 adapter 通告（advisory），
    // 失败/空目录的 provider 不出现在条目里；supportsVision 供 vision 角色警告。
    const providers: RoleCatalogProvider[] = []
    for (const provider of llm.listProviders()) {
      const models = await llm.listModels(provider.id).catch(() => [])
      providers.push({ id: provider.id, models })
    }
    const { items, selectedIndex } = buildRoleModelPickerItems(providers, roles.resolve(role))
    picker.open(`选择${MODEL_ROLE_LABELS[role]}`, items, (item) => {
      if (item.value === FOLLOW_DEFAULT_VALUE) {
        void roles.unpin(role)
        this.commitToScrollback({ text: roleUnpinEcho(role), trailingNewline: true })
        return
      }
      const selection = parseRouteKey(item.value)
      if (selection === undefined) return
      if (role === 'vision') {
        const supportsVision = providers
          .find(p => p.id === selection.provider)?.models
          .find(m => m.id === selection.model)?.supportsVision
        if (supportsVision === false) {
          this.commitToScrollback({ text: roleVisionWarning(selection), trailingNewline: true })
        }
      }
      void roles.pin(role, selection)
      this.commitToScrollback({ text: rolePinEcho(role, selection), trailingNewline: true })
    }, selectedIndex)
    overlay.activate('picker')
  }

  /**
   * /key：供应商密钥配置向导。llm 配置目录可用时先开供应商 picker（默认
   * 供应商 ● 置首、已配置 ✓ 后缀），选中后链到参数化的 key 对话框（掩码
   * 输入 + 探测 + 落盘）；目录缺席（无 llm seam/测试装配）降级为 DeepSeek
   * 直开。凭据服务经 reflect.get 现取（缺席时对话框给降级指引）。
   */
  private async openKeyDialog(): Promise<void> {
    if (this.isDisposed()) return
    const overlay = this.overlay
    const dialog = this.keyDialog
    const picker = this.picker
    if (overlay === null || dialog === null) return
    // 已在打开/已打开时不重进：同 id activate 会先调本对话框 onDeactivate，
    // 把 open() 刚置真的开旗标打回 false（对话框 visually 打开但键控失效）。
    if (overlay.activeId() === 'key-dialog') return
    const credentials = this.ctx.reflect.get('credentials', false) as KeyDialogCredentials | undefined
    const directory = this.keyWizardDirectory()
    if (picker === null || directory.length === 0) {
      await this.openKeyDialogForEntry(undefined, credentials)
      return
    }
    // 状态 join：各条目的落盘引用 + credentials.describe（configured）。
    const sections = this.readResolvedSettingsSections()
    const configured = new Map<string, boolean>()
    for (const entry of directory) {
      const ref = resolveKeyRef(entry.provider, this.profileApiKeyEnv(sections, entry))
      if (credentials === undefined) break
      const isConfigured = await credentials.describe(ref)
        .then(info => info.configured, () => false)
      if (this.isDisposed()) return
      configured.set(entry.provider, isConfigured)
    }
    const defaultProvider = this.defaultModelProvider()
    picker.open('选择供应商（配置 API 密钥）', buildProviderItems(directory, configured, defaultProvider), (item) => {
      const entry = directory.find(candidate => candidate.provider === item.value)
      if (entry === undefined) return
      // picker 的 commit 回调先于随后的 overlay.deactivate：链式开窗必须排到
      // picker 失活之后（微任务），否则 activate 会被紧跟的 deactivate 打掉。
      queueMicrotask(() => { void this.openKeyDialogForEntry(entry, credentials) })
    }, 0)
    overlay.activate('picker')
  }

  /**
   * 打开参数化 key 对话框；entry 缺省即 DeepSeek 缺省目标（首启引导与降级）。
   * pi-ai 路由的 profile 未声明 apiKeyEnv 时挂 afterSave：保存后补写
   * `{providers: {<route>: {apiKeyEnv}}}`——路由即刻注册，/model 立即可选
   * （与 web 模型页的写入形状一致）；settings 缺席则只存 key 不激活。
   * @param entry - 目录条目；undefined = DeepSeek 缺省目标。
   * @param credentials - 凭据服务最小面；undefined = 服务缺席（对话框降级指引）。
   */
  private async openKeyDialogForEntry(
    entry: WizardProviderEntry | undefined,
    credentials: KeyDialogCredentials | undefined,
  ): Promise<void> {
    if (this.isDisposed()) return
    const overlay = this.overlay
    const dialog = this.keyDialog
    if (overlay === null || dialog === null) return
    if (overlay.activeId() === 'key-dialog') return
    const sections = this.readResolvedSettingsSections()
    const namedEnv = entry === undefined ? undefined : this.profileApiKeyEnv(sections, entry)
    const target: KeyDialogTarget = entry === undefined
      ? DEEPSEEK_KEY_TARGET
      : {
        provider: entry.provider,
        displayName: entry.displayName,
        ref: resolveKeyRef(entry.provider, namedEnv),
        probe: this.keyProbeFor(entry),
        ...namedEnv === undefined
          && entry.settingsPath.length > 0
          && this.settingsMutationFacet() !== undefined
          ? { afterSave: () => this.activateRouteProfile(entry) }
          : {},
      }
    await dialog.open(credentials, target)
    if (this.isDisposed()) return
    overlay.activate('key-dialog')
  }

  /** llm 配置目录（llm seam 缺席或面不含该法时为空数组——降级 DeepSeek 直开）。 */
  private keyWizardDirectory(): WizardProviderEntry[] {
    const llm = this.ctx.reflect.get('llm', false) as
      | {
        listConfigurableProviders?: () => Array<{
          provider: string
          displayName: string
          settingsNs: string
          settingsPath: readonly string[]
        }>
      }
      | undefined
    if (llm === undefined || typeof llm.listConfigurableProviders !== 'function') return []
    return llm.listConfigurableProviders()
      .filter(entry => entry.provider.length > 0)
      .map(entry => ({
        provider: entry.provider,
        displayName: entry.displayName,
        settingsNs: entry.settingsNs,
        settingsPath: entry.settingsPath,
      }))
  }

  /** settings 服务最小面（describe/mutate；缺席时向导只存 key 不做 profile 激活）。 */
  private settingsMutationFacet(): KeyWizardSettingsFacet | undefined {
    return this.ctx.reflect.get('settings', false) as KeyWizardSettingsFacet | undefined
  }

  /** 读取 settings 各命名空间的已解析值（ns 对象原样保留供 mutate 回传）。 */
  private readResolvedSettingsSections(): Map<string, unknown> {
    const sections = new Map<string, unknown>()
    const settings = this.settingsMutationFacet()
    if (settings === undefined) return sections
    try {
      for (const descriptor of settings.describe()) {
        sections.set(String(descriptor.ns), descriptor.value)
      }
    } catch {
      // 面不匹配/读取失败：引用解析退回派生规则（最早的可用事实）。
    }
    return sections
  }

  /**
   * 目录条目在已解析 settings 段里的 `apiKeyEnv`（组合层下发的 openrouter
   * profile 就带着 OPENROUTER_API_KEY）；llm-deepseek 段经 schema 缺省解析
   * 为 DEEPSEEK_API_KEY。无 profile/未声明返回 undefined（落派生规则）。
   */
  private profileApiKeyEnv(sections: ReadonlyMap<string, unknown>, entry: WizardProviderEntry): string | undefined {
    const section = sections.get(entry.settingsNs)
    if (section === null || typeof section !== 'object') return undefined
    let profile: unknown = section
    for (const key of entry.settingsPath) {
      if (profile === null || typeof profile !== 'object') return undefined
      profile = (profile as Record<string, unknown>)[key]
    }
    const named = profile === null || typeof profile !== 'object'
      ? undefined
      : (profile as Record<string, unknown>).apiKeyEnv
    return typeof named === 'string' && named.length > 0 ? named : undefined
  }

  /**
   * 供应商探测实现：llm-deepseek 段用既有官方端点探测；其余走 llm 发现探针
   * （带草稿 key 即真鉴权：2xx → ok，AUTH/INVALID_CREDENTIAL → invalid，
   * 其余含网络错 → unknown）。llm seam 缺席按 unknown（无法证伪，可强存）。
   */
  private keyProbeFor(entry: WizardProviderEntry): (key: string) => Promise<'ok' | 'invalid' | 'unknown'> {
    if (entry.settingsNs === 'llm-deepseek') return probeDeepSeekKey
    return async (key) => {
      const llm = this.ctx.reflect.get('llm', false) as
        | { discoverModels?: (ns: string, request: { provider?: string; apiKey?: string }) => Promise<unknown> }
        | undefined
      if (llm === undefined || typeof llm.discoverModels !== 'function') return 'unknown'
      try {
        await llm.discoverModels(entry.settingsNs, { provider: entry.provider, apiKey: key })
        return 'ok'
      } catch (error) {
        const code = (error as { code?: unknown }).code
        return code === 'AUTH' || code === 'INVALID_CREDENTIAL' ? 'invalid' : 'unknown'
      }
    }
  }

  /** 保存 key 后激活路由：写入最小 profile（settingsPath 非空 = pi-ai 路由）。 */
  private async activateRouteProfile(entry: WizardProviderEntry): Promise<void> {
    const settings = this.settingsMutationFacet()
    if (settings === undefined) return
    await settings.mutate(entry.settingsNs, [{
      op: 'set',
      path: [...entry.settingsPath, 'apiKeyEnv'],
      value: resolveKeyRef(entry.provider, undefined),
    }])
  }

  /** 当前默认模型所在的供应商路由（agent-default-model 缺席时无默认）。 */
  private defaultModelProvider(): string | undefined {
    const facet = (this.ctx as unknown as { agentDefaultModel?: { currentSelection?: () => { provider: string } } }).agentDefaultModel
    try {
      return facet?.currentSelection?.().provider
    } catch {
      return undefined
    }
  }

  /**
   * 首启引导：交互终端（TTY）缺 API key 时自动打开一次设置对话框（Esc 可跳过）。
   * 挂载点在欢迎渲染/会话就绪之后（attach 尾；apiKeyReady 已由
   * prepareWelcome 刷新）；keyPromptShown 做 run 级守护，
   * restore/重进等后续流程不再重复弹；非 TTY（测试/管道）不弹交互对话框。
   */
  private maybeAutoOpenKeyDialog(): void {
    if (this.disposed || this.keyPromptShown || this.apiKeyReady) return
    if (!this.stdin.isTTY) return
    this.keyPromptShown = true
    void this.openKeyDialog()
  }

  /** #31/#33：打开主题选择器（THEME_NAMES + 当前主题 ● 高亮）。
   *  实时预览：↑↓ 移动即 setTheme 生效；Enter 落定；Esc/q 还原打开前主题。 */
  private openThemePicker(): void {
    const overlay = this.overlay
    const picker = this.picker
    if (overlay === null || picker === null) return
    const prev = getActiveThemeName()
    const items: PickerItem[] = THEME_NAMES.map(name => ({
      label: name === prev ? `${name}（当前）` : name,
      value: name,
      current: name === prev,
    }))
    const selectedIndex = Math.max(0, THEME_NAMES.indexOf(prev as ThemeName))
    picker.open('选择主题', items, (item) => {
      // 确认：主题已在预览中生效，此处只落提示。
      this.commitToScrollback({ text: `主题已切换: ${item.value}`, trailingNewline: true })
    }, selectedIndex, {
      // ↑↓ 移动即切换（实时预览，overlay 渲染随主题色即时变化）。
      onPreview: (item) => { setTheme(item.value) },
      // Esc/q 关闭还原打开前主题。
      onCancel: () => { setTheme(prev) },
    })
    overlay.activate('picker')
  }

  /** #31：打开会话选择器（listSessions 同源；当前会话 ● 高亮）。 */
  private async openSessionPicker(): Promise<void> {
    const overlay = this.overlay
    const picker = this.picker
    if (overlay === null || picker === null) return
    const rows = await listSessions(this.ctx)
    if (rows.length === 0) {
      this.echoWarn('⚠ 当前无会话，会话选择器不可用')
      return
    }
    const active = this.activeSessionId
    // 2.2：行标签 = formatRestorableSessions 单行摘要（标题 · 年龄 · cwd ·
    // 当前标记）——无需记忆 UUID 即可辨认会话。标题经 loadHistory +
    // sessionTitleFor 计算；损坏行直接标注（loadHistory 失败不回退空标题）。
    const liveIds = new Set(this.ctx.sessions.list().map(s => s.id))
    const projected = projectRestorableSessions(rows, { liveIds })
    const withTitles = await Promise.all(projected.map(async (r) => {
      if (r.corrupt) return { ...r, title: undefined }
      const events = await loadHistory(this.ctx, r.id).catch(() => [])
      return { ...r, title: sessionTitleFor(events) }
    }))
    const items: PickerItem[] = []
    let selectedIndex = 0
    for (const row of withTitles) {
      const summary = formatRestorableSessions([row], { now: Date.now() })[0] ?? row.id
      const label = `${summary}${row.id === active ? '（当前）' : ''}`
      const item: PickerItem = { label, value: row.id, current: row.id === active }
      if (row.id === active) selectedIndex = items.length
      items.push(item)
    }
    picker.open('选择会话', items, (item) => {
      // 损坏会话切换抛错——fails loud（统一回显失败原因，不静默吞掉）。
      this.switchSessionGuarded(SessionId(item.value))
    }, selectedIndex)
    overlay.activate('picker')
  }

  /**
   * P1：发起 /btw 侧问——BtwController 旁路（临时 btw agent，不持 ownedHandle、
   * 不经过 switchSession）。返回是否已发起：无活跃会话或已有挂起侧问时 false
   * （命令分发层回显提示）；创建/提问失败抛错由 runSlash 统一回显。
   * @param question - 侧问文本（已 trim）。
   * @returns 是否已发起。
   */
  private async askBtw(question: string): Promise<boolean> {
    if (this.activeSessionId === null) return false
    if (this.btw.isActive) return false
    await this.btw.ask(question)
    return true
  }

  /**
   * T3：/export 会话导出——把当前会话完整事件日志渲染为 Markdown 并写盘。
   * 数据源是 session.events（权威事件流，非渲染视图）：完整内容、无折叠截断。
   * path 缺省 = 会话创建目录下 `dsh-export-<id>.md`（header.cwd 缺失时回退
   * 当前进程 cwd）。无活跃会话或写盘失败抛错——命令分发层回显失败（fails loud）。
   * @param path - 目标文件路径；缺省由会话 cwd 决定。
   * @returns 实际写入的导出文件路径。
   */
  private async exportTranscript(path?: string): Promise<string> {
    if (this.activeSessionId === null) {
      throw new Error('当前无会话，无法导出')
    }
    const session = this.ctx.sessions.get(this.activeSessionId)
    if (session === undefined) {
      throw new Error('会话不存在，无法导出')
    }
    const target = path ?? join(session.header.cwd ?? process.cwd(), `dsh-export-${session.id}.md`)
    const markdown = renderSessionExport(session.events, {
      sessionId: session.id,
      // exactOptionalPropertyTypes：undefined 显式展开（条件展开是正确形态）。
      ...(session.header.cwd !== undefined ? { cwd: session.header.cwd } : {}),
    })
    await writeFile(target, markdown, 'utf8')
    return target
  }

  /**
   * P2：打开 memory 浏览器 overlay。条目快照 + 删除回调在激活时经 memory
   * 服务注入（reflect 动态获取；服务缺失返回 false，命令层回显不可用）。
   * @returns 是否已打开。
   */
  private async openMemoryBrowser(): Promise<boolean> {
    const overlay = this.overlay
    const browser = this.memoryOverlay
    if (overlay === null || browser === null) return false
    const memory = this.ctx.reflect.get('memory', false) as MemoryServiceFacet | undefined
    if (memory === undefined) return false
    const PAGE_SIZE = 20
    const items = await memory.list({ limit: PAGE_SIZE, offset: 0 })
    const hasMore = items.length >= PAGE_SIZE
    browser.setItems(items, {
      refetch: async () => memory.list(),
      onDelete: async (id) => { await memory.delete(id) },
      fetchPage: async (offset, limit) => memory.list({ offset, limit }),
    }, hasMore)
    overlay.activate('memory')
    return true
  }

  /**
   * T5：打开全屏转录查看器 overlay（/scroll）。数据快照 = CommitEngine 缓冲的
   * scrollback 全文（含命令回显/steer 等屏幕记录）；缓冲满时顶栏提示截断。
   * 打开期间为快照——流式新增不推送（alt screen 遮住主屏，关闭后自然最新）。
   * @returns 是否已打开（scrollback 为空时 false）。
   */
  private openTranscriptViewer(): boolean {
    const overlay = this.overlay
    const viewer = this.transcriptViewer
    if (overlay === null || viewer === null) return false
    const content = this.commit.getContent()
    if (content.trim() === '') return false
    viewer.setContent(content, {
      truncated: this.commit.isFull(),
      maxLines: this.commit.capacity(),
    })
    overlay.activate('transcript')
    return true
  }

  /**
   * C3 项 3：执行回退。mode 决定范围：
   * - convo：仅截断会话（内存 + 持久化）
   * - code：仅文件回退（FileHistory.rewindToBoundary）
   * - both：两者
   * 持久化失败向上抛（RewindOverlay 显示错误）；文件快照缺失计入 filesSkipped。
   * @returns 文件变更数/缺口数与截断 seq。
   */
  private async executeRewind(mode: RewindMode, atSeq: number): Promise<RewindResult> {
    let filesChanged = 0
    let filesSkipped: number | undefined
    if (mode !== 'convo') {
      const r = await this.rewindFiles(atSeq)
      filesChanged = r.changed
      filesSkipped = r.skipped
    }
    const result: RewindResult = { filesChanged }
    // exactOptionalPropertyTypes：undefined 时省略字段（缺省 = 无缺口）
    if (filesSkipped !== undefined) result.filesSkipped = filesSkipped
    if (mode === 'convo' || mode === 'both') {
      await this.truncateSession(atSeq)
      result.truncatedTo = atSeq
    }
    return result
  }

  /** 文件回退：收集 atSeq 之后的写工具 callId，经 fs-snapshot FileHistory 恢复。 */
  private async rewindFiles(atSeq: number): Promise<{ changed: number; skipped: number }> {
    if (this.activeSessionId === null) return { changed: 0, skipped: 0 }
    const session = this.ctx.sessions.get(this.activeSessionId)
    if (session === undefined) return { changed: 0, skipped: 0 }
    // fs-snapshot 快照索引经 reflect 获取（tui 不静态依赖该包；未装配时 fail loud）
    const histories = this.ctx.reflect.get('fsSnapshot.histories', false) as
      | Map<string, { rewindToBoundary(ids: Set<string>): Promise<{ changed: string[]; skipped: number }> }> | undefined
    if (histories === undefined) {
      throw new Error('rewind 文件快照不可用（fs-snapshot 未装配）')
    }
    const fh = histories.get(this.activeSessionId)
    if (fh === undefined) return { changed: 0, skipped: 0 } // 该会话无快照记录（无写工具调用）
    // 边界后写工具 callId：扫事件日志中 seq > atSeq 的 tool/call
    const postBoundaryIds = new Set<string>()
    for (const e of session.events) {
      if (e.seq <= atSeq) continue
      if (e.type === 'tool/call' && isWriteToolCall(e.data.name)) {
        postBoundaryIds.add(e.data.callId)
      }
    }
    const { changed, skipped } = await fh.rewindToBoundary(postBoundaryIds)
    return { changed: changed.length, skipped }
  }

  /**
   * 会话截断：先持久化后内存——truncateStored 失败时内存不动（状态一致、
   * 可重试），成功后再截内存态（同步纯内存操作，不抛错）。
   * @param atSeq - 截断到的 seq（含）。
   */
  private async truncateSession(atSeq: number): Promise<void> {
    if (this.activeSessionId === null) return
    const persistence = this.ctx.reflect.get('sessionPersistence', false) as
      | { truncateStored(id: unknown, atSeq: number): Promise<void> } | undefined
    if (persistence !== undefined) {
      await persistence.truncateStored(this.activeSessionId, atSeq)
    }
    const session = this.ctx.sessions.get(this.activeSessionId)
    if (session === undefined) return
    session.truncate(atSeq)
  }

  /**
   * 切换到既有会话：卸载旧投影/控制面（并释放本层持有的旧 handle），
   * 再 agent-ensure 目标会话——registry 有 live agent 走 controlsFromRegistry 兜底
   * （非自有，不 dispose）；无则 resume 拿 handle（本层持有并 dispose）。
   * resume 的模型定路沿用会话持久化的 request header（跨重启续模），
   * 无 header（从未成功发起请求的会话）才落 agentDefaultModel 当前选择。
   * 恢复先于任何切换状态提交：目标不可恢复时在此抛错，应用停留在原会话
   * （activeSessionId/modelRef/投影均不变，不进入半切换状态）。
   * @param id - 目标会话 id；live 会话或可恢复的持久化会话。
   */
  async switchSession(id: SessionId): Promise<void> {
    // 1.1：任何会话切换都结束欢迎阶段（数字键列表只在冷启动首屏有效）。
    this.welcomeDigitsActive = false
    // 切会话清空运行中排队：待发消息属于原会话上下文，不跨会话投递；丢弃前
    // 在旧会话视图回显条数（此时尚未 detach，transcript 仍是旧的）。
    // 回流 dsh-tui 9d7f421。
    if (this.submitQueue.size() > 0) {
      this.commitToScrollback({ text: `⚠ 切换会话：丢弃 ${this.submitQueue.size()} 条未发送的排队消息`, trailingNewline: true })
    }
    this.submitQueue.clear()
    // 代际号：快速连续切换时旧代作废——resume 是异步的，迟到完成的旧代
    // 不得再提交/挂载（乱序完成会把旧目标挂到新 active 上）。
    const epoch = ++this.switchEpoch
    const agent = this.ctx.agents.get(id)
    const selection = this.selectionForSession(id)
    const ref: ModelSelectionRef = { current: selection, assembled: undefined }
    // 失败先于状态提交：损坏占位/未知工件/后端故障在此抛出。
    const handle = agent !== undefined
      ? undefined
      : await this.resumeForSwitch(id, selection, ref)
    // 迟到的旧代：更新的切换已接管。已 resume 的 handle 让渡 registry
    // （与 keepHandle 同语义：agent 保持 live，切回走 agents.get 兜底；
    // 退出时 factory 统一清理）——不提交状态、不挂载。
    if (epoch !== this.switchEpoch) return
    // P3 side conversation：切走时保留旧会话 agent（keepHandle 让渡 registry；
    // 切回时走上方 agents.get 兜底分支——不 create 不 resume，transcript 重放）。
    await this.detachProjections({ keepHandle: true })
    if (epoch !== this.switchEpoch) return
    this.dynamicRowsHighWater = 0
    this.activeSessionId = id
    this.modelRef = ref
    if (agent !== undefined) {
      /* v8 ignore next -- agent 已确认存在（if 分支外），controlsFromRegistry 恒返回非空 */
      this.controls = controlsFromRegistry(this.ctx, id) ?? null
      this.bindModelSelection(agent.ctx, ref)
    } else if (handle !== undefined) {
      this.ownedHandle = handle
      this.controls = controlsFromHandle(handle)
    }
    this.mountSession(id, { restored: true })
  }

  /**
   * 恢复持久化会话供切换：损坏占位（version -1）先行失败并给出准确原因——
   * 后端对未物化工件只报 not found，用户无从知道是损坏；其余失败（未知 id/
   * 版本不符/后端故障）交给 agents.resume 原样抛出。
   * @param id - 目标会话 id（live store 中无此会话）。
   * @param selection - 定路快照（selectionForSession 已计算）。
   * @param ref - resume 的 setup 要接线的模型选择 ref。
   * @returns 本层持有并负责 dispose 的 agent handle。
   */
  private async resumeForSwitch(
    id: SessionId,
    selection: ModelSelection,
    ref: ModelSelectionRef,
  ): Promise<AgentHandle> {
    // 列举失败（后端故障）吞掉：预检只负责损坏占位，真实错误由 agents.resume 抛。
    const rows = await listSessions(this.ctx).catch(() => [])
    if (rows.some(s => s.id === id && s.corrupt)) {
      throw new Error(`会话工件损坏，不可恢复: ${id}`)
    }
    return this.ctx.agents.resume({
      resumeSessionId: id,
      agentOptions: callConfigFrom(selection),
      setup: (agentCtx) => {
        this.bindModelSelection(agentCtx, ref)
      },
    })
  }

  /**
   * 按键面会话切换：失败统一回显警告（损坏/未知工件 fails loud），rejection
   * 不逃逸成 unhandled；状态安全由 switchSession 保证（失败不提交切换状态）。
   * @param id - 目标会话 id。
   */
  private switchSessionGuarded(id: SessionId): void {
    void this.switchSession(id).catch((error: unknown) => {
      this.echoWarn(`⚠ 会话切换失败: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /**
   * 挂载当前会话的投影与控制面：transcript/live/controls 就位后，
   * 将已提交的历史渲染进 scrollback。
   * @param id - 目标会话 id（activeSessionId 已在调用方设置）。
   * @param opts.restored - 调用方语义：true = 恢复/切换到既有会话（有历史时
   *   渲染横幅 + 崩溃修复告知 +「上次进行到此处」分隔）；false = 本进程新建。
   *   新建必须显式声明——带种子的新会话（intent-bridge 对齐会话）事件数非零，
   *   按事件数猜测会把「新会话」误报成「已恢复会话」。
   */
  private mountSession(id: SessionId, opts: { restored: boolean }): void {
    const session = getSession(this.ctx, id)
    if (session === undefined) throw new Error(`unknown session: ${id}`)
    // 投影层 fold 接线：turn 统计复位（live 事件驱动）；会话汇总从事件日志
    // 重放重建（summarizeSession 即 replay 入口），恢复会话的 /status 立即可用。
    this.turnSummary = emptyTurnSummary(0)
    this.sessionSummary = summarizeSession(id, session.events)
    this.transcript = createTranscript(this.ctx, session)
    this.liveAgent = trackAgent(this.ctx, id)
    // Phase 6.2：工作流阶段指示器接入生产消费端——订阅 agent/status + session/event，
    // 折叠结果经 onUpdate 触发重绘，renderLive 优先取 statusLine.current 作状态行。
    this.statusLine = new WorkflowStatusLine(this.ctx, id, () => { this.renderBatcher.schedule() })
    // Phase 5.3：glance metrics 行的 model 名随会话挂载快照（渲染不重复查询）。
    // 定路与 switchSession 同构：持久化 request header 优先，无 header 才落
    // agentDefaultModel 当前选择——渲染不引入额外的 currentSelection 读取。
    // 推理努力度同构：实际请求 header 优先（adapterDefaults 折叠后的生效值），
    // 无 header 才落当前默认选择；request/header 事件随后保持新鲜。
    // header 完整存在时零查询（持久化路由存在不读默认选择——路由测试断言）。
    const headerConfig = session.requestHeader()?.config
    if (headerConfig !== undefined) {
      this.glanceModelName = headerConfig.model
      this.glanceEffort = headerConfig.reasoningEffort ?? null
    } else {
      const selection = this.ctx.agentDefaultModel.currentSelection()
      this.glanceModelName = selection.model
      this.glanceEffort = selection.reasoningEffort ?? null
    }
    const visionSelection = headerConfig !== undefined
      ? { provider: headerConfig.provider, model: headerConfig.model }
      : this.ctx.agentDefaultModel.currentSelection()
    this.refreshVisionForSelection(visionSelection)
    // 上下文窗口：路由元数据折叠（request/context 只在路由变化时记录；热切换经
    // request/context 事件更新，见 handleStreamEvent）。
    this.contextWindow = session.requestContext()?.contextWindow ?? null
    // 流式提交供给：assistant text-delta 经 blockWriter 节流喂给 StreamRenderer
    // commit 进 scrollback（此前只构造未接线，回复只活在 live 区尾部、turn 结束即消失）。
    this.streamFeed = this.ctx.on('session/event', (owner: { id: SessionId }, event: SessionEvent) => {
      if (owner.id !== id) return
      this.handleStreamEvent(event)
    })
    // T1.1：投影总线（6 域：todos/plan/goal/subagent/subagentTiming/cacheHealth）——全量快照 +
    // onChanged 按 key 分流缓存。经 ctx.reflect.get 读取（Cordis 4 注入代理：
    // 属性访问未注册服务抛 "without inject"——真实装配已复现）；服务缺失时
    // 整体降级：任务窗格/status 面板在切换时回显警告（fails loud），plan 徽标不显示。
    this.taskPanelVisible = false
    this.statusPanelVisible = false
    this.todosPanelVisible = false
    this.todosExpanded = false
    this.todosRetained = null
    this.taskItems = null
    this.planState = { active: false, pending: false }
    this.projectionCache = null
    // cacheHealth 与 miss 去重指纹同属会话内状态：切换会话必须清零，否则旧
    // 会话的 miss 标记残留到新会话（本方法下方专门防的跨会话残留类别）。
    this.cacheHealth = null
    this.lastReportedMiss = null
    const projections = this.ctx.reflect.get('sessionProjections', false) as ProjectionFacet | undefined
    if (projections !== undefined) {
      const snap = projections.snapshot(session)
      this.projectionCache = { ...snap.values }
      const snapTodos = snap.values.todos as TaskItem[] | null | undefined
      this.taskItems = snapTodos ?? null
      // 保留快照同源初始化（重放/重挂载时已写入的清单直接可见）。
      this.todosRetained = snapTodos ?? null
      const plan = snap.values.plan as PlanProjectionWire | undefined
      this.planState = { active: plan?.active ?? false, pending: plan?.pending ?? false }
      const statusLine = this.statusLine as WorkflowStatusLine | null
      statusLine?.setPlanState(this.planState)
      // cacheHealth 同源播种：恢复/重挂载已有缓存历史的会话时，miss 标记
      // 不等下一次投影变更即可见。
      this.cacheHealth = (snap.values.cacheHealth as CacheHealthWire | null | undefined) ?? null
      this.projectionDisposer = projections.onChanged((s, key, value) => {
        if (s.id !== id) {
          // 无关 key 早退：不扫运行中 child、不扫委派树。
          if (key !== 'subagentProgress' && key !== 'subagentTiming') return
          // T2.1：子会话运行态变化 → 重拉当前根的 listDescendants（同一 cut）。
          // 仅面板可见且 id 已在树上时才拉；冷子代仍可能走持久化 inspect。
          if (this.subagentsPanelVisible && this.delegationEntries !== null) {
            let treeHasChild = false
            for (const e of this.delegationEntries) {
              if (e.kind === 'child' && e.id === s.id) { treeHasChild = true; break }
            }
            if (treeHasChild) this.refreshDelegationTree(id)
          }
          // 活动带：运行中 subagent 的子会话 progress 恒缓存（带行统计段与
          // 完成行统计数据源；out-of-process 无 Session 投影，天然不命中）。
          if (key === 'subagentProgress' && this.isRunningSubagentChild(s.id)) {
            this.cacheChildProgress(s.id, value)
          }
          return
        }
        // 按 key 分流缓存（6 域总线）；todos/plan 有专有消费，其余域仅进缓存。
        /* v8 ignore next -- projectionCache 在快照后恒非 null（L766 赋值），null 仅类型收窄 */
        if (this.projectionCache !== null) {
          this.projectionCache[key as ProjectionKey] = value
        }
        if (key === 'todos') {
          const todos = value as TaskItem[] | null
          this.taskItems = todos
          // 保留快照只吸收非空值：turn/start 把投影清成 null 时面板不回退
          // （黏滞语义见 todosRetained 字段注释）。
          if (todos !== null) this.todosRetained = todos
          this.renderBatcher.schedule()
        } else if (key === 'plan') {
          const plan = value as PlanProjectionWire | null
          this.planState = { active: plan?.active ?? false, pending: plan?.pending ?? false }
          this.statusLine?.setPlanState(this.planState)
          this.renderBatcher.schedule()
        } else if (key === 'cacheHealth') {
          this.cacheHealth = value as CacheHealthWire | null
          this.reportCacheMiss()
          this.renderBatcher.schedule()
        } else {
          // goal/subagent/subagentTiming：仅更新缓存（/status 面板渲染时读取）
          this.renderBatcher.schedule()
        }
      })
    }
    // 跨会话残留清理：推理缓冲、最近推理块与进行中卡标题缓存都是会话内状态。
    this.discardReasoning()
    this.lastReasoningBlock = null
    this.reasoningExpanded = false
    this.pendingCallTitles.clear()
    // 历史加载：重放会话事件日志（live store 为权威来源，persisted-only 走
    // loadHistory——见 adapter/sessions；此处 live store 已含全部事件）。
    // 工具卡走同一 presenter 桥（presenter 为 args 纯函数、桥软降级，replay 安全）。
    const rows = renderTranscript(this.transcript.view, this.theme, this.stdout.columns, {
      compact: this.compactMode,
      resolveViews: (tool: TranscriptToolCall) => resolveToolViews(this.toolPresenters(), {
        name: tool.name,
        argumentsRaw: tool.arguments,
        ...(tool.result === undefined ? {} : {
          result: {
            content: tool.result.data.message.content[0].content,
            isError: toolResultText(tool.result).isError,
            ...(tool.result.data.meta === undefined ? {} : { meta: tool.result.data.meta }),
          },
        }),
      }),
    })
    // 1.2/1.3：恢复挂载的可见信号。restored 是调用方语义（切换/恢复 true、
    // 新建 false——带种子的新会话事件数非零，不能按事件数猜测），且仅既有
    // 历史时渲染：回放前横幅（标题 · 最后活动 · cwd）+ 崩溃修复告知，回放
    // 末尾「上次进行到此处」分隔；新会话（无历史）三者都不渲染。
    const restored = opts.restored && session.events.length > 0
    if (restored) {
      const banner = [`已恢复会话 ${sessionTitleFor(session.events)}`]
      const lastAt = lastActivityTime(session.events)
      if (lastAt !== undefined) banner.push(formatSessionAge(lastAt, Date.now()))
      const cwd = session.header.cwd
      if (cwd !== undefined && cwd !== '') banner.push(cwd)
      this.commitToScrollback({ text: color(banner.join(' · '), this.theme.brandColor), trailingNewline: true })
      // 1.3：修复信号——日志含 repair 合成的 interrupted turn/end 标记。
      if (wasCrashRepaired(session.events)) {
        this.commitToScrollback({ text: color('⚠ 上次运行被中断，已自动闭合未完成回合', this.theme.warning), trailingNewline: true })
      }
    }
    this.commitRows(rows)
    if (restored && rows.length > 0) {
      for (const line of formatSeparator({ width: this.stdout.columns, label: '上次进行到此处' }, this.theme)) {
        this.commitToScrollback({ text: line })
      }
    }
    this.inputLine.setHistory(this.history)
    // T2.1：委派树预取（listDescendants 是 async——首次 await 入缓存；
    // subagent/start|end 事件触发 re-await + renderLive 刷新）。
    // ctx.on 返回 disposer（恒非空）——start/end 必须分别注册，?? 会短路右侧。
    this.subagentDisposer?.()
    this.delegationEntries = null
    this.externalRuns = []
    this.subagentRuns.clear()
    this.childProgress.clear()
    const onSubStart = this.ctx.on('subagent/start', () => { this.refreshDelegationTree(id) })
    const onSubEnd = this.ctx.on('subagent/end', () => { this.refreshDelegationTree(id) })
    // 对话流 subagent 状态行（grok SubagentBlock 移植，dsh 精简版）：start →
    // live 区运行行（spinner 动态帧）；end → 终态行提交 scrollback（append）。
    // label 尽力取委派树缓存（可能滞后 → 回退 id 短哈希，与面板同款兜底）。
    const onRunStart = this.ctx.on('subagent/start', (info: { runId: string; id: string }) => {
      this.subagentRuns.set(info.runId, { label: this.subagentLabel(info.id), startedAt: Date.now(), childId: info.id })
      this.renderBatcher.schedule()
    })
    const onRunEnd = this.ctx.on('subagent/end', (info: { runId: string; stopReason: string }) => {
      const run = this.subagentRuns.get(info.runId)
      if (run === undefined) return
      this.subagentRuns.delete(info.runId)
      // 完成行统计：end 时刻取 child 投影缓存快照（R4——运行期持续缓存最近值，
      // 投影 settle 后不再更新）；取不到（out-of-process）则省略统计段。
      const progress = this.childProgress.get(run.childId)
      this.childProgress.delete(run.childId)
      this.commitToScrollback({
        text: formatSubagentDone({
          width: this.stdout.columns,
          label: run.label,
          elapsedMs: Date.now() - run.startedAt,
          stopReason: info.stopReason,
          ...(progress === undefined ? {} : { stats: { toolCalls: progress.toolCalls, tokensUsed: progress.tokensUsed } }),
        }, this.theme),
        trailingNewline: true,
      })
      // BEL 完成提醒（回流 dsh-tui 704a833）：SSH 下唯一可达的完成提示，
      // 长时委派结束时穿透 pty 到本地终端响铃/闪屏。
      writeBell(this.stdout, process.env, this.prefs)
      this.renderBatcher.schedule()
    })
    this.subagentDisposer = () => { onSubStart(); onSubEnd(); onRunStart(); onRunEnd() }
    this.refreshDelegationTree(id)
    // T2.2：workflow 事件订阅（start/phase/log/agent-start/agent-end/end → 缓存；
    // 跨会话运行，attach 订阅 dispose 释放）。六个 disposer 全部收集——
    // 只存 start 会让其余五个在每次挂载时泄漏。
    this.workflowDisposer?.()
    this.workflowRuns.clear()
    const workflowListeners = [
      this.ctx.on('workflow/start', (info: WorkflowRunInfoWire) => {
        // meta 创建时规范化：旧形状事件无 meta 时 name 回退 id、description 空串，
        // 消费点直接透传不再判空。
        const meta = info.meta
        this.workflowRuns.set(info.id, {
          id: info.id,
          meta: {
            name: meta?.name ?? info.id,
            description: meta?.description ?? '',
            ...meta?.phases === undefined ? {} : { phases: meta.phases },
          },
          startedAt: Date.now(),
          phase: null,
          agents: [],
          logs: [],
        })
        this.flushLiveRender()
      }),
      this.ctx.on('workflow/phase', (info: WorkflowRunInfoWire, title: string) => {
        const run = this.workflowRuns.get(info.id)
        if (run !== undefined) { run.phase = title; this.renderBatcher.schedule() }
      }),
      this.ctx.on('workflow/log', (info: WorkflowRunInfoWire, message: string) => {
        const run = this.workflowRuns.get(info.id)
        if (run !== undefined) {
          // cap 20 drop-oldest：脚本刷屏只保留最近叙述，面板不被淹没。
          run.logs.push(message)
          if (run.logs.length > WORKFLOW_LOG_CAP) run.logs.splice(0, run.logs.length - WORKFLOW_LOG_CAP)
          this.renderBatcher.schedule()
        }
      }),
      this.ctx.on('workflow/agent-start', (info: WorkflowRunInfoWire, agent: WorkflowAgentWire) => {
        const run = this.workflowRuns.get(info.id)
        if (run !== undefined) {
          run.agents.push({
            seq: agent.seq,
            label: agent.label,
            ...(agent.childId === undefined ? {} : { childId: agent.childId }),
          })
          this.renderBatcher.schedule()
        }
      }),
      this.ctx.on('workflow/agent-end', (info: WorkflowRunInfoWire, agent: WorkflowAgentEndWire) => {
        const run = this.workflowRuns.get(info.id)
        const slot = run?.agents.find(a => a.seq === agent.seq)
        if (slot !== undefined) { slot.outcome = agent.outcome; this.renderBatcher.schedule() }
      }),
      this.ctx.on('workflow/end', (info: WorkflowRunInfoWire, result: WorkflowResultWire) => {
        const run = this.workflowRuns.get(info.id)
        if (run !== undefined) {
          // 终态折叠为 WorkflowRunView（stopReason/agentsStarted 进 meta；grok 死字段我们消费）
          const view = this.toWorkflowRunView(run, result)
          this.workflowRuns.delete(info.id)
          this.completedWorkflowRuns.set(info.id, view)
          this.commitWorkflowSummary(view)
          writeBell(this.stdout, process.env, this.prefs)
          this.flushLiveRender()
        }
      }),
    ]
    this.workflowDisposer = () => { for (const d of workflowListeners) d() }
    // T2.3：后台任务同步快照 + 完成通知 + 控制面。
    this.taskDoneDisposer?.()
    this.taskSurfaceDisposer?.()
    this.taskSnapshots = []
    this.taskNotice = null
    const tasks = this.ctx.reflect.get('tasks', false) as TasksFacet | undefined
    if (tasks !== undefined) {
      this.taskSnapshots = tasks.list()
      this.taskDoneDisposer = tasks.onTaskDone((snapshot) => {
        this.taskNotice = `✓ 任务完成: ${snapshot.label}`
        this.taskSnapshots = tasks.list()
        writeBell(this.stdout, process.env, this.prefs)
        this.flushLiveRender()
      })
      this.taskSurfaceDisposer = tasks.attachSurface('tui')
    }
    this.flushLiveRender()
  }

  /** T2.1：预取委派树（async；空会话/服务缺失时置 null 降级）。 */
  /**
   * 对话流 subagent 行的显示标签：委派树缓存命中 label 用之，否则 id 短哈希。
   * @param id - 子代理会话 id。
   * @returns 显示标签。
   */
  private subagentLabel(id: string): string {
    for (const e of this.delegationEntries ?? []) {
      if (e.kind === 'child' && e.id === id) return e.label ?? shortSessionLabel(id)
    }
    return shortSessionLabel(id)
  }

  /** 活动带：该子会话是否为某个运行中 subagent 的子会话。 */
  private isRunningSubagentChild(childId: SessionId): boolean {
    const id = String(childId)
    for (const run of this.subagentRuns.values()) {
      if (run.childId === id) return true
    }
    return false
  }

  /** 活动带：缓存运行中 subagent 的 child 投影快照（投影总线是边界，做结构校验）。 */
  private cacheChildProgress(childId: SessionId, value: unknown): void {
    if (!isSubagentProgressValue(value)) return
    this.childProgress.set(String(childId), value)
    this.renderBatcher.schedule()
  }

  /** 活动带：三类活跃活动 fold 为统一活动项（新 startedAt 在前，纯函数承担）。 */
  private foldActivity(): ActivityItem[] {
    const subagentRuns: SubagentRunInput[] = []
    for (const [runId, run] of this.subagentRuns) {
      const progress = this.childProgress.get(run.childId)
      subagentRuns.push({
        runId,
        label: run.label,
        startedAt: run.startedAt,
        ...(progress === undefined ? {} : {
          progress: {
            toolCalls: progress.toolCalls,
            tokensUsed: progress.tokensUsed,
            ...(progress.lastTool === undefined ? {} : { lastTool: progress.lastTool }),
          },
        }),
      })
    }
    const workflowRuns: WorkflowRunInput[] = []
    for (const state of this.workflowRuns.values()) {
      workflowRuns.push({
        id: state.id,
        name: state.meta.name,
        description: state.meta.description,
        phase: state.phase,
        agentCount: state.agents.length,
        startedAt: state.startedAt,
      })
    }
    const tasks: ActiveTaskInput[] = []
    for (const t of this.taskSnapshots) {
      if (t.status === 'running' || t.status === 'stopping') {
        tasks.push({ id: t.id, kind: t.kind, label: t.label, startedAt: t.startedAt })
      }
    }
    return foldActivityItems({ subagentRuns, workflowRuns, tasks })
  }

  /** workflow 结束摘要：塌一行 commit 进 scrollback（CC 对标单行格式）。 */
  private commitWorkflowSummary(view: WorkflowRunView): void {
    const mark = view.result?.stopReason === 'completed'
      ? '✓'
      : view.result?.stopReason === 'cancelled' ? '⊘' : '✗'
    const markColor = view.result?.stopReason === 'completed'
      ? this.theme.success
      : view.result?.stopReason === 'cancelled' ? this.theme.muted : this.theme.error
    const description = view.info.meta.description === ''
      ? `[${view.info.meta.name}]`
      : `[${view.info.meta.name}] ${view.info.meta.description}`
    const elapsed = view.elapsedMs === undefined ? '' : ` · ${formatElapsedHuman(view.elapsedMs)}`
    this.commitToScrollback({
      text: `${color(mark, markColor)}${color(` ${description} · ${view.agents.length} 个 agent${elapsed}`, this.theme.muted)}`,
      trailingNewline: true,
    })
  }

  private refreshDelegationTree(sessionId: SessionId): void {
    const subagents = this.ctx.reflect.get('subagents', false) as SubagentsFacet | undefined
    if (subagents === undefined) {
      this.delegationEntries = null
      this.externalRuns = []
      return
    }
    // G3：活跃外部 run 快照（同步内存面；服务在场即有此面，直接读取）。
    this.externalRuns = subagents.activeExternalRuns()
    this.renderBatcher.schedule()
    void subagents.listDescendants(sessionId).then((entries) => {
      if (this.disposed) return
      this.delegationEntries = entries
      this.renderBatcher.schedule()
    }).catch(() => {
      // 非 dispose 原因的失败同样要重绘（置空清面板），否则滞留旧树直到
      // 120ms ticker 自愈；与 then 分支对称调度。
      if (this.disposed) return
      this.delegationEntries = null
      this.renderBatcher.schedule()
    })
  }

  /** T2.2：运行态缓存项 → 面板视图（终态含 stopReason/agentsStarted）。 */
  private toWorkflowRunView(run: WorkflowRunState, result: WorkflowResultWire): WorkflowRunView {
    return {
      info: { id: run.id, meta: run.meta },
      agents: run.agents.map(a => ({
        seq: a.seq,
        label: a.label,
        childId: a.childId ?? '',
        outcome: a.outcome ?? 'completed',
      })),
      result: {
        stopReason: result.stopReason as WorkflowResultInfoInput['stopReason'],
        ...(result.error === undefined ? {} : { error: result.error }),
        agentsStarted: run.agents.length,
      },
      elapsedMs: Date.now() - run.startedAt,
      ...(run.logs.length === 0 ? {} : { logs: [...run.logs] }),
    }
  }

  /**
   * 打开 /config 面板：构建数据（四类目现取）→ open → activate。模型类目
   * 恒在（服务缺席的字段显示 — 并不可编辑），权限/凭据/概览按服务在场附加。
   */
  private async openConfigPanel(): Promise<void> {
    const controller = this.configPanel
    const overlay = this.overlay
    if (controller === null || overlay === null) return
    if (overlay.activeId() === 'config-panel') {
      overlay.deactivate()
      return
    }
    controller.open(await this.buildConfigPanelData())
    /* v8 ignore next 1 -- 数据构建窗口内 dispose 的竞态无法在同步测试中构造 */
    if (this.disposed) return
    overlay.activate('config-panel')
  }

  /**
   * 编辑器关闭后的回开：刷新数据但保持游标（refresh 按类目/字段键定位）。
   */
  private async reopenConfigPanel(): Promise<void> {
    const controller = this.configPanel
    const overlay = this.overlay
    if (controller === null || overlay === null) return
    const data = await this.buildConfigPanelData()
    /* v8 ignore next 1 -- 数据构建窗口内 dispose 的竞态无法在同步测试中构造 */
    if (this.disposed) return
    controller.refresh(data)
    overlay.activate('config-panel')
  }

  /** 编舞消费点：picker/key-dialog 因关闭而 deactivate 后，回开 /config。 */
  private finishConfigReturn(): void {
    if (!this.configReturnPending) return
    this.configReturnPending = false
    void this.reopenConfigPanel()
  }

  /**
   * 分派 /config 字段编辑：面板失活 + 置回开旗标，按动作打开对应编辑器
   * （/model picker / 角色 picker / effort picker / 权限 picker / /key 供应商
   * 对话框）；编辑器关闭路径统一经 finishConfigReturn 回开面板。
   * @param action - 字段动作意图。
   */
  private dispatchConfigEdit(action: ConfigFieldAction): void {
    this.configReturnPending = true
    this.overlay?.deactivate()
    switch (action.kind) {
      case 'edit-default-model':
        void this.openModelPicker()
        return
      case 'edit-effort':
        this.openEffortPicker()
        return
      case 'edit-role':
        void this.openRoleModelPicker(action.role)
        return
      case 'edit-permission':
        this.openPermissionPresetPicker()
        return
      case 'edit-credential':
        void this.openCredentialFromConfig(action.provider)
        return
      case 'edit-subagent-selection-toggle':
        void this.toggleSubagentModelSelection()
        return
      case 'edit-subagent-route-remove':
        void this.removeSubagentModelRoute(action.index)
        return
      case 'edit-subagent-route-add':
        void this.addSubagentModelRoute()
        return
      case 'edit-subagent-apply-recommendation':
        void this.applyRecommendedSubagentRoute()
        return
      case 'none':
        this.finishConfigReturn()
        return
    }
  }

  /** 推理档位 picker：选项取当前模型的 efforts（回退 off/high/max），选中即 saveSelection。 */
  private openEffortPicker(): void {
    const overlay = this.overlay
    const picker = this.picker
    const facet = (this.ctx as unknown as { agentDefaultModel?: ModelFacet }).agentDefaultModel
    if (overlay === null || picker === null || facet === undefined) {
      this.finishConfigReturn()
      return
    }
    const current = facet.currentSelection()
    const llm = this.ctx.reflect.get('llm', false) as
      | {
        resolveModelInfo?: (provider: string, model: string) => Promise<
          { reasoning?: { efforts: Array<{ id: string }> } } | Record<string, never>
        >
      }
      | undefined
    void Promise.resolve()
      .then(() => llm?.resolveModelInfo?.(current.provider, current.model))
      .catch(() => undefined)
      .then((info) => {
        const options = info?.reasoning?.efforts.map(effort => effort.id)
        const levels = options !== undefined && options.length > 0 ? options : ['off', 'high', 'max']
        const items = levels.map(id => ({
          label: id === current.reasoningEffort ? `${id}（当前）` : id,
          value: id,
          current: id === current.reasoningEffort,
        }))
        picker.open('选择推理档位', items, (item) => {
          void facet.saveSelection({
            provider: current.provider,
            model: current.model,
            reasoningEffort: item.value,
          })
          this.commitToScrollback({
            text: `推理等级已设为 ${item.value}（当前会话与默认均生效；/effort auto 回默认）`,
            trailingNewline: true,
          })
        })
        overlay.activate('picker')
      })
  }

  /**
   * 权限预设 picker：选项取 permission.names，选中走 /permission 命令的同一
   * 写路径（apply 记录意图 + approval seam 置当前会话）；无活跃会话/服务
   * 缺席时提示并回开面板。
   */
  private openPermissionPresetPicker(): void {
    const overlay = this.overlay
    const picker = this.picker
    const permission = this.ctx.reflect.get('permission', false) as
      | { names: readonly string[]; apply(session: unknown, name: string, setPolicy: (policy: unknown) => void): void } | undefined
    const agent = this.activeSessionId === null ? undefined : this.ctx.agents.get(this.activeSessionId)
    if (overlay === null || picker === null || permission === undefined) {
      this.echoWarn('⚠ permission 服务不可用')
      this.finishConfigReturn()
      return
    }
    if (agent === undefined) {
      this.echoWarn('⚠ 无活跃会话——权限预设切换需要活跃会话（先开始一段对话）')
      this.finishConfigReturn()
      return
    }
    const approval = this.ctx.reflect.get('approval', false) as
      | { setPolicy(agent: unknown, policy: unknown): void } | undefined
    const items = permission.names.map(name => ({ label: name, value: name }))
    picker.open('选择权限预设', items, (item) => {
      permission.apply(agent.session, item.value, (policy) => { approval?.setPolicy(agent, policy) })
      this.commitToScrollback({ text: `权限预设已切换: ${item.value}`, trailingNewline: true })
    })
    overlay.activate('picker')
  }

  /** 凭据字段编辑：从 /config 进该供应商的 /key 对话框（向导后段）。 */
  private async openCredentialFromConfig(provider: string): Promise<void> {
    const entry = this.keyWizardDirectory().find(candidate => candidate.provider === provider)
    const credentials = this.ctx.reflect.get('credentials', false) as KeyDialogCredentials | undefined
    if (entry === undefined) {
      this.finishConfigReturn()
      return
    }
    await this.openKeyDialogForEntry(entry, credentials)
  }

  /** `subagent-model-selection` 设置命名空间（属主在 dsh-tool-subagent 的
   *  model-selection-settings；id 是跨包稳定契约，此处就地 brand 避免反向依赖）。 */
  private static readonly SUBAGENT_MODEL_SELECTION_NS = settingsNamespace('subagent-model-selection')

  /** 读已装载的子代理路由选择设置服务；缺席（入口未装配）返回 undefined。 */
  private subagentModelSelectionSettings():
    | { current(): { enabled: boolean; allowedModels: Array<{ provider: string; model: string }> } }
    | undefined {
    return this.ctx.get('subagentModelSelection') as
      | { current(): { enabled: boolean; allowedModels: Array<{ provider: string; model: string }> } }
      | undefined
  }

  /** 写设置段；失败回显 ⚠（fail loud，不静默），成功回显并回开面板。 */
  private updateSubagentModelSelection(
    patch: { enabled?: boolean; allowedModels?: Array<{ provider: string; model: string }> },
    successEcho: string,
  ): void {
    const settings = this.ctx.reflect.get('settings', false) as
      | { update(ns: ReturnType<typeof settingsNamespace>, patch: object): Promise<void> }
      | undefined
    if (settings === undefined) {
      this.echoWarn('⚠ settings 服务不可用，无法写入子代理路由选择')
      this.finishConfigReturn()
      return
    }
    void settings.update(TuiApp.SUBAGENT_MODEL_SELECTION_NS, patch)
      .then(() => {
        this.commitToScrollback({ text: successEcho, trailingNewline: true })
        this.finishConfigReturn()
      })
      .catch((error: unknown) => {
        this.echoWarn(`⚠ ${error instanceof Error ? error.message : String(error)}`)
        this.finishConfigReturn()
      })
  }

  /** 子代理路由选择开关：开↔关。开启需至少一条路由（服务端校验，错误回显）。 */
  private toggleSubagentModelSelection(): void {
    const selection = this.subagentModelSelectionSettings()
    if (selection === undefined) {
      this.finishConfigReturn()
      return
    }
    const current = selection.current()
    const nextEnabled = !current.enabled
    this.updateSubagentModelSelection(
      { enabled: nextEnabled },
      nextEnabled
        ? `子代理路由选择：开（${current.allowedModels.length} 条路由；新顶层会话生效）`
        : '子代理路由选择：关（已录会话的决策不受影响）',
    )
  }

  /** 移除一条已授权路由（整段写剩余列表）。 */
  private removeSubagentModelRoute(index: number): void {
    const selection = this.subagentModelSelectionSettings()
    if (selection === undefined) {
      this.finishConfigReturn()
      return
    }
    const current = selection.current()
    const removed = current.allowedModels[index]
    if (removed === undefined) {
      this.finishConfigReturn()
      return
    }
    const allowedModels = current.allowedModels.filter((_, i) => i !== index)
    this.updateSubagentModelSelection(
      { allowedModels, ...(current.enabled && allowedModels.length === 0 ? { enabled: false } : {}) },
      `已移除路由 ${removed.provider}/${removed.model}${current.enabled && allowedModels.length === 0 ? '（最后一条路由已移除，选择自动关闭）' : ''}`,
    )
  }

  /** llm 活目录投影（provider × model id）；服务缺席或列举失败返回空。 */
  private async routingDirectory(): Promise<RoutingDirectoryProvider[]> {
    const llm = this.ctx.reflect.get('llm', false) as
      | { listProviders(): Array<{ id: string }>; listModels(provider: string): Promise<Array<{ id: string }>> }
      | undefined
    if (llm === undefined) return []
    const providers: RoutingDirectoryProvider[] = []
    for (const provider of llm.listProviders()) {
      const models = (await llm.listModels(provider.id).catch(() => [])).map(model => model.id)
      providers.push({ id: provider.id, models })
    }
    return providers
  }

  /** 一键推荐（回流 opencode-tui 01313be6c）：flash > deepseek > 首个目录模型。 */
  private async applyRecommendedSubagentRoute(): Promise<void> {
    const selection = this.subagentModelSelectionSettings()
    if (selection === undefined) {
      this.finishConfigReturn()
      return
    }
    const recommended = findRecommendedRoute(await this.routingDirectory())
    if (recommended === null) {
      this.echoWarn('⚠ llm 目录无可用模型——先配置 provider 再回来（/key）')
      this.finishConfigReturn()
      return
    }
    this.updateSubagentModelSelection(
      { enabled: true, allowedModels: [recommended] },
      `已启用子代理路由选择并推荐路由 ${recommended.provider}/${recommended.model}（新顶层会话生效；/config 可增删）`,
    )
  }

  /** 添加路由：provider picker → model picker（llm 活目录，与 /model 同源）。 */
  private async addSubagentModelRoute(): Promise<void> {
    const overlay = this.overlay
    const picker = this.picker
    if (overlay === null || picker === null) {
      this.finishConfigReturn()
      return
    }
    const llm = this.ctx.reflect.get('llm', false) as
      | { listProviders(): Array<{ id: string }>; listModels(provider: string): Promise<Array<{ id: string }>> }
      | undefined
    if (llm === undefined) {
      this.echoWarn('⚠ llm 服务不可用（未装配 llm 插件），模型选择器不可用')
      this.finishConfigReturn()
      return
    }
    const providers: Array<{ id: string; models: Array<{ id: string }> }> = []
    for (const provider of llm.listProviders()) {
      const models = await llm.listModels(provider.id).catch(() => [])
      providers.push({ id: provider.id, models })
    }
    picker.open('选择 Provider', providers.map(provider => ({ label: provider.id, value: provider.id })), (picked) => {
      const provider = providers.find(entry => entry.id === picked.value)
      if (provider === undefined || provider.models.length === 0) {
        this.finishConfigReturn()
        return
      }
      // 二级 picker 在微任务里开：共享键分支在 commit 回调返回后统一
      // deactivate overlay（见 handleKey 的 picker 分支），同步重开会被
      // 立即关闭；让分支先完成清理再激活下一级。
      queueMicrotask(() => {
        if (this.disposed) return
        picker.open('选择 Model', provider.models.map(model => ({ label: model.id, value: model.id })), (modelItem) => {
          const selection = this.subagentModelSelectionSettings()
          if (selection === undefined) {
            this.finishConfigReturn()
            return
          }
          const current = selection.current()
          const route = { provider: provider.id, model: modelItem.value }
          const duplicated = current.allowedModels.some(entry => entry.provider === route.provider && entry.model === route.model)
          if (duplicated) {
            this.echoWarn(`⚠ 路由 ${route.provider}/${route.model} 已在授权列表中`)
            this.finishConfigReturn()
            return
          }
          const enabled = current.enabled || current.allowedModels.length === 0
          this.updateSubagentModelSelection(
            { allowedModels: [...current.allowedModels, route], ...(current.enabled ? {} : { enabled }) },
            `已${current.enabled ? '添加' : '添加并启用'}路由 ${route.provider}/${route.model}（新顶层会话生效）`,
          )
        })
        overlay.activate('picker')
      })
    })
    overlay.activate('picker')
  }

  /**
   * 构建 /config 面板数据：模型（默认模型/推理档位/三角色 pin）恒在；
   * 权限（permission 服务）、凭据（key-wizard 目录 + describe）、概览
   * （settings describe 脱敏）按服务在场附加。全部只读拼装，无写面。
   */
  private async buildConfigPanelData(): Promise<ConfigPanelData> {
    const categories: ConfigCategory[] = []
    const facet = (this.ctx as unknown as { agentDefaultModel?: ModelFacet }).agentDefaultModel
    const current = facet?.currentSelection()
    const roles = this.ctx.get('modelRoles')
    const roleField = (key: string, label: string, role: 'vision' | 'secondary' | 'subagent', hint: string): ConfigField => {
      const pin = roles?.resolve(role)
      return {
        key,
        label,
        value: pin === undefined ? '跟随默认' : `${pin.provider}/${pin.model}`,
        editable: roles !== undefined,
        action: { kind: 'edit-role', role },
        hint,
      }
    }
    categories.push({
      key: 'model',
      label: '模型',
      fields: [
        {
          key: 'default-model',
          label: '默认模型',
          value: current === undefined ? '—' : `${current.provider}/${current.model}`,
          editable: current !== undefined,
          action: { kind: 'edit-default-model' },
          hint: '与 /model 同路径：保存 + 当前会话热切',
        },
        {
          key: 'effort',
          label: '推理档位',
          value: current?.reasoningEffort ?? '默认',
          editable: current !== undefined,
          action: { kind: 'edit-effort' },
          hint: 'off = 不思考；缺省档位跟随提供方默认',
        },
        roleField('role-vision', '视觉模型', 'vision', '未 pin 时按各消费者默认回退（/model vision）'),
        roleField('role-secondary', '副模型', 'secondary', '会话标题/compact 等后台工作'),
        roleField('role-subagent', '子代理模型', 'subagent', '委派子代理会话的默认路由'),
      ],
    })
    // 子代理模型路由授权（回流上游 aefc083be7 弧子浪 C）：服务装配且 settings
    // 服务在场时出现；开关 + 路由列表（逐条移除）+ 添加路由（活目录 picker）。
    const subagentSelection = this.subagentModelSelectionSettings()
    if (subagentSelection !== undefined) {
      const selection = subagentSelection.current()
      const directory = await this.routingDirectory()
      const routeFields: ConfigField[] = []
      // 一键推荐（回流 opencode-tui 01313be6c）：未启用或尚无授权路由时置顶；
      // 即写型面板没有草稿缓冲，已配置时不再覆盖式推荐。
      if (!selection.enabled || selection.allowedModels.length === 0) {
        const recommended = findRecommendedRoute(directory)
        if (recommended !== null) {
          routeFields.push({
            key: 'subagent-apply-recommendation',
            label: '一键推荐',
            value: `${recommended.provider}/${recommended.model}`,
            editable: true,
            action: { kind: 'edit-subagent-apply-recommendation' },
            hint: '启用选择并把该目录模型设为授权路由（flash 优先，其次 deepseek 系）',
          })
        }
      }
      routeFields.push({
        key: 'subagent-selection-toggle',
        label: '路由选择',
        value: selection.enabled ? `开（${selection.allowedModels.length} 条路由）` : '关',
        editable: true,
        action: { kind: 'edit-subagent-selection-toggle' },
        hint: '开启后新顶层会话可由模型经 list_subagent_models 选择子代理路由',
      })
      selection.allowedModels.forEach((route, index) => {
        // 目录校验（advisory）：失效路由 ⚠ 显性化，不阻断已存授权（适配器仍可接受目录外 id）。
        const broken = directory.length > 0 && !routeResolvesDirectory(route, directory)
          ? ` ⚠ ${route.provider} 未注册或目录无此模型——该路由当前不可选`
          : ''
        routeFields.push({
          key: `subagent-route:${route.provider}/${route.model}`,
          label: `路由 ${index + 1}`,
          value: `${route.provider}/${route.model}`,
          editable: true,
          action: { kind: 'edit-subagent-route-remove', index },
          hint: `Enter 移除该路由${broken}`,
        })
      })
      routeFields.push({
        key: 'subagent-route-add',
        label: '添加路由',
        value: '从模型目录选择…',
        editable: true,
        action: { kind: 'edit-subagent-route-add' },
        hint: 'Provider → Model 两级 picker，来源为 llm 活目录',
      })
      categories.push({ key: 'subagent-models', label: '子代理模型', fields: routeFields })
    }
    const permission = this.ctx.reflect.get('permission', false) as
      | { names: readonly string[]; current(events: readonly unknown[]): string } | undefined
    if (permission !== undefined) {
      categories.push({
        key: 'permission',
        label: '权限',
        fields: [{
          key: 'preset',
          label: '预设',
          value: permission.current([]),
          editable: true,
          action: { kind: 'edit-permission' },
          hint: '切换即写当前会话并记录意图（与 /permission 同路径）',
        }],
      })
    }
    const credentials = this.ctx.reflect.get('credentials', false) as KeyDialogCredentials | undefined
    const directory = this.keyWizardDirectory()
    if (credentials !== undefined && directory.length > 0) {
      const sections = this.readResolvedSettingsSections()
      const fields = await Promise.all(directory.map(async (entry): Promise<ConfigField> => {
        const ref = resolveKeyRef(entry.provider, this.profileApiKeyEnv(sections, entry))
        const info = await credentials.describe(ref).then(value => value, () => undefined)
        return {
          key: `credential:${entry.provider}`,
          label: entry.displayName,
          value: info?.configured === true
            ? `✓ ${info.source ?? '已配置'}`
            : '○ 未配置',
          editable: info?.writable !== false,
          action: { kind: 'edit-credential', provider: entry.provider },
          hint: `引用 ${ref} · Enter 进入 /key 配置`,
        }
      }))
      categories.push({ key: 'credentials', label: '凭据', fields })
    }
    const settings = this.ctx.reflect.get('settings', false) as
      | { describe(options?: { redactSecrets?: boolean }): unknown[] } | undefined
    if (settings !== undefined) {
      const descriptors = settings.describe({ redactSecrets: true }) as Array<{ ns: string; value: unknown; secrets?: { set: boolean }[] }>
      categories.push({
        key: 'overview',
        label: '概览',
        fields: descriptors.map((descriptor): ConfigField => ({
          key: `ns:${descriptor.ns}`,
          label: descriptor.ns,
          value: `${formatConfigValue(descriptor.value)}${configSecretMark(descriptor.secrets)}`,
          editable: false,
          action: { kind: 'none' },
          hint: '已解析的 settings 命名空间（只读；编辑经各归属命令/界面）',
        })),
      })
    }
    return { categories }
  }

  /** T3.3：刷新 skill 快照（ctx.skills.list；服务缺失时空数组）。 */
  private refreshSkillItems(): void {
    const skills = this.ctx.reflect.get('skills', false) as
      | { list(): Promise<SkillSummaryInput[]> } | undefined
    if (skills === undefined) { this.skillItems = []; return }
    void skills.list().then((items) => {
      /* v8 ignore next -- dispose 后 promise 才 resolve 的场景无法在同步测试中构造 */
      if (this.disposed) return
      this.skillItems = items
      this.renderBatcher.schedule()
    }).catch(() => {
      /* v8 ignore next -- 同上：dispose 后 reject 的竞态守卫 */
      if (this.disposed) return
      this.skillItems = []
    })
  }

  /** 回显一条警告行到 scrollback（可选服务缺失的 fails-loud 提示共用出口）。 */
  private echoWarn(text: string): void {
    this.commitToScrollback({ text: color(text, this.theme.warning), trailingNewline: true })
    this.flushLiveRender()
  }

  /**
   * 缓存 miss 诊断日志观测点：cacheHealth 投影报出 warn/error 级 miss 时
   * 在 scrollback 输出一行「⚠ 缓存异常」。同一 (reason, turn) 只报告一次，
   * 防止同因重复刷屏；info 级判定（首轮/正常增长）与压缩不报告。
   */
  private reportCacheMiss(): void {
    const reason = this.cacheHealth?.lastMissReason
    if (reason === undefined || !isReportableMiss(reason)) return
    const turn = this.transcript?.view.turn ?? 0
    const reported = this.lastReportedMiss
    if (reported !== null && reported.reason === reason && reported.turn === turn) return
    const info = formatCacheMissReason(reason)
    if (info === undefined) return
    this.lastReportedMiss = { reason, turn }
    this.echoWarn(`⚠ 缓存异常：${info.detail}`)
  }

  /** 当前主题（动态读取，切主题后立即生效）。 */
  private get theme(): RivetTheme { return getTheme() }

  /** 偏好落盘（合并写，保留文件里其他工具的 key）；持久化禁用时静默跳过。 */
  private persistPrefs(): void {
    if (this.prefsPath === null) return
    writePrefs(this.prefsPath, this.prefs)
  }

  /**
   * 原子提交编舞（输入框闪烁根修，回流 dsh-tui 2026-08-27）：BEGIN_SYNC 包裹
   * 「清 live 区 → 写 scrollback → 同步重绘」，END_SYNC 收口。
   *
   * 旧序里 clearForCommit 同步直写擦掉整个 live 区（含待办卡/输入轨/footer），
   * 重绘却交给 WriteBatcher 的 16ms 尾沿——每个段落/思考块落底后屏幕上真实缺席
   * 一帧 chrome，推理期段边界密集即呈现为「输入框消失几帧又出现」。三步收敛进
   * 同一轮事件循环后间隙只剩写入耗时；再包 CSI 2026 同步窗把它对终端合成器也
   * 隐藏。窗内 LiveEngine.render 自带的嵌套 begin 按 CSI 2026 语义忽略、其 end
   * 的释放点恰是整幅新帧写完之时，擦除中间态不再有任何显示窗口。
   */
  private atomicScrollbackWrite(writeScrollback: () => void): void {
    const stdout = this.stdout
    stdout.write(ANSI.BEGIN_SYNC)
    try {
      this.live.clearForCommit()
      writeScrollback()
      this.flushLiveRender()
    } finally {
      // 写屏/渲染抛错也必须收口：支持 2026 的终端会持续缓冲到 end 才刷新。
      stdout.write(ANSI.END_SYNC)
    }
  }

  /**
   * 统一 scrollback 写入：先结算 canonical welcome，再按 overlay 所有权延迟
   * 或执行 mid-stream commit，保证所有后续条目保持 append-only 顺序。
   */
  private commitToScrollback(entry: { text: string; trailingNewline?: boolean }): void {
    if (this.welcomePreparing && this.welcomeScrollbackBarrier) {
      this.pendingWelcomeSettleReason ??= 'commit'
      this.pendingWelcomeActions.push(() => { this.commitToScrollback(entry) })
      return
    }
    this.settleWelcome('commit')
    if (this.overlay !== null && this.overlay.activeId() !== null) {
      this.deferredScrollback.push(entry)
      return
    }
    this.atomicScrollbackWrite(() => { this.commit.write(entry) })
  }

  /** Flushes entries that already crossed the welcome-settlement gate before deferral. */
  private flushDeferredScrollback(): void {
    const pending = this.deferredScrollback
    if (pending.length === 0) return
    this.deferredScrollback = []
    this.atomicScrollbackWrite(() => {
      for (const entry of pending) {
        this.live.clearForCommit()
        this.commit.write(entry)
      }
    })
  }

  /**
   * 当前会话是否 blank：无消息且无未结算工具调用。
   * /preset recompose 与更新后自动重启的守卫共用（非空白不打断会话）。
   * @returns blank 返回 true。
   */
  isBlankSession(): boolean {
    const view = this.transcript?.view
    return (view?.messages ?? []).length === 0
      && (view?.tools ?? []).every(t => t.result !== undefined)
  }

  /**
   * 提交用户输入：追加输入历史、将用户消息渲染进 scrollback、
   * 走 adapter.send 的 followup 驱动 agent。slash 命令（/steer）分流到 handleSteer。
   * @param text - 输入框提交的文本；空文本但无图时 no-op
   * @param images - 输入框携带的图片附件 data URL 列表（可省略）
   */
  handleSubmit(text: string, images?: string[]): void {
    this.settleWelcome('input')
    // 1.1：提交输入即结束欢迎阶段（数字键回归输入行语义由 handleKey 收尾兜底）。
    this.welcomeDigitsActive = false
    // 入口先规范化图片数组：只保留合法 data URL，上限 MAX_IMAGES。
    images = normalizeSubmitImages(images)
    let trimmed = text.trim()
    const hasImages = images !== undefined && images.length > 0
    // 图片是否可达主控：识图主控直发；不识图但有视觉桥时经 agent/pre-step 转描述；
    // 两者皆无时图片不发送（气泡警告「图片未发送」）。桥状态优先取注入配置，
    // 未注入时按 visionBridge 服务存在性探测（见 resolveVisionBridge）。
    const imagesReachable = this.supportsVision || this.resolveVisionBridge()
    // 只发图片：可达时补占位 prompt，让后端能触发 run；不可达时无有效内容可发。
    if (!trimmed && hasImages) {
      if (imagesReachable) {
        text = '📎 图片消息'
        trimmed = text
      } else {
        // 有图但不可发送：只回显附件气泡+警告，不触发 followup。
        this.commitUserPrompt('', images)
        this.inputLine.clearImages()
        this.flushLiveRender()
        return
      }
    }
    if (!trimmed) return
    // 任何 / 前缀输入都进命令通道……但以 / 开头的文件路径（/src/main.ts、
    // /tmp/foo bar、/etc 等非命令单段）不是命令——走普通文本流程，避免被
    // 当作未知 slash 命令报失败（参考本体 looksLikeFilePath；命令集取注册表
    // 现值——/lsp 等动态注册命令不误判为路径）。
    if (trimmed.startsWith('/') && !looksLikeFilePath(trimmed, n => this.isKnownCommand(n), n => this.isCommandPrefix(n))) {
      void this.runSlash(trimmed, images)
      return
    }
    // Phase 9a：@mention 用户侧摘要展开（cwd 边界/截断/降级见 mention-expand）。
    // 展开后的文本进用户消息与 followup——agent 看到的是摘要而非裸路径。
    const expanded = expandMentions(trimmed, this.sessionCwd())
    this.historyStore.record(trimmed)
    this.history = this.historyStore.snapshot()
    this.inputLine.setHistory(this.history)
    // 运行中排队（对标 CC，回流 dsh-tui 9d7f421）：本地队列让 ↑ 取回不惊动宿主
    // （取舍见 submit-queue 模块头）；turn/end 按序投递。图片随队列入暂存。
    if (this.liveAgent?.state.status === 'running') {
      this.submitQueue.push(expanded, images)
      this.inputLine.clearImages()
      this.flushLiveRender()
      return
    }
    // 用户气泡：正文 + 📎 附件行 + 识图能力提示；有图且终端支持图形协议时
    // 异步 prepare 后在同一写窗口追加终端图片（见 commitUserPrompt 时序说明）。
    this.commitUserPrompt(expanded, images)
    this.inputLine.clearImages()
    // 提交前先同步画一帧：commitUserPrompt 已把 live 区（含输入框）整体擦除，
    // 而 followup 的同步前缀（inbox 事件 + prompt 组装 + pre-step 监听者的同步段）
    // 可能耗时数秒——期间无帧可画、ticker 也不触发，输入框就"消失"到驱动返回。
    // 先画回输入框（空闲态），再进入可能阻塞的驱动调用（防御性不变量，见
    // .agents/notes/implemented/bug-fix/2026-08-16-semantic-index-async-refresh.md）。
    this.flushLiveRender()
    // 图片不可达时不发送（气泡已警告「图片未发送」）；可达时直发或经视觉桥转描述。
    this.controls?.followup(expanded, imagesReachable ? images : undefined)
    this.flushLiveRender()
  }

  /**
   * turn/end → 本地队列按序投递（气泡 → followup），回流 dsh-tui 9d7f421。
   * aborted 不 flush——打断后用户可能想 ↑ 取回队首改投；与「中断不清队」一致。
   * 本包 followup 是同步 inbox 入队（void），无上游 Promise 拒绝的失败回显路径。
   */
  private flushSubmitQueue(reason: 'completed' | 'aborted'): void {
    if (reason === 'aborted') return
    const items = this.submitQueue.drain()
    for (const item of items) {
      this.commitUserPrompt(item.text, item.images)
      this.controls?.followup(item.text, item.images)
    }
    if (items.length > 0) this.flushLiveRender()
  }

  /**
   * 用户气泡提交：正文 + 图片附件行 + 识图能力提示（vision 三态文案）。
   * 有图且终端支持图形协议时，图片在气泡提交后异步 prepare（本地转码，
   * 毫秒级，先于任何网络往返的 assistant 输出）并以同一写窗口协议追加
   * 图形序列（先清 live 区再 writeRaw，写完立即重绘）——物理上图片位于
   * 所属气泡下方、先于后续流式输出；prepare 失败静默降级为纯文本气泡。
   * @param content - 用户消息正文（已 mention 展开）
   * @param images - 图片 data URL 列表（已 normalize；可省略）
   */
  private commitUserPrompt(content: string, images?: string[]): void {
    const protocol = imageProtocol()
    const withImages = images !== undefined && images.length > 0
    this.commitToScrollback({ text: this.writeUserBubbleLines(content, images), trailingNewline: true })
    if (!withImages) return
    // 无图形协议终端：气泡图片走半块字符回退（任意终端可读的像素级预览）。
    if (protocol === 'none') {
      void this.commitHalfBlockImages(images)
      return
    }
    void (async () => {
      let prepared: PreparedTermImage[] = []
      try {
        for (const dataUrl of images.slice(0, MAX_IMAGES)) {
          const img = await prepareTermImageForCommit(dataUrl, protocol)
          if (img) prepared.push(img)
        }
      } catch {
        prepared = []
      }
      if (prepared.length === 0) return
      // 宽高在写入当刻取最新终端尺寸：转码期间的 resize 不会用过期值编码。
      const cols = Math.max(10, this.stdout.columns - 4)
      const maxRows = Math.max(5, Math.min(40, (this.stdout.rows || 24) - 6))
      let seq = ''
      for (const img of prepared) {
        const s = encodeTermImage(img, protocol, cols, maxRows)
        if (s) seq += s + (protocol === 'kitty' ? '\r' : '\r\n')
      }
      if (!seq) return
      // 与 commitToScrollback 同协议：原子编舞内先清 live 区再写，同步重绘。
      this.atomicScrollbackWrite(() => { this.commit.writeRaw(seq) })
    })()
  }

  /** 用户气泡正文（含 📎 附件行与识图能力提示）。 */
  private writeUserBubbleLines(content: string, images?: string[]): string {
    const hasImages = images !== undefined && images.length > 0
    let imageNote = ''
    if (hasImages) {
      imageNote = `\n${color(`📎 ${images.length} image${images.length > 1 ? 's' : ''} attached`, this.theme.muted)}`
      if (!this.supportsVision) {
        if (this.visionBridgeEnabled) {
          // 提示反映真实桥接来源：桥接=图先经视觉模型转文字描述再发。
          const src = this.visionBridgeSource === 'auto' ? '（自动选用的视觉模型）' : ''
          imageNote += `\n${color(`🖼 主模型不识图，将经识图桥${src}生成图片描述后发送`, this.theme.muted)}`
        } else {
          imageNote += `\n${color('⚠ 当前模型不支持识图，且无可用识图桥，图片未发送。请在配置中指定识图模型。', this.theme.warning)}`
        }
      }
    }
    return formatUserMessage({ content: content.trim() + imageNote, width: this.stdout.columns }, this.theme).join('\n')
  }

  /**
   * 无图形协议终端的气泡图片回退：半块字符预览写进 scrollback（与图形路径
   * 同编舞——先清 live 区再 writeRaw，写完立即重绘）。解码失败返回 null 已在
   * 渲染器内吞并，此处无需再兜——静默降级为纯文本气泡（📎 行已随正文写入）。
   * @param images - 图片 data URL 列表（与气泡一致，封顶 MAX_IMAGES）
   */
  private async commitHalfBlockImages(images: string[]): Promise<void> {
    const cols = Math.max(10, this.stdout.columns - 4)
    const blocks: string[] = []
    for (const dataUrl of images.slice(0, MAX_IMAGES)) {
      const preview = await renderHalfBlockPreview(dataUrl, {
        maxCols: cols,
        maxRows: FALLBACK_MAX_ROWS,
        background: this.previewBackground(),
      })
      if (preview) blocks.push(preview.lines.join('\r\n'))
    }
    if (blocks.length === 0) return
    // 与气泡正文同编舞（原子提交）：先清 live 区再 writeRaw，同步重绘。
    this.atomicScrollbackWrite(() => { this.commit.writeRaw(blocks.join('\r\n') + '\r\n') })
  }

  /**
   * composer 附件缩略图维护：附件列表变化时重算最后一张的半块预览。
   * sharp 异步解码毫秒级，完成后触发一次重绘；代际号丢弃迟到结果
   * （快速增删/提交清空后不再挂出过期图片）。渲染失败置 null——计数行
   * 仍在，预览是装饰性增强。
   * @param images - 变化后的附件 data URL 列表
   */
  private async refreshAttachmentPreview(images: string[]): Promise<void> {
    const last = images[images.length - 1]
    if (last === undefined) {
      this.attachmentPreview = null
      return
    }
    if (this.attachmentPreview?.dataUrl === last) return
    const epoch = ++this.attachmentPreviewEpoch
    const cols = Math.max(8, Math.min(PREVIEW_MAX_COLS, this.stdout.columns - 6))
    const preview = await renderHalfBlockPreview(last, {
      maxCols: cols,
      maxRows: PREVIEW_MAX_ROWS,
      background: this.previewBackground(),
    })
    if (epoch !== this.attachmentPreviewEpoch) return
    this.attachmentPreview = preview === null ? null : { dataUrl: last, lines: preview.lines }
    this.flushLiveRender()
  }

  /** 预览合成底色：主题气泡底色（truecolor 轨）优先，缺省中性暗色。 */
  private previewBackground(): { r: number; g: number; b: number } {
    const bg = this.theme.userMsgBg !== undefined ? hexToRgb(this.theme.userMsgBg) : null
    return bg ?? NEUTRAL_PREVIEW_BACKGROUND
  }

  /** 把 slash 注册表投影到 InputController（菜单 / Tab 补全数据源）。
   * 注册表可被外部插件经 tui.commands 服务在构造后扩展（如 /next-workflow 的
   * 中文菜单项），故每次输入变化前重投影一次（列表很小，成本可忽略）。
   */
  private syncSlashHints(): void {
    this.inputController.slashCommands = this.slash.list().map(toSlashHint)
  }

  /**
   * 执行一条 slash 命令：注册表解析 → handler 运行 → 回显/错误提示。
   * 命令回显写 scrollback（用户可见），但不写回 session log（dsh 纪律：
   * 命令执行是 UI 层副作用，session 事件词汇不变）。
   * @param input - 输入行提交的原始文本（已 trim，以 / 开头）。
   * @param images - composer 图片 data URL 列表（已 normalize；可省略）；
   *   仅 cordis 命令通道消费，内置命令通道不透传。
   */
  private async runSlash(input: string, images?: string[]): Promise<void> {
    const echo = (text: string): void => {
      this.commitToScrollback({ text, trailingNewline: true })
    }
    const parsed = this.slash.resolve(input)
    if (parsed === null) {
      // A1：registry 未命中时 fallback 到 CommandService（cordis 命令通道）。
      // /plan 等由插件（plan-mode 等）注册在 CommandService 的命令由此可达，
      // 且 command/run 生命周期事件驱动 plan 投影的 pending 状态。
      // 经 reflect.get 读取：TuiApp 的 runtimeCtx 未 inject commands，属性访问
      // 在 Cordis 4 抛 "without inject"；服务未装配时返回 undefined → 降级。
      if (await this.runCordisCommand(input, echo, images)) {
        this.flushLiveRender()
        return
      }
      // 闭环引导：未知命令不刷 40+ 命令列表，给相近建议（编辑距离/公共前缀）；
      // 无相近命令时引导 /help，避免信息过载。
      const suggestions = suggestCommands(input, this.slash.list())
      const hint = suggestions.length > 0
        ? `你是要找: ${suggestions.map(c => `/${c.name}`).join(' ')}?`
        : '试试 /help 查看全部命令'
      echo(`未知命令: ${input}。${hint}`)
      this.flushLiveRender()
      return
    }
    try {
      await parsed.command.run({
        text: parsed.text,
        ctx: this.ctx,
        sessionId: this.activeSessionId,
        echo,
        /* v8 ignore next -- 内置命令 run 均不消费 rerender（死回调，无调用方） */
        rerender: () => { this.flushLiveRender() },
      })
      // 阶段 2：命令执行成功 → MRU 排序数据源（菜单下次打开最近使用优先）。
      this.inputController.recordSlashUse(parsed.command.name)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      echo(`⚠ 命令执行失败: ${message}`)
    }
    this.flushLiveRender()
  }

  /**
   * A1：把未命中的 slash 输入委托给 CommandService（cordis 命令通道）。
   * 无会话、commands 服务未装配、或命令未知名（execute 返回 undefined）时
   * 返回 false，由调用方维持「未知命令」回显；成功/失败回显在此完成。
   * composer 图片转成 ImageBlock 随信封透传：声明 input.images 的命令
   * （/goal、/plan）由生产方负责模型可见性；成功执行后清空输入框图片，
   * 失败/未知时保留以便用户修正重发。
   * @param input - 完整 slash 输入（含 / 前缀）。
   * @param echo - scrollback 回显回调。
   * @param images - composer 图片 data URL 列表（已 normalize；可省略）。
   * @returns 命令是否被 CommandService 受理（true 时调用方不再回显未知命令）。
   */
  private async runCordisCommand(input: string, echo: (text: string) => void, images?: string[]): Promise<boolean> {
    if (this.activeSessionId === null) return false
    const commands = this.ctx.reflect.get('commands', false) as CommandServiceFacet | undefined
    if (commands === undefined) return false
    const agent = this.ctx.agents.get(this.activeSessionId)
    if (agent === undefined) return false
    const blocks: readonly ImageBlock[] | undefined = images === undefined || images.length === 0
      ? undefined
      : images.map(dataUrl => ({ type: 'image', dataUrl }))
    try {
      const execution = await commands.execute(agent, input, new AbortController().signal, blocks)
      if (execution === undefined) return false
      if (execution.result.kind === 'success') {
        echo(execution.result.text ?? '已执行')
        // 与文本提交路径同一纪律：仅成功消费后清空；错误结果保留图片供重试。
        if (blocks !== undefined) this.inputLine.clearImages()
      } else {
        echo(`⚠ 命令执行失败: ${execution.result.text}`)
      }
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      echo(`⚠ 命令执行失败: ${message}`)
      return true
    }
  }

  /**
   * 提交中轮转向：渲染差异化 steer 消息（marker/颜色区分 user）进 scrollback，
   * 走 adapter.send 的 steer API。空文本 no-op（/steer 无参数、Ctrl+T 空输入）。
   * @param text - 转向文本。
   */
  private handleSteer(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    this.historyStore.record(trimmed)
    this.history = this.historyStore.snapshot()
    this.inputLine.setHistory(this.history)
    this.commitToScrollback({ text: formatSteerMessage({ content: trimmed, width: this.stdout.columns }, this.theme).join('\n'), trailingNewline: true })
    // 与 handleSubmit 同一防御：擦除 live 区后、进入可能阻塞的驱动调用前先画一帧。
    this.flushLiveRender()
    this.controls?.steer(trimmed)
    this.flushLiveRender()
  }

  /**
   * 取消当前 agent 活动：Ctrl-C 走 adapter.cancel（cause { kind: 'user' }）。
   * 空闲时 Ctrl-C 幂等 no-op。
   */
  /**
   * Phase 8：审批 answerer 入口——薄转发 ApprovalController（短路/委托/挂起
   * 由控制器内聚，会话归属经 getCurrentSessionId 注入）。
   * @param req - 待决审批请求。
   * @param next - waterfall 委托（不处理时调用）。
   * @returns 用户决定（allowed-once/allowed-always/rejected/cancelled）或 next() 结果。
   */
  private handleApprovalRequest(
    req: PendingApprovalRequest,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    return this.approval.handle(req, next)
  }

  /** Phase 8：结算挂起的审批请求（用户按键/取消）——薄转发。 */
  private settleApproval(outcome: ApprovalOutcome): void {
    this.approval.settle(outcome)
  }

  /**
   * P1①「永久允许」：把挂起审批的精确匹配 allow 规则写入 approval-rules
   * （项目层 YAML，经 `approvalRules.persistAllow` 同进程 facet），成功后以
   * `'allowed-always'` 结算——后续同参请求由规则 answerer 直接放行。
   * 落盘期间忽略 y/n/a/esc，避免规则已写、本次却被拒；`await` 后只结算
   * 仍是同一 `req` 的挂起卡。facet 未装配或写入失败时卡片不动，告警进
   * scrollback 由用户改选。
   */
  private async persistPendingApprovalRule(): Promise<void> {
    const pending = this.approval.peek()
    if (pending === null || this.persistInFlight !== null) return
    const facet = this.ctx.reflect.get('approvalRules.persistAllow', false) as
      | { persistAllowRule(req: unknown): Promise<unknown> }
      | undefined
    if (facet === undefined) {
      this.echoWarn('⚠ approval-rules 未装配，无法永久允许（可先 y/n/a）')
      return
    }
    const req = pending.req
    this.persistInFlight = { req }
    try {
      await facet.persistAllowRule(req)
      if (this.approval.peek()?.req === req) {
        this.settleApproval('allowed-always')
      }
    } catch (error: unknown) {
      this.echoWarn(`⚠ 永久允许写入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.persistInFlight = null
    }
  }

  /**
   * 当前会话是否在跑（含工具执行中 / inbox 排队）：Esc 与 Ctrl+C 都应打断。
   * 只看 status==='running' 会漏掉 tool/call 已发出、status 尚未翻成 running 的缝。
   */
  private isAgentBusy(): boolean {
    const state = this.liveAgent?.state
    if (state === undefined) return false
    return state.status === 'running' || state.activity !== undefined || state.inbox.length > 0
  }

  /** 取消当前运行（Esc/Ctrl+C）：cancel agent、丢弃未发出的流式/推理缓冲并重置流渲染。 */
  handleAbort(): void {
    // 防御：打断优先于 overlay——释放任何激活的全屏 overlay（palette/search/
    // rewind/picker），保证主屏（含输入轨）在下一帧必然恢复。按键路径上 overlay
    // 分支先于 ctrl_c 分支拦截，此防御覆盖未来新增路径在 overlay 激活时调 abort。
    this.overlay?.deactivate()
    this.palette?.close()
    this.picker?.close()
    // keepInbox（回流 dsh-tui c53a497）：手动打断不清宿主 inbox——未消费的
    // steer/排队残留留到下一轮，与本地队列「中断不清队」一致。
    this.controls?.cancel({ kind: 'user' }, { keepInbox: true })
    // 先丢弃流式残文再提交中止提示：提交编舞会同步重绘一帧，残尾若还留在
    // peek/pending 里就会把上一个 run 的残留画进那一帧（提交与丢弃的次序
    // 曾被延迟重绘掩盖，同步化后必须理顺）。
    this.blockWriter.discard()
    this.streamRenderer.reset()
    this.discardReasoning()
    this.pendingCallTitles.clear()
    this.commitToScrollback({ text: '⏹ 已取消', trailingNewline: true })
    this.flushLiveRender()
  }

  /** 连按退出提示的恢复定时器；null = 未激活。 */
  private ctrlCExitHintTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 进入连按退出窗口（输入轨上方渲染提示行，窗口超时自动复位）。
   * 忙碌打断与空闲清草稿都会走到这里；提示行而非 placeholder——
   * 有草稿时 placeholder 不可见。
   */
  private showCtrlCExitHint(): void {
    if (this.ctrlCExitHintTimer !== null) clearTimeout(this.ctrlCExitHintTimer)
    this.ctrlCExitHintTimer = setTimeout(() => {
      this.ctrlCExitHintTimer = null
      this.inputController.ctrlCPendingSince = 0
      this.flushLiveRender()
    }, InputController.EXIT_WINDOW_MS)
    this.flushLiveRender()
  }

  /** 终止连按窗口：复位提示与恢复定时器。 */
  private clearCtrlCExitHint(): void {
    if (this.ctrlCExitHintTimer !== null) {
      clearTimeout(this.ctrlCExitHintTimer)
      this.ctrlCExitHintTimer = null
    }
  }

  /**
   * Phase 6.4：打开外部编辑器编辑当前输入行。编辑器是外部进程，必须暂时
   * 退出 raw-mode（编辑器需要正常终端交互）；spawnSync 阻塞期间 ticker 暂停。
   * 任何路径（含编辑器失败）都恢复 raw-mode。编辑结果回填输入行。
   */
  private openExternalEditor(): void {
    // 编辑器接管终端前退出 raw-mode；spawn 结束（含失败）恢复。
    try { this.stdin.setRawMode(false) } catch { /* best-effort：非 TTY 无 raw-mode */ }
    let content: string | null = null
    let editorError: string | null = null
    try {
      const r = openInEditorDetailed(this.inputLine.value, this.editorCommand)
      content = r.content
      editorError = r.error
    } finally {
      try { this.stdin.setRawMode(true) } catch { /* best-effort */ }
    }
    if (content !== null) {
      this.inputLine.setValue(content)
    } else if (editorError !== null) {
      // P1-1：编辑器启动失败不再静默——回显实际生效命令与 spawn 原因
      this.echoWarn(`⚠ 外部编辑器启动失败（${this.editorCommand ?? getEditorCommand()}）：${editorError}`)
    }
    this.flushLiveRender()
  }

  /**
   * Tab 补全（Phase 6.3）：委托 InputController 状态机——首次 Tab 解析
   * 光标前 @ 路径 token 的候选并应用首项，再次 Tab 循环。无 @ token 时
   * 返回 false，Tab 保持原行为（InputLine 照常发出 'tab' 事件）。
   */
  private handleTabComplete(): boolean {
    const result = this.inputController.tabComplete(
      this.inputLine.value,
      this.inputLine.cursor,
      this.sessionCwd(),
    )
    if (result === null) return false
    this.inputLine.setValue(result.text, result.cursor)
    this.flushLiveRender()
    return true
  }

  /**
   * 输入行 ghost 预览文本（阶段 2）：菜单选中命令时预览补全剩余
   * （`/th` + 选中 /theme → `eme`）；完整命令名 + 尾空格 → 预览参数占位
   * （`/theme ` → `<name>`）。菜单关闭/光标不在末尾/无补全关系 → null。
   * @returns ghost 文本或 null。
   */
  private slashGhostText(): string | null {
    const menu = this.inputController.slashMenu
    if (!menu.open) return null
    const selected = menu.matches[menu.selected]
    if (selected === undefined) return null
    const value = this.inputLine.value
    if (this.inputLine.cursor !== value.length || value === '') return null
    const name = `/${selected.name}`
    if (value === `${name} ` && selected.argsHint !== undefined) return selected.argsHint
    if (value === name) return null
    if (name.startsWith(value)) return name.slice(value.length)
    return null
  }

  /**
   * 接受 slash 菜单当前选中项（Tab / Enter）。
   * Enter 且输入已是完整命令名（如 `/theme`）→ 关闭菜单并直接提交；
   * 否则补全命令名到输入行（有 argsHint 的命令补到 `cmd ` 留参数位，
   * 参数建议留待下一批），随后关闭菜单。
   * @param opts - submit：Enter 语义（精确命令直接发送）。
   */
  private acceptSlashCompletion(opts?: { submit?: boolean }): void {
    const menu = this.inputController.slashMenu
    const selected = menu.matches[menu.selected]
    if (selected === undefined) {
      this.inputController.closeSlash()
      this.flushLiveRender()
      return
    }
    const name = `/${selected.name}`
    const current = this.inputLine.value
    // 参数模式（`/cmd ` 尾空格）：Enter 提交完整输入行（trim 由 handleSubmit 承担）。
    if (opts?.submit === true && (current === name || current === `${name} `)) {
      this.inputController.closeSlash()
      // 清空输入行（对齐 InputLine 正常提交路径的 clearAfterSubmit；否则
      // 命令文本残留，后续键入会拼出 /cmd/xxx 无效命令）。
      this.inputLine.setValue('')
      this.handleSubmit(current)
      return
    }
    // setValue 触发 onChange → refreshSlash 会重开菜单；此处随后关闭收敛。
    this.inputLine.setValue(selected.argsHint !== undefined ? `${name} ` : name)
    this.inputController.closeSlash()
    this.flushLiveRender()
  }

  /**
   * C3 项 4：Shift+Tab 三态循环（对齐 grok 的两轴模型，plan 与 permission 正交）：
   * Normal → Plan（planMode.set(true)）→ Always-Approve（plan off + 本地短路）→ Normal。
   * plan 切换经 planMode 服务（投影总线驱动 planState 徽标）；always-approve 是
   * 纯 TUI 本地标志（不持久化，退出即失），对审批 answerer 短路放行。
   * alwaysApprove 优先判断：它是同步本地态；planState 经投影异步更新，
   * 若按投影判断会在 Always-Approve 态误走回 Plan 分支。
   */
  private cycleMode(): void {
    if (this.approval.alwaysApprove) {
      // Always-Approve → Normal
      this.approval.setAlwaysApprove(false)
      this.statusLine?.setAlwaysApprove(false)
      this.flushLiveRender()
    } else if (this.planState.active) {
      // Plan → Always-Approve
      this.setPlanMode(false)
      this.approval.setAlwaysApprove(true)
      this.statusLine?.setAlwaysApprove(true)
      this.flushLiveRender()
    } else {
      // Normal → Plan
      this.setPlanMode(true)
    }
  }

  /**
   * /yolo：全放行模式快捷入口（approval always-approve 的显式开关）。
   * 与 Shift+Tab 循环进 always-approve 同语义（allowed-once 短路），但提供
   * 命令入口；切会话/退出时沿既有复位路径清零（detachProjections 的
   * setAlwaysApprove(false) 覆盖）。
   * @param flag - true 开启全放行（后续审批自动放行）；false 关闭。
   */
  private setYoloMode(flag: boolean): void {
    this.approval.setAlwaysApprove(flag)
    this.statusLine?.setAlwaysApprove(flag)
    this.flushLiveRender()
  }

  /** C3 项 4：经 planMode 服务切换 plan 状态（服务缺失时回显警告，不再静默）。 */
  private setPlanMode(active: boolean): void {
    const planMode = this.ctx.reflect.get('planMode', false) as
      | { set(agent: unknown, active: boolean): string } | undefined
    if (planMode === undefined) {
      // 只在进入 plan 时提示（退出分支由 Always-Approve 本地态驱动，无需服务）。
      if (active) this.echoWarn('⚠ planMode 服务不可用（未装配 plan 插件），无法进入 plan 模式')
      return
    }
    if (this.activeSessionId === null) return
    const agent = this.ctx.agents.get(this.activeSessionId)
    if (agent === undefined) return
    planMode.set(agent, active)
  }

  /** 键路由：Enter 提交 / Ctrl-C 取消或退出 / 上下键历史 / 其余交给 InputLine。 */
  private handleKey(key: KeyPress): void {
    this.settleWelcome('input')
    // 任何非 Ctrl+C 键都终止连按退出窗口（提示行随窗口一起复位）。
    if (key.name !== 'ctrl_c' && this.inputController.ctrlCPendingSince !== 0) {
      this.inputController.ctrlCPendingSince = 0
      this.clearCtrlCExitHint()
    }
    // 双击 Esc 待定窗口：任何非 Esc 键打断（与 Ctrl+C 双击退出同模式）。
    if (key.name !== 'escape' && this.escRewindPendingSince !== 0) {
      this.escRewindPendingSince = 0
    }
    // C3 项 4：Shift+Tab 三态循环（Normal → Plan → Always-Approve → Normal）。
    if (key.name === 'shift_tab') {
      this.cycleMode()
      return
    }
    // C4 概念稿 A：欢迎页菜单入口快捷键——新会话 / 恢复会话 / 退出。
    // 语义与菜单行提示一致（grok menu.rs 的 ctrl+w/ctrl+s/ctrl+q 对齐）；
    // 任意时刻可用（新会话即 /session new 语义，退出即 Ctrl+Q 或连按两次 Ctrl+C）。
    // 注意：ctrl_n 在此劫持 InputLine 的 historyNext（L791）、ctrl_p 早已被
    // 命令面板劫持（historyPrev）——输入历史导航由 ↑/↓ 承担，此处不留键。
    if (key.name === 'ctrl_n') {
      void this.newSession()
      return
    }
    if (key.name === 'ctrl_s') {
      void this.restoreRecentOtherSession()
      return
    }
    if (key.name === 'ctrl_q') {
      if (this.onExit !== undefined) this.onExit()
      return
    }
    // Ctrl+P 命令面板：先于 inputLine 拦截（ctrl_p 原被 historyPrev 占用）。
    if (key.name === 'ctrl_p') {
      const palette = this.palette
      const overlay = this.overlay
      /* v8 ignore next 2 -- palette/overlay 在 attach 时恒创建（L539-547），null 仅类型收窄 */
      if (palette !== null && overlay !== null) {
        if (palette.isOpen()) {
          palette.close()
          overlay.deactivate()
        } else {
          palette.open()
          overlay.activate('command-palette')
        }
      }
      return
    }
    // Ctrl+. 快捷键面板：静态键位表弹层（grok-build 同款键位清单；再按一次关闭）。
    if (key.name === 'ctrl_.') {
      const overlay = this.overlay
      /* v8 ignore next -- overlay 在 attach 时恒创建，null 仅类型收窄 */
      if (overlay !== null) {
        if (overlay.activeId() === 'keymap') overlay.deactivate()
        else overlay.activate('keymap')
      }
      return
    }
    // C2 项 2：Ctrl+F 历史搜索 overlay。打开时快照 transcript 消息；
    // 再按一次或 Esc 关闭。palette 打开时不拦截（palette 优先，见下）。
    // Ctrl+R 是 Ctrl+F 历史搜索的 readline 惯例别名（回流 dsh-tui 181d517 之
    // Ctrl+R 半）。本拦截先于 inputLine.handleKey，vim 非 insert 态不生效——
    // NORMAL 态的 Ctrl+R redo 保留给 vim 引擎（Ctrl+F 无此冲突，不受限）。
    if ((key.name === 'ctrl_f' || (key.name === 'ctrl_r' && !(this.vimEnabled && this.inputLine.vimMode !== 'insert')))
      && this.palette?.isOpen() !== true) {
      const overlay = this.overlay
      const search = this.searchOverlay
      /* v8 ignore next 2 -- overlay/searchOverlay 在 attach 时恒创建（L539-547），null 仅类型收窄 */
      if (overlay !== null && search !== null) {
        if (overlay.activeId() === 'search') {
          overlay.deactivate()
        } else {
          search.setMessages(this.transcript?.view.messages ?? [])
          overlay.activate('search')
        }
      }
      return
    }
    // 搜索 overlay 打开：可打印字符进 query，Backspace 退格，n/N 跳转，Esc 关闭。
    if (this.overlay?.activeId() === 'search' && this.searchOverlay !== null) {
      if (key.name === 'escape' || key.name === 'ctrl_c') {
        this.overlay.deactivate()
      } else if (key.name === 'backspace') {
        this.searchOverlay.backspace()
        this.overlay.rerender()
      } else if (key.char === 'n' || key.char === 'N') {
        this.searchOverlay.goNext()
        this.overlay.rerender()
      } else if (key.char === 'p' || key.char === 'P') {
        this.searchOverlay.goPrev()
        this.overlay.rerender()
      } else if (key.char !== '') {
        this.searchOverlay.type(key.char)
        this.overlay.rerender()
      }
      return
    }
    // /config 面板打开——双栏导航/编辑分派交给面板状态机；close 动作在
    // actions 里直接 deactivate，这里只重绘。
    if (this.overlay?.activeId() === 'config-panel' && this.configPanel !== null) {
      this.configPanel.handleKey(key.name, key.char)
      this.overlay.rerender()
      return
    }
    // /key：API Key 对话框打开——Ctrl+V 只读剪贴板文本进 Key 字段；其余键交给
    // 对话框状态机（输入态收字符/退格/Enter/Esc），wantsClose 后 deactivate。
    if (this.overlay?.activeId() === 'key-dialog' && this.keyDialog !== null) {
      const dialog = this.keyDialog
      if (key.name === 'ctrl_v') {
        void this.pasteClipboardIntoKeyDialog(dialog)
        return
      }
      dialog.handleKey(key.name, key.char)
      if (dialog.wantsClose()) {
        this.overlay.deactivate()
        this.finishConfigReturn()
      } else {
        this.overlay.rerender()
      }
      return
    }
    // #31：选择器 overlay 打开：↑/↓（j/k）移动、PageUp/PageDown 翻页、
    // Enter 确认、Esc/Ctrl+C/q 关闭。优先于输入行（overlay 独占焦点）。
    if (this.overlay?.activeId() === 'picker' && this.picker !== null) {
      const picker = this.picker
      if (key.name === 'escape' || key.name === 'ctrl_c' || key.char === 'q') {
        picker.close()
        this.overlay.deactivate()
        this.finishConfigReturn()
      } else if (key.name === 'up' || key.char === 'k') {
        picker.move(-1)
        this.overlay.rerender()
      } else if (key.name === 'down' || key.char === 'j') {
        picker.move(1)
        this.overlay.rerender()
      } else if (key.name === 'pageup') {
        picker.move(-10)
        this.overlay.rerender()
      } else if (key.name === 'pagedown') {
        picker.move(10)
        this.overlay.rerender()
      } else if (key.name === 'return') {
        picker.commit()
        this.overlay.deactivate()
        this.finishConfigReturn()
      }
      return
    }
    // C3 项 3：rewind overlay 打开——Ctrl+C 与 list/done 的 Esc 立刻关闭
    // （对齐 memory；否则第一次 Ctrl+C 走不到进程退出）。mode 的 Esc 先回 list。
    if (this.overlay?.activeId() === 'rewind' && this.rewindOverlay !== null) {
      if (key.name === 'ctrl_c') {
        this.overlay.deactivate()
        return
      }
      if (key.name === 'escape') {
        if (this.rewindOverlay.isListPhase() || this.rewindOverlay.isDone()) {
          this.overlay.deactivate()
          return
        }
        if (this.rewindOverlay.handleKey(key.name, key.char)) {
          this.overlay.rerender()
        }
        return
      }
      if (this.rewindOverlay.handleKey(key.name, key.char)) {
        this.overlay.rerender()
      }
      if (this.rewindOverlay.isDone()) {
        this.overlay.deactivate()
      }
      return
    }
    // T5：转录查看器打开——Ctrl+C 关闭；Esc 在搜索态清 query、普通态关闭；
    // 其余键转发 overlay 状态机。
    if (this.overlay?.activeId() === 'transcript' && this.transcriptViewer !== null) {
      if (key.name === 'ctrl_c') {
        this.overlay.deactivate()
      } else if (key.name === 'escape') {
        if (this.transcriptViewer.isSearchMode()) {
          this.transcriptViewer.handleKey(key.name, key.char)
          this.overlay.rerender()
        } else {
          this.overlay.deactivate()
        }
      } else if (this.transcriptViewer.handleKey(key.name, key.char)) {
        this.overlay.rerender()
      }
      return
    }
    // P2：memory 浏览器打开——Esc/Ctrl+C 关闭；其余键转发 overlay 状态机。
    if (this.overlay?.activeId() === 'memory' && this.memoryOverlay !== null) {
      if (key.name === 'escape' || key.name === 'ctrl_c') {
        this.overlay.deactivate()
      } else if (this.memoryOverlay.handleKey(key.name, key.char)) {
        this.overlay.rerender()
      }
      return
    }
    // 面板打开：↑/↓ 移动选中，字符进面板查询，Enter 提交回填输入行。
    // type/move 后 rerender——overlay 无自动 ticker，不重绘则过滤/选中不刷新。
    if (this.palette?.isOpen() === true) {
      if (key.name === 'escape' || key.name === 'ctrl_c') {
        // Esc/Ctrl+C 关闭面板（与 search/memory overlay 一致），不提交、
        // 不回填输入行。此前只有 Enter 能关闭（会把 /命令 回填进输入行），
        // Esc 被三个分支漏掉后直接 return 吞掉——面板底栏却提示 "Esc 关闭"。
        this.overlay?.deactivate()
        this.palette.close()
      } else if (key.name === 'return') {
        const committed = this.palette.commit()
        this.overlay?.deactivate()
        this.palette.close()
        if (committed !== null) {
          // execute 模式（Tab 命令菜单，#31）：直接执行无参命令
          // （/model /theme /session → 对应选择器）；backfill 模式（Ctrl+P）回填。
          if (committed.execute) this.handleSubmit(committed.text)
          else this.inputLine.setValue(committed.text)
        }
      } else if (key.name === 'up' || key.name === 'down') {
        this.palette.move(key.name === 'up' ? -1 : 1)
        this.overlay?.rerender()
      } else if (key.char !== '') {
        this.palette.type(key.char)
        this.overlay?.rerender()
      }
      return
    }
    // T3.1：结构化提问挂起中——数字键选选项（1-based），Esc/Ctrl+C 取消；
    // plan-review 卡 f 键进入反馈输入模式（文本走 inputLine，Enter 提交）。
    if (this.question.isPending) {
      const peek = this.question.peek()
      const item = peek?.request.questions[0]
      if (this.question.feedbackMode) {
        if (key.name === 'return') {
          const feedback = this.inputLine.value
          this.inputLine.setValue('')
          // 反馈路径选择「非 approve 的选项」（plan-mode 按 selected !== approve
          // + custom 判定 keep-planning；label 从 options 推导，不硬编码）。
          const keepLabel = item?.options?.find(o => o.label !== item.intent?.approve)?.label
            ?? item?.options?.[0]?.label ?? ''
          this.settleQuestion({ answers: [{ id: item?.id ?? '', selected: [keepLabel], custom: feedback }] })
        } else if (key.name === 'escape' || key.name === 'ctrl_c') {
          this.question.setFeedbackMode(false)
          this.flushLiveRender()
        } else {
          this.inputLine.handleKey(key.name, key.char, key.ctrl, key.meta, key.shift, key.inline === true)
          this.flushLiveRender()
        }
      } else if (key.name === 'escape' || key.name === 'ctrl_c') {
        this.cancelQuestion()
      } else if (item !== undefined && item.intent?.kind === 'plan-review' && (key.char === 'f' || key.char === 'F')) {
        this.question.setFeedbackMode(true)
        this.inputLine.setValue('')
        this.flushLiveRender()
      } else if (item !== undefined && item.options !== undefined && /^[0-9]$/.test(key.char)) {
        const idx = Number(key.char) - 1
        const option = item.options[idx]
        if (option !== undefined) {
          this.settleQuestion({ answers: [{ id: item.id, selected: [option.label] }] })
        }
      }
      return
    }
    // P1：/btw 侧问挂起中——Esc/Ctrl+C 关闭（done 折叠答案入 scrollback；
    // loading 取消并销毁 btw agent；error 直接清除）。question 分支优先。
    if (this.btw.isActive && (key.name === 'escape' || key.name === 'ctrl_c')) {
      this.btw.dismiss()
      this.flushLiveRender()
      return
    }
    // Phase 8：审批挂起中——y/N 决定，Ctrl+C/Esc 取消，其余键忽略（不干扰输入行）
    if (this.approval.isPending) {
      if (this.persistInFlight !== null) return
      if (key.char === 'y' || key.char === 'Y') {
        this.settleApproval('allowed-once')
      } else if (key.char === 'n' || key.char === 'N') {
        this.settleApproval('rejected')
      } else if (key.char === 'a' || key.char === 'A') {
        // 本会话总是允许：先开 always-approve，再以持续授权结算当前请求（与
        // Shift+Tab 进 auto 不同——挂起中的这一张也立刻通过，而不只影响后续）。
        this.approval.setAlwaysApprove(true)
        this.statusLine?.setAlwaysApprove(true)
        this.settleApproval('allowed-always')
      } else if (key.char === 'p' || key.char === 'P') {
        // 永久允许：先把精确匹配规则落进 approval-rules（项目层 YAML），落盘
        // 成功才结算——规则在、结算在；规则写失败则卡片留在原地等用户改选。
        void this.persistPendingApprovalRule()
      } else if (key.name === 'ctrl_c' || key.name === 'escape') {
        this.settleApproval('cancelled')
      }
      return
    }
    // 1.1：欢迎页数字键直达——仅欢迎阶段（列表刚渲染、尚未输入/切换）且空输入行
    // 时劫持纯数字键（行号 = 欢迎列表编号）；其余时候数字键一律进输入行。
    if (this.welcomeDigitsActive && !key.meta && !key.ctrl && /^[1-9]$/.test(key.char) && this.inputLine.value === '') {
      const row = this.welcomeSessionRows[Number(key.char) - 1]
      if (row !== undefined) {
        this.switchSessionGuarded(row.id)
        return
      }
    }
    // Esc 打断：对齐 Claude Code 单次 Esc 停止输出。位于挂起交互分支之后——
    // overlay/菜单打开时 Esc 仍先关面板；仅「无挂起交互 + 忙碌」才打断；
    // 空闲不动作（不退出、不触发任何东西）。Kitty CSI u 的 Esc（CSI 27 u）
    // 与 lone ESC 走同一 name；忙碌时 escapeImmediate，不跟 80ms 防误触。
    if (key.name === 'escape' && !this.inputController.slashMenu.open) {
      if (this.isAgentBusy()) {
        this.handleAbort()
        return
      }
      // 空闲：双击 Esc（窗口内第二次）触发 rewind（CC 的 Esc+Esc 时间回溯）；
      // 第一次只记时间戳并继续流向后续分支，窗口过期后第二次仅刷新时间戳。
      // vim 开启时整段跳过：离开 insert 的那一次 Esc 当时仍是 insert，
      // 若按 normal 才守卫，第一次会布防、习惯性补按就会弹出 overlay。
      // 忙碌打断在本分支之前；时间回溯走 /rewind。
      if (!this.vimEnabled) {
        const now = Date.now()
        if (this.escRewindPendingSince !== 0 && now - this.escRewindPendingSince < REWIND_DOUBLE_ESC_MS) {
          this.escRewindPendingSince = 0
          this.rewindSession()
          return
        }
        this.escRewindPendingSince = now
      }
    }
    if (key.name === 'ctrl_c') {
      // Windows 控制台（PowerShell/conhost）下 Ctrl+C 可能同时产生 0x03 字节
      // 与 SIGINT：记录字节处理时间，供 index.ts 的 SIGINT 防抖（双触发时
      // SIGINT 忽略，避免刚打断的 TUI 被 teardown 拆掉——「输入框消失」）。
      // Kitty flag 1 下 Ctrl+C 是 CSI 99;5u 而不是 0x03，同样走此分支。
      const now = Date.now()
      this.lastCtrlCAt = now
      const empty = this.inputLine.value === ''
      const pending = this.inputController.ctrlCPendingSince
      const within = pending !== 0 && now - pending < InputController.EXIT_WINDOW_MS
      // 窗口内第二次 Ctrl+C 恒退出（不要求空输入）：第一次（无论打断、清空还是
      // 布防提示）已表达退出意图，草稿/在途不再拦路——「连按两次退出」对
      // 「有草稿想退出」与「打断后立刻退出」同样成立。
      if (this.onExit !== undefined && within) {
        this.inputController.ctrlCPendingSince = 0
        this.clearCtrlCExitHint()
        this.onExit()
        return
      }
      if (this.isAgentBusy()) {
        this.handleAbort()
        // 打断同时布防连按窗口（有草稿也布防）：agent 落定前第二次 Ctrl+C
        // 直接退出（within 分支先行），不再要求等 agent 变 idle 后重按。
        if (this.onExit !== undefined) {
          this.inputController.ctrlCPendingSince = now
          this.showCtrlCExitHint()
        } else {
          this.inputController.ctrlCPendingSince = 0
          this.clearCtrlCExitHint()
        }
        return
      }
      if (empty && this.onExit !== undefined) {
        this.inputController.ctrlCPendingSince = now
        this.showCtrlCExitHint()
        return
      }
      if (!empty) {
        // 空闲草稿：清空输入行（shell 语义；setValue 记 undo，Ctrl+Z 可恢复）
        // 并布防连按窗口——第二次 Ctrl+C 即退出，无「已取消」噪音。
        this.inputLine.setValue('')
        this.flushLiveRender()
        if (this.onExit !== undefined) {
          this.inputController.ctrlCPendingSince = now
          this.showCtrlCExitHint()
        }
        return
      }
      this.inputController.ctrlCPendingSince = 0
      this.clearCtrlCExitHint()
      this.handleAbort()
      return
    }
    if (key.name === 'ctrl_o') {
      // 展开/收起最近推理块：流式进行中展开全文、已落底块展开正文（scrollback
      // append-only——正文在 live 区展示，头行保持折叠）。无推理块时落到
      // 下方 editorKey（缺省 ctrl_e；恢复 opencode 的 ctrl+o=展开语义）。
      if (this.reasoningText !== '' || this.lastReasoningBlock !== null) {
        this.reasoningExpanded = !this.reasoningExpanded
        this.renderBatcher.schedule()
        return
      }
    }
    if (key.name === this.editorKey) {
      // Phase 6.4：外部编辑器——当前输入行内容进 $EDITOR，保存退出后回填。
      // 编辑器是外部进程，必须暂时退出 raw-mode（否则编辑器收到的是字节流
      // 而非终端交互）；spawn 结束后恢复。任何路径（含编辑器失败）都恢复。
      this.openExternalEditor()
      return
    }
    if (key.name === 'ctrl_t') {
      // 中轮转向：把当前输入行作为转向提交（空输入 no-op），并清空输入行。
      const text = this.inputLine.value.trim()
      if (text !== '') {
        this.inputLine.setValue('')
        this.handleSteer(text)
      }
      return
    }
    // Ctrl+Enter 插队（cancel-and-send，回流 dsh-tui c53a497）：打断当前回合，
    // whenIdle 落定后把草稿走正常提交路径直发——与 Ctrl+T（不打断在途 step）
    // 语义分层。仅 running 态消费：空闲时不消费（草稿保留）；无 kitty 增强的
    // 终端发不出该键，天然静默。
    if (key.name === 'ctrl_return') {
      if (this.liveAgent?.state.status === 'running') {
        cancelAndSendInput({
          input: this.inputLine,
          controls: this.controls ?? undefined,
          abort: () => { this.handleAbort() },
          submit: (text, images) => { this.handleSubmit(text, images) },
        })
      }
      return
    }
    // Ctrl+V：剪贴板图片粘贴（先于普通输入处理；无图时 fallback 剪贴板文本）。
    if (key.name === 'ctrl_v') {
      void this.handleCtrlV()
      return
    }
    // slash 命令菜单打开：拦截导航/接受/关闭键（grok slash_dropdown 键路由
    // 对齐；Ctrl+P/N 已被命令面板/新会话占用，用 ↑↓ 与 PageUp/Down）。
    if (this.inputController.slashMenu.open) {
      if (key.name === 'up' || key.name === 'down') {
        this.inputController.moveSlashSelection(key.name === 'up' ? -1 : 1)
        this.flushLiveRender()
        return
      }
      if (key.name === 'pageup' || key.name === 'pagedown') {
        this.inputController.scrollSlashSelection(key.name === 'pageup' ? -SLASH_MENU_MAX_ROWS : SLASH_MENU_MAX_ROWS)
        this.flushLiveRender()
        return
      }
      if (key.name === 'tab') {
        this.acceptSlashCompletion()
        return
      }
      if (key.name === 'return' && !key.shift) {
        this.acceptSlashCompletion({ submit: true })
        return
      }
      if (key.name === 'escape') {
        this.inputController.closeSlash()
        this.flushLiveRender()
        return
      }
    }
    if (key.name === 'return' && key.shift) {
      this.inputLine.setNewlineMode(!this.inputLine.newlineMode)
      this.flushLiveRender()
      return
    }
    // 空行 Alt+Backspace → 移除末张附件：有文本时 Alt+Backspace 仍是词删除
    //（空行上词删除本就是空操作，两职责零冲突）；📎 行同步更新。
    if (key.name === 'backspace' && key.meta
      && this.inputLine.value === '' && this.inputLine.images.length > 0) {
      this.inputLine.removeImage(this.inputLine.images.length - 1)
      this.flushLiveRender()
      return
    }
    if (key.name === 'up' || key.name === 'down') {
      // 排队取回（对标 CC，回流 dsh-tui 9d7f421）：空输入 ↑ 取回队首回输入行。
      if (key.name === 'up' && this.inputLine.value === '' && this.submitQueue.size() > 0) {
        const first = this.submitQueue.takeFirst()
        if (first !== undefined) this.inputLine.setValue(first.text, first.text.length)
        this.flushLiveRender()
        return
      }
      // 交给 InputLine 的历史导航（InputLineEvent 'history' 不消费即已处理）
      this.inputLine.handleKey(key.name, key.char, key.ctrl, key.meta, key.shift, key.inline === true)
      this.flushLiveRender()
      return
    }
    // 空输入框 Tab → 命令菜单（palette execute 模式，#31 参考 Claude Code）：
    // 选命令回车直接执行（/model → 模型选择器），省去输入 /cmd 一步。
    // 非空输入框 Tab 走 @ 补全（下方 inputLine.handleKey → onTabComplete）；
    // slash 菜单打开时 Tab 已被上方分支拦截（接受补全）。
    if (key.name === 'tab' && this.inputLine.value === '') {
      const palette = this.palette
      const overlay = this.overlay
      /* v8 ignore next 2 -- palette/overlay 在 attach 时恒创建，null 仅类型收窄 */
      if (palette !== null && overlay !== null) {
        palette.open(true)
        overlay.activate('command-palette')
        this.flushLiveRender()
      }
      return
    }
    // 欢迎阶段收尾：任何未路由的可见字符输入后，数字键回归输入行（不劫持打字）。
    if (this.welcomeDigitsActive && key.char !== '') this.welcomeDigitsActive = false
    const event = this.inputLine.handleKey(key.name, key.char, key.ctrl, key.meta, key.shift, key.inline === true)
    // 选区剪切/复制的 OSC52 drain：Ctrl+K 剪切 / Alt+W 复制写系统剪贴板
    // （终端支持 OSC52 时生效，不支持者无害忽略）。vim yank（p/P、Alt+Y）走
    // 内部剪贴板，不经此通道。
    const clip = this.inputLine.takeClipboardOut()
    if (clip != null) {
      // P1-1：终端不支持 OSC52 时每进程首次提示一次；序列仍写出（保持无害忽略降级）
      if (!supportsOsc52() && !this.osc52WarningShown) {
        this.osc52WarningShown = true
        this.echoWarn('⚠ 终端不支持 OSC52 复制（Ctrl+K/Alt+W 无法写入系统剪贴板，请用终端原生复制）')
      }
      this.stdout.write(osc52Clipboard(clip))
    }
    if (event !== null) this.flushLiveRender()
  }

  /**
   * Phase 5.3：glance 一行条的可得数据。model（request header 优先、
   * agentDefaultModel 兜底）、effort（同构）、缓存命中率与上下文占比
   * （最后一条 assistant/message 的 usage 折叠）、上下文窗口
   * （request/context 折叠）、turn 数、本轮耗时。任何数据缺失 → 对应段
   * 省略（glance 段组装按可得段渲染，窄宽渐进 drop）。
   * 无可渲染数据返回 null（不占位）。
   */
  private glanceMetrics(): FormatGlanceBarInput | null {
    const view = this.transcript?.view
    if (view === undefined) return null
    const modelName = this.glanceModelName
    /* v8 ignore next -- glanceModelName 在 mountSession 时经 ?? 兜底恒非 null；防御分支 */
    if (modelName === null) return null
    const input: FormatGlanceBarInput = {
      width: this.stdout.columns,
      modelName,
    }
    if (this.glanceEffort !== null) input.effort = this.glanceEffort
    const usage = this.usageFold
    if (usage !== null) {
      // TokenUsage 为 DISJOINT 计数：inputTokens 是未缓存输入，billed input =
      // 三者之和（llm/types.ts 契约）。缓存命中率只在适配器报了 cache 字段时
      // 显示（未报不显示 0%——诚实降级）。
      const billed = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      if (billed > 0) {
        if (usage.cacheReadTokens !== undefined || usage.cacheWriteTokens !== undefined) {
          input.cacheHitRate = (usage.cacheReadTokens ?? 0) / billed
          // cacheHealth 投影报出 warn/error 级 miss 时附加短标记（截断/漂移/驱逐）。
          const missLabel = formatCacheMissReason(this.cacheHealth?.lastMissReason ?? '')?.label
          if (missLabel !== undefined) input.cacheMissLabel = missLabel
        }
        if (this.contextWindow !== null && this.contextWindow > 0) {
          input.contextRatio = Math.min(1, billed / this.contextWindow)
          input.tokens = { used: billed, max: this.contextWindow }
        }
        // 成本估算：定价表命中才显示（未知模型不猜价，与缓存% 诚实降级同款）。
        const cost = estimateCost(this.glanceModelName ?? 'unknown', usage)
        if (cost !== undefined) input.cost = cost
      }
    }
    if (view.turn >= 0) {
      input.turnCount = view.turn + 1
      // O(1)：transcript 折叠时维护的当前 turn 首条消息时间，替代每帧
      // view.messages.find() 线性扫描（消息列表随会话增长无界）。
      if (view.firstInTurnTime !== undefined) {
        input.elapsedMs = Date.now() - view.firstInTurnTime
      }
    }
    return input
  }

  /**
   * 把渲染行批量提交到 scrollback（保持时间顺序）。
   * @param rows - RenderedRow 数组。
   */
  private commitRows(rows: readonly RenderedRow[]): void {
    if (rows.length === 0) return
    const buf: string[] = []
    for (const row of rows) buf.push(row.ansi)
    this.commitToScrollback({ text: buf.join('\n'), trailingNewline: true })
  }

  /**
   * 流式事件供给：assistant text-delta 推进 blockWriter（节流切块，稳定前缀
   * commit 进 scrollback）；message/turn 边界 flush + finalize 收尾。aborted
   * turn 的残文由 handleAbort discard/reset，不在此 commit。
   * @param event - 当前会话的 session/event（订阅处已按会话过滤）。
   */
  private handleStreamEvent(event: SessionEvent): void {
    // 投影层 fold（turn 统计 + 会话汇总）：先于 switch 折叠每条事件——fold 内部
    // 对无关事件原样返回，代价可忽略；两模型只读事件，不写回任何状态。
    this.turnSummary = applyTurnEvent(this.turnSummary, event)
    this.sessionSummary = applySummaryEvent(this.sessionSummary, event)
    switch (event.type) {
      case 'assistant/chunk': {
        const { chunk } = event.data
        if (chunk.type === 'text-delta') {
          // 正文开始即推理段结束点：先整块落底（此刻 blockWriter 必为空——
          // 推理段先于本 step 一切 text-delta，顺序天然安全）。
          this.commitReasoningBlock()
          this.blockWriter.push(chunk.text)
        } else if (chunk.type === 'reasoning-delta') {
          if (this.reasoningText === '') this.reasoningStartedAt = event.time
          this.reasoningText += chunk.text
          this.renderBatcher.schedule()
        }
        break
      }
      case 'assistant/message': {
        // reasoning-only step（无 text-delta 的推理段）在消息组装点落底。
        this.commitReasoningBlock()
        // 最后一次请求的 token 计量（缓存命中率/上下文占比数据源；适配器未报
        // usage 时保持上一次折叠——同一会话内后续段仍可用）。
        if (event.data.usage !== undefined) {
          this.usageFold = event.data.usage
          // /cost 会话累计：按最近一次 request/header 的模型分桶累加。
          const model = this.glanceModelName ?? 'unknown'
          this.sessionCosts.set(model, accumulateUsage(this.sessionCosts.get(model), event.data.usage, model))
        }
        void this.flushStream()
        break
      }
      case 'request/header':
        // effort / 模型名随实际请求更新（header 记录 adapterDefaults 折叠后的生效值）。
        this.glanceEffort = event.data.header.config.reasoningEffort ?? null
        this.glanceModelName = event.data.header.config.model
        break
      case 'request/context':
        this.contextWindow = event.data.contextWindow ?? null
        break
      case 'tool/call': {
        // 推理后直接发工具（无正文 step）的段边界。
        this.commitReasoningBlock()
        // live 进行中卡标题接 presentCall（意图缺省回落 toolArgSummary 启发式）。
        const { call } = resolveToolViews(this.toolPresenters(), {
          name: event.data.name,
          argumentsRaw: event.data.arguments,
        })
        if (call !== undefined) this.pendingCallTitles.set(event.data.callId, call.title)
        // LSP：agent 触碰文件 → 异步拉取该文件诊断（本地展示缓存，纯只读）。
        this.touchLspPaths(event.data.arguments)
        // Phase 9d：工具开始 → 阶段推进（静默计时从工具起算）
        this.fluency.setPhase('tool')
        break
      }
      case 'tool/result': {
        // Phase 9d：工具结果 → 追踪 routine 链 / 输出速率 / 错误信号。
        // resultLength 取结果消息文本长度（tool-result 块内 text 折叠）。
        const { message, error } = event.data
        const resultBlock = message.content[0]
        const resultLength = resultBlock.content.reduce(
          (acc, block) => acc + (block.type === 'text' ? block.text.length : 0),
          0,
        )
        const callId = message.source.callId
        const name = this.transcript?.view.tools.findLast(t => t.callId === callId)?.name ?? 'tool'
        this.fluency.recordToolResult({
          name,
          isError: error !== undefined || resultBlock.isError === true,
          resultLength,
        })
        this.pendingCallTitles.delete(callId)
        this.commitSettledToolCard(event)
        break
      }
      case 'turn/start':
        // A5：回合开始 → 标记请求在途，静默提示生效（turn/end 由 onTurnComplete 复位）。
        this.fluency.onTurnStart()
        break
      case 'turn/end': {
        // Phase 9d：turn 边界复位流利度信号
        this.fluency.onTurnComplete()
        // 运行中排队 → turn 边界按序投递（中止轮不 flush，见 flushSubmitQueue；
        // 回流 dsh-tui 9d7f421）。
        this.flushSubmitQueue(event.data.reason.kind === 'aborted' ? 'aborted' : 'completed')
        // A3：回合边界刷新 git 未提交计数（footer ●N；不逐帧 spawn）。
        this.gitDirty = gitDirtyCount()
        // A5：回合结束复位工具卡展开态（工具已结算，展开无意义）。
        this.expandedToolCallId = null
        if (event.data.reason.kind !== 'aborted') {
          // 错误终止的 turn 可能没有 assistant/message——落底已累积的推理
          //（durable log 已含这些 chunk，与「模型可见 ⟺ 已记录」一致）。
          this.commitReasoningBlock()
          // 投影层：turn 摘要行接在流式收尾之后（flushStream 异步吐尽节流缓冲，
          // 同步 commit 会抢在正文尾巴前）。内容快照此刻取定；回调只认未
          // dispose 且仍在同一会话（切会话后旧 turn 的行不写进新会话视图）。
          const summary = this.turnSummary
          const sid = this.activeSessionId
          if (summary.toolCount > 0) {
            void this.flushStream().then(() => {
              if (this.disposed || this.activeSessionId !== sid) return
              // 轮号取事件的权威值而非 fold 状态：中途挂载运行中会话（错过了
              // 本turn的 turn/start）时 summary.turn 仍是初值 0，会误显 turn 0。
              this.commitTurnSummaryLine(summary, event.data.turn)
            })
          } else {
            void this.flushStream()
          }
        } else {
          this.discardReasoning()
        }
        this.pendingCallTitles.clear()
        break
      }
      case 'hook/result': {
        // hook 的用户可见通告(CC dialect systemMessage)——即席 scrollback
        // 系统行;无 systemMessage 的常规结果不渲染(审计已在日志里)。
        const hookMessage = event.data.systemMessage
        if (hookMessage !== undefined) {
          this.commitToScrollback({ text: color(`[hook] ${hookMessage}`, this.theme.muted), trailingNewline: true })
        }
        break
      }
      default:
        break
    }
  }

  /** tools 服务的 presenter 面（可选服务：未装配返回 undefined → 桥软降级）。 */
  private toolPresenters(): ToolPresenterSource | undefined {
    return this.ctx.reflect.get('tools', false) as ToolPresenterSource | undefined
  }

  /**
   * 结算工具卡实时提交：从 transcript 查配对 call 的 name/arguments →
   * presenter 桥 → 卡片渲染 → 串行在流式文本 flush 之后 commit 进
   * scrollback（保证「文本 → 卡」的事件序）。配对缺失（截断/rewind 边界）
   * 无卡可渲染，静默跳过。
   */
  private commitSettledToolCard(event: SessionEvent<'tool/result'>): void {
    const callId = event.data.message.source.callId
    const tool = this.transcript?.view.tools.findLast(t => t.callId === callId)
    if (tool === undefined) return
    const { content, isError } = toolResultText(event)
    const views = resolveToolViews(this.toolPresenters(), {
      name: tool.name,
      argumentsRaw: tool.arguments,
      result: {
        content: event.data.message.content[0].content,
        isError,
        ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
      },
    })
    const rows = formatToolViewCard({
      toolName: tool.name,
      argumentsRaw: tool.arguments,
      content,
      isError,
      ...(views.call === undefined ? {} : { callView: views.call }),
      ...(views.result === undefined ? {} : { resultView: views.result }),
      elapsedMs: Math.max(0, event.time - tool.time),
      compact: this.compactMode,
      width: this.stdout.columns,
    }, this.theme)
    // 串行链：先吐尽本 step 的流式文本（flushStream 幂等），卡片紧随其后
    // ——live 区进行中卡的消失与 scrollback 结算卡的出现衔接为一次提交。
    void this.flushStream().then(() => {
      if (this.disposed) return
      this.commitToScrollback({ text: rows.join('\n'), trailingNewline: true })
      this.renderBatcher.schedule()
    })
  }

  /**
   * 推理段落底：静态 `✻ 思考 (Ns) · N 行` 折叠头行（对标竞品默认折叠——
   * 正文经 Ctrl+O 展开查看）整块 commit 进 scrollback，清缓冲。空缓冲 no-op。
   * 调用点即段边界：首个 text-delta / tool/call / assistant/message /
   * 非中止 turn/end。
   */
  private commitReasoningBlock(): void {
    if (this.reasoningText === '') return
    const elapsedMs = this.reasoningStartedAt === null ? undefined : Math.max(0, Date.now() - this.reasoningStartedAt)
    const lines = formatReasoningBlock({
      text: this.reasoningText,
      ...(elapsedMs === undefined ? {} : { elapsedMs }),
      compact: this.compactMode,
    }, this.theme)
    // 折叠头行已落底；全文留存供 Ctrl+O 展开查看（滚动区 append-only，不可改写）。
    this.lastReasoningBlock = { text: this.reasoningText, ...(elapsedMs === undefined ? {} : { elapsedMs }) }
    this.reasoningExpanded = false
    this.discardReasoning()
    // commitToScrollback 原子编舞内同步重绘（旧 schedule 尾沿是推理段落底时
    // 输入框缺席数帧的闪烁根因之一）。
    this.commitToScrollback({ text: lines.join('\n'), trailingNewline: true })
  }

  /** 丢弃推理缓冲（abort / 会话切换；aborted turn 的推理不落底）。 */
  private discardReasoning(): void {
    this.reasoningText = ''
    this.reasoningStartedAt = null
  }

  /** 流式收尾：吐尽节流缓冲，并把 StreamRenderer 剩余 pending commit 进 scrollback。 */
  private async flushStream(): Promise<void> {
    await this.blockWriter.flush()
    this.streamRenderer.finalize()
  }

  /**
   * turn 结束摘要行（投影层：turn-summary 模型 → format/turn-summary 渲染半）：
   * `turn N · 读X 改Y · elapsed` 单行 dim 落 scrollback。读/改计数复用
   * tool-meta 的 read|find/write 家族（投影不重复造「工具名 → 域」映射）。
   * @param summary - 该 turn 的统计快照（fold 于 handleStreamEvent，调用点取定）。
   * @param turn - 轮号（取 turn/end 事件的权威值；中途挂载错过 turn/start 时
   *   快照内轮号是初值 0）。
   */
  private commitTurnSummaryLine(summary: TurnSummaryState, turn: number): void {
    const reads = summary.calls.filter((c) => {
      const family = getToolFamily(c.name).family
      return family === 'read' || family === 'find'
    }).length
    const writes = summary.calls.filter(c => getToolFamily(c.name).family === 'write').length
    const lines = renderTurnSummaryLine({
      turnNumber: turn,
      segments: [],
      filesRead: reads,
      filesModified: writes,
      ...(summary.totalElapsedMs > 0 ? { elapsedMs: summary.totalElapsedMs } : {}),
      width: this.stdout.columns,
    }, this.theme)
    for (const line of lines) this.commitToScrollback({ text: line, trailingNewline: true })
  }

  /** wrapping-aware display rows（空行计 1）。 */
  private displayRowsFor(text: string): number {
    const cols = this.stdout.columns
    if (cols <= 0) return 1
    const dw = displayWidth(text, { ambiguousAsWide: ambiguousWideEnabled() })
    if (dw === 0) return 1
    return Math.ceil(dw / cols)
  }

  /** critical 路径同步穿透：用户交互（提交/审批/按键）不等 16ms 帧边界。 */
  private flushLiveRender(): void {
    this.renderBatcher.flushNow()
  }

  /**
   * 本帧是否有转圈行。ticker 只在此时推进 `tick`；空闲帧不改 shimmer，
   * 以便 snapshot+chrome key 保持稳定并跳过组装。
   */
  private hasVisibleSpinner(): boolean {
    return liveHasSpinner({
      agentRunning: this.liveAgent?.state.status === 'running',
      activityRunning: this.foldActivity().some(item => item.status === 'running'),
      pendingTools: (this.transcript?.view.tools.some(tool => tool.result === undefined) ?? false),
      reasoningLive: this.reasoningText !== '' || this.reasoningExpanded,
    })
  }

  /**
   * snapshot 面 + chrome 面空闲键（不含 tick/now）。任一面变化都必须组装。
   * @returns 可与 {@link lastIdleKey} 比较的稳定串。
   */
  private currentIdleKey(): string {
    const activity = this.foldActivity()
    const pending = this.transcript?.view.tools.filter(tool => tool.result === undefined) ?? []
    return liveIdleKey({
      snapshotKey: [
        this.liveAgent?.state.status ?? '',
        activity.map(item => `${item.id}:${item.status}:${item.lastTool ?? ''}:${item.toolCalls ?? 0}:${item.tokensUsed ?? 0}`).join('|'),
        pending.map(tool => tool.callId).join(','),
        this.activityBandEnabled ? '1' : '0',
        this.compactMode ? '1' : '0',
        `${this.stdout.rows}x${this.stdout.columns}`,
        [
          this.todosPanelVisible,
          this.taskPanelVisible,
          this.statusPanelVisible,
          this.subagentsPanelVisible,
          this.workflowPanelVisible,
          this.skillsPanelVisible,
          this.lspPanelVisible,
        ].map(flag => (flag ? '1' : '0')).join(''),
        this.btw.peek() === null ? '' : 'btw',
        this.taskNotice ?? '',
        this.gitDirty,
        this.apiKeyReady ? '1' : '0',
        this.reasoningText.length,
        this.reasoningExpanded ? '1' : '0',
        this.blockWriter.peek().length,
      ].join('\n'),
      chromeKey: [
        this.inputLine.value,
        this.question.isPending ? '1' : '0',
        this.approval.isPending ? '1' : '0',
        this.approval.peek()?.req.toolName ?? '',
        this.approval.alwaysApprove ? '1' : '0',
        this.inputLine.newlineMode ? '1' : '0',
        this.inputController.slashMenu.open
          ? `slash:${this.inputController.slashMenu.selected}:${this.inputController.slashMenu.matches.length}`
          : '',
      ].join('\n'),
    })
  }

  /** 渲染一帧 live 区：状态行 + 流式尾巴 + 进行中工具卡 + 输入行。 */
  private renderLive(): void {
    if (this.disposed) return
    // A6：全屏 overlay（命令面板/快捷键/搜索/rewind/memory）激活时处于
    // alternate screen buffer——跳过主屏 live 写屏，避免流式帧逐帧盖住面板；
    // overlay 退出后 flushLiveRender / ticker 下一帧自然重绘。作废空闲键，
    // 避免退出后 key 未变而跳过主屏重铺。
    if (this.overlay !== null && this.overlay.activeId() !== null) {
      this.lastIdleKey = null
      return
    }
    const idleKey = this.currentIdleKey()
    // 空闲跳过只作用于 120ms ticker。按键 / 审批 / 流式事件走 flush 或
    // batcher，必须组装——否则 slash 开合与高水位垫高会被误跳过。
    if (
      this.renderLiveFromTicker
      && shouldSkipIdleAssemble({
        prevKey: this.lastIdleKey,
        nextKey: idleKey,
        hasSpinner: this.hasVisibleSpinner(),
      })
    ) {
      return
    }
    this.lastIdleKey = idleKey
    const renderStart = performance.now()
    this.input.setEscapeImmediate(
      this.question.isPending || this.approval.isPending || this.isAgentBusy(),
    )
    const theme = this.theme
    const termCols = this.stdout.columns
    const gutter = termCols >= CHROME_GUTTER * 2 + 8 ? CHROME_GUTTER : 0
    const cols = Math.max(1, termCols - gutter * 2)
    const tightViewport = this.stdout.rows < LIVE_COMPACT_MIN_ROWS
    const compactLive = this.compactMode || tightViewport
    const lines: LiveRegionLine[] = []

    // ── 组装 LiveSnapshot（Wave 2）：renderLive 读取字段子集（控制面/面板
    // 显隐/投影源/输入行五组），交给 render/live-panels 的 7 面板纯函数；
    // 非面板段（提问/审批/流利度/流式尾巴/工具卡/输入行）仍由组合器直渲染。──
    // Phase 5.3：glance 控制器统一派生（首推同步 + 窗口内节流）。
    this.glance.refresh()
    const glance = this.glance.current()
    // C4 概念稿 A：turn_status 形态——glance 状态行升级为 spinner（运行中
    // braille 帧循环 / 等待输入 pulsing ◆）+ 阶段文本；null 不占位。
    const turnStatusLines = formatTurnStatus({
      statusText: glance.status,
      tick: this.tick,
      active: this.liveAgent?.state.status === 'running',
      width: cols,
    }, theme)
    // T2.2：运行中 + 已结算 workflow run 折叠为视图数组（列表行 + 终态汇总）。
    const now = Date.now()
    const workflowRuns: WorkflowRunView[] = []
    for (const state of this.workflowRuns.values()) {
      workflowRuns.push({
        info: { id: state.id, meta: state.meta },
        agents: state.agents.map(a => ({
          seq: a.seq,
          label: a.label,
          childId: a.childId ?? '',
          outcome: a.outcome ?? 'completed',
        })),
        elapsedMs: now - state.startedAt,
        ...(state.logs.length === 0 ? {} : { logs: [...state.logs] }),
      })
    }
    workflowRuns.push(...this.completedWorkflowRuns.values())
    const snapshot: LiveSnapshot = {
      cols,
      theme,
      now,
      glanceStatus: turnStatusLines[0] ?? null,
      glanceError: glance.error,
      taskPanelVisible: this.taskPanelVisible,
      taskItems: this.taskItems,
      taskSnapshots: this.taskSnapshots,
      taskNotice: this.taskNotice,
      statusPanelVisible: this.statusPanelVisible,
      goal: (this.projectionCache?.goal as GoalProjectionInput | undefined) ?? null,
      todos: (this.projectionCache?.todos as TaskItem[] | null | undefined) ?? null,
      plan: (this.projectionCache?.plan as PlanProjectionInput | undefined) ?? null,
      // todos 紧凑面板（/todos）：保留快照 + 显隐/明细状态。
      todosPanelVisible: this.todosPanelVisible,
      todosExpanded: this.todosExpanded,
      todosItems: this.todosRetained,
      // 投影层：会话级汇总段（本地 fold，宿主投影总线缺失时仍有数据）。
      sessionTotals: {
        turns: this.sessionSummary.totalTurns,
        toolCalls: this.sessionSummary.totalToolCalls,
        elapsedMs: this.sessionSummary.totalElapsedMs,
      },
      subagentsPanelVisible: this.subagentsPanelVisible,
      delegationEntries: this.delegationEntries,
      externalRuns: this.externalRuns,
      workflowPanelVisible: this.workflowPanelVisible,
      workflowRuns,
      skillsPanelVisible: this.skillsPanelVisible,
      skillItems: this.skillItems,
      // LSP 面板（本地语言服务诊断；bridge 缓存折叠——桥未创建时视为无诊断）
      lspPanelVisible: this.lspPanelVisible,
      lspDiagnostics: this.lspDiagnosticsView(),
      lspAvailable: this.lspBridge === null ? true : this.lspBridge.isAvailable(),
      // P3：会话 tab 栏（多会话 side conversation；快照从 live store 派生）
      activeSessionId: this.activeSessionId === null ? null : String(this.activeSessionId),
      sessionTabs: this.sessionManager.list().map(s => ({ id: String(s.id), status: s.status })),
      activityBandEnabled: this.activityBandEnabled,
      activityItems: this.foldActivity(),
      activityBandMaxRows: this.activityBandMaxRows,
      tick: this.tick,
    }

    // ── 面板段（7 面板纯函数；组合器负责 { text } 包装与 theme 着色）。──
    // 会话 tab 栏只在 chrome 段渲染一次（formatSessionTabs：短 label + 当前 ● +
    // 窄宽折叠；Ctrl+X/Alt+数字切换）。live 段的 renderSessionTabs 消费已移除——
    // 双栏同屏（两行不同来源的 tab）且 label 数据源曾是空壳病灶。
    // glance 段：状态行 + 错误行（metrics 已并入输入轨下方 footer，避免双份）。
    for (const line of renderGlancePanel(snapshot)) lines.push({ text: line })
    // todos 紧凑待办面板（/todos；保留快照跨 turn/start 黏滞，显隐门控在
    // renderTodosPanel 内）——放在 glance 之后、任务窗格之前：摘要卡是
    // 「一眼当前进度」的最高频消费面。
    for (const line of renderTodosPanel(snapshot)) lines.push({ text: line })
    // T4 + T2.3：任务窗格 + 后台任务区（/tasks 面板内；taskPanelVisible 门控
    // 在 renderTasksPanel 内，窗格行在前、后台任务区行在后）。
    for (const line of renderTasksPanel(snapshot)) lines.push({ text: line })
    // T1.2：/status 状态面板——goal/todos/plan 段在投影缓存缺失时折叠为 null
    // 由纯函数逐段降级（切换时已回显警告）；会话汇总段是 TUI 本地 fold
    // （summary-state），不依赖投影总线，总线缺失时仍有数据。
    if (this.statusPanelVisible) {
      for (const line of renderStatusPanel(snapshot)) lines.push({ text: line })
    }
    // T2.1：委派树面板（delegationEntries null 降级在 renderDelegationPanel 内）。
    for (const line of renderDelegationPanel(snapshot)) lines.push({ text: line })
    // T2.2：workflow 面板（列表行 + 终态汇总；cancelled 置灰由纯函数承担）。
    for (const line of renderWorkflowPanel(snapshot)) lines.push({ text: line })
    // T3.3：/skills 技能浏览面板。
    for (const line of renderSkillsPanel(snapshot)) lines.push({ text: line })
    // LSP：/lsp 诊断面板（本地语言服务；bridge 缓存折叠，纯展示）。
    for (const line of renderLspPanel(snapshot)) lines.push({ text: line })

    // P1：/btw 侧问面板——live 区顶部浮动段（glance 之后；不抢占输入焦点）。
    // loading 用 secondary 色、error 用 warning 色、done 不着色（答案原样）。
    const btwPeek = this.btw.peek()
    if (btwPeek !== null) {
      const btwColor = btwPeek.status === 'error'
        ? theme.warning
        : btwPeek.status === 'loading' ? theme.secondary : null
      for (const line of renderBtwPanel(btwPeek, { width: cols })) {
        lines.push({ text: btwColor === null ? line : color(line, btwColor) })
      }
    }

    // T2.3：任务完成通知（onTaskDone 一次性提示行；组合器副作用——渲染后
    // 清空，面板纯函数不承担可变状态）。
    if (snapshot.taskNotice !== null) {
      lines.push({ text: color(snapshot.taskNotice, theme.muted) })
      this.taskNotice = null
    }

    // Phase 9d 流利度：长静默/高负载的策略提示（stale 档：等待太久时给出
    // 分级提示，action 档明示 Ctrl+C；吞吐折叠不在此渲染，折叠由
    // format/tool-group 纯 fold 承担）
    const policy = this.fluency.getPolicy()
    if (policy.staleMessage !== undefined && policy.staleLevel !== undefined) {
      const staleColor = policy.staleLevel === 'action'
        ? theme.error
        : policy.staleLevel === 'warn' ? theme.warning : theme.secondary
      lines.push({ text: color(`⏳ ${policy.staleMessage}`, staleColor) })
    }

    // 推理展开视图（Ctrl+O 切换；scrollback append-only，全文在 live 区展示）：
    // - 流式进行中：shimmer 头行 + 推理全文（替代折叠态的尾 N 行）；
    // - 已落底块：静态头行 + 全文（scrollback 只留折叠头行，展开不重复落底）。
    if (this.reasoningExpanded) {
      if (this.reasoningText !== '') {
        const reasoningLines = formatReasoningLive({
          text: this.reasoningText,
          ...(this.reasoningStartedAt === null ? {} : { elapsedMs: Math.max(0, Date.now() - this.reasoningStartedAt) }),
          tick: this.tick,
          columns: cols,
          expanded: true,
        }, theme)
        for (const line of reasoningLines) lines.push({ text: line })
        lines.push({ text: color('— ctrl+o 收起', theme.dim) })
      } else if (this.lastReasoningBlock !== null) {
        const blockLines = formatReasoningBlock({
          text: this.lastReasoningBlock.text,
          ...(this.lastReasoningBlock.elapsedMs === undefined ? {} : { elapsedMs: this.lastReasoningBlock.elapsedMs }),
          expanded: true,
        }, theme)
        for (const line of blockLines) lines.push({ text: line })
        lines.push({ text: color('— ctrl+o 收起', theme.dim) })
      }
    }

    // 流式推理段（reasoning-delta 累积中）：shimmer 头行 + 尾 N 行暗色思考
    // ——渲染在流式文本尾巴上方（推理先于正文的事件序）。段结束由
    // handleStreamEvent 落底进 scrollback 并清缓冲，live 区随之消失。
    // 展开态已在上面渲染全文，此处跳过（避免上下双份）。
    if (this.reasoningText !== '' && !this.reasoningExpanded) {
      const reasoningLines = formatReasoningLive({
        text: this.reasoningText,
        ...(this.reasoningStartedAt === null ? {} : { elapsedMs: Math.max(0, Date.now() - this.reasoningStartedAt) }),
        tick: this.tick,
        columns: cols,
        compact: compactLive,
        maxRows: reasoningTailBudget(this.stdout.rows),
      }, theme)
      for (const line of reasoningLines) lines.push({ text: line })
    }

    // 流式尾巴：StreamRenderer pending + blockWriter 未吐缓冲（原始文本防围栏闪烁）。
    // 已 commit 的稳定块在 scrollback，不进 live 区——避免同段文字上下双份。
    for (const line of this.streamRenderer.getLiveTailLines(tightViewport ? 2 : 6, this.blockWriter.peek())) {
      lines.push({ text: line })
    }

    // 进行中的工具卡（无 result 的 tool/call）；标题优先 presentCall 意图
    //（tool/call 时解析缓存），缺省回落 toolArgSummary 启发式。
    // 只有最新一张展开末 3 行 tail（定高，防跳动）；其余仅标题。session 日志
    // 无工具 stdout 增量，故进行中卡在 tool/result 前只显示占位 …。
    const pendingTools = this.transcript?.view.tools.filter(t => t.result === undefined) ?? []
    const overflow = Math.max(0, pendingTools.length - LIVE_TOOL_CARD_MAX)
    const shownTools = overflow > 0 ? pendingTools.slice(-LIVE_TOOL_CARD_MAX) : pendingTools
    for (const [i, tool] of shownTools.entries()) {
      const args = parseToolArguments(tool.arguments)
      const titleOverride = this.pendingCallTitles.get(tool.callId)
      const latest = i === shownTools.length - 1
      // LSP 徽标：工具触碰的文件有诊断缓存时标题追加「⚠ N错 M警」
      // （诊断已就绪才显示；拉取中/无诊断不干扰标题）。
      const lspBadge = this.lspBadgeFor(args)
      const title = lspBadge === null
        ? (titleOverride ?? toolCardTitle(tool.name, args))
        : `${titleOverride ?? toolCardTitle(tool.name, args)} ${lspBadge}`
      const rows = formatToolCardLive({
        toolName: tool.name,
        ...(args === undefined ? {} : { toolInput: args }),
        title,
        columns: cols,
        elapsedMs: Math.max(0, Date.now() - tool.time),
        // A5：手动展开的进行中工具卡（空输入 Enter 切换）。
        expanded: this.expandedToolCallId === tool.callId,
        // oxlint-disable-next-line no-unnecessary-condition -- oxlint 类型面把 latest 误判为恒 false;entries() 循环里 i 取 0..len-1,latest 在末位为 true
        tailLines: compactLive ? 0 : latest ? (tightViewport ? 1 : 3) : 0,
        tick: this.tick,
        compact: compactLive,
      }, theme)
      for (const line of rows) lines.push({ text: line })
    }
    if (overflow > 0) {
      lines.push({ text: color(` …(+${overflow}) 个工具进行中`, theme.muted) })
    }

    // 统一活动带（CC 对标）：subagent/workflow/后台任务活跃项收敛为高度封顶
    // 固定带（计数头 + 每 item 1 行 + 最新 subagent ⎿ 子行 + 常驻入口尾行）；
    // 完成项已在 end 事件塌一行 commit 进 scrollback。逃生门 activityBand=false
    // 回退旧散行渲染（每 run 一行 spinner）。
    if (snapshot.activityBandEnabled) {
      for (const line of renderActivityBand(snapshot)) {
        lines.push({ text: line })
      }
    } else {
      for (const run of this.subagentRuns.values()) {
        for (const line of formatSubagentRunning({
          width: cols,
          label: run.label,
          tick: this.tick,
        }, theme)) {
          lines.push({ text: line })
        }
      }
    }

    // chrome 起点：提问/审批贴输入轨（列入 chrome，小窗口也不会被从顶裁掉），
    // 其后是 slash / vim / 图片 / 输入轨 / footer。溢出裁剪只作用在动态段；
    // slash 菜单行数另计入动态段高水位记账（见下方预算段），高度变化由垫高吸收。
    const chromeStart = lines.length

    // 提问 / 审批紧挨输入轨。
    const questionPeek = this.question.peek()
    if (questionPeek !== null) {
      for (const line of projectQuestionPanel(questionPeek.request, { width: cols })) {
        lines.push({ text: line })
      }
      if (questionPeek.feedbackMode) {
        lines.push({ text: color('📝 反馈输入中（Enter 提交 / Esc / Ctrl+C 返回选项）', theme.muted) })
      }
    }
    const approvalPeek = this.approval.peek()
    if (approvalPeek !== null) {
      const callId = approvalPeek.req.callId
      const toolCall = callId === undefined
        ? undefined
        : this.transcript?.view.tools.findLast(t => t.callId === callId)
      const diff = toolCall === undefined
        ? null
        : formatPermissionDiff({ toolName: toolCall.name, arguments: toolCall.arguments }, this.theme)
      for (const line of formatApprovalCard({
        columns: cols,
        toolName: approvalPeek.req.toolName,
        ...(approvalPeek.req.reason === undefined ? {} : { reason: approvalPeek.req.reason }),
        diffLines: diff,
        compact: compactLive,
      }, theme)) {
        lines.push({ text: line })
      }
    }

    // slash 命令菜单（grok slash_dropdown 移植）：输入以 / 开头且有匹配时
    // 在输入行上方渲染可滚动命令列表；无匹配时退回一行内联提示（旧行为）。
    // 菜单/hint 行是可变高度 chrome 行：行数随行内过滤实时变化，其 display
    // rows（slashRows）计入下方动态段高水位记账，由垫高吸收高度差，输入框
    // 不随菜单开合/过滤上下漂移（首次打开落定一次，见动态段预算注释）。
    const inputValue = this.inputLine.value
    const slashLines: string[] = []
    if (this.inputController.slashMenu.open) {
      for (const line of formatSlashMenu({
        width: cols,
        items: this.inputController.slashMenu.matches,
        selected: this.inputController.slashMenu.selected,
      }, theme)) {
        slashLines.push(line)
      }
    } else {
      const hint = this.slash.hint(inputValue)
      if (hint !== null) slashLines.push(hint)
    }
    for (const line of slashLines) lines.push({ text: line })

    // 输入行；vim 模式标签（Phase 6.5：normal/visual 态可见，insert 态隐藏）
    if (this.vimEnabled && this.inputLine.vimMode !== 'insert') {
      const modeLabel = this.inputLine.vimMode === 'visual'
        ? (this.inputLine.visualLineWise ? '-- VISUAL LINE --' : '-- VISUAL --')
        : '-- NORMAL --'
      lines.push({ text: color(modeLabel, theme.secondary) })
    }
    // 图片附件：最后一张的半块缩略图 + 📎 N 计数行，显示在输入行上方。
    // 缩略图是纯文本 ANSI 行，随 live 区重绘天然擦除（无图形协议残影问题）；
    // 计数行 dim 色弱化不干扰输入。
    const currentImages = this.inputLine.images
    const lastAttached = currentImages[currentImages.length - 1]
    if (this.attachmentPreview !== null && lastAttached === this.attachmentPreview.dataUrl) {
      for (const line of this.attachmentPreview.lines) lines.push({ text: line })
    }
    for (const summary of this.inputLine.imageSummary(cols)) {
      lines.push({ text: color(summary, theme.muted) })
    }
    // 运行中排队行（对标 CC：待发消息显示在输入上方；↑ 取回队首）。
    if (this.submitQueue.size() > 0) {
      lines.push({ text: formatQueueLine(cols, this.submitQueue.peekAll()) })
    }
    // 阶段 2：slash 菜单选中命令 → 输入行 ghost 预览（补全剩余/参数占位）。
    this.inputLine.setGhost(this.slashGhostText())
    // Ctrl+C 连按退出窗口激活中：输入轨上方渲染提示行（窗口由定时器复位）。
    if (this.inputController.ctrlCPendingSince !== 0) {
      lines.push({ text: color('再按 Ctrl+C 退出进程 · Ctrl+Q 立即退出', theme.muted) })
    }
    // CC PromptInput marginTop={1}：轨前 1 行呼吸，不填视口。
    lines.push({ text: '' })
    // 输入轨（Claude Code 形态）：上下圆角横线、左右不封。顶轨嵌 omp 风格
    // 段式状态栏（左模型/effort、右 metrics），边框色随模式（plan warning /
    // auto error / normal 雾蓝）。caret 行 +1、列不修正。
    const planProj = this.projectionCache?.plan as PlanProjectionWire | undefined
    const modeFlags = {
      planActive: planProj?.active === true,
      planPending: planProj?.pending === true,
      alwaysApprove: this.approval.alwaysApprove,
    }
    const modeColor = modeFlags.planPending || modeFlags.planActive
      ? theme.warning
      : modeFlags.alwaysApprove ? theme.error : theme.secondary
    const promptColor = this.liveAgent?.state.status === 'running' ? theme.dim : modeColor
    const inputView = this.inputLine.displayLinesWithCaret({
      maxWidth: cols,
      maxLines: inputViewportMaxLines(this.stdout.rows),
    })
    const framedLines = inputView.lines.map(line => (
      line.startsWith('❯ ') ? `${color('❯', promptColor)}${line.slice(1)}` : line
    ))
    // 状态栏段：左身份（model/effort）、右 metrics（缓存/上下文/token/API）——
    // 复用 glanceBarSegments 的顺序（model、effort 在前），按段数切分。
    // 输入区信息密度（/info）：compact 保留身份段与 API/git、隐 metrics；
    // off 整条顶栏与 footer 都不渲染，动态区多让出两行。
    const infoLevel = this.prefs.footerInfo ?? 'full'
    const bottomMetrics = this.glanceMetrics()
    const allSegs = bottomMetrics === null ? [] : glanceBarSegments({ ...bottomMetrics, width: cols })
    const leftCount = Math.min(
      (bottomMetrics?.modelName !== undefined ? 1 : 0) + (bottomMetrics?.effort != null ? 1 : 0),
      allSegs.length,
    )
    // 禅相位徽章：zen/phase 日志折叠（官方 foldZenPhase），布防中显示、晋升后消失。
    const zenBadge = this.activeSessionId === null
      ? undefined
      : zenPhaseLabel(getSession(this.ctx, this.activeSessionId)?.events)
    const topLine = infoLevel === 'off'
      ? undefined
      : formatTopStatusBar({
        width: cols,
        left: [...allSegs.slice(0, leftCount), ...(zenBadge === undefined ? [] : [zenBadge])],
        // A3：git 未提交 ●N 段置于右段末尾（丢段从右丢 → ●N 最次要先丢，不挤 metrics）。
        // compact 档 metrics 段整体摘除，右段只剩 API/git 身份信息。
        right: [
          ...(infoLevel === 'compact' ? [] : allSegs.slice(leftCount)),
          `API ${this.apiKeyReady ? '✓' : '✗'}`,
          ...(this.gitDirty > 0 ? [`●${this.gitDirty}`] : []),
        ],
        borderColor: promptBorderColor(modeFlags, theme),
      }, theme)
    const frame = formatInputFrame({
      columns: cols,
      lines: framedLines,
      caretLine: inputView.caret.line,
      caretCol: inputView.caret.col,
      // off 档不传 topLine（exactOptionalPropertyTypes 下显式 undefined 不合法）。
      ...(topLine === undefined ? {} : { topLine }),
      ...modeFlags,
    }, theme)
    for (const [i, line] of frame.lines.entries()) {
      lines.push(i === frame.caretLine ? { text: line, caretCol: frame.caretCol } : { text: line })
    }

    // C4：footer 一行——左模式/快捷键（metrics 已上移输入框顶边状态栏，不再右挂）。
    // info off 档整行不渲染（与顶栏一起关，动态区让行数）。
    if (infoLevel !== 'off') {
      const footerLines = formatPromptFooter({
        width: cols,
        ...modeFlags,
        approvalPending: this.approval.isPending,
        agentBusy: this.isAgentBusy(),
        newlineMode: this.inputLine.newlineMode,
      }, theme)
      for (const line of footerLines) lines.push({ text: line })
    }

    if (gutter > 0) {
      const pad = ' '.repeat(gutter)
      for (const line of lines) {
        line.text = `${pad}${line.text}`
        if (line.caretCol !== undefined) line.caretCol += gutter
      }
    }

    const rowsForLine = (text: string): number => this.displayRowsFor(text)
    let chromeRows = 0
    for (let i = chromeStart; i < lines.length; i++) {
      const row = lines[i]
      if (row === undefined) continue
      chromeRows += rowsForLine(row.text)
    }
    let dynamicRows = 0
    for (let i = 0; i < chromeStart; i++) {
      const row = lines[i]
      if (row === undefined) continue
      dynamicRows += rowsForLine(row.text)
    }
    let slashRows = 0
    for (const line of slashLines) slashRows += rowsForLine(line)
    // 定高视口：动态段按高水位垫到恰好 budget，live region 只涨不缩 →
    // 输入框钉住、回缩黑洞与旧轨线重影一并消除。欢迎首帧（无消息且非运行、
    // 未开过 slash 菜单）不垫，但仍按 Working 封顶从顶裁，避免活动带把
    // 审批卡/输入轨挤出 24 行视口。
    // slash 菜单/hint 虽在 chrome 段（小窗不被裁剪），其行数计入被跟踪总量：
    // ceiling 已含 chromeRows（含 slashRows），传 ceiling + slashRows 使上限与
    // 菜单高度无关 → 菜单开合/过滤只改垫高行数，输入框行位恒定。首次打开时
    // 高水位尚无余量，输入框向下落定一次；此后（含关闭）由垫高吸收，不再漂移。
    const terminalRows = this.stdout.rows || 24
    this.live.setMaxRows(liveMaxRowsFor(terminalRows))
    const raw = terminalRows - chromeRows - 2
    const ceiling = Math.max(0, Math.min(raw, workingRowsCap(terminalRows, chromeRows)))
    const skipPad = (this.transcript?.view.messages ?? []).length === 0
      && this.liveAgent?.state.status !== 'running'
      && slashRows === 0
      && this.dynamicRowsHighWater === 0
    const next = nextDynamicBudget(
      this.dynamicRowsHighWater,
      dynamicRows + slashRows,
      ceiling + slashRows,
      skipPad,
      this.reasoningExpanded,
    )
    this.dynamicRowsHighWater = next.highWater
    const padded = padDynamicRegion(
      lines,
      chromeStart,
      Math.max(0, next.budget - slashRows),
      rowsForLine,
      { pad: !skipPad },
    )
    const chromeTail = padded.lines.length - padded.chromeStart
    this.live.render(padded.lines, chromeTail > 0 ? { reservedTail: chromeTail } : undefined)
    this.perfMonitor.record('renderLive', performance.now() - renderStart)
  }

  /**
   * 卸载当前会话的投影与控制面，并按 opts 处理本层持有的 handle：
   * - keepHandle（P3 side conversation 切换）：所有权让渡 registry——agent
   *   保持 live（可切回复用），退出时由 agent-loop factory 统一 teardown；
   *   本层卸掉 modelRef 与 selection 监听，切回时再装。
   * - 缺省（dispose 退出）：释放本层 handle（create/resume 铸造的）。
   * registry 兜底的裸 agent 非自有，两种情况都不 dispose。会话本身所有权归
   * 持有方，不销毁。
   * @param opts - keepHandle：切换保留模式（默认释放）。
   */
  private async detachProjections(opts?: { keepHandle?: boolean }): Promise<void> {
    this.transcript?.dispose()
    this.liveAgent?.dispose()
    this.statusLine?.dispose()
    this.streamFeed?.()
    this.streamFeed = null
    // T1.1/T4：投影订阅随会话卸载释放，缓存与显隐复位（整体降级回默认态）。
    this.projectionDisposer?.()
    this.projectionDisposer = null
    // T2.1/T2.2：subagent/workflow 事件订阅同样随会话卸载释放（否则每次挂载泄漏）。
    this.subagentDisposer?.()
    this.subagentDisposer = null
    this.workflowDisposer?.()
    this.workflowDisposer = null
    // T2.3：tasks onTaskDone 订阅随会话卸载释放（注释语义『随会话挂载/卸载』；
    // 否则单次挂载后 dispose/切会话时订阅残留，回调闭包持有 App 无法回收。
    // mountSession 末尾的预释放只覆盖重挂载路径，不覆盖最后一次挂载）。
    this.taskDoneDisposer?.()
    this.taskDoneDisposer = null
    this.taskSnapshots = []
    this.taskNotice = null
    // glance 数据（usage/effort/contextWindow）随会话卸载复位——新会话重挂载重折叠。
    this.usageFold = null
    this.sessionCosts.clear()
    this.glanceEffort = null
    this.contextWindow = null
    this.projectionCache = null
    this.taskItems = null
    this.todosRetained = null
    this.planState = { active: false, pending: false }
    this.modelSelectionDisposer?.()
    this.modelSelectionDisposer = null
    this.modelRef = null
    // C3 项 4：always-approve 是会话级本地态——切会话/退出时复位，
    // 防止残留到新会话（planState 同上复位；徽章由 statusLine 重建）。
    this.approval.setAlwaysApprove(false)
    // Phase 8：卸载会话时清挂起审批——否则旧审批仍可被 y/N 结算且阻塞
    // 新会话请求（跨会话残留 bug；fail-closed 结算为 cancelled）。
    if (this.approval.isPending) this.approval.settle('cancelled')
    // T3.1：卸载会话时清挂起提问——否则会话 A 的 plan-review 卡残留在会话
    // B 仍渲染，B 的按键决定 A 的 ask promise（跨会话残留 bug；与 approval
    // settle('cancelled') 对称，cancel 按 provider 契约 reject ASK_CANCELLED）。
    if (this.question.isPending) this.question.cancel()
    this.taskPanelVisible = false
    this.statusPanelVisible = false
    this.todosPanelVisible = false
    this.todosExpanded = false
    // 切会话/退出共用：旧会话的流式残文不得带进下一段输出
    this.blockWriter.discard()
    this.streamRenderer.reset()
    if (this.ownedHandle !== null) {
      if (opts?.keepHandle === true) {
        // P3：切换保留——让渡 registry（agent 保持 live；退出时 factory 统一清理）。
        this.ownedHandle = null
      } else {
        const handle = this.ownedHandle
        this.ownedHandle = null
        await handle.dispose()
      }
    }
    this.transcript = null
    this.liveAgent = null
    this.statusLine = null
    this.controls = null
  }

  /**
   * 退出：先 flush 所有 live 会话到持久层（退出恢复 checkpoint）、停止 ticker、
   * 卸载投影、恢复终端 raw-mode。
   * @returns 全部 flush 完成后 resolve。
   */
  async dispose(): Promise<void> {
    this.lifetimeAbort.abort()
    if (this.disposed) return
    this.welcomeIntro?.cancel()
    this.autoKeyDialogPending = false
    this.welcomePreparing = false
    this.welcomeScrollbackBarrier = false
    this.pendingWelcomeSettleReason = null
    this.pendingWelcomeActions = []
    this.pendingWelcomeHadInput = false
    this.disposed = true
    if (this.ctrlCExitHintTimer !== null) { clearTimeout(this.ctrlCExitHintTimer); this.ctrlCExitHintTimer = null }
    if (this.ticker !== null) { clearInterval(this.ticker); this.ticker = null }
    // 先 flush 再释放本层持有的 handle：flushAll 依赖 live store 未拆，
    // 而 dispose owned handle 会卸载投影/释放 agent，先拆会让 flush 无物可刷。
    try { await flushAll(this.ctx) } catch { /* flush 失败不阻塞退出 */ }
    // Phase 8：解绑 answerer；未决审批 settle 为 cancelled（fail-closed 语义；
    // detachProjections 已清挂起，此处幂等兜底）
    this.approvalDisposer?.()
    this.approvalDisposer = null
    if (this.approval.isPending) this.approval.settle('cancelled')
    // T3.1：释放 userInteraction provider 注册（否则服务侧再次 registerProvider
    // 抛 DUPLICATE_PROVIDER）；挂起提问 reject ASK_CANCELLED（detachProjections
    // 已清挂起，此处幂等兜底）。
    this.interactionDisposer?.()
    this.interactionDisposer = null
    if (this.question.isPending) this.question.cancel()
    await this.detachProjections()
    // P1：/btw 侧问收尾——未决侧问直接销毁 btw agent（done 态答案未折叠则
    // 丢弃，退出即弃；订阅随 teardown 释放，防 dispose 后事件回调泄漏）。
    this.btw.dispose()
    // LSP：诊断桥销毁（kill 全部语言 server、清缓存与回调；幂等）。
    this.lspBridge?.dispose()
    this.lspBridge = null
    // T2.3：tasks attachSurface('tui') 控制面随 dispose 释放（注释语义『attach
    // 声明、dispose 释放』；切会话场景由 mountSession 预释放兜底，此处覆盖
    // 最后一次挂载后直接退出的路径）。
    this.taskSurfaceDisposer?.()
    this.taskSurfaceDisposer = null
    // overlay 若仍在 alt screen，先退回主屏（1049l），否则进程退出后部分
    // 终端会把用户留在备用屏。
    this.overlay?.deactivate()
    this.stdout.write(ANSI.BRACKETED_PASTE_OFF)
    this.stdout.write(ANSI.KITTY_KEYBOARD_OFF)
    this.pasteDisposer?.()
    this.pasteDisposer = null
    this.intentBridgeDisposer?.()
    this.intentBridgeDisposer = null
    this.input.dispose()
    this.resize.dispose()
    this.glance.dispose()
    this.perfMonitor.stop()
    this.live.clear()
    // live.clear / 每帧渲染都会 HIDE_CURSOR；必须在全部写屏之后恢复，
    // 否则 Ctrl+Q / /exit 把 TTY 还给 shell 时硬件光标仍隐藏（#22）。
    this.stdout.write(ANSI.SHOW_CURSOR)
  }

  /**
   * 刷新会话列表（供外部面板查询；本 MVP 的会话面板直接读 store）。
   * @returns 全部会话的摘要列表。
   */
  async refreshSessions(): Promise<SessionSummary[]> {
    return listSessions(this.ctx)
  }
}
