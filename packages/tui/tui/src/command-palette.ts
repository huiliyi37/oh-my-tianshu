/**
 * command-palette — Ctrl+P 命令面板（纯状态机 + 渲染）。
 *
 * 数据源 = SlashCommandRegistry（getCommands 现取，插件扩展后可见）；
 * 过滤 = 名称/描述子串 + 名称子序列，前缀优先；状态机 open/type/backspace/move/close。
 */
import type { SlashCommand } from './commands/registry.js'
import { color } from './engine/ansi.js'
import type { RivetTheme } from './theme.js'
import { displayWidth } from './width.js'

/** 面板条目：命令名（不含 `/` 前缀）+ 描述 + 可选参数提示。 */
export interface PaletteEntry {
  name: string
  description: string
  argsHint?: string
}

/** 面板状态：开合 + 查询串 + 选中下标（指向过滤后列表）。 */
export interface PaletteState {
  open: boolean
  query: string
  selected: number
}

/** 状态机输入事件（move 的 count = 过滤后可见条目数，由调用方计算）。 */
export type PaletteEvent =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'type'; char: string }
  | { type: 'backspace' }
  | { type: 'move'; delta: number; count: number }

/**
 * 初始面板状态（关闭、空查询、选中第 0 项）。
 * @returns 初始状态。
 */
export function emptyPaletteState(): PaletteState {
  return { open: false, query: '', selected: 0 }
}

/**
 * SlashCommand → 面板条目。
 * @param commands - 注册表命令列表。
 * @returns 面板条目（argsHint 缺省时不带该字段）。
 */
export function toPaletteEntries(commands: readonly SlashCommand[]): PaletteEntry[] {
  return commands.map(c => ({ name: c.name, description: c.description, ...(c.argsHint === undefined ? {} : { argsHint: c.argsHint }) }))
}

function isSubsequence(query: string, name: string): boolean {
  let i = 0
  for (const ch of name) {
    if (ch === query[i]) i++
    if (i === query.length) return true
  }
  return i === query.length
}

/**
 * 模糊过滤：名称/描述子串 + 名称子序列；前缀优先排序；大小写不敏感。
 * @param entries - 全部条目。
 * @param query - 查询串（trim 后为空则返回全部）。
 * @returns 过滤排序后的条目。
 */
export function filterPalette(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...entries]
  const hit: PaletteEntry[] = []
  const tail: PaletteEntry[] = []
  for (const e of entries) {
    const name = e.name.toLowerCase()
    const desc = e.description.toLowerCase()
    if (name.startsWith(q)) hit.push(e)
    else if (name.includes(q) || desc.includes(q) || isSubsequence(q, name)) tail.push(e)
  }
  return [...hit, ...tail]
}

/**
 * 过滤后可见条目（selected 指向过滤列表下标）。
 * @param state - 面板状态（取 query）。
 * @param entries - 全部条目。
 * @returns 过滤后条目。
 */
export function paletteVisibleEntries(state: PaletteState, entries: readonly PaletteEntry[]): PaletteEntry[] {
  return filterPalette(entries, state.query)
}

/**
 * 折叠一个事件进入面板状态（纯函数）：open 重置查询与选中、type 追加字符并
 * 归零选中、move 在 [0, count-1] 内夹紧移动。
 * @param state - 当前状态。
 * @param event - 输入事件。
 * @returns 新状态。
 */
export function applyPaletteEvent(state: PaletteState, event: PaletteEvent): PaletteState {
  switch (event.type) {
    case 'open':
      return { ...state, open: true, query: '', selected: 0 }
    case 'close':
      return { ...state, open: false }
    case 'type':
      return { ...state, query: state.query + event.char, selected: 0 }
    case 'backspace':
      return { ...state, query: state.query.slice(0, -1) }
    case 'move': {
      // count = 过滤后可见条目数（调用方计算；0 → 无项可选中，selected 归 0）
      const maxIndex = Math.max(0, event.count - 1)
      const next = state.selected + event.delta
      return { ...state, selected: Math.max(0, Math.min(next, maxIndex)) }
    }
  }
}

/**
 * 回填文本：`/name `（含尾随空格，用户续写参数）。
 * @param entry - 选中条目。
 * @returns 回填到输入框的文本。
 */
export function paletteCommitText(entry: PaletteEntry): string {
  return `/${entry.name} `
}

/**
 * overlay 渲染：头 + 条目（选中 ▶ 高亮、宽度截断）+ 底部键位提示；滚动窗口跟随选中。
 * @param state - 面板状态。
 * @param entries - 全部条目（内部按 query 过滤）。
 * @param width - 可用显示宽度（条目按此截断）。
 * @param height - 可用行数（头尾各占一行，其余给条目窗口）。
 * @param theme - 主题（取语义色）。
 * @returns 渲染行数组（含 ANSI）。
 */
