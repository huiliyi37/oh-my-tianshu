/**
 * Phase 6.1 Slash 命令系统 — Cordis 服务式命令注册表与内置命令。
 *
 * 职责划分：
 * - `resolveSlashCommand`：纯函数最小唯一前缀解析（/ 前缀检测、歧义/未知 → null）。
 * - `SlashCommandRegistry`：实例化命令注册表（register/list/get/unregister/resolve/hint），
 *   经 `ctx.provide('tui.commands', registry)` 暴露为 Cordis 服务——外部插件可
 *   `ctx.get('tui.commands')?.register(...)` 扩展命令。
 * - `createBuiltinCommands`：内置命令工厂（/theme /session /clear /compact；/steer 由
 *   TuiApp 直接复用既有入口，注册表只保留其名字参与前缀解析与提示）。
 *
 * dsh 纪律：命令执行只改 UI 状态（主题/滚动区/会话切换）或调用既有服务，不写回 session
 * log、不发明事件类型。命令文本经 `/` 前缀在输入层分流，未知命令回显提示而非提交给 agent。
 *
 * @module @huiliyi37/dsh-tui/commands
 */

import type { Context } from '@huiliyi37/cordis'
import { SessionId } from '@huiliyi37/dsh-session'
import type { Agent } from '@huiliyi37/dsh-agent'
import { getActiveThemeName, setTheme, THEME_NAMES } from '../theme.js'
import { formatWireSurface, wirePhaseLabel, wireToolNames } from '../preset-surface.js'
import { listSessions, loadHistory } from '../adapter/sessions.js'
import { sessionTitleFor } from '../adapter/session-title.js'
import { collectDoctorReport, collectNativeDependencyChecks, getDoctorFixGuidance } from '../format/doctor-report.js'

// agent-preset/selected 会话事件由 dsh-agent-presets 声明扩展（persistence
// catalog 门禁要求全仓单一声明）；此处仅以 type-only 引用把该合并引入本包
// 编译面,使 Session.append('agent-preset/selected', ...) 获得完整类型检查。
// /preset 的运行时服务面仍走 ctx.reflect.get('agentPresets') 最小接口,
// 不引入 dsh-agent-presets 运行时依赖。
import type {} from '@huiliyi37/dsh-agent-presets'
// Type-only：让 ctx.get('modelRoles') 解析到角色 pin 服务（可选缝，从不硬依赖）；
// 角色子命令的共享纯函数层在 ../model-roles.js。
import type { ModelRole } from '@huiliyi37/dsh-model-roles'
import {
  MODEL_ROLES_UNAVAILABLE,
  MODEL_ROLE_LABELS,
  parseModelRole,
  parseRouteKey,
  rolePinEcho,
  roleVisionWarning,
} from '../model-roles.js'

/**
 * Slash 命令执行上下文——TuiApp 在分发时注入。
 */
export interface SlashCommandArgs {
  /** 参数文本（命令名后已 trim；无参数为空串）。 */
  text: string
  /** 服务上下文（提供方 ctx）。 */
  ctx: Context
  /** 当前会话 id；尚未 attach 时为 null。 */
  sessionId: SessionId | null
  /** 回显一行命令结果到 scrollback。 */
  echo: (text: string) => void
  /** 请求重绘 live 区（命令执行后统一调用）。 */
  rerender: () => void
}

/** 一条 slash 命令。 */
export interface SlashCommand {
  /** 命令名（不含 / 前缀；小写，互不为前缀歧义时才能唯一解析）。 */
  name: string
  /** 命令面板/提示展示描述。 */
  description: string
  /** 可选参数 ghost 提示（如 `<name>`）。 */
  argsHint?: string
  /** 执行命令。可 async；抛错由分发层捕获并回显失败信息。 */
  run(args: SlashCommandArgs): void | Promise<void>
}

/** 解析结果：命中的命令与剥离后的参数文本。 */
export interface SlashParse {
  command: SlashCommand
  text: string
}

/** /compact 所需的最小 compact 服务面（不引入 dsh-compact 依赖）。 */
interface CompactFacet {
  compactIfNeeded(
    agent: { session: { id: SessionId }; options: { provider?: string; model?: string } },
    trigger: 'pressure' | 'context-overflow',
    signal: AbortSignal,
  ): Promise<unknown>
}

/** /model 所需的最小 agent-default-model 服务面（不引入 dsh-agent-default-model 依赖）。 */
export interface ModelFacet {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
  saveSelection(next: { provider: string; model: string; reasoningEffort?: string }): Promise<void>
}

/** /model 目录条目（supportsVision 供 vision 角色 pin 的识图能力警告；advisory）。 */
interface LlmCatalogModel {
  id: string
  supportsVision?: boolean
}

/** /model 校验所需的 llm 目录最小服务面（不引入 dsh-llm 依赖；reflect.get 动态获取）。 */
interface LlmCatalogFacet {
  listProviders(): Array<{ id: string }>
  listModels(provider: string): Promise<LlmCatalogModel[]>
}

/** 目录校验结果（checkCatalogRoute 返回值）。 */
interface CatalogRouteCheck {
  /** 校验失败的中文原因（不含命令特定后缀）；通过为 null。 */
  error: string | null
  /** 命中的目录条目（目录为空/校验失败时 undefined——advisory 无法证伪时放行）。 */
  entry?: LlmCatalogModel
}

/**
 * /model 的就近建议：大小写不敏感的精确 → 前缀 → 子串匹配，去重封顶 3 个。
 * 只做提示，不做自动纠错（纠错会掩盖 advisory 目录的边界）。
 * @param input - 用户输入的模型名。
 * @param catalogIds - 目标 provider 通告目录里的模型 id 列表。
 * @returns 相近模型 id（catalog 原序），无相近时为空数组。
 */
function suggestModels(input: string, catalogIds: readonly string[]): string[] {
  const needle = input.toLowerCase()
  const exact = catalogIds.filter(id => id.toLowerCase() === needle)
  const prefix = catalogIds.filter(id => id.toLowerCase().startsWith(needle))
  const substring = catalogIds.filter(id => id.toLowerCase().includes(needle))
  return [...new Set([...exact, ...prefix, ...substring])].slice(0, 3)
}

/**
 * /model 直参的目录校验（对标 Claude Code：拼写错误不切换/pin）。分级策略遵守
 * llm 的 advisory 契约——目录缺失不得变成请求拒绝：provider 未注册是权威事实
 * （请求注定派发失败）硬拒绝；目录非空而模型在目录外硬拒绝并给就近建议；目录
 * 为空（adapter 未通告/通告失败）无法证伪，放行。主模型与角色 pin 两路径共用。
 * @param llm - llm 目录服务面（reflect.get 现取）。
 * @param next - 目标 provider/model 路由。
 * @param pickerHint - 无就近建议时的选择器用法文案（主模型与角色各自的 /model 形态）。
 * @returns 校验结果（error 为失败原因；entry 为命中的目录条目，供 vision 能力警告）。
 */
