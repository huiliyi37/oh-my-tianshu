/**
 * picker — 交互式选择器 overlay（Issue #31：主题/模型/会话切换用上下键选择）。
 *
 * 纯状态机 + 渲染 + 控制器，与 command-palette 同构（OverlayRenderer 契约）。
 * 打开时注入条目与确认回调；↑/↓ 移动、PageUp/PageDown 翻页、Enter 确认、
 * Esc/q 关闭。当前值条目带 ● 标记（current），选中项 ▶ 高亮。
 *
 * @module @huiliyi37/dsh-tui/picker
 */

import { color } from './engine/ansi.js'
import type { RivetTheme } from './theme.js'
import { displayWidth } from './width.js'

/** 选择器条目：展示标签 + 提交值 + 当前值标记。 */
export interface PickerItem {
  /** 展示标签（列表行原文，窄宽截断）。 */
  label: string
  /** 提交值（确认回调的入参）。 */
  value: string
  /** 当前生效值（列表行 ● 标记；无匹配条目时忽略）。 */
  current?: boolean
  /** 行内附加调节位（如 `</>` 步进的档位值）；渲染在 label 之后。 */
  detail?: string
}

/** 确认回调：选中条目 → 调用方执行动作。 */
export type PickerCommit = (item: PickerItem) => void

/** 预览回调：选中变化时以新选中条目调用（实时预览，如主题切换）。 */
export type PickerPreview = (item: PickerItem) => void

/** 取消回调：选择器被关闭（Esc/q，非确认路径）时调用（还原预览等）。 */
export type PickerCancel = () => void

/** 选择器状态：开合 + 选中下标 + 标题。 */
export interface PickerState {
  open: boolean
  /** 选中项下标（指向 items；越界时渲染夹紧）。 */
  selected: number
  /** 面板标题行。 */
  title: string
  /** 步进能力提示（onStep 存在时置串，footer 显示 </> 键位）。 */
  stepHint?: string | undefined
}

/** 状态机输入事件（move 的 count = 条目数，由调用方计算）。 */
export type PickerEvent =
  | { type: 'open'; title: string }
  | { type: 'close' }
  | { type: 'move'; delta: number; count: number }

/**
 * 初始状态（关闭、选中 0、空标题）。
 * @returns 关闭态的选择器状态。
 */
export function emptyPickerState(): PickerState {
  return { open: false, selected: 0, title: '' }
}

/**
 * 步进回调：横向调节选中行的附加位（如档位）。
 * @param delta - 步进方向（-1 左 / 1 右）。
 * @returns 该行的新 detail 文本；null = 该行无步进面（键位静默）。
 */
export type PickerStep = (delta: 1 | -1) => string | null

/**
 * 折叠一个事件进入选择器状态（纯函数）：open 重置选中、move 在 [0, count-1]
 * 内夹紧（0 条时选中归 0）。
 * @param state - 当前状态。
 * @param event - 输入事件。
 * @returns 新状态。
 */
export function applyPickerEvent(state: PickerState, event: PickerEvent): PickerState {
  switch (event.type) {
    case 'open':
      return { ...state, open: true, selected: 0, title: event.title }
    case 'close':
      return { ...state, open: false }
    case 'move': {
      const maxIndex = Math.max(0, event.count - 1)
      const next = state.selected + event.delta
      return { ...state, selected: Math.max(0, Math.min(next, maxIndex)) }
    }
  }
}

/**
 * overlay 渲染：标题 + 条目（选中 ▶ 高亮、当前 ● 标记、宽度截断）+ 底部
 * 键位提示；滚动窗口跟随选中。
 * @param state - 选择器状态（取 title/selected）。
 * @param items - 全部条目。
 * @param width - 可用显示宽度（条目按此截断）。
 * @param height - 可用行数（头尾各占一行，其余给条目窗口）。
 * @param theme - 主题（取语义色）。
 * @returns 渲染行数组（含 ANSI）。
 */
