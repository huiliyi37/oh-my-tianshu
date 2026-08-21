/**
 * config-panel — /config 交互式设置面板（双栏 framed overlay，T3.2 深度优化版）。
 *
 * 对标天枢（opencode-tui）/config 的交互词汇：左类目栏 + 右字段栏、光标导航、
 * 页脚键位提示、居中窗口滚动。刻意偏离其持久化模型：harness 的全部写面
 * （modelRoles.pin / agentDefaultModel.saveSelection / permission.apply /
 * settings.mutate / credentials.set）都即时热生效，因此没有草稿与脏块保存
 * 机制——Enter 即编辑、完成即生效，面板只负责导航与分派。
 *
 * 分层：本模块是纯渲染 + 状态机（OverlayRenderer 契约），不认识任何服务；
 * 数据（类目/字段/动作意图）由装配方（app.ts 的 buildConfigPanelData）注入，
 * 编辑动作经 ConfigPanelActions.edit 分派回装配方（打开 /model picker、角色
 * picker、effort picker、权限 picker 或 /key 供应商对话框），编辑器关闭后由
 * 装配方回开本面板。
 *
 * @module @huiliyi37/dsh-tui/config-panel
 */

import type { OverlayRenderer } from './engine/overlay-engine.js'
import { color } from './engine/ansi.js'
import type { RivetTheme } from './theme.js'
import { displayWidth } from './width.js'

/** 字段编辑动作：装配方据此分派编辑器（none = 只读展示）。 */
export type ConfigFieldAction =
  | { kind: 'edit-default-model' }
  | { kind: 'edit-effort' }
  | { kind: 'edit-role'; role: 'vision' | 'secondary' | 'subagent' }
  | { kind: 'edit-permission' }
  | { kind: 'edit-credential'; provider: string }
  | { kind: 'none' }

/** 一个可展示/可编辑的配置字段。 */
export interface ConfigField {
  /** 稳定键（刷新数据后保持游标位置用）。 */
  key: string
  /** 字段标签（右栏左列）。 */
  label: string
  /** 当前值显示文本。 */
  value: string
  /** 选中时的状态行提示（字段用途一句话；缺省用类目回退提示）。 */
  hint?: string
  /** 是否可编辑（Enter 有分派；false 时 Enter 无动作）。 */
  editable: boolean
  /** 编辑动作。 */
  action: ConfigFieldAction
}

/** 一个类目（左栏一行，右栏一组字段）。 */
export interface ConfigCategory {
  /** 稳定键。 */
  key: string
  /** 类目标签（左栏）。 */
  label: string
  /** 字段列表（空数组渲染占位行）。 */
  fields: ConfigField[]
}

/** 面板数据：类目列表（声明序即展示序）。 */
export interface ConfigPanelData {
  categories: ConfigCategory[]
}

/** 装配方分派面：字段编辑 + 面板关闭。 */
export interface ConfigPanelActions {
  /** 字段 Enter：打开对应编辑器（完成后装配方回开面板）。 */
  edit(action: ConfigFieldAction): void
  /** 用户请求关闭（Esc/Ctrl+C）。 */
  close(): void
}

/** 焦点栏：左类目 / 右字段。 */
type Focus = 'categories' | 'fields'

/** 面板标题。 */
const TITLE = '⚙ 配置'
/** 光标符。 */
const CURSOR = '>'
/** 左栏宽度下限。 */
const LEFT_MIN = 8
/** 左栏宽度上限。 */
const LEFT_MAX = 20
/** 状态行提示色调：info / error。 */
export type ConfigStatusTone = 'info' | 'error'

/**
 * /config 面板控制器：双栏游标状态机 + framed 渲染。open/refresh 注入数据
 * （refresh 保持类目与字段键上的游标），键路由由装配方在 overlay 激活时全量
 * 转发；wantsClose 为 true 时装配方 deactivate。
 */