async function checkCatalogRoute(
  llm: LlmCatalogFacet,
  next: { provider: string; model: string },
  pickerHint: string,
): Promise<CatalogRouteCheck> {
  const providers = llm.listProviders().map(provider => provider.id)
  if (!providers.includes(next.provider)) {
    return { error: `未知 provider: ${next.provider}（已注册: ${providers.join(' / ') || '无'}）` }
  }
  const catalog = await llm.listModels(next.provider).catch(() => [])
  const entry = catalog.find(model => model.id === next.model)
  if (catalog.length > 0 && entry === undefined) {
    const suggestions = suggestModels(next.model, catalog.map(model => model.id))
    const hint = suggestions.length > 0
      ? `（你是否想用 ${suggestions.map(id => `${next.provider}/${id}`).join(' / ')}？）`
      : `（可用 ${catalog.length} 个，${pickerHint}）`
    return { error: `${next.provider} 没有模型 ${next.model}${hint}` }
  }
  return { error: null, ...(entry === undefined ? {} : { entry }) }
}

/** /preset 所需的最小 agent-presets 服务面（不引入 dsh-agent-presets 依赖）。 */
interface PresetFacet {
  /** 当前配置根提供的全部预设（first-root-wins per id）。 */
  list(): Promise<Array<{ id: string; name?: string; description?: string }>>
  /** 一个 live agent 当前运行的预设 id（作用域链读取；未加入任何预设返回 undefined）。 */
  composedPreset?(agentCtx: Context): string | undefined
  /** 把 agent 重绑到另一预设的 standing 组成；调用方负责 blank-session 检查。 */
  recompose(agentCtx: Context, id: string): Promise<{ id: string; name?: string }>
  /** 部署当前生效的默认预设 id（settings.default 覆盖 config.default）。 */
  defaultId?: string
  /** 持久化默认预设：后续新建会话继承它。校验失败（未知/损坏 id）响亮抛出。 */
  setDefault?(id: string): Promise<void>
}

/** /model 的 effort 白名单（llm 三档：off / high / max）。 */
const EFFORT_LEVELS = ['off', 'high', 'max'] as const

/** /goal 所需的最小目标 ref（CAS 身份，取自当前 view）。 */
interface GoalRefFacet {
  readonly id: string
  readonly revision: number
}

/** /goal 所需的最小目标 view（get/create/动词的返回面）。 */
interface GoalViewFacet extends GoalRefFacet {
  readonly objective: string
  readonly phase: 'active' | 'paused' | 'blocked' | 'complete'
  readonly roundsStarted: number
  readonly maxGoalRounds: number
}

/** /goal 所需的最小 goal 服务面（不引入 dsh-goal 依赖）。 */
interface GoalFacet {
  get(agent: unknown): GoalViewFacet | undefined
  create(agent: unknown, request: { objective: string }): GoalViewFacet
  pause(agent: unknown, ref: GoalRefFacet): GoalViewFacet
  resume(agent: unknown, ref: GoalRefFacet): GoalViewFacet
  complete(agent: unknown, ref: GoalRefFacet): GoalViewFacet
  block(agent: unknown, ref: GoalRefFacet, reason: { code: string; message: string }): GoalViewFacet
}

/** /tasks kill 所需的最小 tasks 服务面（不引入 dsh-tasks 依赖；id 运行时即 string）。 */
/** One `listDescendants` row the kill path reads (direct parent + mode). */
interface SubagentsKillEntry {
  readonly kind: 'child' | 'diagnostic'
  readonly id: string
  readonly parentId: string
  readonly activity?: 'running' | 'inactive'
  readonly mode?: 'one-shot' | 'continuable'
}

/** /subagents kill 所需的最小 subagents 服务面（不引入 dsh-subagent 依赖；
 *  reflect.get 动态获取——TUI 编译面约定）。 */
interface SubagentsFacet {
  listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<readonly SubagentsKillEntry[]>
  interrupt(targetSessionId: SessionId, authority: { kind: 'user'; parentSessionId: SessionId }): void
}

interface TasksFacet {
  kill(id: string, caller?: unknown, reason?: string): 'requested' | 'already-finished'
}

/** /remember、/memory 所需的最小 memory 服务面（不引入 dsh-memory 依赖；
 *  reflect.get 动态获取——TUI 编译面约定）。 */
interface MemoryFacet {
  save(entry: { text: string; scope: string; tags: string[]; source: string }): Promise<{ id: string }>
  list(opts?: { scope?: string; limit?: number }): Promise<Array<{ id: string; text: string; tags: string[]; createdAt: number }>>
  delete(id: string): Promise<void>
}

/**
 * 内置命令名（解析 + 提示的单一事实来源；描述/argsHint 见 createBuiltinCommands）。
 * 含 /steer：TuiApp 复用既有 handleSteer 入口，此处只参与前缀匹配。
 * /status 同款：注册表只声明名字参与前缀解析/提示，实际显隐切换 handler 由
 * TuiApp 经 register 接线（见 ui/app.ts）。
 * /subagents、/workflow、/tasks 的命令定义在 createBuiltinCommands（deps 注入
 * TuiApp 的显隐切换）；/status、/todos 保持 TuiApp 内注册（/todos：无参显隐 +
 * all 明细展开，数据源为 todos 投影保留快照）。
 */
export const BUILTIN_COMMAND_NAMES = ['theme', 'session', 'resume', 'fork', 'branch', 'clear', 'compact', 'steer', 'model', 'effort', 'key', 'login', 'preset', 'tasks', 'density', 'info', 'goal', 'status', 'todos', 'subagents', 'workflow', 'config', 'skills', 'rewind', 'btw', 'doctor', 'mcp', 'remember', 'memory', 'scroll', 'export', 'exit', 'yolo', 'cost', 'help', 'restart'] as const

/**
 * /model 一键切换别名（TUI 便捷层）：展开为 deepseek-spark route 的
 * provider/model，免去手输完整路由。spark 截断由 llm-deepseek 的
 * settings spark.enabled 门控（别名本身不改变门控状态）；锚点补偿由
 * dsh-spark-anchors 在 pre-step 注入（route 判定与截断同源）。
 */
const SPARK_ALIASES: Readonly<Record<string, { provider: string; model: string }>> = {
  'spark-flash': { provider: 'deepseek-spark', model: 'deepseek-v4-flash' },
  'spark-pro': { provider: 'deepseek-spark', model: 'deepseek-v4-pro' },
}

/**
 * 最小唯一前缀解析：`/` 前缀 + 命令名 `startsWith` 匹配。
 * 歧义（多命令同前缀）或未知名返回 null——不猜命令。
 * @param input - 输入行原始文本。
 * @param commands - 命令名集合（字符串或带 name 的对象，registry 实例与静态名表共用）。
 * @returns 命中的命令与剥离后的参数文本；无匹配返回 null。
 */
