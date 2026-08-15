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
import type { SessionId } from '@huiliyi37/dsh-session'
import type { Agent } from '@huiliyi37/dsh-agent'
import { getActiveThemeName, setTheme, THEME_NAMES } from '../theme.js'
import { listSessions, loadHistory } from '../adapter/sessions.js'
import { sessionTitleFor } from '../adapter/session-title.js'
import { collectDoctorReport, getDoctorFixGuidance } from '../format/doctor-report.js'

// agent-preset/selected 事件由 host 的 dsh-agent-presets 声明扩展（官方同款
// declare module）；插件本地声明同型合并——host 包进入依赖后 interface 合并
// 且属性类型一致（{ agentPreset: string }），无冲突。此扩展使
// Session.append('agent-preset/selected', ...) 获得完整类型检查。
declare module '@huiliyi37/dsh-session/types' {
  interface SessionEventMap {
    /**
     * 用户经 `/preset` 选定 agent 预设的事实记录。载荷 `agentPreset` 是选中的预设名;
     * log-only,只供投影与审计回放,不进模型派生历史。
     */
    'agent-preset/selected': { agentPreset: string }
  }
}

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
interface ModelFacet {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
  saveSelection(next: { provider: string; model: string; reasoningEffort?: string }): Promise<void>
}

/** /preset 所需的最小 agent-presets 服务面（不引入 dsh-agent-presets 依赖）。 */
interface PresetFacet {
  /** 当前配置根提供的全部预设（first-root-wins per id）。 */
  list(): Promise<Array<{ id: string; name?: string; description?: string }>>
  /** 一个 live agent 当前运行的预设 id（作用域链读取；未加入任何预设返回 undefined）。 */
  composedPreset?(agentCtx: Context): string | undefined
  /** 把 agent 重绑到另一预设的 standing 组成；调用方负责 blank-session 检查。 */
  recompose(agentCtx: Context, id: string): Promise<{ id: string; name?: string }>
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
 * TuiApp 的显隐切换）；/status 保持 TuiApp 内注册。
 */
export const BUILTIN_COMMAND_NAMES = ['theme', 'session', 'fork', 'branch', 'clear', 'compact', 'steer', 'model', 'effort', 'preset', 'tasks', 'density', 'goal', 'status', 'subagents', 'workflow', 'config', 'skills', 'rewind', 'btw', 'doctor', 'mcp', 'remember', 'memory', 'export', 'exit', 'yolo'] as const

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
  /** /rewind（C3 项 3）：打开 rewind overlay；返回是否已打开（无会话时 false）。 */
  rewindSession(): boolean
  /** /btw（P1）：发起侧问；返回是否已发起（无会话/已有挂起侧问时 false）。 */
  askBtw(question: string): Promise<boolean>
  /** /memory（P2）：打开记忆浏览器 overlay；返回是否已打开（无 memory 服务时 false）。 */
  openMemoryBrowser(): Promise<boolean>
  /** /session switch（P3）：切换到既有 live 会话（id 字符串；app 侧转 SessionId）。 */
  switchSession(id: string): Promise<void>
  /** /export（T3）：导出当前会话转录为 Markdown；path 缺省由实现决定；返回导出文件路径。 */
  exportTranscript(path?: string): Promise<string>
  /** /exit：请求退出 TUI（与 Ctrl+Q 同一 onExit 路径）。 */
  requestExit(): void
  /** /preset：当前会话的 agent（recompose/composedPreset 的 agentCtx 来源；无会话为 null）。 */
  currentAgent(): Agent | null
  /** /preset：当前会话是否 blank（无消息且无进行中工具调用）——recompose 的调用方契约。 */
  isBlankSession(): boolean
  /** /yolo：开启/关闭全放行模式（approval always-approve 快捷入口）。 */
  setYoloMode(flag: boolean): void
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
          echo(`用法: /theme <name>。可用: ${THEME_NAMES.join(', ')}`)
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
          // 不调 API、不写 sidecar、不写 session log。
          for (const row of rows) {
            const events = await loadHistory(ctx, row.id)
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
      description: '回退到指定消息（C3 项 3：会话截断 + 可选文件回退）',
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
      description: '查看或切换模型（默认 + 当前会话热切；spark-flash / spark-pro 别名一键切 spark）',
      argsHint: '[provider/model | spark-flash | spark-pro]',
      run: async ({ text, echo, ctx }) => {
        // as unknown as：Context 声明合并的 agentDefaultModel 是完整服务面，
        // 这里只消费最小读/写两方法（本地 ModelFacet）。
        const facet = (ctx as unknown as { agentDefaultModel?: ModelFacet }).agentDefaultModel
        if (facet === undefined) {
          echo('⚠ agent-default-model 服务不可用')
          return
        }
        const current = facet.currentSelection()
        const raw = text.trim()
        if (raw === '') {
          const effortPart = current.reasoningEffort === undefined
            ? ''
            : ` (effort: ${current.reasoningEffort})`
          echo(`当前模型: ${current.provider}/${current.model}${effortPart}`)
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
        const parts = input.split('/')
        // noUncheckedIndexedAccess：parts 元素可能 undefined，空串回退无害
        /* v8 ignore next 2 -- split 恒返回非空数组且元素恒为 string；noUncheckedIndexedAccess 收窄防御 */
        const next = parts.length === 2
          ? { provider: parts[0] ?? '', model: parts[1] ?? '' }
          : { provider: current.provider, model: parts[0] ?? '' }
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
      name: 'preset',
      description: '查看/切换 agent 预设模式（标准 / PTC / 极简 / 创造）',
      argsHint: '[id]',
      run: async ({ text, echo, ctx }) => {
        // as unknown as：Context 声明合并的 agentPresets 是完整服务面，
        // 这里只消费最小读/切三方法（本地 PresetFacet）。
        const facet = (ctx as unknown as { agentPresets?: PresetFacet }).agentPresets
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
          for (const preset of presets) {
            const mark = preset.id === current ? '*' : ' '
            const name = preset.name ?? preset.id
            const desc = preset.description === undefined || preset.description === ''
              ? ''
              : ` — ${preset.description}`
            echo(` ${mark} ${name} (${preset.id})${desc}`)
          }
          echo(current === undefined ? '当前: 未装配（host 默认）' : `当前: ${current}`)
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
      description: '清空当前会话滚动区',
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
      description: '切换委派树面板（subagent 层级投影）',
      run: () => { deps.toggleSubagentsPanel() },
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
        const checks = collectDoctorReport(cols, rows, background)
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
  ]
}

/** 渲染一行当前目标（/goal 无参视图）。 */
function formatGoalView(view: GoalViewFacet): string {
  return `目标: ${view.objective}（phase: ${view.phase}，rounds: ${view.roundsStarted}/${view.maxGoalRounds}）`
}

export { getActiveThemeName }