export class ConfigPanelController implements OverlayRenderer {
  private data: ConfigPanelData | null = null
  private categoryIndex = 0
  private fieldIndex = 0
  private focus: Focus = 'categories'
  private status: { text: string; tone: ConfigStatusTone } | null = null
  private openFlag = false
  private closeRequested = false
  private readonly getTheme: () => RivetTheme
  private readonly editAction: ConfigPanelActions['edit']
  private readonly closeAction: ConfigPanelActions['close']

  constructor(opts: { getTheme: () => RivetTheme } & ConfigPanelActions) {
    this.getTheme = opts.getTheme
    // 闭包包装：opts 是参数对象（非类实例），直接取方法引用会被 unbound-method 误报。
    this.editAction = (action) => { opts.edit(action) }
    this.closeAction = () => { opts.close() }
  }

  /**
   * 打开面板（重置游标到首个类目）。
   * @param data - 面板数据。
   */
  open(data: ConfigPanelData): void {
    this.data = data
    this.categoryIndex = 0
    this.fieldIndex = 0
    this.focus = 'categories'
    this.status = null
    this.openFlag = true
    this.closeRequested = false
  }

  /**
   * 编辑器关闭后的回开：注入新数据但保持游标（按类目/字段键定位；失配回退首项）。
   * @param data - 刷新后的面板数据。
   */
  refresh(data: ConfigPanelData): void {
    const prevCategory = this.currentCategory()?.key
    const prevField = this.currentField()?.key
    this.data = data
    this.openFlag = true
    this.closeRequested = false
    if (prevCategory !== undefined) {
      const ci = data.categories.findIndex(category => category.key === prevCategory)
      if (ci >= 0) this.categoryIndex = ci
    }
    if (prevField !== undefined) {
      const fields = this.currentCategory()?.fields ?? []
      const fi = fields.findIndex(field => field.key === prevField)
      if (fi >= 0) this.fieldIndex = fi
    }
    this.clampCursors()
  }

  /**
   * 面板是否打开（deactivate 时置假，迟到结果丢弃）。
   * @returns 打开返回 true。
   */
  isOpen(): boolean {
    return this.openFlag
  }

  /**
   * 处理按键（装配方在 overlay 激活时全量转发；本方法总是消费）。
   * ↑↓ 栏内移动；←→/Tab 切栏（Shift+Tab 回左）；Enter：类目栏下钻、字段栏
   * 分派编辑（不可编辑字段提示）；Esc/Ctrl+C 请求关闭。
   * @param name - 按键名。
   * @param _char - 可打印字符（本面板无文本编辑，忽略）。
   */
  handleKey(name: string, _char: string): void {
    if (!this.openFlag || this.data === null) return
    switch (name) {
      case 'escape':
      case 'ctrl_c':
        this.closeRequested = true
        this.closeAction()
        return
      case 'up':
      case 'k':
        this.move(-1)
        return
      case 'down':
      case 'j':
        this.move(1)
        return
      case 'left':
      case 'tab':
        this.focus = 'categories'
        return
      case 'right':
        if (this.currentCategory()?.fields.length !== 0) this.focus = 'fields'
        return
      case 'return': {
        if (this.focus === 'categories') {
          if (this.currentCategory()?.fields.length !== 0) this.focus = 'fields'
          return
        }
        const field = this.currentField()
        if (field === undefined) return
        if (!field.editable) {
          this.status = { text: '该项只读', tone: 'info' }
          return
        }
        this.editAction(field.action)
        return
      }
      default:
        return
    }
  }

  /**
   * 装配方查询：用户已请求关闭。
   * @returns 请求关闭返回 true。
   */
  wantsClose(): boolean {
    return this.closeRequested
  }

  /** OverlayRenderer 契约：失活时关旗标。 */
  onDeactivate(): void {
    this.openFlag = false
  }

  /** 当前类目（越界防禘认为空面板）。 */
  private currentCategory(): ConfigCategory | undefined {
    return this.data?.categories[this.categoryIndex]
  }

  /** 当前字段（类目字段列表越界时 undefined）。 */
  private currentField(): ConfigField | undefined {
    return this.currentCategory()?.fields[this.fieldIndex]
  }