export function resolveSlashCommand(
  input: string,
  commands: readonly (string | { name: string })[],
): { command: { name: string }; text: string } | null {
  if (!input.startsWith('/')) return null
  const spaceIdx = input.indexOf(' ')
  const token = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx)
  const rest = spaceIdx === -1 ? '' : input.slice(spaceIdx + 1).trim()
  if (token === '') return null
  const nameOf = (c: string | { name: string }): string => (typeof c === 'string' ? c : c.name)
  const matches = commands.filter(c => nameOf(c).startsWith(token))
  if (matches.length !== 1) return null
  const match = matches[0]
  /* v8 ignore next -- length===1 保证 [0] 必有值；noUncheckedIndexedAccess 收窄防御 */
  if (match === undefined) return null
  return { command: { name: nameOf(match) }, text: rest }
}

/**
 * 命令注册表——register/unregister/list/get/resolve/hint。
 * 同名 register 覆盖旧命令；空名或含空格的命令名 register 抛错。
 * 实例经 `ctx.provide('tui.commands', registry)` 暴露为 Cordis 服务。
 */
export class SlashCommandRegistry {
  private readonly commands = new Map<string, SlashCommand>()

  /**
   * 注册（或覆盖同名）命令。
   * @param command - 命令定义；空名或含空格的名字抛错。
   */
  register(command: SlashCommand): void {
    if (command.name === '' || command.name.includes(' ')) {
      throw new Error(`invalid slash command name: ${JSON.stringify(command.name)}`)
    }
    this.commands.set(command.name, command)
  }

  /**
   * 反注册命令；不存在时 no-op。
   * @param name - 命令名（不含 / 前缀）。
   */
  unregister(name: string): void {
    this.commands.delete(name)
  }

  /**
   * 按注册顺序列出全部命令。
   * @returns 命令数组（注册顺序）。
   */
  list(): SlashCommand[] {
    return [...this.commands.values()]
  }

  /**
   * 按名取命令；未注册返回 undefined。
   * @param name - 命令名（不含 / 前缀，精确匹配）。
   * @returns 命中的命令；未注册为 undefined。
   */
  get(name: string): SlashCommand | undefined {
    return this.commands.get(name)
  }

  /**
   * 最小唯一前缀解析（委托 resolveSlashCommand，用实例注册表）。
   * @param input - 输入行原始文本。
   * @returns 命中的命令与参数文本；未知/歧义/非 slash 输入为 null。
   */
  resolve(input: string): SlashParse | null {
    const parsed = resolveSlashCommand(input, this.list())
    /* v8 ignore next -- resolveSlashCommand 只在命令存在时返回对象，get 必命中；双查防御 */
    if (parsed === null) return null
    const command = this.commands.get(parsed.command.name)
    /* v8 ignore next -- 同上：parsed 来自本注册表命令名，get 恒非 undefined；双查防御 */
    if (command === undefined) return null
    return { command, text: parsed.text }
  }

  /**
   * 内联提示：输入以 / 开头且有匹配命令时返回提示行；否则 null。
   * 展示在 live 区输入行上方（最小内联提示，不启用 overlay-engine 全屏面板）。
   * @param input - 输入行原始文本。
   * @returns 一行 `命令: /a /b …` 提示；无匹配为 null。
   */
  hint(input: string): string | null {
    if (!input.startsWith('/')) return null
    const token = input.slice(1)
    if (token === '') return null
    const matches = this.list().filter(c => c.name.startsWith(token))
    if (matches.length === 0) return null
    const parts = matches.map(c => `/${c.name}${c.argsHint === undefined ? '' : ` ${c.argsHint}`}`)
    return `命令: ${parts.join('   ')}`
  }
}

/**
 * 内置命令工厂依赖——TuiApp 私有能力注入（会话铸造、滚动区重置、面板显隐切换）。
 */
export interface BuiltinCommandDeps {
  /** /session new：新建会话并挂载（TuiApp.newSession）。 */
  newSession(): Promise<SessionId>
  /** /fork、/branch（A3）：分叉当前会话（复制历史）并切换（TuiApp.forkSession）。 */
  forkSession(opts?: { directive?: string }): Promise<SessionId>
  /** C2 项 4：热切当前会话的模型（TuiApp.switchLiveModel）；返回是否已热切。 */
  switchLiveModel(selection: { provider: string; model: string }): boolean
  /** /clear：清空当前会话 scrollback（CommitEngine.reset）。 */
  clearScrollback(): void
  /** /tasks 无参：切换任务窗格显隐（TuiApp 私有状态 + renderLive）。 */
  toggleTaskPanel(): void
  /** /subagents：切换委派树面板显隐（T2.1；数据源为委派树缓存）。 */
  toggleSubagentsPanel(): void
  /** /workflow：切换 workflow 运行中面板显隐（T2.2；数据源为运行中缓存）。 */
  toggleWorkflowPanel(): void
  /** /rewind（C3 项 3）：打开 rewind overlay；返回是否已打开（无会话或无可回退用户消息时 false）。 */
  rewindSession(): boolean
  /** /btw（P1）：发起侧问；返回是否已发起（无会话/已有挂起侧问时 false）。 */
  askBtw(question: string): Promise<boolean>
  /** /memory（P2）：打开记忆浏览器 overlay；返回是否已打开（无 memory 服务时 false）。 */
  openMemoryBrowser(): Promise<boolean>
  /** /scroll（T5）：打开全屏转录查看器 overlay；返回是否已打开（scrollback 为空时 false）。 */
  openTranscriptViewer(): boolean
  /** /session switch（P3）：切换到既有 live 会话（id 字符串；app 侧转 SessionId）。 */
  switchSession(id: string): Promise<void>
  /** /export（T3）：导出当前会话转录为 Markdown；path 缺省由实现决定；返回导出文件路径。 */
  exportTranscript(path?: string): Promise<string>
  /** /exit：请求退出 TUI（与 Ctrl+Q 同一 onExit 路径）。 */
  requestExit(): void
  /** /restart：以相同命令重启当前 dsh 进程（dispose → spawn 同 argv → 退出）。 */
  requestRestart(): void
  /** /preset：当前会话的 agent（recompose/composedPreset 的 agentCtx 来源；无会话为 null）。 */
  currentAgent(): Agent | null
  /** /preset：当前会话是否 blank（无消息且无进行中工具调用）——recompose 的调用方契约。 */
  isBlankSession(): boolean
  /** /yolo：开启/关闭全放行模式（approval always-approve 快捷入口）。 */
  setYoloMode(flag: boolean): void
  /** /cost：当前会话累计用量与成本报告行（app 侧汇总；无数据时返回占位行）。 */
  sessionCostReport(): string[]
  /** #31：打开模型选择器（上下键选择替代命令参数输入）。 */
  openModelPicker(): void
  /** /model vision|secondary|subagent：打开角色模型选择器（首行「跟随默认」清除 pin）。 */
  openRoleModelPicker(role: ModelRole): void
  /** #31：打开主题选择器。 */
  openThemePicker(): void
  /** #31：打开会话选择器。 */
  openSessionPicker(): void
  /** /key、/login：打开 API Key 设置对话框（掩码输入 + 联网验证 + 落盘）。 */
  openKeyDialog(): void
  /** /help：当前注册表的全部命令（TuiApp 是注册表所有者，经 deps 注入而非 ctx 服务）。 */
  listCommands(): SlashCommand[]
}