export function renderCommandPalette(
  state: PaletteState,
  entries: readonly PaletteEntry[],
  width: number,
  height: number,
  theme: RivetTheme,
): string[] {
  const visible = filterPalette(entries, state.query)
  const lines: string[] = [color('命令面板', theme.brandColor, { bold: true })]
  if (visible.length === 0) {
    lines.push(color('无匹配', theme.muted))
  } else {
    const bodyHeight = Math.max(1, height - 2)
    const sel = Math.max(0, Math.min(state.selected, visible.length - 1))
    const start = Math.max(0, sel - bodyHeight + 1)
    const window = visible.slice(start, start + bodyHeight)
    for (let i = 0; i < window.length; i++) {
      const e = window[i]
      /* v8 ignore next 1 -- unreachable: window 来自 visible.slice()，元素恒非 undefined */
      if (e === undefined) continue
      const isSel = start + i === sel
      const label = `/${e.name}${e.argsHint !== undefined ? ` ${e.argsHint}` : ''}`
      const text = isSel ? `▶ ${label}` : `  ${label}`
      const clipped = truncate(text, width)
      lines.push(isSel ? color(clipped, theme.primary, { bold: true }) : color(clipped, theme.dim))
    }
  }
  lines.push(color('Enter 执行 · Esc 关闭', theme.muted))
  return lines
}

function truncate(text: string, width: number): string {
  let out = ''
  for (const ch of text) {
    if (displayWidth(out + ch) > width) break
    out += ch
  }
  return out
}

/** CommandPalette 构造选项（两个读取函数均动态现取）。 */
export interface CommandPaletteOptions {
  /** 命令列表读取函数（动态，插件扩展后新命令可见）。 */
  getCommands: () => readonly SlashCommand[]
  /** 主题读取函数（动态，切主题后 overlay 立即生效）。 */
  getTheme: () => RivetTheme
}

/** Ctrl+P 面板控制器：open/toggle/type/move/commit，实现 OverlayRenderer 契约。 */
export class CommandPalette {
  private state: PaletteState = emptyPaletteState()
  /** 确认模式：true = execute（Enter 直接执行 `/name`）；false = backfill（回填 `/name `）。 */
  private executeMode = false
  private readonly getCommands: () => readonly SlashCommand[]
  private readonly getTheme: () => RivetTheme

  constructor(opts: CommandPaletteOptions) {
    this.getCommands = opts.getCommands
    this.getTheme = opts.getTheme
  }

  /**
   * 面板是否打开。
   * @returns 开合状态。
   */
  isOpen(): boolean {
    return this.state.open
  }

  /** 打开面板（重置查询与选中）。
   * @param execute - true 为 execute 模式（Enter 直接执行 `/name`，Tab 命令菜单用）；
   *                  缺省 false 为 backfill 模式（Ctrl+P 命令面板，回填 `/name `）。
   */
  open(execute = false): void {
    this.executeMode = execute
    this.state = applyPaletteEvent(this.state, { type: 'open' })
  }

  /** 关闭面板（保留查询，下次 open 时重置）。 */
  close(): void {
    this.state = applyPaletteEvent(this.state, { type: 'close' })
  }

  /** 开合切换。 */
  toggle(): void {
    if (this.state.open) this.close()
    else this.open()
  }

  /**
   * 追加查询字符（选中归零）。
   * @param char - 输入字符。
   */
  type(char: string): void {
    this.state = applyPaletteEvent(this.state, { type: 'type', char })
  }

  /**
   * 移动选中项（在过滤后列表范围内夹紧）。
   * @param delta - 移动量（负上正下）。
   */
  move(delta: number): void {
    // 夹紧上限取过滤后可见条目数（count 由调用方算，状态机保持纯函数）。
    this.state = applyPaletteEvent(this.state, { type: 'move', delta, count: this.paletteVisible().length })
  }

  /** 当前查询串。 */
  get query(): string {
    return this.state.query
  }

  /** 过滤后可见条目（paletteVisible 的别名访问器）。 */
  get entries(): PaletteEntry[] {
    return this.paletteVisible()
  }

  /**
   * 过滤后可见条目（命令现取自 getCommands）。
   * @returns 过滤后条目。
   */
  paletteVisible(): PaletteEntry[] {
    return paletteVisibleEntries(this.state, toPaletteEntries(this.getCommands()))
  }

  /**
   * 提交选中项：返回条目 + 文本 + 确认模式；无选中返回 null。
   * execute 模式文本为 `/name`（无尾随空格，调用方直接执行）；backfill 模式
   * 为 `/name `（含尾随空格，调用方回填输入框续写参数）。
   * @returns 条目与文本/模式；选中越界（如无匹配）返回 null。
   */
  commit(): { entry: PaletteEntry; text: string; execute: boolean } | null {
    const visible = this.paletteVisible()
    const entry = visible[this.state.selected]
    if (entry === undefined) return null
    return this.executeMode
      ? { entry, text: `/${entry.name}`, execute: true }
      : { entry, text: paletteCommitText(entry), execute: false }
  }

  /**
   * OverlayRenderer 契约：render(width, height) → string[]。
   * @param width - 可用显示宽度。
   * @param height - 可用行数。
   * @returns 渲染行数组（含 ANSI）。
   */
  render(width: number, height: number): string[] {
    return renderCommandPalette(this.state, toPaletteEntries(this.getCommands()), width, height, this.getTheme())
  }
}