  /** 栏内移动（上下键在焦点栏内换行；越界钳制）。 */
  private move(delta: number): void {
    if (this.focus === 'categories') {
      const count = this.data?.categories.length ?? 0
      if (count === 0) return
      this.categoryIndex = (this.categoryIndex + delta + count) % count
      this.fieldIndex = 0
      return
    }
    const count = this.currentCategory()?.fields.length ?? 0
    if (count === 0) return
    this.fieldIndex = (this.fieldIndex + delta + count) % count
  }

  /** 数据刷新后的游标钳制（类目/字段可能变少）。 */
  private clampCursors(): void {
    const categories = this.data?.categories ?? []
    if (categories.length === 0) {
      this.categoryIndex = 0
      this.fieldIndex = 0
      this.focus = 'categories'
      return
    }
    if (this.categoryIndex >= categories.length) this.categoryIndex = 0
    const fieldCount = categories[this.categoryIndex]?.fields.length ?? 0
    if (this.fieldIndex >= fieldCount) this.fieldIndex = 0
    if (fieldCount === 0) this.focus = 'categories'
  }

  /**
   * OverlayRenderer 契约：render(width, height)。framed 双栏——顶行标题、
   * 内容区（左类目 + 分隔线 + 右字段，双栏各自居中窗口滚动）、状态行、
   * 页脚键位、底行。高度不足时内容区先行收缩（< 6 退化为单行 …）。
   * @param width - 可用显示宽度。
   * @param height - 可用行数。
   * @returns 渲染行数组（含 ANSI）。
   */
  render(width: number, height: number): string[] {
    const theme = this.getTheme()
    if (width <= 4 || height < 6) return [truncateByWidth(TITLE, width)]
    const rows: string[] = []
    rows.push(frameLine('top', TITLE, width, theme))
    const contentRows = Math.max(1, height - 4)
    const leftW = Math.min(LEFT_MAX, Math.max(LEFT_MIN, widestLabel(this.data) + 4))
    const dividerCol = leftW + 1
    const rightW = Math.max(4, width - dividerCol - 2)
    for (let i = 0; i < contentRows; i++) {
      const left = this.renderCategoryRow(i, contentRows, leftW, theme)
      const right = this.renderFieldRow(i, contentRows, rightW, theme)
      rows.push(`│${left}${color('│', theme.dim)}${right}│`)
    }
    const status = this.statusText()
    rows.push(`│${status === null
      ? ' '.repeat(width - 2)
      : color(padToWidth(status.tone === 'error' ? `✗ ${status.text}` : status.text, width - 2),
        status.tone === 'error' ? theme.error : theme.muted)}│`)
    rows.push(frameLine('divider', undefined, width, theme))
    const footer = '↑↓ 移动 · ←→ 切栏 · Enter 编辑 · Esc 退出'
    // 窄终端下页脚文本可能超出预算：先截断再补白（padToWidth 不截断）。
    rows.push(`│${color(padToWidth(truncateByWidth(footer, width - 2), width - 2), theme.muted)}│`)
    rows.push(frameLine('bottom', undefined, width, theme))
    return rows
  }

  /** 左栏一行：光标（焦点时）+ 类目标签（选中态着色）。 */
  private renderCategoryRow(index: number, contentRows: number, leftW: number, theme: RivetTheme): string {
    const categories = this.data?.categories ?? []
    const start = windowStart(this.categoryIndex, categories.length, contentRows)
    const category = categories[start + index]
    if (category === undefined) return ' '.repeat(leftW)
    const selected = start + index === this.categoryIndex
    const cursor = this.focus === 'categories' && selected ? color(CURSOR, theme.primary, { bold: true }) : ' '
    const label = selected
      ? color(category.label, this.focus === 'categories' ? theme.primary : theme.secondary)
      : color(category.label, theme.muted)
    return padToWidth(`${cursor} ${label}`, leftW)
  }