/**
 * 装配内置命令（/theme /session /clear /compact）。
 * /steer 不在此列——TuiApp 复用既有 handleSteer 入口。
 * @param deps - TuiApp 私有能力。
 * @returns 内置命令数组（含描述/argsHint，供注册表与提示使用）。
 */
export function createBuiltinCommands(deps: BuiltinCommandDeps): SlashCommand[] {
  return [
    {
      name: 'theme',
      description: '切换主题（内置或 custom:<name>）',
      argsHint: '<name>',
      run: ({ text, echo }) => {
        const name = text.trim()
        if (name === '') {
          // #31：无参打开主题选择器（上下键选择替代命令输入）。
          deps.openThemePicker()
          return
        }
        if (setTheme(name)) echo(`主题已切换: ${name}`)
        else echo(`未知主题: ${name}。可用: ${THEME_NAMES.join(', ')}`)
      },
    },
    {
      name: 'session',
      description: '会话管理：new 新建，list 列出，switch 切换',
      argsHint: 'new|list|switch <id>',
      run: async ({ text, echo, ctx }) => {
        /* v8 ignore next -- split(/\s+/) 恒返回非空数组，[0] 必有值；noUncheckedIndexedAccess 收窄防御 */
        const sub = text.split(/\s+/)[0] ?? ''
        if (sub === '') {
          // #31：无参打开会话选择器（上下键选择替代命令输入；当前会话 ● 高亮）。
          deps.openSessionPicker()
          return
        }
        if (sub === 'new') {
          const id = await deps.newSession()
          echo(`已新建会话: ${id}`)
          return
        }
        if (sub === 'list') {
          const rows = await listSessions(ctx)
          if (rows.length === 0) {
            echo('（当前无会话）')
            return
          }
          // 每行在 session id 旁展示会话标题。数据源为官方 log-backed
          // `session/title` 事件（dsh-base 装配的 session-title + session-title-llm
          // 在会话活跃时自动生成）；无标题事件的历史会话展示首条真人消息的
          // 确定性 fallback；无聊天记录的会话显示「新对话」。只读纯函数，
          // 不调 API、不写 sidecar、不写 session log。损坏会话标注原因
          // （loadHistory 失败不回退成空会话标题——不可恢复要可见）。
          for (const row of rows) {
            if (row.corrupt) {
              echo(`${row.id} · 不可恢复（工件损坏，无法读取）`)
              continue
            }
            const events = await loadHistory(ctx, row.id).catch(() => [])
            echo(`${row.id} · ${sessionTitleFor(events)} · ${new Date(row.createdAt).toISOString()}`)
          }
          return
        }
        if (sub === 'switch') {
          // P3：多会话切换——目标 id 必须是 live store 中已存在的会话。
          const id = text.slice(sub.length).trim()
          if (id === '') {
            echo('用法: /session switch <id>（/session list 查看 id）')
            return
          }
          await deps.switchSession(id)
          echo(`已切换会话: ${id}`)
          return
        }
        echo('用法: /session new|list|switch <id>')
      },
    },
    {
      // session-resume 2.1：/resume 无参恢复最近可恢复会话（含持久化），
      // 带参切换指定会话；与 Ctrl+S、欢迎页列表共享 listSessions 数据源。
      // 损坏行（version -1 占位）：无参跳过（落到最近一个可恢复会话），
      // 带参显式选中时由 switchSession 预检抛错——命令层回显失败原因
      // （不静默新建、不吞掉）。
      name: 'resume',
      description: '恢复会话：无参恢复最近可恢复会话，带参切换指定会话',
      argsHint: '[id]',
      run: async ({ text, echo, ctx, sessionId }) => {
        const id = text.trim()
        const rows = await listSessions(ctx)
        if (id === '') {
          const target = rows.find(r => r.id !== sessionId && !r.corrupt)
          if (target === undefined) {
            echo('无可恢复会话（/session new 新建）')
            return
          }
          await deps.switchSession(target.id)
          echo(`已恢复会话: ${target.id}`)
          return
        }
        if (!rows.some(r => r.id === SessionId(id))) {
          echo(`会话不存在: ${id}。可用: /session list 或欢迎页恢复列表`)
          return
        }
        await deps.switchSession(SessionId(id))
        echo(`已恢复会话: ${id}`)
      },
    },
    {
      name: 'fork',
      description: '分叉当前会话（复制历史到新会话并切换）',
      argsHint: '[directive]',
      run: async ({ text, echo }) => {
        const directive = text.trim()
        const id = directive === '' ? await deps.forkSession() : await deps.forkSession({ directive })
        echo(`已分叉会话: ${id}`)
      },
    },
    {
      name: 'rewind',
      description: '回退到一条用户消息（C3 项 3：会话截断 + 可选文件回退）',
      argsHint: '',
      run: ({ echo }) => {
        if (!deps.rewindSession()) {
          echo('⚠ 当前无可回退的会话')
        }
      },
    },
    {
      name: 'branch',
      description: '分叉当前会话（/fork 别名）',
      run: async ({ echo }) => {
        const id = await deps.forkSession()
        echo(`已分叉会话: ${id}`)
      },
    },
    {
      name: 'model',
      description: '查看或切换模型（默认 + 当前会话热切；vision/secondary/subagent 角色 pin；spark-flash / spark-pro 别名一键切 spark）',
      argsHint: '[provider/model [effort] | spark-flash | spark-pro | vision|secondary|subagent [provider/model]]',
      run: async ({ text, echo, ctx }) => {
        const raw = text.trim()
        /* v8 ignore next -- split(/\s+/) 恒返回非空数组，[0] 必有值；noUncheckedIndexedAccess 收窄防御 */
        const role = raw === '' ? undefined : parseModelRole(raw.split(/\s+/)[0] ?? '')
        if (role !== undefined) {
          // 角色子命令：pin 写 settings 用户层（model-roles 服务），与主模型选择
          // 互不相关——不依赖 agent-default-model 服务面。可选服务经 ctx.get 读取
          // （packages/AGENTS.md：可选服务不用属性代理）。
          const roles = ctx.get('modelRoles')
          if (roles === undefined) {
            echo(MODEL_ROLES_UNAVAILABLE)
            return
          }
          const rest = raw.slice(role.length).trim()
          if (rest === '') {
            // 无第三参：打开该角色的 picker（首行「跟随默认」即 unpin）。
            deps.openRoleModelPicker(role)
            return
          }
          const next = parseRouteKey(rest)
          if (rest.split(/\s+/).length !== 1 || next === undefined) {
            echo(`⚠ 用法: /model ${role} provider/model（或 /model ${role} 无参打开选择器）——未 pin`)
            return
          }
          // 与主模型同一份目录校验（拼写错误不 pin）；llm 缺席时跳过（既有降级）。
          const llm = ctx.reflect.get('llm', false) as LlmCatalogFacet | undefined
          let visionEntry: LlmCatalogModel | undefined
          if (llm !== undefined) {
            const check = await checkCatalogRoute(llm, next, `/model ${role} 无参打开选择器`)
            if (check.error !== null) {
              echo(`⚠ ${check.error}——未 pin，${MODEL_ROLE_LABELS[role]}仍跟随默认`)
              return
            }
            visionEntry = check.entry
          }
          await roles.pin(role, next)
          // 目录 supportsVision 是 advisory：仅显式 false 给警告，不阻止 pin。
          if (role === 'vision' && visionEntry?.supportsVision === false) {
            echo(roleVisionWarning(next))
          }
          echo(rolePinEcho(role, next))
          return
        }
        // as unknown as：Context 声明合并的 agentDefaultModel 是完整服务面，
        // 这里只消费最小读/写两方法（本地 ModelFacet）。
        const facet = (ctx as unknown as { agentDefaultModel?: ModelFacet }).agentDefaultModel
        if (facet === undefined) {
          echo('⚠ agent-default-model 服务不可用')
          return
        }
        const current = facet.currentSelection()
        if (raw === '') {
          // #31：无参打开模型选择器（上下键选择替代命令输入；当前值 ● 高亮）。
          deps.openModelPicker()
          return
        }
        // 解析：目标（别名或 provider/model）与可选 effort（空格分隔，grok 同款形状）。
        const [target = '', effortRaw] = raw.split(/\s+/)
        if (effortRaw !== undefined
          && !(EFFORT_LEVELS as readonly string[]).includes(effortRaw)) {
          echo(`⚠ 不支持的 effort: ${effortRaw}（可用: off / high / max）`)
          return
        }
        // spark 一键切换别名（TUI 便捷层）：展开为 deepseek-spark route 的
        // provider/model，无需手输完整路由。非别名输入原样解析。
        const aliased = SPARK_ALIASES[target]
        const input = aliased === undefined ? target : `${aliased.provider}/${aliased.model}`
        // 首个斜杠分割：模型 id 可自身含 '/'（openrouter/stealth/ox-alpha 一类）；
        // 无斜杠的裸输入保持既有语义——沿当前 provider 只换模型。空输入在上方
        // raw === '' 分支已开选择器，此处 input 恒非空。
        const routed = parseRouteKey(input)
        const next = routed === undefined
          ? { provider: current.provider, model: input }
          : routed
        // 目录校验（对标 Claude Code：拼写错误不切换；分级策略见 checkCatalogRoute）。
        // reflect.get 读取可选服务（Cordis 4 注入代理：属性访问未 inject 抛错）。
        const llm = ctx.reflect.get('llm', false) as LlmCatalogFacet | undefined
        if (llm !== undefined) {
          const check = await checkCatalogRoute(llm, next, '/model 无参打开选择器')
          if (check.error !== null) {
            echo(`⚠ ${check.error}——未切换，当前仍是 ${current.provider}/${current.model}`)
            return
          }
        }
        // effort 显式传入（含清除：省略 = 回 provider 默认——与 installModelSelection
        // 的 "absent effort clears inherited" 语义一致）。
        const selection = effortRaw === undefined
          ? next
          : { ...next, reasoningEffort: effortRaw }
        await facet.saveSelection(selection)
        // C2 项 4：热切当前会话（下一次 agent 步进生效）；registry 兜底会话不可热切
        const hot = deps.switchLiveModel(selection)
        const effortPart = effortRaw === undefined ? '' : ` (effort: ${effortRaw})`
        echo(hot
          ? `模型已切换: ${selection.provider}/${selection.model}${effortPart}（当前会话与默认均生效）`
          : `模型已切换: ${selection.provider}/${selection.model}${effortPart}（默认生效；当前会话不可热切）`)
      },
    },
    {
      name: 'effort',
      description: '设置推理等级（off / high / max 固定；auto 回模型默认）',
      argsHint: '[off|high|max|auto]',
      run: async ({ text, echo, ctx }) => {
        // 与 /model 共用最小 agent-default-model 面（ModelFacet）。
        const facet = (ctx as unknown as { agentDefaultModel?: ModelFacet }).agentDefaultModel
        if (facet === undefined) {
          echo('⚠ agent-default-model 服务不可用')
          return
        }
        const current = facet.currentSelection()
        const input = text.trim()
        if (input === '') {
          echo(current.reasoningEffort === undefined
            ? '当前推理等级: auto（跟随模型默认）'
            : `当前推理等级: ${current.reasoningEffort}（/effort auto 可回默认）`)
          return
        }
        if (input === 'auto') {
          // auto = 清除 effort，回 provider/模型默认（installModelSelection 的
          // absent-effort 语义）。持久化 + 热切当前会话（与 /model 同构：
          // 改 modelRef.current，下一次 agent 步进自动生效）。
          const selection = { provider: current.provider, model: current.model }
          await facet.saveSelection(selection)
          const hot = deps.switchLiveModel(selection)
          echo(hot
            ? '推理等级已设为 auto（跟随模型默认；当前会话与默认均生效）'
            : '推理等级已设为 auto（跟随模型默认；默认生效；当前会话不可热切）')
          return
        }
        if (!(EFFORT_LEVELS as readonly string[]).includes(input)) {
          echo(`⚠ 不支持的推理等级: ${input}（可用: off / high / max / auto）`)
          return
        }
        // 手动设为固定值：持久化到默认选择 + 热切当前会话（/model 同构：
        // 下一次 agent 步进自动生效，不中断当前步骤）。
        const selection = { provider: current.provider, model: current.model, reasoningEffort: input }
        await facet.saveSelection(selection)
        const hot = deps.switchLiveModel(selection)
        echo(hot
          ? `推理等级已设为 ${input}（固定；当前会话与默认均生效；/effort auto 回默认）`
          : `推理等级已设为 ${input}（固定；默认生效；当前会话不可热切；/effort auto 回默认）`)
      },
    },
    {
      name: 'key',
      description: '配置模型供应商 API 密钥（选择供应商 → 掩码输入 + 联网验证；保存即生效）',
      run: () => { deps.openKeyDialog() },
    },
    {
      name: 'login',
      description: '配置模型供应商 API 密钥（/key 别名）',
      run: () => { deps.openKeyDialog() },
    },
    {
      name: 'preset',
      description: '查看/切换/设默认 agent 预设模式',
      argsHint: '[id|default <id>]',
      run: async ({ text, echo, ctx }) => {
        // reflect.get 读取可选服务（Cordis 4 注入代理：未声明属性访问抛
        // "without inject"——/compact /goal 同款；agentPresets 未装配时返回
        // undefined → 降级 fails loud，禁止静默空操作）。
        const facet = ctx.reflect.get('agentPresets', false) as PresetFacet | undefined
        if (facet === undefined) {
          echo('⚠ agent-presets 服务不可用（host 未装配 agent 预设）')
          return
        }
        const target = text.trim()
        if (target === '') {
          const presets = await facet.list()
          const agent = deps.currentAgent()
          const current = agent === null ? undefined : facet.composedPreset?.(agent.ctx)
          echo(`agent 预设 (${presets.length}):`)
          const fallback = facet.defaultId
          for (const preset of presets) {
            const mark = preset.id === current ? '*' : ' '
            const name = preset.name ?? preset.id
            const tag = preset.id === fallback ? '（默认）' : ''
            const desc = preset.description === undefined || preset.description === ''
              ? ''
              : ` — ${preset.description}`
            echo(` ${mark} ${name} (${preset.id})${tag}${desc}`)
          }
          // 当前预设行追加 wire 工具面（最近 request/header 的实际工具 schema，
          // 含 preset 过滤器作用后的最终面——日志事实，非插件内部状态）。
          // 梁神类两阶段 preset 下：双工具面 = 锚定面，run_code = PTC 面。
          let currentLine = current === undefined ? '当前: 未装配（host 默认）' : `当前: ${current}`
          if (agent !== null) {
            const wire = wireToolNames(agent.session.events)
            const surface = formatWireSurface(wire)
            if (surface !== undefined) {
              const phase = wirePhaseLabel(wire)
              currentLine += ` · wire: ${surface}${phase === undefined ? '' : `（${phase}）`}`
            }
          }
          echo(currentLine)
          return
        }
        // /preset default <id>：持久化默认（后续新会话继承），不要求有会话。
        const defaultMatch = target.match(/^default(?:\s+(.+))?$/)
        if (defaultMatch !== null) {
          const id = (defaultMatch[1] ?? '').trim()
          if (id === '') {
            echo('用法：/preset default <id>（设为默认，后续新会话继承）')
            return
          }
          if (facet.setDefault === undefined) {
            echo('⚠ 该部署不支持设置默认预设')
            return
          }
          try {
            await facet.setDefault(id)
            echo(`已将默认预设设为 ${id}（后续新会话继承）`)
          } catch (error) {
            echo(`设置失败: ${error instanceof Error ? error.message : String(error)}`)
          }
          return
        }
        const agent = deps.currentAgent()
        if (agent === null) {
          echo('当前无会话，无法切换预设')
          return
        }
        // 官方 recompose 契约：仅 blank session 可换（换工具集会留下历史 tool
        // call 与新组成不匹配）；检查由调用方负责（方法本身不读会话历史）。
        if (!deps.isBlankSession()) {
          echo('⚠ 会话已产生内容，无法切换预设（仅空白会话可换；新会话默认仍用当前预设）')
          return
        }
        try {
          // 切换链与官方 host 一致（recompose 成功后才 append 落日志；失败
          // 保留原组成且不留记录）。事件类型经上方 declare module 扩展，
          // append 签名全类型检查（key 合法 + data 形状 { agentPreset }）。
          const preset = await facet.recompose(agent.ctx, target)
          agent.session.append('agent-preset/selected', { agentPreset: preset.id })
          echo(`已切换为 ${preset.name ?? preset.id} (${preset.id})`)
        } catch (error) {
          echo(`切换失败: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    },
    {
      name: 'clear',
      description: '清空当前会话滚动区并收起命令面板',
      run: ({ echo }) => {
        deps.clearScrollback()
        echo('已清空当前会话滚动区')
      },
    },
    {
      name: 'compact',
      description: '压缩当前会话（需 compact 服务）',
      run: async ({ text: _text, echo, ctx, sessionId }) => {
        // reflect.get 读取可选服务（Cordis 4 注入代理：属性访问未注册服务
        // 抛 "without inject"——与 T4 sessionProjections 同款修复）
        const compact = ctx.reflect.get('compact', false) as CompactFacet | undefined
        if (compact === undefined) {
          echo('⚠ compact 服务不可用（未加载 compact 插件）')
          return
        }
        if (sessionId === null) {
          echo('⚠ 当前无会话')
          return
        }
        const session = ctx.sessions.get(sessionId)
        if (session === undefined) {
          echo('⚠ 会话不存在')
          return
        }
        const agent = ctx.agents.get(sessionId)
        /* v8 ignore next -- agent 已在上方 undefined 检查放行，此处仅类型收窄；noUncheckedIndexedAccess 防御 */
        const result = await compact.compactIfNeeded(
          { session, options: agent?.options ?? {} },
          'pressure',
          new AbortController().signal,
        )
        echo(result === null ? '无需压缩（或无可压缩范围）' : '压缩完成')
      },
    },
    {
      name: 'goal',
      description: '目标管理：查看/创建/暂停/恢复/完成/阻塞（需 goal 服务）',
      argsHint: '[create <objective>|pause|resume|complete|block]',
      run: ({ text, echo, ctx, sessionId }) => {
        // reflect.get 读取可选服务（与 /compact 同款：goal 插件未装配时
        // 返回 undefined，命令报不可用——fails loud，禁止静默空操作）。
        const goals = ctx.reflect.get('goals', false) as GoalFacet | undefined
        if (goals === undefined) {
          echo('⚠ goal 服务不可用（未加载 goal 插件）')
          return
        }
        if (sessionId === null) {
          echo('⚠ 当前无会话')
          return
        }
        const agent = ctx.agents.get(sessionId)
        if (agent === undefined) {
          echo('⚠ 会话不存在')
          return
        }
        /* v8 ignore next -- split(/\s+/) 恒返回非空数组，[0] 必有值；noUncheckedIndexedAccess 收窄防御 */
        const verb = text.split(/\s+/)[0] ?? ''
        const rest = verb === '' ? '' : text.slice(verb.length).trim()
        if (verb === '') {
          // 无参：查看当前目标（渲染到 live 区；runSlash 在 run 后统一
          // renderLive 刷新）。
          const view = goals.get(agent)
          if (view === undefined) {
            echo('（当前无目标）')
            return
          }
          echo(formatGoalView(view))
          return
        }
        if (verb === 'create') {
          if (rest === '') {
            echo('用法: /goal create <objective>')
            return
          }
          const view = goals.create(agent, { objective: rest })
          echo(`目标已创建: ${view.objective}（phase: ${view.phase}）`)
          return
        }
        const MUTATIONS = ['pause', 'resume', 'complete', 'block'] as const
        if (!(MUTATIONS as readonly string[]).includes(verb)) {
          echo('用法: /goal [create <objective>|pause|resume|complete|block]')
          return
        }
        const current = goals.get(agent)
        if (current === undefined) {
          echo('（当前无目标，无法执行该操作）')
          return
        }
        const ref: GoalRefFacet = { id: current.id, revision: current.revision }
        if (verb === 'pause') {
          const view = goals.pause(agent, ref)
          echo(`目标已暂停: ${view.objective}`)
          return
        }
        if (verb === 'resume') {
          const view = goals.resume(agent, ref)
          echo(`目标已恢复: ${view.objective}（phase: ${view.phase}）`)
          return
        }
        if (verb === 'complete') {
          const view = goals.complete(agent, ref)
          echo(`目标已完成: ${view.objective}`)
          return
        }
        /* v8 ignore next -- MUTATIONS 过滤 + 前三 if 提前 return，此处 verb 恒为 'block'，false 侧不可达 */
        if (verb === 'block') {
          const view = goals.block(agent, ref, {
            code: 'user-requested',
            message: rest === '' ? 'blocked by user via /goal' : rest,
          })
          echo(`目标已阻塞: ${view.objective}`)
          return
        }
      },
    },
    {
      name: 'tasks',
      description: '任务窗格：无参切换；kill <id> 终止后台任务',
      argsHint: '[kill <id>]',
      run: ({ text, echo, ctx }) => {
        /* v8 ignore next -- split(/\s+/) 恒返回非空数组，[0] 必有值；noUncheckedIndexedAccess 收窄防御 */
        const sub = text.split(/\s+/)[0] ?? ''
        if (sub === 'kill') {
          // T2.3：task kill 接线 ctx.tasks.kill（reflect.get 读取可选服务；
          // 与 /compact /goal 同款——tasks 插件未装配时报不可用，fails loud）。
          const id = text.slice(sub.length).trim()
          if (id === '') {
            echo('用法: /tasks kill <id>')
            return
          }
          const tasks = ctx.reflect.get('tasks', false) as TasksFacet | undefined
          if (tasks === undefined) {
            echo('⚠ tasks 服务不可用（未加载 tasks 插件）')
            return
          }
          const result = tasks.kill(id)
          echo(result === 'already-finished' ? `任务已结束: ${id}` : `已请求终止任务: ${id}`)
          return
        }
        if (sub !== '') {
          echo('用法: /tasks [kill <id>]')
          return
        }
        deps.toggleTaskPanel()
      },
    },
    {
      name: 'subagents',
      description: '委派树：无参切换；kill <id> 终止运行中的 continuable 子代理',
      argsHint: '[kill <id>]',
      run: async ({ text, echo, ctx, sessionId }) => {
        const sub = text.split(/\s+/)[0] ?? ''
        if (sub === 'kill') {
          const id = text.slice(sub.length).trim()
          if (id === '') {
            echo('用法: /subagents kill <id>')
            return
          }
          const subagents = ctx.reflect.get('subagents', false) as SubagentsFacet | undefined
          if (subagents === undefined) {
            echo('⚠ subagents 服务不可用（未加载 subagent 插件）')
            return
          }
          if (sessionId === null) {
            echo('⚠ 无活动会话，无法终止子代理')
            return
          }
          const entry = (await subagents.listDescendants(sessionId))
            .find(row => row.kind === 'child' && row.id === id)
          if (entry === undefined) {
            echo(`⚠ 该 id 不在当前委派树中: ${id}`)
            return
          }
          if (entry.mode === 'one-shot') {
            echo(`⚠ 一次性子代理不能经 /subagents kill 终止: ${id}`)
            return
          }
          if (entry.activity === 'inactive') {
            echo(`⚠ 子代理已不在运行: ${id}`)
            return
          }
          try {
            subagents.interrupt(id as SessionId, {
              kind: 'user',
              parentSessionId: entry.parentId as SessionId,
            })
            echo(`已请求终止子代理: ${id}`)
          } catch (error: unknown) {
            echo(`⚠ 终止失败: ${error instanceof Error ? error.message : String(error)}`)
          }
          return
        }
        if (sub !== '') {
          echo('用法: /subagents [kill <id>]')
          return
        }
        deps.toggleSubagentsPanel()
      },
    },
    {
      name: 'workflow',
      description: '切换 workflow 运行中面板',
      run: () => { deps.toggleWorkflowPanel() },
    },
    {
      name: 'btw',
      description: '侧问：向后台 agent 提问（不中断当前对话）',
      argsHint: '<question>',
      run: async ({ text, echo }) => {
        const question = text.trim()
        if (question === '') {
          echo('用法: /btw <question>')
          return
        }
        const started = await deps.askBtw(question)
        if (!started) echo('⚠ 当前无会话或已有挂起的侧问')
      },
    },
    {
      name: 'remember',
      description: '保存一条项目记忆（写入 .dsh/memory/global.md）',
      argsHint: '<text>',
      run: async ({ text, echo, ctx }) => {
        const memory = ctx.reflect.get('memory', false) as MemoryFacet | undefined
        if (memory === undefined) {
          echo('⚠ memory 服务不可用（未加载 memory 插件）')
          return
        }
        const content = text.trim()
        if (content === '') {
          echo('用法: /remember <text>')
          return
        }
        const entry = await memory.save({ text: content, scope: 'global', tags: [], source: 'user' })
        echo(`已保存记忆: ${entry.id}`)
      },
    },
    {
      name: 'memory',
      description: '打开记忆浏览器；delete <id> 直接删除',
      argsHint: '[delete <id>]',
      run: async ({ text, echo, ctx }) => {
        const memory = ctx.reflect.get('memory', false) as MemoryFacet | undefined
        if (memory === undefined) {
          echo('⚠ memory 服务不可用（未加载 memory 插件）')
          return
        }
        /* v8 ignore next -- split(/\s+/) 恒返回非空数组，[0] 必有值；noUncheckedIndexedAccess 收窄防御 */
        const sub = text.split(/\s+/)[0] ?? ''
        if (sub === 'delete') {
          const id = text.slice(sub.length).trim()
          if (id === '') {
            echo('用法: /memory delete <id>')
            return
          }
          await memory.delete(id)
          echo(`已删除记忆: ${id}`)
          return
        }
        if (sub !== '') {
          echo('用法: /memory [delete <id>]')
          return
        }
        if (!await deps.openMemoryBrowser()) {
          echo('⚠ 无法打开记忆浏览器')
        }
      },
    },
    {
      name: 'doctor',
      description: '终端诊断：检测终端能力并输出报告；fix <id> 查看修复指引',
      argsHint: '[fix <id>]',
      run: ({ text, echo }) => {
        const sub = text.trim()
        if (sub.startsWith('fix')) {
          const idStr = sub.slice(3).trim()
          const id = Number(idStr)
          if (Number.isNaN(id) || idStr === '') {
            echo('用法: /doctor fix <id>')
            return
          }
          const guidance = getDoctorFixGuidance(id)
          if (guidance === null) {
            echo(`未知修复项: ${id}`)
            return
          }
          echo(guidance)
          return
        }
        if (sub !== '') {
          echo('用法: /doctor [fix <id>]')
          return
        }
        const cols = process.stdout.columns
        const rows = process.stdout.rows
        const background = process.env.COLORFGBG !== undefined ? '已检测' : '未检测'
        const checks = [
          ...collectDoctorReport(cols, rows, background),
          ...collectNativeDependencyChecks(),
        ]
        echo('终端诊断报告:')
        for (const c of checks) {
          const icon = c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : 'ℹ'
          const fixTag = c.fixId !== undefined ? ` [修复 ${c.fixId}]` : ''
          echo(`  ${icon} ${c.name}: ${c.value}${fixTag}`)
        }
        const fixable = checks.filter(c => c.fixId !== undefined)
        if (fixable.length > 0) {
          echo('')
          echo('可修复项:')
          for (const c of fixable) {
            const id = c.fixId
            if (id === undefined) continue
            const fix = getDoctorFixGuidance(id)
            if (fix !== null) echo(`  [${id}] ${fix.split('\n')[0]}`)
          }
          echo('运行 /doctor fix <id> 查看详细修复指引')
        }
      },
    },
    {
      name: 'mcp',
      description: 'MCP 状态：列出已连接 server 与工具数；tools <name> 查看工具清单',
      argsHint: '[tools <server>]',
      run: ({ text, echo, ctx }) => {
        // 读 mcp-client 的聚合状态表（'mcp.status'：serverName → status）；
        // 经 reflect.get 动态获取——不静态依赖 mcp-client 包。未装配时
        // undefined 兜底（fails loud 禁止静默空操作）。
        const table = ctx.reflect.get('mcp.status', false) as
          | Map<string, { serverName: string; getToolCount(): number; listToolNames(): string[] }>
          | undefined
        if (table === undefined || table.size === 0) {
          echo('⚠ 无 MCP server 连接（检查 cordis.yml 中 mcp-client 插件配置）')
          return
        }
        const sub = text.trim()
        if (sub.startsWith('tools')) {
          const target = sub.slice(5).trim()
          if (target === '') {
            echo('用法: /mcp tools <server>')
            return
          }
          const status = table.get(target)
          if (status === undefined) {
            echo(`未知 MCP server: ${target}。可用: ${[...table.keys()].join(', ')}`)
            return
          }
          const names = status.listToolNames().sort()
          echo(`${target} (${names.length} 工具):`)
          for (const name of names) echo(`  ${name}`)
          return
        }
        if (sub !== '') {
          echo('用法: /mcp [tools <server>]')
          return
        }
        const servers = [...table.values()].sort((a, b) => a.serverName.localeCompare(b.serverName))
        echo(`MCP servers (${servers.length}):`)
        for (const s of servers) {
          echo(`  ${s.serverName}: ${s.getToolCount()} 工具`)
        }
      },
    },
    {
      name: 'scroll',
      description: '全屏转录查看器：翻页/轮次跳转/搜索会话内容（T5）',
      run: ({ echo }) => {
        if (!deps.openTranscriptViewer()) {
          echo('⚠ 无可查看内容（scrollback 为空）')
        }
      },
    },
    {
      name: 'export',
      description: '导出当前会话转录为 Markdown 文件（T3）',
      argsHint: '[path]',
      run: async ({ text, echo }) => {
        // path 缺省由 TuiApp.exportTranscript 决定（会话 cwd 下 dsh-export-<id>.md）；
        // 空串按缺省处理。写文件失败向上抛，由分发层回显失败（fails loud）。
        const path = text.trim() === '' ? undefined : text.trim()
        const written = await deps.exportTranscript(path)
        echo(`会话已导出: ${written}`)
      },
    },
    {
      name: 'exit',
      description: '退出 TUI（与 Ctrl+Q 相同）',
      run: () => { deps.requestExit() },
    },
    {
      name: 'restart',
      description: '重启当前 dsh 进程（同命令重新启动）',
      run: () => { deps.requestRestart() },
    },
    {
      name: 'yolo',
      description: '全放行模式：审批不再逐项询问（on 开启 / off 关闭；等价 Shift+Tab 进 always-approve）',
      argsHint: 'on|off',
      run: ({ text, echo }) => {
        const arg = text.trim().toLowerCase()
        if (arg === 'off' || arg === '0' || arg === 'false') {
          deps.setYoloMode(false)
          echo('全放行模式已关闭（恢复逐项审批）')
          return
        }
        // on / 缺省（无参）均视为开启——与 Shift+Tab 进 always-approve 同语义。
        // 不接宿主 approval/policy=never（其 decide() 语义是自动拒绝，非放行），
        // 映射到 TUI 本地 always-approve（[auto] 徽标），避免语义错位。
        if (arg !== '' && arg !== 'on' && arg !== '1' && arg !== 'true') {
          echo('用法: /yolo [on|off]（缺省 on；off 关闭全放行）')
          return
        }
        deps.setYoloMode(true)
        echo('全放行模式已开启：后续审批请求自动放行（/yolo off 关闭，退出会话复位）')
      },
    },
    {
      name: 'cost',
      description: '当前会话累计用量与成本估算（按模型分桶）',
      argsHint: '',
      run: ({ echo }) => {
        for (const line of deps.sessionCostReport()) echo(line)
      },
    },
    {
      name: 'help',
      description: '列出全部命令与用法（/help <cmd> 查看单条详情）',
      argsHint: '[cmd]',
      run: ({ text, echo }) => {
        // 注册表经 deps 注入（TuiApp 持有 this.slash 实例）——不访问 ctx 属性：
        // Cordis 注入代理对未声明属性直接抛 "without inject"（#36 根因）。
        const all = deps.listCommands()
        const target = text.trim()
        if (target !== '') {
          const command = all.find(c => c.name === target)
          if (command === undefined) {
            echo(`未知命令: /${target}（/help 查看全部命令）`)
            return
          }
          echo(`/${command.name}${command.argsHint === undefined ? '' : ` ${command.argsHint}`} — ${command.description}`)
          return
        }
        echo(`全部命令（${all.length} 条）:`)
        for (const command of all) {
          echo(`  /${command.name}${command.argsHint === undefined ? '' : ` ${command.argsHint}`} — ${command.description}`)
        }
        echo('快捷键见 Ctrl+. 键位表')
        echo('分组浏览/过滤: Ctrl+P 命令面板（会话/配置/认证/面板/系统）')
      },
    },
  ]
}

/** 渲染一行当前目标（/goal 无参视图）。 */
function formatGoalView(view: GoalViewFacet): string {
  return `目标: ${view.objective}（phase: ${view.phase}，rounds: ${view.roundsStarted}/${view.maxGoalRounds}）`
}

/**
 * 未知命令的相近建议（闭环引导）：编辑距离命中（≤ 2 且 ≤ 输入长度一半——
 * 短输入只信前缀，防 /st 误建议 btw/cost），其次公共前缀 ≥ 2。
 * 歧义前缀（如 /st → steer/status）与笔误（如 /glans → glance）都能命中；
 * 无相近命令返回空数组（调用方回退「/help 查看全部」引导）。
 * @param input - 完整 slash 输入（含 / 前缀；大小写不敏感）。
 * @param commands - 命令列表。
 * @param limit - 建议条数上限（缺省 3）。
 * @returns 建议命令（匹配度升序；距离相同时短名优先）。
 */
export function suggestCommands(
  input: string,
  commands: readonly SlashCommand[],
  limit = 3,
): SlashCommand[] {
  const name = input.replace(/^\//, '').trim().toLowerCase()
  if (name === '') return []
  const scored: Array<{ cmd: SlashCommand; score: number }> = []
  for (const cmd of commands) {
    const d = levenshteinDistance(name, cmd.name)
    const prefix = commonPrefixLength(name, cmd.name)
    if (d <= 2 && d <= Math.floor(name.length / 2)) scored.push({ cmd, score: d })
    else if (prefix >= 2) scored.push({ cmd, score: 3 })
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    if (a.cmd.name.length !== b.cmd.name.length) return a.cmd.name.length - b.cmd.name.length
    return a.cmd.name.localeCompare(b.cmd.name)
  })
  return scored.slice(0, limit).map(s => s.cmd)
}

/** 编辑距离（经典 DP；len 乘积空间，命令名短小足够）。 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...Array(n)]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
    }
    prev = curr
  }
  return prev[n]!
}

/** 最长公共前缀长度。 */
function commonPrefixLength(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

export { getActiveThemeName }
