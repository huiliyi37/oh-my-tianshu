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
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReadStream, WriteStream } from 'node:tty'
import type { Context } from '@huiliyi37/cordis'
import { SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import type { CallId, TokenUsage } from '@huiliyi37/dsh-llm'
import { installModelSelection, type Agent, type AgentHandle, type ModelSelection, type ModelSelectionRef } from '@huiliyi37/dsh-agent'
// 空类型导入引入 Context 上 agentDefaultModel 服务的声明合并（headless 同款）。
import type {} from '@huiliyi37/dsh-agent-default-model'
import { CommitEngine } from '../engine/commit-engine.js'
import { ANSI, color, imageProtocol, osc52Clipboard } from '../engine/ansi.js'
import { LiveEngine, LIVE_TOOL_CARD_MAX, liveMaxRowsFor, nextDynamicBudget, padDynamicRegion, type LiveRegionLine } from '../engine/live-engine.js'
import { WriteBatcher } from '../engine/write-batcher.js'
import { InputHandler, type KeyPress, type KeyName } from '../engine/input-handler.js'
import { InputLine } from '../engine/input-line.js'
import { InputController, type SlashHintEntry } from '../engine/input-controller.js'
import { ResizeHandler } from '../engine/resize-handler.js'
import { BlockStreamWriter } from '../block-stream-writer.js'
import { StreamRenderer } from '../engine/stream-renderer.js'
import { TuiPerfMonitor, isTuiPerfEnabled } from '../engine/perf-monitor.js'
import { loadImageAttachment, looksLikeImagePath, MAX_IMAGES } from '../engine/image-attach.js'
import { readImageFromClipboard, readTextFromClipboard, FOCUS_DEBOUNCE_MS } from '../engine/clipboard-image.js'
import {
  encodeTermImage,
  parseImageDataUrl,
  prepareTermImageForCommit,
  type PreparedTermImage,
} from '../engine/term-image.js'
import { createTranscript, type Transcript, type TranscriptToolCall } from '../adapter/transcript.js'
import { resolveToolViews, type ToolPresenterSource } from '../adapter/tool-view.js'
import { trackAgent, type LiveAgent } from '../adapter/live.js'
import { controlsFromHandle, controlsFromRegistry, type AgentControls } from '../adapter/send.js'
import { listSessions, flushAll, getSession, type SessionSummary } from '../adapter/sessions.js'
import { supportsOsc52 } from '../term-caps.js'
import { getTheme, getActiveThemeName, setTheme, type RivetTheme } from '../theme.js'
import { displayWidth, ambiguousWideEnabled } from '../width.js'
import { detectTerminalBackground, autoThemeFor } from '../theme-detect.js'
import { formatUserMessage } from '../format/user-message.js'
import { formatSteerMessage } from '../format/steer-message.js'
import { formatToolCardLive, toolCardTitle } from '../format/tool-card.js'
import { lspBadgeText } from '../format/lsp-diagnostics.js'
import { formatToolViewCard } from '../format/tool-view-card.js'
import { formatReasoningBlock, formatReasoningLive, reasoningTailBudget } from '../format/reasoning.js'
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
  DelegationTreeEntry,
  DelegationIdentityProjection,
  DelegationTimingProjection,
} from '../delegation-panel.js'
import type { WorkflowRunView, WorkflowResultInfoInput } from '../workflow-panel.js'
import {
  projectQuestionPanel,
} from '../question-panel.js'
import type { ConfigPanelProjection } from '../config-panel.js'
import type { SkillSummaryInput } from '../skill-panel.js'
/** Wave 2：renderLive 7 面板纯函数 + 单帧快照类型（app.ts → render/ 单向依赖）。 */
import {
  renderGlancePanel,
  renderTasksPanel,
  renderStatusPanel,
  renderDelegationPanel,
  renderWorkflowPanel,
  renderConfigPanel,
  renderSkillsPanel,
  renderSessionTabs,
  renderLspPanel,
} from '../render/live-panels.js'
import type { LiveSnapshot } from '../render/live-snapshot.js'
/** T1.1：5 域投影 key（与 sessionProjections 注册表的 wire key 对齐）。 */
type ProjectionKey = 'todos' | 'plan' | 'goal' | 'subagent' | 'subagentTiming'

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

/** T2.2：workflow/start|phase|agent-start|agent-end|end 事件 payload 的最小 wire 形状。 */
interface WorkflowRunInfoWire {
  readonly id: string
}
interface WorkflowAgentWire {
  readonly seq: number
  readonly label: string
  readonly phase?: string
}
interface WorkflowAgentEndWire extends WorkflowAgentWire {
  readonly outcome: 'completed' | 'failed' | 'cancelled'
}
interface WorkflowResultWire {
  readonly stopReason: string
  readonly error?: string
}

/** T2.2：运行中 workflow 缓存项（key = payload.id；随 start 建、end 移除）。 */
interface WorkflowRunState {
  readonly id: string
  /** 最近一次 workflow/phase 标题；无 phase 事件时为 null。 */
  phase: string | null
  /** 已建立的 agent() 调用（agent-start 追加，agent-end 标记 outcome）。 */
  agents: { seq: number; label: string; outcome?: 'completed' | 'failed' | 'cancelled' }[]
}
import { WorkflowStatusLine } from '../statusline.js'
import {
  BUILTIN_COMMAND_NAMES,
  SlashCommandRegistry,
  createBuiltinCommands,
  resolveSlashCommand,
} from '../commands/registry.js'
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
import { formatSessionAge } from '../restore-session.js'
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

/** Phase 8：审批 answerer 的请求/结果类型由 ApprovalController 持有（单向依赖）。 */
import {
  ApprovalController,
  type PendingApprovalRequest,
  type ApprovalOutcome,
} from '../controllers/approval-controller.js'
import { QuestionController } from '../controllers/question-controller.js'
import { BtwController } from '../controllers/btw-controller.js'
import { SessionManager } from '../controllers/session-manager.js'
import { renderBtwPanel } from '../format/btw-panel.js'
import { CHROME_GUTTER, formatWelcomeCard, formatWelcomeHero, pickWelcomeTip, type WelcomeEnvCheck, type WelcomeTipItem } from '../format/welcome.js'
import { formatWhaleLogo, WHALE_MIN_ROWS } from '../format/whale.js'
import { formatTopBar } from '../format/top-bar.js'
import { formatTurnStatus } from '../format/turn-status.js'
import { formatPromptFooter } from '../format/prompt-footer.js'
import { formatInputFrame, promptBorderColor } from '../format/input-frame.js'
import { formatTopStatusBar } from '../format/top-status-bar.js'
import { formatSlashMenu, SLASH_MENU_MAX_ROWS } from '../format/slash-menu.js'
import { formatSubagentRunning, formatSubagentDone } from '../format/subagent-line.js'
import { glanceBarSegments } from '../format/glance-bar.js'
import { MemoryBrowserOverlay } from '../format/memory-overlay.js'