export function renderPicker(
  state: PickerState,
  items: readonly PickerItem[],
  width: number,
  height: number,
  theme: RivetTheme,
): string[] {
  const lines: string[] = [color(state.title, theme.brandColor, { bold: true })]
  if (items.length === 0) {
    lines.push(color('（无选项）', theme.muted))
  } else {
    const bodyHeight = Math.max(1, height - 2)
    const sel = Math.max(0, Math.min(state.selected, items.length - 1))
    const start = Math.max(0, sel - bodyHeight + 1)
    const window = items.slice(start, start + bodyHeight)
    for (let i = 0; i < window.length; i++) {
      const item = window[i]
      /* v8 ignore next 1 -- unreachable: window 来自 items.slice()，元素恒非 undefined */
      if (item === undefined) continue
      const isSel = start + i === sel
      const marker = item.current === true ? ' ●' : ''
      const detail = item.detail === undefined ? '' : ` · ${item.detail}`
      const text = `${isSel ? '▶ ' : '  '}${item.label}${marker}${detail}`
      const clipped = truncate(text, width)
      lines.push(isSel ? color(clipped, theme.primary, { bold: true }) : color(clipped, theme.dim))
    }
  }
  lines.push(color(state.stepHint === undefined
    ? '↑↓ 选择 · Enter 确认 · Esc 关闭'
    : '↑↓ 选择 · </> 调档位 · Enter 确认 · Esc 关闭', theme.muted))
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

/** PickerController 构造选项。 */
export interface PickerOptions {
  /** 主题读取函数（动态，切主题后 overlay 立即生效）。 */
  getTheme: () => RivetTheme
}

/**
 * 选择器控制器：open/close/move/commit，实现 OverlayRenderer 契约。
 * 条目与确认回调在 open 时注入（每次打开重建）。
 */
export class PickerController {
  private state: PickerState = emptyPickerState()
  private items: PickerItem[] = []
  private onCommit: PickerCommit | null = null
  private onPreview: PickerPreview | null = null
  private onCancel: PickerCancel | null = null
  private onStep: PickerStep | null = null
  private readonly getTheme: () => RivetTheme

  constructor(opts: PickerOptions) {
    this.getTheme = opts.getTheme
  }

  /**
   * 选择器是否打开。
   * @returns 打开返回 true。
   */
  isOpen(): boolean {
    return this.state.open
  }

  /**
   * 当前选中条目的提交值。
   * @returns 选中条目的 value；未打开或无条目为 null。
   */
  selectedValue(): string | null {
    const item = this.items[this.state.selected]
    return item === undefined ? null : item.value
  }

  /**
   * 打开选择器：注入条目、确认回调与可选预览/取消回调，选中可指定（缺省 0）。
   * @param title - 面板标题。
   * @param items - 条目列表。
   * @param commit - 确认回调（Enter 时以选中条目调用）。
   * @param selectedIndex - 初始选中下标（缺省 0）。
   * @param hooks - 可选：onPreview（选中变化时调用，实时预览）；
   *   onCancel（Esc/q 关闭时调用，还原预览）；onStep（`</>` 横向步进
   *   选中行的附加位，返回新 detail 或 null 表示该行无步进面）。
   */
  open(
    title: string,
    items: readonly PickerItem[],
    commit: PickerCommit,
    selectedIndex?: number,
    hooks?: { onPreview?: PickerPreview; onCancel?: PickerCancel; onStep?: PickerStep },
  ): void {
    this.items = [...items]
    this.onCommit = commit
    this.onPreview = hooks?.onPreview ?? null
    this.onCancel = hooks?.onCancel ?? null
    this.onStep = hooks?.onStep ?? null
    this.state = { ...applyPickerEvent(this.state, { type: 'open', title }),
      ...(hooks?.onStep === undefined ? {} : { stepHint: '</>' }) }
    if (selectedIndex !== undefined && selectedIndex > 0) {
      this.state = applyPickerEvent(this.state, { type: 'move', delta: selectedIndex, count: this.items.length })
    }
    // 打开即通知一次预览：初始选中行（如当前模型）的附加位无需移动就能显示。
    const initial = this.items[this.state.selected]
    if (initial !== undefined && this.onPreview !== null) this.onPreview(initial)
  }

  /**
   * 横向步进选中行的附加位：调 onStep 并把返回的 detail 写回该行。
   * @param delta - 步进方向（-1 左 / 1 右）。
   * @returns 已更新该行 detail 为 true（调用方负责重绘）；该行无步进面为 false。
   */
  step(delta: 1 | -1): boolean {
    if (this.onStep === null) return false
    const detail = this.onStep(delta)
    if (detail === null) return false
    const item = this.items[this.state.selected]
    if (item === undefined) return false
    item.detail = detail
    return true
  }

  /**
   * 直接设置一行的附加位（如选中变化后异步解析到的档位）。
   * @param index - 目标行下标。
   * @param detail - 附加位文本（undefined 清除）。
   */
  setDetail(index: number, detail: string | undefined): void {
    const item = this.items[index]
    if (item === undefined) return
    if (detail === undefined) delete item.detail
    else item.detail = detail
  }

  /** 关闭选择器（Esc/q 路径；触发 onCancel 还原预览；保留条目，下次 open 重建）。 */
  close(): void {
    const cancel = this.onCancel
    this.onCancel = null
    this.onCommit = null
    this.onPreview = null
    this.onStep = null
    this.state = applyPickerEvent(this.state, { type: 'close' })
    if (cancel !== null) cancel()
  }

  /**
   * 移动选中项（夹紧在条目范围内）；选中变化时触发 onPreview（实时预览）。
   * @param delta - 移动量（负上正下）。
   */
  move(delta: number): void {
    this.state = applyPickerEvent(this.state, { type: 'move', delta, count: this.items.length })
    const item = this.selected
    if (item !== undefined && this.onPreview !== null) this.onPreview(item)
  }

  /** 当前选中条目（越界返回 undefined）。 */
  get selected(): PickerItem | undefined {
    return this.items[this.state.selected]
  }

  /** 当前条目数。 */
  get count(): number {
    return this.items.length
  }

  /**
   * 确认当前选中项：以选中条目调用注入的确认回调并关闭；无选中或未注入
   * 回调时不动作。确认路径不触发 onCancel（预览已由确认落定，无需还原）。
   */
  commit(): void {
    const item = this.selected
    const cb = this.onCommit
    this.onCancel = null
    this.onCommit = null
    this.onPreview = null
    this.state = applyPickerEvent(this.state, { type: 'close' })
    if (item !== undefined && cb !== null) cb(item)
  }

  /**
   * OverlayRenderer 契约：render(width, height) → string[]。
   * @param width - 可用显示宽度。
   * @param height - 可用行数。
   * @returns 渲染行数组（含 ANSI）。
   */
  render(width: number, height: number): string[] {
    return renderPicker(this.state, this.items, width, height, this.getTheme())
  }
}