  /** 右栏一行：光标（焦点时）+ 标签 + 当前值（两列预算精确到 rightW）。 */
  private renderFieldRow(index: number, contentRows: number, rightW: number, theme: RivetTheme): string {
    const fields = this.currentCategory()?.fields ?? []
    if (fields.length === 0) {
      return padToWidth(index === 0 ? color('（无配置项）', theme.muted) : '', rightW)
    }
    const start = windowStart(this.fieldIndex, fields.length, contentRows)
    const field = fields[start + index]
    if (field === undefined) return ' '.repeat(rightW)
    const selected = start + index === this.fieldIndex
    const cursor = this.focus === 'fields' && selected ? color(CURSOR, theme.primary, { bold: true }) : ' '
    const labelW = Math.min(Math.max(6, Math.floor(rightW / 3)), widestFieldLabel(fields))
    const valueW = Math.max(2, rightW - 2 - labelW - 1)
    // 先补白再着色：displayWidth 不识别 ANSI，着色必须落在定宽纯文本上。
    const label = color(padToWidth(field.label, labelW), selected ? theme.secondary : theme.muted)
    const value = color(truncateByWidth(field.value, valueW), field.editable ? theme.primary : theme.dim)
    return padToWidth(`${cursor} ${label} ${value}`, rightW)
  }

  /** 状态行（纯文本 + 色调；错误红 / 提示 muted；无状态时空行）。 */
  private statusText(): { text: string; tone: ConfigStatusTone } | null {
    if (this.status !== null) return this.status
    const field = this.currentField()
    if (field?.hint !== undefined) return { text: field.hint, tone: 'info' }
    const category = this.currentCategory()
    if (category === undefined) return null
    if (this.focus === 'categories') return { text: `${category.label} · ←→ 切栏 · Enter 查看字段`, tone: 'info' }
    return null
  }
}

/** 类目标签最大显示宽度（空数据返回 0）。 */
function widestLabel(data: ConfigPanelData | null): number {
  if (data === null) return 0
  return data.categories.reduce((max, category) => Math.max(max, displayWidth(category.label)), 0)
}

/** 字段标签最大显示宽度（用于右栏标签列预算）。 */
function widestFieldLabel(fields: readonly ConfigField[]): number {
  return fields.reduce((max, field) => Math.max(max, displayWidth(field.label)), 0)
}

/**
 * 居中窗口起点：选中项保持在窗口中央；短列表不滚动（起点 0）。
 * @param index - 选中下标。
 * @param count - 条目总数。
 * @param rows - 窗口行数。
 * @returns 窗口起始下标。
 */
function windowStart(index: number, count: number, rows: number): number {
  if (count <= rows) return 0
  const start = index - Math.floor(rows / 2)
  return Math.max(0, Math.min(start, count - rows))
}

/**
 * 框线行：top 带标题、divider/bottom 平线；宽度精确补齐。
 * @param edge - 框位。
 * @param title - 顶行标题（仅 top）。
 * @param width - 总宽。
 * @param theme - 主题（框线 dim）。
 * @returns 框线行（含 ANSI）。
 */
function frameLine(edge: 'top' | 'divider' | 'bottom', title: string | undefined, width: number, theme: RivetTheme): string {
  const dim = (text: string): string => color(text, theme.dim)
  const inner = width - 2
  if (edge === 'top' && title !== undefined) {
    const text = ` ${title} `
    const used = displayWidth(title) + 2
    return `${dim('┌')}${dim(text)}${dim('─'.repeat(Math.max(0, inner - used)))}${dim('┐')}`
  }
  const horiz = edge === 'divider' ? '├' : '└'
  const horizEnd = edge === 'divider' ? '┤' : '┘'
  return `${dim(horiz)}${dim('─'.repeat(Math.max(0, inner)))}${dim(horizEnd)}`
}

/** 按显示宽度右侧补空格（超宽不截断——调用方先行截断）。 */
function padToWidth(text: string, width: number): string {
  const w = displayWidth(text)
  return w >= width ? text : text + ' '.repeat(width - w)
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