/**
 * A1：CommandService 的最小消费面（不引入 dsh-commands 依赖）。
 * execute 的返回形状对齐 CommandExecution：undefined = 命令未知名。
 */
interface CommandServiceFacet {
  execute(
    agent: unknown,
    line: string,
    signal: AbortSignal,
  ): Promise<{ result: { kind: 'success' | 'error'; text?: string } } | undefined>
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

/** llm.resolveModelInfo 最小面（识图能力取 inputModalities，不引入 dsh-llm peer）。 */
interface LlmModelInfoFacet {
  resolveModelInfo(provider: string, model: string): Promise<{ inputModalities?: readonly string[] }>
}

/** TuiApp 构造选项。 */
export interface TuiAppOptions {
  ctx: Context
  stdout: WriteStream
  stdin: ReadStream
  /** 启动时切入的会话 id；缺省优先恢复最近会话（live store 为空才新建）。 */
  initialSessionId?: SessionId
  /** 主题名；'auto' 走系统终端配色探测，缺省 'auto'。 */
  theme?: string
  /** 输入行为空时 Ctrl+C 的退出回调（raw-mode 下 Ctrl+C 是数据字节非 SIGINT）。 */
  onExit?: () => void
  /** 外部编辑器触发键（KeyName）；缺省 'ctrl_e'（ctrl+o 已恢复为推理展开，Phase 6.4）。 */
  editorKey?: KeyName
  /** 外部编辑器命令；缺省 $VISUAL/$EDITOR/平台缺省（测试注入点）。 */
  editorCommand?: string
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
}

/** live 区预留行（顶轨 + 输入 + 底轨 + footer）。 */
const LIVE_RESERVED_ROWS = 4

/** A3：`oh-my-tianshu tui --help` 输出的用法文本（port of dsh-tianshu-tui#21）。 */
const USAGE_TEXT = `oh-my-tianshu tui — oh-my-tianshu 交互式终端界面 / interactive terminal UI

用法 / Usage:
  oh-my-tianshu tui                   启动交互式 TUI / start the interactive TUI
  oh-my-tianshu tui "<提示词>"        启动并直接发送提示词 / start and send a prompt
  oh-my-tianshu tui --help            显示本帮助 / show this help
  oh-my-tianshu tui --version         输出版本 / print the version

快捷键 / Keys: ctrl+n 新会话 · ctrl+s 恢复 · ctrl+p 命令面板 · / slash 命令 · ctrl+o 展开推理 · shift+tab 模式循环
`

/** 读取 tui 包自身版本（packages/tui/tui/package.json），供 --version 输出。 */
function readOwnVersion(anchorUrl: string): string | undefined {
  try {
    const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', anchorUrl)), 'utf8')) as { version?: unknown }
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

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

/** 检测当前目录是否为 git 仓库（静默，失败返回 false）。 */
function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe', encoding: 'utf-8' })
    return true
  } catch {
    return false
  }
}

/**
 * 读取当前 git 分支（C4 概念稿 A top bar；attach 时一次，静默）。
 * detached HEAD 或非仓库返回 undefined（不渲染分支段）。
 */
function gitBranch(): string | undefined {
  try {
    const out = execSync('git rev-parse --abbrev-ref HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim()
    return out === '' || out === 'HEAD' ? undefined : out
  } catch {
    return undefined
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
function readDistributionVersion(): string | undefined {
  const start = fileURLToPath(new URL('.', import.meta.url))
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
  /** C3 项 3：rewind overlay（/rewind 双阶段回退面板）。 */
  private rewindOverlay: RewindOverlay | null = null
  /** P2：memory 浏览器 overlay（/memory 记忆列表/过滤/删除）。 */
  private memoryOverlay: MemoryBrowserOverlay | null = null
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
  /** 当前模型路由的上下文窗口（request/context 事件折叠；adapter 未报时 null）。 */
  private contextWindow: number | null = null


  private transcript: Transcript | null = null
  private liveAgent: LiveAgent | null = null
  private controls: AgentControls | null = null
  /** 工作流阶段/活动投影（Phase 5.1/6.2）；随会话挂载/卸载，dispose 时解绑订阅。 */
  private statusLine: WorkflowStatusLine | null = null
  /** 流式提交供给的 session/event 订阅；随会话挂载/卸载。 */
  private streamFeed: (() => void) | null = null
  /** 本层经 create/resume 铸造的 handle；非 registry 兜底的裸 agent。dispose 时释放。 */
  private ownedHandle: AgentHandle | null = null
  private readonly initialSessionId: SessionId | undefined
  private readonly themeName: string
  private readonly onExit: (() => void) | undefined
  /** 外部编辑器触发键（Phase 6.4）；缺省 ctrl_e（ctrl+o 已恢复为推理展开）。 */
  private readonly editorKey: KeyName
  /** 外部编辑器命令注入（测试用）；缺省走环境变量/平台缺省。 */
  private readonly editorCommand: string | undefined
  private readonly vimEnabled: boolean
  /** T1.1：5 域投影缓存（snapshot 全量 + onChanged 按 key 分流；服务缺失时为 null → 整体降级）。 */
  private projectionCache: Partial<Record<ProjectionKey, unknown>> | null = null
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
  /** 对话流 subagent 运行态（runId → 标签/开始时间；end 时结算并提交 scrollback）。 */
  private subagentRuns = new Map<string, { label: string; startedAt: number }>()
  /** T2.2：运行中 workflow 缓存（key = payload.id；start 建、end 移除）。 */
  private readonly workflowRuns = new Map<string, WorkflowRunState>()
  /** T2.2：已结算 run 视图缓存（workflow/end 折叠；/workflow 面板渲染运行中+已完成）。 */
  private readonly completedWorkflowRuns = new Map<string, WorkflowRunView>()
  /** T2.3：后台任务同步快照（tasks.list() 每次事件/会话挂载刷新）。 */
  private taskSnapshots: TaskSnapshotView[] = []
  /** T2.3：onTaskDone 完成通知（live 区提示行；一次性，渲染后清空）。 */
  private taskNotice: string | null = null
  /** T3.2：/config 设置面板显隐（/config 切换）。 */
  private configPanelVisible = false
  /** T3.2：/config 面板投影缓存（settings describe + permission + credentials；null = 服务缺失）。 */
  private configProjection: ConfigPanelProjection | null = null
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
  /** C2 项 4：当前会话的模型选择 ref（newSession/switchSession 挂载；registry 兜底为 null）。 */
  private modelRef: ModelSelectionRef | null = null
  /** C2 项 2：历史搜索 overlay（Ctrl+F；attach 时注册，消息快照激活时提供）。 */
  private searchOverlay: HistorySearchOverlay | null = null
  /** T1.2：/status 面板显隐（/status 切换；数据源为投影缓存）。 */
  private statusPanelVisible = false
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
  /** T4：任务投影变更订阅 disposer；随会话卸载释放。 */
  private projectionDisposer: (() => void) | null = null
  /** T5：紧凑渲染模式（/density 切换）——工具卡仅标题行。 */
  private compactMode = false
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
  private history: string[] = []
  private tick = 0
  private ticker: ReturnType<typeof setInterval> | null = null
  private disposed = false
  /** OSC52 不支持警告：每进程首次触发时提示一次（P1-1；newSession 不重置，避免重复打扰）。 */
  private osc52WarningShown = false
  /** bracketed paste 处理器 disposer（attach 注册，dispose 释放）。 */
  private pasteDisposer: (() => void) | null = null
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
    this.initialSessionId = options.initialSessionId
    this.themeName = options.theme ?? 'auto'
    this.onExit = options.onExit
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
    this.commit = new CommitEngine({ stdout: options.stdout })
    this.live = new LiveEngine({
      stdout: options.stdout,
      reservedRows: LIVE_RESERVED_ROWS,
      maxRows: liveMaxRowsFor(options.stdout.rows),
    })
    this.input = new InputHandler({ stdin: options.stdin, mode: 'input' })
    this.inputLine = new InputLine({
      history: this.history,
      vimEnabled: this.vimEnabled,
      onSubmit: (text, images) => { this.handleSubmit(text, images) },
      onTabComplete: () => this.handleTabComplete(),
      // slash 菜单状态随输入变化刷新（键入/粘贴/外部 setValue 统一入口；
      // 渲染由各调用路径 flushLiveRender 承担，此处不触发重绘）。
      onChange: (value) => { this.inputController.refreshSlash(value) },
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
        // scrollback），随后重绘 live 区。
        this.commitToScrollback({ text: ansi, trailingNewline: true })
        this.renderBatcher.schedule()
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
      switchSession: id => this.switchSession(SessionId(id)),
      exportTranscript: path => this.exportTranscript(path),
      requestExit: () => { this.onExit?.() },
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
      isBlankSession: () => {
        const view = this.transcript?.view
        return (view?.messages ?? []).length === 0
          && (view?.tools ?? []).every(t => t.result !== undefined)
      },
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
    // T3.2：/config 设置面板显隐切换（数据源为 settings/permission/credentials 投影；
    // 切换时刷新投影——部分服务缺失时对应段显示占位；三者全缺时面板无数据，回显警告）。
    this.slash.register({
      name: 'config',
      description: '切换设置面板（settings/permission/credentials）',
      run: async () => {
        this.configPanelVisible = !this.configPanelVisible
        if (this.configPanelVisible) {
          await this.refreshConfigProjection()
          if (this.configProjection === null) {
            this.echoWarn('⚠ settings/permission/credentials 服务均不可用，设置面板无数据')
          }
        }
        this.renderBatcher.schedule()
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
    this.inputController.slashCommands = this.slash.list().map(toSlashHint)
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

  /** 当前会话 id（null = 尚未 attach）。 */
  get sessionId(): SessionId | null { return this.activeSessionId }

  /**
   * 接管终端：切主题（'auto' 探测背景）、装配会话、注册键路由与 resize、启动渲染 ticker。
   * @param initialSessionId - 覆盖构造选项的起始会话；缺省用构造 initialSessionId，
   *   再缺省恢复最近会话（live store 为空才新建）。
   */
  async attach(initialSessionId?: SessionId): Promise<void> {
    if (this.disposed) throw new Error('TuiApp already disposed')
    // A3：处理 launcher 转发的命令行参数（`oh-my-tianshu tui <args>`）：
    // --help/-h 输出用法、--version/-v 输出版本后经 appExit 退出；纯位置参数
    // 作为初始 prompt（attach 完成后发送）。含其它 flag 时不发 prompt（避免
    // 与 --resume 等未实现参数的组合语义冲突）。port of dsh-tianshu-tui#21。
    const cmdline = this.ctx.reflect.get('cmdlineArgs', false) as { get(): string[] } | undefined
    const args = cmdline?.get() ?? []
    const flags = args.filter(a => a.startsWith('-'))
    const wantHelp = flags.includes('--help') || flags.includes('-h')
    const wantVersion = flags.includes('--version') || flags.includes('-v')
    const initialPrompt = flags.length === 0 ? args.filter(a => !a.startsWith('-')).join(' ') : ''
    if (wantHelp || wantVersion) {
      const exit = this.ctx.reflect.get('appExit', false) as ((code?: number) => void) | undefined
      this.stdout.write(wantHelp
        ? USAGE_TEXT
        : `oh-my-tianshu tui ${readOwnVersion(fileURLToPath(new URL('.', import.meta.url))) ?? 'unknown'}\n`)
      if (exit !== undefined) { exit(0); return }
      // 无 appExit（测试/裸装配）：保持 fail loud，由调用方 dispose 收尾。
      throw new Error('[tui-runner] --help/--version requested but no appExit service provided')
    }
    // bracketed paste：粘贴的多行文本被终端包裹为整段（行尾 CR 不再逐行触发
    // Enter 提交）；onPaste 处理器把整段插入输入行（超阈值折叠为标记）。
    this.stdout.write(ANSI.BRACKETED_PASTE_ON)
    this.pasteDisposer?.()
    this.pasteDisposer = this.input.onPaste((text) => { void this.handlePaste(text) })
    // 目标 6：'auto' 才走系统终端配色探测（OSC 11 → dark/light）；显式主题直接生效。
    if (this.themeName === 'auto') {
      const background = await detectTerminalBackground()
      /* v8 ignore next -- autoThemeFor 恒返回有效主题名，setTheme 恒 true，graphite 兜底不可达 */
      if (!setTheme(autoThemeFor(background))) setTheme('graphite')
    } else {
      setTheme(this.themeName)
    }

    const target = initialSessionId ?? this.initialSessionId ?? this.ctx.sessions.list()[0]?.id
    if (target !== undefined) await this.switchSession(target)
    else await this.newSession()

    // Phase 9b：会话恢复面板——启动时把可恢复会话列表写进 scrollback
    // （当前会话除外；无其他可恢复会话时静默）。live 标注取 live store。
    await this.renderRestorableSessions()

    this.resize.onResize(() => {
      this.live.setMaxRows(liveMaxRowsFor(this.stdout.rows))
      this.flushLiveRender()
    })
    this.input.onAnyKey((key) => { this.handleKey(key) })
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
      onOverlayChange: () => { this.renderBatcher.schedule() },
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
    this.rewindOverlay = new RewindOverlay()
    this.overlay.register('rewind', this.rewindOverlay)
    // P2：memory 浏览器 overlay（/memory）——条目快照 + 数据源在激活时注入。
    this.memoryOverlay = new MemoryBrowserOverlay()
    this.overlay.register('memory', this.memoryOverlay)
    this.input.setMode('input')
    this.ticker = setInterval(() => { this.tick++ ; this.renderLive() }, 120)
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
    this.flushLiveRender()
    // A3：纯位置参数作为初始 prompt（`oh-my-tianshu tui "修复这个 bug"`）。
    if (initialPrompt !== '') {
      this.handleSubmit(initialPrompt)
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
    // 剪贴板当前是图片 → 附图并吞掉（与 Ctrl+V 互斥：右键粘贴产生 paste
    // 事件、Ctrl+V 产生 ctrl_v 按键，不会同时触发）。
    if (this.inputLine.images.length < MAX_IMAGES) {
      try {
        const imgResult = await readImageFromClipboard()
        if (imgResult) {
          this.inputLine.addImage(imgResult.dataUrl)
          this.flushLiveRender()
          return
        }
      } catch {
        // 剪贴板读图失败（无图/不支持）→ 落入正常文本粘贴
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
   * 焦点防抖：输入框在最近 FOCUS_DEBOUNCE_MS 内刚获得焦点时跳过读图
   * （编辑器/overlay 切回后 1s 内的 Ctrl+V 大概率是文本操作）。
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
        this.inputLine.addImage(result.dataUrl)
        this.flushLiveRender()
        return
      }
    } catch {
      // 剪贴板读图失败，静默 fallback 到文本
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
    if (credentials !== undefined) {
      try {
        const info = await credentials.describe('DEEPSEEK_API_KEY')
        this.apiKeyReady = info.configured
        return
      } catch {
        // 服务面不匹配时回退 env
      }
    }
    this.apiKeyReady = Boolean(process.env.DEEPSEEK_API_KEY)
  }

  /**
   * 按当前主控模型刷新识图标志。llm 服务缺失或查询失败时保持原值；
   * inputModalities 含 image 才直发图片，否则走桥或「未发送」。
   */
  private refreshVisionForSelection(selection: { provider: string; model: string }): void {
    const llm = this.ctx.reflect.get('llm', false) as LlmModelInfoFacet | undefined
    if (llm === undefined) return
    void llm.resolveModelInfo(selection.provider, selection.model).then((info) => {
      if (this.disposed) return
      const modalities = info.inputModalities
      this.supportsVision = modalities !== undefined && modalities.includes('image')
    }).catch(() => {
      // 目录查询失败时保持启动时的识图标志
    })
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
    const others = (await listSessions(this.ctx)).filter(s => s.id !== this.activeSessionId)
    const target = others[0]?.id
    if (target !== undefined) await this.switchSession(target)
  }

  /**
   * Phase 9b：把可恢复会话列表写进 scrollback（启动时）。
   * 排除当前活跃会话；无其他可恢复会话时静默（不占位）。
   * live 标注取 live store（listSessions 的 header 无 live 字段，
   * 经 ctx.sessions.list() 的 id 集合判定）。
   */
  private async renderRestorableSessions(): Promise<void> {
    await this.refreshApiKeyReady()
    const cols = this.stdout.columns
    const gutter = cols >= CHROME_GUTTER * 2 + 8 ? CHROME_GUTTER : 0
    const commitLine = (text: string): void => {
      // 不加 trailingNewline：CommitEngine 会把 true 理解成「再垫一个空行」，
      // 欢迎每行变成双倍高度，40 行屏上 tips 会被顶出视口。
      this.commitToScrollback({ text })
    }
    // C4 概念稿 A：顶部栏（format/top-bar.ts 纯渲染）——cwd + 模型 + git 分支，
    // 最顶一行（对齐 grok top_bar）；分支经 gitBranch() 一次读取（静默）。
    const current = this.ctx.agentDefaultModel.currentSelection()
    const branch = gitBranch()
    for (const line of formatTopBar({
      width: cols - gutter,
      cwd: this.sessionCwd(),
      modelName: `${current.provider}/${current.model}`,
      // exactOptionalPropertyTypes：branch 不可显式传 undefined，条件展开
      ...(branch === undefined ? {} : { branch }),
    }, this.theme)) {
      commitLine(gutter > 0 ? `${' '.repeat(gutter)}${line}` : line)
    }

    const active = this.activeSessionId
    const summaries = await listSessions(this.ctx)
    const others = summaries.filter(s => s.id !== active)

    // 环境检查结果：唯一来源（首启与有会话统一一行，不重复渲染）。
    const env: WelcomeEnvCheck = {
      hasApiKey: this.apiKeyReady,
      isGitRepo: isGitRepo(),
      themeName: getActiveThemeName(),
      cols,
    }
    // 最近可恢复会话摘要（并入 tips「恢复」项，不单独占屏）。
    const recent = others[0]
    const resumeAvailable = others.length > 0
    const resumeLabel = recent === undefined
      ? '恢复会话'
      : `恢复 · ${formatSessionAge(recent.createdAt, Date.now())}`

    // 品牌鲸鱼像素画（omp 风格对角渐变——truecolor 轨；窄屏/矮屏/低色深/
    // legacy conhost 时降级为纯文字品牌区）。卡盒内容宽 = cols - 4。
    const whale = formatWhaleLogo({ width: Math.max(0, cols - 4), rows: this.stdout.rows, bodyGradient: true })

    // 顶栏与欢迎之间留 1 行。live overlay 不再填剩余视口。
    commitLine('')

    const tips: WelcomeTipItem[] = [
      { keyHint: 'ctrl+n', label: '新会话' },
      { keyHint: 'ctrl+s', label: resumeLabel, available: resumeAvailable },
      { keyHint: 'ctrl+p', label: '命令面板' },
      { keyHint: '/', label: 'slash 命令' },
      { keyHint: 'ctrl+o', label: '展开推理' },
      { keyHint: 'shift+tab', label: '模式循环' },
    ]
    const distVersion = readDistributionVersion()
    const heroLines = formatWelcomeHero({
      width: Math.max(0, cols - 4),
      whale,
      env,
      tips,
      ...(distVersion === undefined ? {} : { version: distVersion }),
    }, this.theme)
    // omp 风格欢迎卡：圆角盒 + 顶边嵌品牌；盒下斜体随机 Tip。
    for (const line of formatWelcomeCard({ width: cols, lines: heroLines }, this.theme)) {
      commitLine(line)
    }
    commitLine(color(pickWelcomeTip(), this.theme.muted, { italic: true }))
    // 空行收尾：命令回显（如「模型已切换」）与欢迎页在视觉上自然分离。
    commitLine('')
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
    // header.cwd 是 Web 会话列表与 workspace 挂载的门槛：缺省会被持久化进
    // `_no-cwd/` 并从 web API 可见列表过滤掉（issue #5）。TUI 工作区 = 启动目录。
    const handle = await this.ctx.agents.create({
      sessionId: id,
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx) => {
        installModelSelection(agentCtx, ref)
      },
    })
    this.ownedHandle = handle
    this.controls = controlsFromHandle(handle)
    this.activeSessionId = id
    this.mountSession(id)
    return id
  }

  /**
   * C2 项 4：热切当前会话的模型。改 modelRef.current——下一次 agent 步进
   * （prompt assembly）自动生效，不中断当前步骤。registry 兜底的会话
   * （ref 由其他装配方持有）返回 false，调用方提示不可热切。
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
   * C3 项 3：打开 rewind overlay（/rewind）。消息快照 = transcript 视图
   * （seq/turn/text），执行回调做「文件回退 + 会话截断 + 持久化截断」。
   * @returns 是否已打开（无活跃会话或无消息时 false）。
   */
  rewindSession(): boolean {
    const overlay = this.overlay
    const rewind = this.rewindOverlay
    if (overlay === null || rewind === null) return false
    if (this.activeSessionId === null) return false
    const messages = this.transcript?.view.messages ?? []
    if (messages.length === 0) return false
    rewind.setMessages(messages, (mode, atSeq) => this.executeRewind(mode, atSeq))
    overlay.activate('rewind')
    return true
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
   * @param id - 目标会话 id；必须是 live store 中已存在的会话。
   */
  async switchSession(id: SessionId): Promise<void> {
    // P3 side conversation：切走时保留旧会话 agent（keepHandle 让渡 registry；
    // 切回时走下方 agents.get 兜底分支——不 create 不 resume，transcript 重放）。
    await this.detachProjections({ keepHandle: true })
    this.dynamicRowsHighWater = 0
    this.activeSessionId = id
    const agent = this.ctx.agents.get(id)
    if (agent !== undefined) {
      /* v8 ignore next -- agent 已确认存在（if 分支外），controlsFromRegistry 恒返回非空 */
      this.controls = controlsFromRegistry(this.ctx, id) ?? null
      // registry 兜底：ref 由其他装配方持有，本层不可热切
      this.modelRef = null
    } else {
      const persisted = getSession(this.ctx, id)?.requestHeader()?.config
      const selection: ModelSelection = persisted === undefined
        ? this.ctx.agentDefaultModel.currentSelection()
        : {
          provider: persisted.provider,
          model: persisted.model,
          ...persisted.reasoningEffort === undefined ? {} : { reasoningEffort: persisted.reasoningEffort },
        }
      // C2 项 4：持有可变 ref（resume 续模的 selection 也进 ref.current）
      this.modelRef = { current: selection, assembled: undefined }
      const ref = this.modelRef
      const handle = await this.ctx.agents.resume({
        resumeSessionId: id,
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: (agentCtx) => {
          installModelSelection(agentCtx, ref)
        },
      })
      this.ownedHandle = handle
      this.controls = controlsFromHandle(handle)
    }
    this.mountSession(id)
  }

  /**
   * 挂载当前会话的投影与控制面：transcript/live/controls 就位后，
   * 将已提交的历史渲染进 scrollback。
   * @param id - 目标会话 id（activeSessionId 已在调用方设置）。
   */
  private mountSession(id: SessionId): void {
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
    // T1.1：投影总线（5 域：todos/plan/goal/subagent/subagentTiming）——全量快照 +
    // onChanged 按 key 分流缓存。经 ctx.reflect.get 读取（Cordis 4 注入代理：
    // 属性访问未注册服务抛 "without inject"——真实装配已复现）；服务缺失时
    // 整体降级：任务窗格/status 面板在切换时回显警告（fails loud），plan 徽标不显示。
    this.taskPanelVisible = false
    this.statusPanelVisible = false
    this.taskItems = null
    this.planState = { active: false, pending: false }
    this.projectionCache = null
    const projections = this.ctx.reflect.get('sessionProjections', false) as ProjectionFacet | undefined
    if (projections !== undefined) {
      const snap = projections.snapshot(session)
      this.projectionCache = { ...snap.values }
      this.taskItems = snap.values.todos as TaskItem[] | null | undefined ?? null
      const plan = snap.values.plan as PlanProjectionWire | undefined
      this.planState = { active: plan?.active ?? false, pending: plan?.pending ?? false }
      const statusLine = this.statusLine as WorkflowStatusLine | null
      statusLine?.setPlanState(this.planState)
      this.projectionDisposer = projections.onChanged((s, key, value) => {
        if (s.id !== id) return
        // 按 key 分流缓存（5 域总线）；todos/plan 有专有消费，其余域仅进缓存。
        /* v8 ignore next -- projectionCache 在快照后恒非 null（L766 赋值），null 仅类型收窄 */
        if (this.projectionCache !== null) {
          this.projectionCache[key as ProjectionKey] = value
        }
        if (key === 'todos') {
          this.taskItems = value as TaskItem[] | null
          this.renderBatcher.schedule()
        } else if (key === 'plan') {
          const plan = value as PlanProjectionWire | null
          this.planState = { active: plan?.active ?? false, pending: plan?.pending ?? false }
          this.statusLine?.setPlanState(this.planState)
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
    this.commitRows(rows)
    this.inputLine.setHistory(this.history)
    // T2.1：委派树预取（listDescendants 是 async——首次 await 入缓存；
    // subagent/start|end 事件触发 re-await + renderLive 刷新）。
    // ctx.on 返回 disposer（恒非空）——start/end 必须分别注册，?? 会短路右侧。
    this.subagentDisposer?.()
    this.delegationEntries = null
    this.subagentRuns.clear()
    const onSubStart = this.ctx.on('subagent/start', () => { this.refreshDelegationTree(id) })
    const onSubEnd = this.ctx.on('subagent/end', () => { this.refreshDelegationTree(id) })
    // 对话流 subagent 状态行（grok SubagentBlock 移植，dsh 精简版）：start →
    // live 区运行行（spinner 动态帧）；end → 终态行提交 scrollback（append）。
    // label 尽力取委派树缓存（可能滞后 → 回退 id 短哈希，与面板同款兜底）。
    const onRunStart = this.ctx.on('subagent/start', (info: { runId: string; id: string }) => {
      this.subagentRuns.set(info.runId, { label: this.subagentLabel(info.id), startedAt: Date.now() })
      this.renderBatcher.schedule()
    })
    const onRunEnd = this.ctx.on('subagent/end', (info: { runId: string; stopReason: string }) => {
      const run = this.subagentRuns.get(info.runId)
      if (run === undefined) return
      this.subagentRuns.delete(info.runId)
      this.commitToScrollback({
        text: formatSubagentDone({
          width: this.stdout.columns,
          label: run.label,
          elapsedMs: Date.now() - run.startedAt,
          stopReason: info.stopReason,
        }, this.theme),
        trailingNewline: true,
      })
      this.renderBatcher.schedule()
    })
    this.subagentDisposer = () => { onSubStart(); onSubEnd(); onRunStart(); onRunEnd() }
    this.refreshDelegationTree(id)
    // T2.2：workflow 事件订阅（start/phase/agent-start/agent-end/end → 缓存；
    // 跨会话运行，attach 订阅 dispose 释放）。五个 disposer 全部收集——
    // 只存 start 会让其余四个在每次挂载时泄漏。
    this.workflowDisposer?.()
    this.workflowRuns.clear()
    const workflowListeners = [
      this.ctx.on('workflow/start', (info: WorkflowRunInfoWire) => {
        this.workflowRuns.set(info.id, { id: info.id, phase: null, agents: [] })
        this.flushLiveRender()
      }),
      this.ctx.on('workflow/phase', (info: WorkflowRunInfoWire, title: string) => {
        const run = this.workflowRuns.get(info.id)
        if (run !== undefined) { run.phase = title; this.renderBatcher.schedule() }
      }),
      this.ctx.on('workflow/agent-start', (info: WorkflowRunInfoWire, agent: WorkflowAgentWire) => {
        const run = this.workflowRuns.get(info.id)
        if (run !== undefined) { run.agents.push({ seq: agent.seq, label: agent.label }); this.renderBatcher.schedule() }
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
      if (e.kind === 'child' && e.id === id) return e.label ?? id.slice(0, 8)
    }
    return id.slice(0, 8)
  }

  private refreshDelegationTree(sessionId: SessionId): void {
    const subagents = this.ctx.reflect.get('subagents', false) as SubagentsFacet | undefined
    if (subagents === undefined) { this.delegationEntries = null; return }
    void subagents.listDescendants(sessionId).then((entries) => {
      if (this.disposed) return
      this.delegationEntries = entries
      this.renderBatcher.schedule()
    }).catch(() => {
      /* v8 ignore next -- dispose 后 reject 的竞态守卫（同步测试无法构造） */
      if (this.disposed) return
      this.delegationEntries = null
    })
  }

  /** T2.2：运行态缓存项 → 面板视图（终态含 stopReason/agentsStarted）。 */
  private toWorkflowRunView(run: WorkflowRunState, result: WorkflowResultWire): WorkflowRunView {
    return {
      info: { id: run.id, meta: { name: run.phase ?? run.id, description: '' } },
      agents: run.agents.map(a => ({
        seq: a.seq,
        label: a.label,
        childId: '',
        outcome: a.outcome ?? 'completed',
      })),
      result: {
        stopReason: result.stopReason as WorkflowResultInfoInput['stopReason'],
        ...(result.error === undefined ? {} : { error: result.error }),
        agentsStarted: run.agents.length,
      },
      elapsedMs: Date.now(),
    }
  }

  /** T3.2：刷新 /config 面板投影（settings describe + permission + credentials；服务缺失降级）。 */
  private async refreshConfigProjection(): Promise<void> {
    const settings = this.ctx.reflect.get('settings', false) as
      | { describe(options?: { redactSecrets?: boolean }): unknown[] } | undefined
    const permission = this.ctx.reflect.get('permission', false) as
      | { names: readonly string[]; current(events: readonly unknown[]): string } | undefined
    const credentials = this.ctx.reflect.get('credentials', false) as CredentialsDescribeFacet | undefined
    if (settings === undefined && permission === undefined && credentials === undefined) {
      this.configProjection = null
      return
    }
    const settingsDescriptors = settings === undefined ? [] : settings.describe({ redactSecrets: true })
    const permissionView = permission === undefined ? null : {
      options: permission.names.map(n => ({ value: n, name: n })),
      currentValue: permission.current([]),
    }
    this.configProjection = {
      settings: settingsDescriptors as ConfigPanelProjection['settings'],
      permission: permissionView,
      credentials: [],
    }
    if (credentials !== undefined) await this.fillCredentials(credentials)
  }

  /** 把 DEEPSEEK_API_KEY 的 describe 结果填进 /config 凭据段（与欢迎页同源）。 */
  private async fillCredentials(credentials: CredentialsDescribeFacet): Promise<void> {
    try {
      const info = await credentials.describe('DEEPSEEK_API_KEY')
      if (this.disposed || !this.configPanelVisible || this.configProjection === null) return
      this.configProjection = {
        ...this.configProjection,
        credentials: [{
          ref: 'DEEPSEEK_API_KEY',
          configured: info.configured,
          writable: info.writable !== false,
          ...(info.source === undefined ? {} : { source: info.source }),
        }],
      }
      this.renderBatcher.schedule()
    } catch {
      // 面不匹配时保持空凭据段
    }
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

  /** 当前主题（动态读取，切主题后立即生效）。 */
  private get theme(): RivetTheme { return getTheme() }

  /**
   * 统一 scrollback 写入：先清除 live 区（mid-stream commit 协议），再写条目。
   * 不擦则文本写在光标处（live 区底部），随后 renderLive 重绘 live 区把刚写的
   * 内容覆盖——用户消息丢失根因（assistant 流式 commit 已带 clearForCommit，
   * 非流式路径缺失导致行为不对称）。
   */
  private commitToScrollback(entry: { text: string; trailingNewline?: boolean }): void {
    this.live.clearForCommit()
    this.commit.write(entry)
  }

  /**
   * 提交用户输入：追加输入历史、将用户消息渲染进 scrollback、
   * 走 adapter.send 的 followup 驱动 agent。slash 命令（/steer）分流到 handleSteer。
   * @param text - 输入框提交的文本；空文本但无图时 no-op
   * @param images - 输入框携带的图片附件 data URL 列表（可省略）
   */
  handleSubmit(text: string, images?: string[]): void {
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
    // 任何 / 前缀输入都进命令通道：注册表命中则执行，未命中回显未知命令
    // 提示——不把命令文本当普通消息发给 agent。
    if (trimmed.startsWith('/')) {
      void this.runSlash(trimmed)
      return
    }
    // Phase 9a：@mention 用户侧摘要展开（cwd 边界/截断/降级见 mention-expand）。
    // 展开后的文本进用户消息与 followup——agent 看到的是摘要而非裸路径。
    const expanded = expandMentions(trimmed, this.sessionCwd())
    this.history = [trimmed, ...this.history.filter(h => h !== trimmed)].slice(0, 100)
    this.inputLine.setHistory(this.history)
    // 用户气泡：正文 + 📎 附件行 + 识图能力提示；有图且终端支持图形协议时
    // 异步 prepare 后在同一写窗口追加终端图片（见 commitUserPrompt 时序说明）。
    this.commitUserPrompt(expanded, images)
    this.inputLine.clearImages()
    // 图片不可达时不发送（气泡已警告「图片未发送」）；可达时直发或经视觉桥转描述。
    this.controls?.followup(expanded, imagesReachable ? images : undefined)
    this.flushLiveRender()
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
    const withImages = images !== undefined && images.length > 0 && protocol !== 'none'
    this.commitToScrollback({ text: this.writeUserBubbleLines(content, images), trailingNewline: true })
    if (!withImages) return
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
      // 与 commitToScrollback 同协议：先清 live 区再写，写完立即重绘。
      this.live.clearForCommit()
      this.commit.writeRaw(seq)
      this.flushLiveRender()
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
   * 执行一条 slash 命令：注册表解析 → handler 运行 → 回显/错误提示。
   * 命令回显写 scrollback（用户可见），但不写回 session log（dsh 纪律：
   * 命令执行是 UI 层副作用，session 事件词汇不变）。
   * @param input - 输入行提交的原始文本（已 trim，以 / 开头）。
   */
  private async runSlash(input: string): Promise<void> {
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
      if (await this.runCordisCommand(input, echo)) {
        this.flushLiveRender()
        return
      }
      const available = this.slash.list().map(c => `/${c.name}`).join(' ')
      echo(`未知命令: ${input}。可用: ${available}`)
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
   * @param input - 完整 slash 输入（含 / 前缀）。
   * @param echo - scrollback 回显回调。
   * @returns 命令是否被 CommandService 受理（true 时调用方不再回显未知命令）。
   */
  private async runCordisCommand(input: string, echo: (text: string) => void): Promise<boolean> {
    if (this.activeSessionId === null) return false
    const commands = this.ctx.reflect.get('commands', false) as CommandServiceFacet | undefined
    if (commands === undefined) return false
    const agent = this.ctx.agents.get(this.activeSessionId)
    if (agent === undefined) return false
    try {
      const execution = await commands.execute(agent, input, new AbortController().signal)
      if (execution === undefined) return false
      if (execution.result.kind === 'success') {
        echo(execution.result.text ?? '已执行')
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
    this.history = [trimmed, ...this.history.filter(h => h !== trimmed)].slice(0, 100)
    this.inputLine.setHistory(this.history)
    this.commitToScrollback({ text: formatSteerMessage({ content: trimmed, width: this.stdout.columns }, this.theme).join('\n'), trailingNewline: true })
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
   * @returns 用户决定（allowed-once/rejected/cancelled）或 next() 结果。
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

  /** 取消当前运行（Esc/Ctrl+C）：cancel agent、丢弃未发出的流式/推理缓冲并重置流渲染。 */
  handleAbort(): void {
    this.controls?.cancel({ kind: 'user' })
    this.commitToScrollback({ text: '⏹ 已取消', trailingNewline: true })
    this.blockWriter.discard()
    this.streamRenderer.reset()
    this.discardReasoning()
    this.pendingCallTitles.clear()
    this.flushLiveRender()
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
    // C3 项 4：Shift+Tab 三态循环（Normal → Plan → Always-Approve → Normal）。
    if (key.name === 'shift_tab') {
      this.cycleMode()
      return
    }
    // C4 概念稿 A：欢迎页菜单入口快捷键——新会话 / 恢复会话 / 退出。
    // 语义与菜单行提示一致（grok menu.rs 的 ctrl+w/ctrl+s/ctrl+q 对齐）；
    // 任意时刻可用（新会话即 /session new 语义，退出即 Ctrl+C 空输入退出）。
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
    if (key.name === 'ctrl_f' && this.palette?.isOpen() !== true) {
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
    // C3 项 3：rewind overlay 打开——键转发给 overlay 状态机；done 后任意键关闭。
    if (this.overlay?.activeId() === 'rewind' && this.rewindOverlay !== null) {
      if (this.rewindOverlay.handleKey(key.name, key.char)) {
        this.overlay.rerender()
      }
      if (this.rewindOverlay.isDone()) {
        this.overlay.deactivate()
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
        if (committed !== null) this.inputLine.setValue(committed.text)
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
      if (key.char === 'y' || key.char === 'Y') {
        this.settleApproval('allowed-once')
      } else if (key.char === 'n' || key.char === 'N') {
        this.settleApproval('rejected')
      } else if (key.char === 'a' || key.char === 'A') {
        // 本会话放行：先开 always-approve，再结算当前请求（与 Shift+Tab 进 auto 不同——
        // 挂起中的这一张也立刻通过，而不是只影响后续请求）。
        this.approval.setAlwaysApprove(true)
        this.statusLine?.setAlwaysApprove(true)
        this.settleApproval('allowed-once')
      } else if (key.name === 'ctrl_c' || key.name === 'escape') {
        this.settleApproval('cancelled')
      }
      return
    }
    if (key.name === 'ctrl_c') {
      // raw-mode 下 Ctrl+C 是 0x03 数据字节而非 SIGINT——退出路径走这里：
      // 输入为空退出（onExit），有输入取消当前活动（handleAbort）。
      if (this.inputLine.value === '' && this.onExit !== undefined) {
        this.onExit()
        return
      }
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
      if (key.name === 'return') {
        this.acceptSlashCompletion({ submit: true })
        return
      }
      if (key.name === 'escape') {
        this.inputController.closeSlash()
        this.flushLiveRender()
        return
      }
    }
    if (key.name === 'up' || key.name === 'down') {
      // 交给 InputLine 的历史导航（InputLineEvent 'history' 不消费即已处理）
      this.inputLine.handleKey(key.name, key.char, key.ctrl, key.meta, key.shift, key.inline === true)
      this.flushLiveRender()
      return
    }
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
        }
        if (this.contextWindow !== null && this.contextWindow > 0) {
          input.contextRatio = Math.min(1, billed / this.contextWindow)
          input.tokens = { used: billed, max: this.contextWindow }
        }
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
        if (event.data.usage !== undefined) this.usageFold = event.data.usage
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
      case 'turn/end': {
        // Phase 9d：turn 边界复位流利度信号
        this.fluency.onTurnComplete()
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
    this.commitToScrollback({ text: lines.join('\n'), trailingNewline: true })
    this.renderBatcher.schedule()
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

  /** 渲染一帧 live 区：状态行 + 流式尾巴 + 进行中工具卡 + 输入行。 */
  private renderLive(): void {
    if (this.disposed) return
    const renderStart = performance.now()
    const theme = this.theme
    const termCols = this.stdout.columns
    const gutter = termCols >= CHROME_GUTTER * 2 + 8 ? CHROME_GUTTER : 0
    const cols = Math.max(1, termCols - gutter * 2)
    const tightViewport = this.stdout.rows < WHALE_MIN_ROWS
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
    const workflowRuns: WorkflowRunView[] = []
    for (const state of this.workflowRuns.values()) {
      workflowRuns.push({
        info: { id: state.id, meta: { name: state.phase ?? state.id, description: '' } },
        agents: state.agents.map(a => ({
          seq: a.seq,
          label: a.label,
          childId: '',
          outcome: a.outcome ?? 'completed',
        })),
        elapsedMs: Date.now(),
      })
    }
    workflowRuns.push(...this.completedWorkflowRuns.values())
    const snapshot: LiveSnapshot = {
      cols,
      theme,
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
      // 投影层：会话级汇总段（本地 fold，宿主投影总线缺失时仍有数据）。
      sessionTotals: {
        turns: this.sessionSummary.totalTurns,
        toolCalls: this.sessionSummary.totalToolCalls,
        elapsedMs: this.sessionSummary.totalElapsedMs,
      },
      subagentsPanelVisible: this.subagentsPanelVisible,
      delegationEntries: this.delegationEntries,
      subagentIdentities: (this.projectionCache?.subagent as
        ReadonlyMap<string, DelegationIdentityProjection> | undefined) ?? new Map(),
      subagentTimings: (this.projectionCache?.subagentTiming as
        ReadonlyMap<string, DelegationTimingProjection> | undefined) ?? new Map(),
      workflowPanelVisible: this.workflowPanelVisible,
      workflowRuns,
      configPanelVisible: this.configPanelVisible,
      configProjection: this.configProjection,
      skillsPanelVisible: this.skillsPanelVisible,
      skillItems: this.skillItems,
      // LSP 面板（本地语言服务诊断；bridge 缓存折叠——桥未创建时视为无诊断）
      lspPanelVisible: this.lspPanelVisible,
      lspDiagnostics: this.lspDiagnosticsView(),
      lspAvailable: this.lspBridge === null ? true : this.lspBridge.isAvailable(),
      // P3：会话 tab 栏（多会话 side conversation；快照从 live store 派生）
      activeSessionId: this.activeSessionId === null ? null : String(this.activeSessionId),
      sessionTabs: this.sessionManager.list().map(s => ({ id: String(s.id), status: s.status })),
    }

    // ── 面板段（7 面板纯函数；组合器负责 { text } 包装与 theme 着色）。──
    // P3：会话 tab 栏（多会话 side conversation；单行，secondary 色）。
    for (const line of renderSessionTabs(snapshot)) {
      lines.push({ text: color(line, theme.secondary) })
    }
    // glance 段：状态行 + 错误行（metrics 已并入输入轨下方 footer，避免双份）。
    for (const line of renderGlancePanel(snapshot)) lines.push({ text: line })
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
    // T3.2：/config 设置面板（projection null 降级在 renderConfigPanel 内）。
    for (const line of renderConfigPanel(snapshot)) lines.push({ text: line })
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

    // 对话流 subagent 运行行（grok SubagentBlock 移植）：live 区动态 spinner 帧，
    // 终态在 end 事件提交 scrollback 后从本集合移除（本处只渲染进行中的）。
    for (const run of this.subagentRuns.values()) {
      for (const line of formatSubagentRunning({
        width: cols,
        label: run.label,
        tick: this.tick,
      }, theme)) {
        lines.push({ text: line })
      }
    }

    // chrome 起点：提问/审批贴输入轨（列入 chrome，小窗口也不会被从顶裁掉），
    // 其后是 slash / vim / 图片 / 输入轨 / footer。溢出裁剪只作用在动态段。
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
    const inputValue = this.inputLine.value
    if (this.inputController.slashMenu.open) {
      for (const line of formatSlashMenu({
        width: cols,
        items: this.inputController.slashMenu.matches,
        selected: this.inputController.slashMenu.selected,
      }, theme)) {
        lines.push({ text: line })
      }
    } else {
      const hint = this.slash.hint(inputValue)
      if (hint !== null) lines.push({ text: hint })
    }

    // 输入行；vim 模式标签（Phase 6.5：normal/visual 态可见，insert 态隐藏）
    if (this.vimEnabled && this.inputLine.vimMode !== 'insert') {
      const modeLabel = this.inputLine.vimMode === 'visual'
        ? (this.inputLine.visualLineWise ? '-- VISUAL LINE --' : '-- VISUAL --')
        : '-- NORMAL --'
      lines.push({ text: color(modeLabel, theme.secondary) })
    }
    // 图片附件标记（📎 N images）显示在输入行上方；dim 色弱化不干扰输入。
    for (const summary of this.inputLine.imageSummary(cols)) {
      lines.push({ text: color(summary, theme.muted) })
    }
    // 阶段 2：slash 菜单选中命令 → 输入行 ghost 预览（补全剩余/参数占位）。
    this.inputLine.setGhost(this.slashGhostText())
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
    const inputView = this.inputLine.displayLinesWithCaret({ maxWidth: cols })
    const framedLines = inputView.lines.map(line => (
      line.startsWith('❯ ') ? `${color('❯', promptColor)}${line.slice(1)}` : line
    ))
    // 状态栏段：左身份（model/effort）、右 metrics（缓存/上下文/token/API）——
    // 复用 glanceBarSegments 的顺序（model、effort 在前），按段数切分。
    const bottomMetrics = this.glanceMetrics()
    const allSegs = bottomMetrics === null ? [] : glanceBarSegments({ ...bottomMetrics, width: cols })
    const leftCount = Math.min(
      (bottomMetrics?.modelName !== undefined ? 1 : 0) + (bottomMetrics?.effort != null ? 1 : 0),
      allSegs.length,
    )
    const topLine = formatTopStatusBar({
      width: cols,
      left: allSegs.slice(0, leftCount),
      right: [...allSegs.slice(leftCount), `API ${this.apiKeyReady ? '✓' : '✗'}`],
      borderColor: promptBorderColor(modeFlags, theme),
    }, theme)
    const frame = formatInputFrame({
      columns: cols,
      lines: framedLines,
      caretLine: inputView.caret.line,
      caretCol: inputView.caret.col,
      topLine,
      ...modeFlags,
    }, theme)
    for (const [i, line] of frame.lines.entries()) {
      lines.push(i === frame.caretLine ? { text: line, caretCol: frame.caretCol } : { text: line })
    }

    // C4：footer 一行——左模式/快捷键（metrics 已上移输入框顶边状态栏，不再右挂）。
    const footerLines = formatPromptFooter({
      width: cols,
      ...modeFlags,
      approvalPending: this.approval.isPending,
    }, theme)
    for (const line of footerLines) lines.push({ text: line })

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
    // 定高视口：动态段按高水位垫到恰好 budget，live region 只涨不缩 →
    // 输入框钉住、回缩黑洞与旧轨线重影一并消除。欢迎首帧（无消息且非运行）不垫。
    const terminalRows = this.stdout.rows || 24
    const raw = terminalRows - chromeRows - 2
    const ceiling = Math.max(0, Math.min(raw, liveMaxRowsFor(terminalRows) - chromeRows))
    const skipPad = (this.transcript?.view.messages ?? []).length === 0
      && this.liveAgent?.state.status !== 'running'
    const next = nextDynamicBudget(
      this.dynamicRowsHighWater,
      dynamicRows,
      ceiling,
      skipPad,
      this.reasoningExpanded,
    )
    this.dynamicRowsHighWater = next.highWater
    const padded = padDynamicRegion(lines, chromeStart, next.budget, rowsForLine)
    const chromeTail = padded.lines.length - padded.chromeStart
    this.live.render(padded.lines, chromeTail > 0 ? { reservedTail: chromeTail } : undefined)
    this.perfMonitor.record('renderLive', performance.now() - renderStart)
  }

  /**
   * 卸载当前会话的投影与控制面，并按 opts 处理本层持有的 handle：
   * - keepHandle（P3 side conversation 切换）：所有权让渡 registry——agent
   *   保持 live（可切回复用），退出时由 agent-loop factory 统一 teardown；
   *   modelRef 同步让渡（registry 兜底语义：不可热切）。
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
    this.glanceEffort = null
    this.contextWindow = null
    this.projectionCache = null
    this.taskItems = null
    this.planState = { active: false, pending: false }
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
    // 切会话/退出共用：旧会话的流式残文不得带进下一段输出
    this.blockWriter.discard()
    this.streamRenderer.reset()
    if (this.ownedHandle !== null) {
      if (opts?.keepHandle === true) {
        // P3：切换保留——让渡 registry（agent 保持 live；退出时 factory 统一清理）。
        this.ownedHandle = null
        this.modelRef = null
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
    if (this.disposed) return
    this.disposed = true
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
    this.pasteDisposer?.()
    this.pasteDisposer = null
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
