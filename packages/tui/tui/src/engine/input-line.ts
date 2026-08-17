/**
 * T9 InputLine — 纯 TypeScript 类，替代 base-text-input.tsx / input.tsx。
 *
 * 管理输入文本缓冲区、光标位置、历史、Vim 模式。
 * 零 React/Ink 依赖。通过回调通知外部变化。
 *
 * 核心能力：
 * - 字符输入 + 多字节 UTF-8 支持
 * - 光标移动（左右/home/end/词级）
 * - 删除（backspace/delete/词级删除）
 * - 历史导航（上下键）
 * - 行内编辑（Ctrl+A/E/U/K/W）
 * - Vim 模式（Normal/Insert）
 * - Tab 补全接口
 * - 粘贴支持
 */

export type InputLineEvent =
  | { type: 'change'; value: string; cursor: number }
  | { type: 'submit'; value: string; images?: string[] }
  | { type: 'tab' }
  | { type: 'history'; direction: 'prev' | 'next' }

/** InputLine 构造参数（初始状态 + 变化/提交/补全回调）。 */
export interface InputLineOptions {
  /** 初始文本值 */
  value?: string
  /** 占位符文本（当 value 为空时显示） */
  placeholder?: string
  /** 历史记录（最新的在前） */
  history?: string[]
  /** 是否启用 Vim 模式 */
  vimEnabled?: boolean
  /** 回调 */
  onChange?: (value: string, cursor: number) => void
  onSubmit?: (value: string, images?: string[]) => void
  /**
   * Tab 补全回调（Phase 6.3 接入点）：Tab 键命中时先调用，返回 true 表示
   * 已消费（补全应用）；返回 false 表示未处理，InputLine 照常发出 'tab' 事件。
   */
  onTabComplete?: () => boolean
  /** 最大输入长度 */
  maxLength?: number
  /** 初始图片附件 data URL 列表 */
  images?: string[]
  /** 图片附件变化回调 */
  onImagesChange?: (images: string[]) => void
}

/**
 * 输入框可视行上限：长草稿不占满整屏。
 * @param rows - 终端行数。
 * @returns 至少 3、至多 16，约 `rows / 3`。
 */
export function inputViewportMaxLines(rows: number): number {
  return Math.max(3, Math.min(16, Math.floor(Math.max(1, rows) / 3)))
}

/** displayLines / displayLinesWithCaret 的视窗裁剪参数。 */
export interface InputLineDisplayOptions {
  /** Maximum display rows to return. When exceeded, keep the cursor line visible. */
  maxLines?: number
  /** Maximum display columns per line. When the cursor line exceeds this width,
   *  a horizontal viewport centered on the cursor is shown instead of truncating
   *  from the start (which hides the text the user is actively typing at the end). */
  maxWidth?: number
}

/** Vim 键位模式（vimEnabled 时生效；insert 为非 vim 行为的默认态）。 */
export type VimMode = 'normal' | 'insert' | 'visual'

/** Grapheme 分段器（Node 22+）。用于按用户感知字符（CJK/emoji/ZWJ 簇）步进光标。
 * WSL/Alpine 中若 Node.js 运行时缺少 ICU 数据，Intl.Segmenter 会抛出。
 * 降级到按 code-point 分割（仍正确处理多字节 UTF-8，但不支持 ZWJ emoji 簇）。 */
let graphemeSegmenter: Intl.Segmenter | null = null
try {
  graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
} catch {
  graphemeSegmenter = null
}

const GRAPHEME_SEGMENTER = graphemeSegmenter

// ── fish 式 undo 合并（2026-07-23 P1-1）──────────────────────────────
// 连续 word 字符插入合并为一单元；空格/换行各自独立；删除/粘贴/历史导航/
// 外部写入各自独立；kind 切换或光标跳变（移动/模式切换）时封口。
type UndoKind = 'insert-word' | 'insert-space' | 'insert-other' | 'delete' | 'replace'

interface UndoUnit {
  value: string
  cursor: number
  kind: UndoKind
}

/** CJK 统一表意/扩展A/兼容/假名/谚文——与 \w 一起视为 word 字符。
 *  不复用 prevWordStart 的 /\w/ 口径：它把整段中文当非词，连续中文输入
 *  会被错分为一堆独立单元。 */
const WORD_CHAR_RE = /^(?:\w|[一-鿿㐀-䶿豈-﫿぀-ヿ가-힯])$/

function classifyInsert(ch: string): UndoKind {
  if (/^\s$/.test(ch)) return 'insert-space'
  if (WORD_CHAR_RE.test(ch)) return 'insert-word'
  return 'insert-other'
}

const UNDO_STACK_MAX = 200
/** 快照滞留总字符上限（≈2M UTF-16 code units）：200 单元 × 极端大 buffer
 * （多次 100KB+ 粘贴）的滞留内存长尾防护——超限时逐出最旧单元。 */
const UNDO_TOTAL_CHARS_MAX = 2_000_000

// ── 长粘贴自动收纳（2026-07-24，对齐 pi-tui 与 Mission Composer §12）────────
// 命中阈值的粘贴不原文进 buffer，而是插入原子标记串 `[paste #N +M lines]`，
// 原文存 _pastes 旁路——输入框不被长计划/日志淹没，提交时展开还原。
// 阈值抬高（10 行/1000 字符 → 100 行/10000 字符）：折行缓存化后长文本渲染
// 不再卡顿，常规长草稿（几段文字/贴代码片段）应保持可编辑，只有整页日志/
// 计划这类超大粘贴才收纳成标记。
/** 触发折叠的阈值（行数 或 字符数）。 */
const PASTE_FOLD_MIN_LINES = 100
const PASTE_FOLD_MIN_CHARS = 10_000
/** 标记串形态（grapheme 原子化 / 提交展开 / 渲染着色共用）。 */
const PASTE_MARKER_RE = /\[paste #(\d+) \+\d+ lines?\]/g

import { ambiguousWideEnabled, charDisplayWidth, displayWidth } from '../width.js'
import { ANSI } from './ansi.js'

/**
 * Grapheme 边界缓存：Intl.Segmenter 对整串分段是 O(n)，而 prevGrapheme/
 * nextGrapheme 在每次光标移动（左右键/backspace/delete）都被调用。长输入下
 * 每次按键重跑全长分段会卡。按 value 缓存边界数组，value 未变（纯光标移动）
 * 直接复用；并用二分定位而非线性扫描边界。
 */
interface GraphemeCache {
  value: string
  bounds: number[] // 升序的 code-unit 偏移（含 0 与末尾）
}

/** 返回字符串中所有 grapheme 边界的 code-unit 偏移（含 0 与末尾）。 */
function graphemeBoundaries(value: string): number[] {
  const bounds = [0]
  if (GRAPHEME_SEGMENTER) {
    for (const seg of GRAPHEME_SEGMENTER.segment(value)) {
      bounds.push(seg.index + seg.segment.length)
    }
  } else {
    // ICU 数据缺失降级：按 code-point 分割（ZWJ emoji 簇会被拆开，但 CJK/ASCII 正常）
    let i = 0
    while (i < value.length) {
      const cp = value.codePointAt(i)
      if (cp === undefined) { bounds.push(i); i++; continue }
      bounds.push(i + (cp > 0xFFFF ? 2 : 1))
      i += cp > 0xFFFF ? 2 : 1
    }
  }
  return bounds
}

interface VisualLine {
  text: string
  cursor: boolean
}

function inputDisplayWidth(text: string, ambiguousAsWide: boolean): number {
  return displayWidth(text, { ambiguousAsWide })
}

function pushWrappedSegment(
  out: VisualLine[],
  segment: string,
  prefix: string,
  maxContentWidth: number,
  cursorOffset: number | null,
  ambiguousAsWide: boolean,
  /** 输出参数：记录 █ 插入点左侧的 cell 数（不含前缀）。仅在插入时写入。 */
  caretCol?: { value: number },
  /** segment 在 buffer 中的绝对起始偏移（选区高亮定位用）。 */
  segAbsStart?: number,
  /** 键盘选区（buffer 绝对偏移，start<end）：范围内字符反色渲染。 */
  sel?: { start: number; end: number } | null,
): void {
  let current = ''
  let currentWidth = 0
  let currentHasCursor = false
  let offset = 0
  let inSel = false

  const flush = (): void => {
    // 选区跨越折行边界：本行末 RESET 封口，下一视觉行重新 REVERSE 起头。
    out.push({ text: `${prefix}${current}${inSel ? ANSI.RESET : ''}`, cursor: currentHasCursor })
    current = inSel ? ANSI.REVERSE : ''
    currentWidth = 0
    currentHasCursor = false
  }

  // 按 code point 迭代（for-of 直接走字符串迭代器，免 Array.from 全量数组）；
  // 宽度用 charDisplayWidth 缓存版——长草稿逐字符直调 displayWidth（每次
  // 重建 Intl.Segmenter）会让每次按键渲染上百毫秒（2026-08-17 长文本优化）。
  for (const ch of segment) {
    const absOff = (segAbsStart ?? 0) + offset
    if (sel && inSel && absOff === sel.end) { current += ANSI.RESET; inSel = false }
    if (sel && !inSel && absOff === sel.start) { current += ANSI.REVERSE; inSel = true }
    if (cursorOffset !== null && offset === cursorOffset) {
      const markerWidth = inputDisplayWidth('█', ambiguousAsWide)
      if (currentWidth > 0 && currentWidth + markerWidth > maxContentWidth) flush()
      if (caretCol) caretCol.value = currentWidth
      current += '█'
      currentWidth += markerWidth
      currentHasCursor = true
    }

    const chWidth = Math.max(1, charDisplayWidth(ch, ambiguousAsWide))
    if (currentWidth > 0 && currentWidth + chWidth > maxContentWidth) flush()
    current += ch
    currentWidth += chWidth
    offset += ch.length
  }

  if (cursorOffset !== null && cursorOffset === segment.length) {
    const absOff = (segAbsStart ?? 0) + offset
    if (sel && inSel && absOff === sel.end) { current += ANSI.RESET; inSel = false }
    if (sel && !inSel && absOff === sel.start) { current += ANSI.REVERSE; inSel = true }
    const markerWidth = inputDisplayWidth('█', ambiguousAsWide)
    if (currentWidth > 0 && currentWidth + markerWidth > maxContentWidth) flush()
    if (caretCol) caretCol.value = currentWidth
    current += '█'
    currentWidth += markerWidth
    currentHasCursor = true
  }

  if (currentWidth > 0 || currentHasCursor || segment.length === 0) flush()
}

/** ghost 预览的 dim 样式（终端原生 dim，不依赖主题）。 */
const GHOST_DIM_OPEN = '\x1B[2m'
const GHOST_DIM_CLOSE = '\x1B[22m'

/**
 * 在 wrap 后的光标行按列位置插入 dim ghost，并把行宽截到 maxWidth。
 * 行文本不含 ANSI（调用方保证无选区）；ghost 按剩余空间截断。
 * @param line - wrap 后的光标行文本（prefix + 片段）。
 * @param col - 光标列（含 prefix，列 = 字符位置）。
 * @param ghost - ghost 文本。
 * @param maxWidth - 目标行宽。
 * @returns 插入 ghost 并截断后的行。
 */
function insertGhost(line: string, col: number, ghost: string, maxWidth: number): string {
  const prefix = line.slice(0, col)
  const rest = line.slice(col)
  const avail = maxWidth - displayWidth(prefix) - displayWidth(rest)
  if (avail <= 0) return line
  let shown = ''
  for (const ch of ghost) {
    if (displayWidth(shown + ch) > avail) break
    shown += ch
  }
  return `${prefix}${GHOST_DIM_OPEN}${shown}${GHOST_DIM_CLOSE}${rest}`
}

function wrapInputLines(
  value: string,
  cursor: number,
  maxWidth: number,
  sel?: { start: number; end: number } | null,
): { lines: string[]; cursorLine: number; cursorCol: number } {
  const ambiguousAsWide = ambiguousWideEnabled()
  const visual: VisualLine[] = []
  const logicalLines = value.split('\n')
  const prefixWidth = inputDisplayWidth('❯ ', ambiguousAsWide)
  const maxContentWidth = Math.max(1, maxWidth - prefixWidth)
  let cursorLine = 0
  let cursorCol = prefixWidth
  let absoluteOffset = 0

  for (let lineIndex = 0; lineIndex < logicalLines.length; lineIndex++) {
    const logicalLine = logicalLines[lineIndex]
    if (logicalLine === undefined) continue // unreachable: lineIndex < logicalLines.length
    const lineStart = absoluteOffset
    const lineEnd = lineStart + logicalLine.length
    const cursorInLine = cursor >= lineStart && cursor <= lineEnd
    const prefix = cursorInLine ? '❯ ' : '  '
    const beforeCount = visual.length
    const caretCol: { value: number } = { value: 0 }
    pushWrappedSegment(
      visual,
      logicalLine,
      prefix,
      maxContentWidth,
      cursorInLine ? cursor - lineStart : null,
      ambiguousAsWide,
      caretCol,
      lineStart,
      sel,
    )
    if (cursorInLine) {
      const found = visual.findIndex((line, idx) => idx >= beforeCount && line.cursor)
      cursorLine = found >= 0 ? found : beforeCount
      cursorCol = prefixWidth + caretCol.value
    }
    absoluteOffset = lineEnd + 1
  }

  return { lines: visual.map(line => line.text), cursorLine, cursorCol }
}

/** 在升序边界数组中找严格小于 cursor 的最大下标（光标左侧最近边界）。二分 O(log n)。 */
function boundaryBefore(bounds: number[], cursor: number): number {
  let lo = 0, hi = bounds.length - 1, ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const b = bounds[mid]
    if (b === undefined) break // unreachable: mid 在 [lo, hi] 内
    if (b < cursor) { ans = b; lo = mid + 1 }
    else hi = mid - 1
  }
  return ans
}

/** 在升序边界数组中找严格大于 cursor 的最小下标（光标右侧最近边界）。二分 O(log n)。 */
function boundaryAfter(bounds: number[], cursor: number): number {
  let lo = 0, hi = bounds.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const b = bounds[mid]
    if (b === undefined) break // unreachable: mid 在 [lo, hi] 内
    if (b > cursor) hi = mid
    else lo = mid + 1
  }
  const b = bounds[lo]
  if (b === undefined) return -1
  return b > cursor ? b : -1
}

/** 剔除落在 `[paste #N …]` 标记内部的边界（端点保留）——标记成为原子编辑单位。 */
function atomicPasteMarkerBounds(value: string, bounds: number[]): number[] {
  const spans: Array<[number, number]> = []
  for (const m of value.matchAll(new RegExp(PASTE_MARKER_RE.source, 'g'))) {
    const matched = m[0]
    spans.push([m.index, m.index + matched.length])
  }
  if (spans.length === 0) return bounds
  return bounds.filter(b => !spans.some(([s, e]) => b > s && b < e))
}

/** 视窗裁剪：返回可见行 + 光标行在【返回数组内】的下标（硬件光标归位需要）。 */
function viewportWithCaret(lines: string[], cursorLine: number, maxLines?: number): { lines: string[]; caretLine: number } {
  if (maxLines === undefined || lines.length <= maxLines) {
    return { lines, caretLine: Math.min(Math.max(cursorLine, 0), lines.length - 1) }
  }
  const max = Math.max(1, Math.floor(maxLines))
  const cursor = Math.min(Math.max(cursorLine, 0), lines.length - 1)
  const cursorText = lines[cursor]
  if (cursorText === undefined) {
    // unreachable: cursor 恒在 [0, lines.length) 内
    return { lines: [], caretLine: 0 }
  }
  if (max === 1) return { lines: [cursorText], caretLine: 0 }
  if (max === 2) {
    return cursor < lines.length - 1
      ? { lines: [cursorText, `… 下 ${lines.length - cursor - 1} 行`], caretLine: 0 }
      : { lines: [`… 上 ${cursor} 行`, cursorText], caretLine: 1 }
  }

  const hasAbove = cursor > 0
  const hasBelow = cursor < lines.length - 1
  const contentSlots = Math.max(1, max - (hasAbove ? 1 : 0) - (hasBelow ? 1 : 0))
  const minStart = hasAbove ? 1 : 0
  const maxStart = hasBelow
    ? Math.max(minStart, lines.length - 1 - contentSlots)
    : Math.max(minStart, lines.length - contentSlots)
  const centeredStart = cursor - Math.floor(contentSlots / 2)
  const start = Math.min(Math.max(centeredStart, minStart), maxStart)
  const visible = lines.slice(start, start + contentSlots)

  return {
    lines: [
      ...(hasAbove ? [`… 上 ${start} 行`] : []),
      ...visible,
      ...(hasBelow ? [`… 下 ${lines.length - (start + contentSlots)} 行`] : []),
    ],
    caretLine: (hasAbove ? 1 : 0) + (cursor - start),
  }
}

/**
 * 纯 TypeScript 输入行状态机：管理文本缓冲区、光标、历史、选区、undo/redo、
 * 图片附件与 Vim 模式，零 React/Ink 依赖。按键经 handleKey 进入，
 * 状态变化通过构造时注入的回调通知外部。
 */
export class InputLine {
  private _value: string
  private _cursor: number
  private _placeholder: string
  private _history: string[]
  private _historyIdx: number
  private _vimEnabled: boolean
  private _vimMode: VimMode
  private _maxLength: number
  /** 手工换行：Enter 插入 \\n 而不是提交（粘贴流结束的 return 仍提交）。 */
  private _newlineMode = false
  /** 最近一次 displayLines 的折行宽度；↑↓/PgUp 按视觉行移动。 */
  private _wrapWidth: number | undefined
  /** 最近一次 displayLines 的可视行上限；PageUp/Down 按此翻页。 */
  private _maxDisplayLines: number | undefined
  /** 图片附件 data URL 列表 */
  private _images: string[] = []

  /** Grapheme 边界缓存（按 value 失效）。光标移动不改 value，命中缓存省去 O(n) 分段。 */
  private _graphemeCache: GraphemeCache | null = null

  private onChangeCallback?: (value: string, cursor: number) => void
  private onSubmitCallback?: (value: string, images?: string[]) => void
  private onTabCompleteCallback?: () => boolean
  private onImagesChangeCallback?: (images: string[]) => void

  /** undo 栈（改前快照）。submit 后清空——上一条输入的文本不得被下一条撤销复活。 */
  private _undoStack: UndoUnit[] = []
  /** 栈内快照滞留的总字符数（配合 UNDO_TOTAL_CHARS_MAX 防护内存长尾）。 */
  private _undoChars = 0
  /** redo 栈（undo 目标态快照）。任何新编辑（recordUndo）清空——redo 分支失效。 */
  private _redoStack: UndoUnit[] = []
  private _redoChars = 0
  /** 当前未封口单元 kind（仅 insert-word 参与合并）。 */
  private _undoOpen: UndoKind | null = null
  /** 合并继续时光标应处的位置（插入点右缘）；不符即封口。 */
  private _undoExpectCursor = -1
  /** 翻历史前的在输草稿（P1-2 shell 式往返恢复）。 */
  private _draft: string | null = null
  /** 折叠粘贴原文旁路：标记序号 → 原文。提交时展开还原（expandPastes）。 */
  private _pastes = new Map<number, string>()
  private _pasteSeq = 0
  /** 非 bracketed paste 终端的粘贴流累积：内联 return 的行内容（不含换行），
   *  流结束（普通 return）时按 \n 合并为一次提交。bracketed paste 整段经
   *  onPaste 到达、不触发累积；Vim normal 的 return 同样走合并（一致性）。 */
  private _inlinePasteLines: string[] = []

  /** 粘贴流合并提交：累积行 + 当前行并为一次多行提交；无累积行则原样提交。 */
  private submitFlushingPasteLines(submitted: string, submittedImages: string[]): InputLineEvent {
    if (this._inlinePasteLines.length > 0) {
      // 粘贴流结束（缓冲已空）：合并累积行 + 当前行为一次多行提交。
      const merged = [...this._inlinePasteLines, submitted].join('\n')
      this._inlinePasteLines = []
      this.onSubmitCallback?.(merged, submittedImages)
      return { type: 'submit', value: merged, images: submittedImages }
    }
    this.onSubmitCallback?.(submitted, submittedImages)
    return { type: 'submit', value: submitted, images: submittedImages }
  }

  // ── 键盘选区（S1）──
  /** 选区锚点（shift+方向键设定）；null = 无选区。选区 = [min(anchor,cursor), max)。 */
  private _selAnchor: number | null = null
  /** vim visual linewise 标记（V 进入时为 true，v 进入/退出 visual 时复位）。 */
  private _visualLineWise = false
  /** 内部剪贴板（Alt+Y yank / vim p）；系统剪贴板经 OSC52（_clipboardOut → app drain）。 */
  private _clipboard = ''
  /** 待 app 写出 OSC52 的剪贴文本（takeClipboardOut 取走后清空）。 */
  private _clipboardOut: string | null = null
  /** ghost 预览文本（slash 菜单选中命令的补全剩余/参数占位）；null = 不显示。 */
  private _ghost: string | null = null

  constructor(options: InputLineOptions = {}) {
    this._value = options.value ?? ''
    this._cursor = this._value.length
    this._placeholder = options.placeholder ?? ''
    this._history = options.history ?? []
    this._historyIdx = -1
    this._vimEnabled = options.vimEnabled ?? false
    this._vimMode = 'insert'
    this._maxLength = options.maxLength ?? 100000
    this._images = options.images ?? []
    if (options.onChange !== undefined) this.onChangeCallback = options.onChange
    if (options.onSubmit !== undefined) this.onSubmitCallback = options.onSubmit
    if (options.onTabComplete !== undefined) this.onTabCompleteCallback = options.onTabComplete
    if (options.onImagesChange !== undefined) this.onImagesChangeCallback = options.onImagesChange
  }

  // ── Accessors ────────────────────────────────────────────────

  /** 当前文本值。 */
  get value(): string { return this._value }
  /** 光标位置（buffer code-unit 偏移）。 */
  get cursor(): number { return this._cursor }
  /** 当前 Vim 模式（vimEnabled 为 false 时恒为 insert）。 */
  get vimMode(): VimMode { return this._vimMode }
  /** Vim 键位是否启用。 */
  get vimEnabled(): boolean { return this._vimEnabled }
  /** 占位符文本（value 为空时显示）。 */
  get placeholder(): string { return this._placeholder }
  /**
   * 运行时替换空输入占位提示（如 Ctrl+C 连按退出的临时提示）。
   * @param value - 新占位符文本。
   */
  setPlaceholder(value: string): void {
    this._placeholder = value
  }
  /** 手工换行模式：Enter 插入换行；粘贴流（非 bracketed paste）结束时并入草稿不提交。 */
  get newlineMode(): boolean { return this._newlineMode }
  /**
   * 开关手工换行模式。
   * @param enabled - true 时普通 Enter 插入 \\n。
   */
  setNewlineMode(enabled: boolean): void {
    this._newlineMode = enabled
  }
  /** 图片附件 data URL 列表（防御性拷贝）。 */
  get images(): string[] { return [...this._images] }

  /**
   * 启用/停用 vim 键位。停用或启用时都复位到 insert 模式，避免残留 normal 态吞字符。
   * @param enabled - 是否启用 vim 键位
   */
  setVimEnabled(enabled: boolean): void {
    this._vimEnabled = enabled
    this._vimMode = 'insert'
    this._visualLineWise = false
  }

  /** visual 模式是否为 linewise（V 进入；charwise v 为 false）。渲染 `-- VISUAL LINE --` 用。 */
  get visualLineWise(): boolean { return this._vimMode === 'visual' && this._visualLineWise }

  /**
   * 多行渲染：返回输入框的显示行数组。
   * - 空值时显示 placeholder（首行）
   * - 光标行以 `❯ ` 前缀标识（高亮行），其余行缩进对齐
   * - 光标位置以 `█` 标记
   * - 当 maxWidth 给出时，长逻辑行按显示宽度软换行，避免前文被水平视窗遮盖。
   *   maxLines 仍按光标所在视觉行裁剪，保证正在编辑的位置始终可见。
   * @param options - 视窗裁剪参数（maxLines/maxWidth）
   * @returns 输入框显示行数组
   */
  displayLines(options: InputLineDisplayOptions = {}): string[] {
    return this.displayLinesWithCaret(options).lines
  }

  /**
   * displayLines + 光标 cell 坐标（2026-07-23 IME 硬件光标归位）。
   *
   * 返回的 caret 是「█ 左侧」在显示行内的位置：line 为返回数组下标，
   * col 为 0-based cell 数（含 `❯ ` 前缀，按 ambiguousAsWide 口径度量，
   * 与 renderInputRow/rowsForLine 同尺）。调用方把硬件光标搬到该行该列，
   * 终端 IME 候选窗即锚定在输入框内（自绘 █ 终端不可见）。
   * @param options - 视窗裁剪参数（maxLines/maxWidth）
   * @returns 显示行数组 + 光标 cell 坐标（line 为数组下标，col 为 0-based cell）
   */
  displayLinesWithCaret(options: InputLineDisplayOptions = {}): { lines: string[]; caret: { line: number; col: number } } {
    if (options.maxWidth !== undefined) this._wrapWidth = options.maxWidth
    if (options.maxLines !== undefined) this._maxDisplayLines = options.maxLines
    const ambiguousAsWide = ambiguousWideEnabled()
    const prefixWidth = inputDisplayWidth('❯ ', ambiguousAsWide)
    if (!this._value) {
      return { lines: [`❯ █${this._placeholder}`], caret: { line: 0, col: prefixWidth } }
    }
    // ghost 激活：光标在值末尾且无选区（选区行含 ANSI 高亮，列≠字符位置，
    // 插入会错位；ghost 是「接下来可补全」语义，选区场景无意义）。
    const ghostActive = this._ghost !== null && this._ghost !== ''
      && this._cursor === this._value.length && this.selectionRange === null
    const before = this._value.slice(0, this._cursor)
    const cursorLine = before.split('\n').length - 1
    const cursorCol = before.length - (before.lastIndexOf('\n') + 1)

    if (options.maxWidth !== undefined) {
      const wrapped = wrapInputLines(this._value, this._cursor, options.maxWidth, this.selectionRange)
      const view = viewportWithCaret(wrapped.lines, wrapped.cursorLine, options.maxLines)
      if (ghostActive) {
        // 光标行片段无 ANSI（selectionRange 已排除）→ 列 = 字符串位置；
        // 光标行含自绘 █（pushWrappedSegment 插入），ghost 显示在 █ 右侧（col + 1）。
        const lines = [...view.lines]
        const cursorLineText = lines[view.caretLine]
        if (cursorLineText !== undefined) {
          lines[view.caretLine] = insertGhost(cursorLineText, wrapped.cursorCol + 1, this._ghost ?? '', options.maxWidth)
        }
        return { lines, caret: { line: view.caretLine, col: wrapped.cursorCol } }
      }
      return { lines: view.lines, caret: { line: view.caretLine, col: wrapped.cursorCol } }
    }

    const ghostSuffix = ghostActive ? `${GHOST_DIM_OPEN}${this._ghost}${GHOST_DIM_CLOSE}` : ''
    const lines = this._value.split('\n').map((line, i) => {
      const isCursorLine = i === cursorLine
      const prefix = isCursorLine ? '❯ ' : '  '
      if (!isCursorLine) return `${prefix}${line}`
      const beforeCursor = line.slice(0, cursorCol)
      const afterCursor = `█${line.slice(cursorCol)}${ghostSuffix}`
      return `${prefix}${beforeCursor}${afterCursor}`
    })
    const view = viewportWithCaret(lines, cursorLine, options.maxLines)
    const beforeCursorText = before.slice(before.lastIndexOf('\n') + 1)
    const col = prefixWidth + inputDisplayWidth(beforeCursorText, ambiguousAsWide)
    return { lines: view.lines, caret: { line: view.caretLine, col } }
  }

  /**
   * 设置 ghost 预览文本（显示在光标后、dim 色；不影响值/光标/宽度计算）。
   * 幂等：相同文本不触发重渲染状态变化。
   * @param text - ghost 文本；null 关闭。
   */
  setGhost(text: string | null): void {
    this._ghost = text
  }

  /**
   * 设置值（外部更新用）。覆盖式写入（粘贴/补全/审批填充等）记为独立 undo 单元。
   * @param value - 新文本值（超过 maxLength 截断）
   * @param cursor - 新光标位置（钳到值长度内）；缺省置于末尾
   */
  setValue(value: string, cursor?: number): void {
    this.recordUndo('replace')
    this._value = value.slice(0, this._maxLength)
    this._cursor = cursor !== undefined ? Math.min(cursor, this._value.length) : this._value.length
    this.onChangeCallback?.(this._value, this._cursor)
  }

  /**
   * 追加文本到末尾，光标移到追加内容之后。
   * @param text - 要追加的文本
   */
  append(text: string): void {
    this.setValue(this._value + text, this._value.length + text.length)
  }

  /**
   * 在光标处插入文本（用于 bracketed paste），光标移动到插入内容之后。
   * 命中折叠阈值的长粘贴收纳为原子标记 `[paste #N +M lines]`（原文旁路存储）。
   * @param text - 要插入的文本；空串为 no-op
   */
  insertText(text: string): void {
    if (!text) return
    const lineCount = text.split('\n').length
    if (lineCount > PASTE_FOLD_MIN_LINES || text.length > PASTE_FOLD_MIN_CHARS) {
      const id = ++this._pasteSeq
      this._pastes.set(id, text)
      const marker = `[paste #${id} +${lineCount} ${lineCount === 1 ? 'line' : 'lines'}]`
      this.insertText(marker)
      return
    }
    const before = this._value.slice(0, this._cursor)
    const after = this._value.slice(this._cursor)
    const next = (before + text + after).slice(0, this._maxLength)
    const cursor = Math.min(before.length + text.length, next.length)
    this.setValue(next, cursor)
  }

  /**
   * 提交前把折叠粘贴标记还原为原文（用户手输的同名标记无原文则原样保留）。
   * @param text - 可能含粘贴标记的文本
   * @returns 标记展开后的文本
   */
  expandPastes(text: string): string {
    if (this._pastes.size === 0) return text
    return text.replace(PASTE_MARKER_RE, (m, id) => this._pastes.get(Number(id)) ?? m)
  }

  /**
   * 添加图片附件（data URL）。
   * @param dataUrl - 图片 data URL
   */
  addImage(dataUrl: string): void {
    this._images.push(dataUrl)
    this.onImagesChangeCallback?.([...this._images])
  }

  /**
   * 移除指定索引的图片附件；越界索引为 no-op。
   * @param index - 要移除的附件下标
   */
  removeImage(index: number): void {
    if (index < 0 || index >= this._images.length) return
    this._images.splice(index, 1)
    this.onImagesChangeCallback?.([...this._images])
  }

  /** 清空图片附件。 */
  clearImages(): void {
    if (this._images.length === 0) return
    this._images = []
    this.onImagesChangeCallback?.([])
  }

  /**
   * 图片占位摘要，用于 ANSI 渲染。
   * @param maxWidth - 摘要最大宽度；超宽时截断加省略号
   * @returns 摘要行数组；无附件时为空数组
   */
  imageSummary(maxWidth?: number): string[] {
    if (this._images.length === 0) return []
    const label = `📎 ${this._images.length} image${this._images.length > 1 ? 's' : ''}`
    if (!maxWidth || label.length <= maxWidth) return [label]
    return [label.slice(0, maxWidth - 1) + '…']
  }

  /**
   * 设置历史记录（最新的在前，供上下键导航）。
   * @param history - 历史条目列表
   */
  setHistory(history: string[]): void {
    this._history = history
  }

  // ── 键盘选区（S1）───────────────────────────────────────────

  /** 选区范围（start<end，buffer code-unit 偏移）；无选区或锚点=光标时 null。
   *  vim visual linewise（V）时对齐整行：start=起始行行首，end=结束行行尾——
   *  删除/复制/高亮自动行级化。 */
  get selectionRange(): { start: number; end: number } | null {
    if (this._selAnchor === null || this._selAnchor === this._cursor) return null
    let start = Math.min(this._selAnchor, this._cursor)
    let end = Math.max(this._selAnchor, this._cursor)
    if (this._vimMode === 'visual' && this._visualLineWise) {
      start = this._value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const nl = this._value.indexOf('\n', end)
      // 含行尾换行（vim 行删除语义：删行后剩余行自然上提，不留空行）
      end = nl === -1 ? this._value.length : nl + 1
    }
    return { start, end }
  }

  /**
   * 取走待 OSC52 写出的剪贴文本（app 渲染循环 drain），取走后清空。
   * @returns 待写出的剪贴文本；无待写内容时为 null
   */
  takeClipboardOut(): string | null {
    const t = this._clipboardOut
    this._clipboardOut = null
    return t
  }

  private collapseSelection(): void {
    this._selAnchor = null
  }

  /** Shift+←/→/Home/End：锚定（首次）并移动光标扩展选区。 */
  private extendSelection(name: string): InputLineEvent | null {
    if (this._selAnchor === null) this._selAnchor = this._cursor
    this.sealUndo()
    switch (name) {
      case 'left': this._cursor = this.prevGrapheme(); break
      case 'right': this._cursor = this.nextGrapheme(); break
      case 'home': this._cursor = 0; break
      case 'end': this._cursor = this._value.length; break
    }
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  /** Backspace/Delete（有选区）：删除选区（独立 undo 单元）。 */
  private deleteSelection(): InputLineEvent | null {
    const r = this.selectionRange
    if (!r) return null
    this.recordUndo('delete')
    this._value = this._value.slice(0, r.start) + this._value.slice(r.end)
    this._cursor = r.start
    this.collapseSelection()
    this.onChangeCallback?.(this._value, this._cursor)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  /** Ctrl+K（有选区）：剪切选区 → 内部剪贴板 + OSC52 drain。 */
  private cutSelection(): InputLineEvent | null {
    const r = this.selectionRange
    if (!r) return null
    this._clipboard = this._value.slice(r.start, r.end)
    this._clipboardOut = this._clipboard
    return this.deleteSelection()
  }

  /** Alt+W：复制选区 → 内部剪贴板 + OSC52 drain（不删除，复制后折叠选区）。 */
  private copySelection(): InputLineEvent | null {
    const r = this.selectionRange
    if (!r) return null
    this._clipboard = this._value.slice(r.start, r.end)
    this._clipboardOut = this._clipboard
    this.collapseSelection()
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  /** Alt+Y：yank 内部剪贴板（直插不走粘贴折叠；setValue 记 undo）。 */
  private yankClipboard(): InputLineEvent | null {
    if (!this._clipboard) return null
    const before = this._value.slice(0, this._cursor)
    const after = this._value.slice(this._cursor)
    this.setValue(before + this._clipboard + after, before.length + this._clipboard.length)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  // ── Key Dispatch ─────────────────────────────────────────────

  /**
   * 处理按键：按全局键 → 选区 → vim 模式 → insert 模式的优先级路由。
   * @param name - 按键语义名称（InputHandler 的 KeyName）
   * @param char - 可打印字符；控制键为 ''
   * @param ctrl - Ctrl 是否按下
   * @param meta - Alt/Meta 是否按下
   * @param shift - Shift 是否按下
   * @param inline - 该 return 后同一输入缓冲还有后续字节（非 bracketed paste
   *   终端的粘贴流行分隔；见 InputHandler KeyPress.inline）。
   * @returns 产生的事件（change/submit/tab/history）；按键未引起变化时为 null
   */
  handleKey(name: string, char: string, ctrl: boolean, meta: boolean, shift = false, inline = false): InputLineEvent | null {
    // ── 全局键 ─────────────────────────────────────────────────
    if (name === 'return' && (shift || meta)) {
      return this.insertChar('\n')
    }

    if (name === 'return') {
      // 多行输入：`\` + Enter 续行（去掉尾部反斜杠，插入换行）
      if (this._value.slice(0, this._cursor).endsWith('\\')) {
        this.recordUndo('replace')
        const before = this._value.slice(0, this._cursor - 1)
        const after = this._value.slice(this._cursor)
        this._value = before + '\n' + after
        // 光标落在新插入的换行符之后（去掉了尾部 `\`，补了一个 `\n`）
        this._cursor = before.length + 1
        this.onChangeCallback?.(this._value, this._cursor)
        return { type: 'change', value: this._value, cursor: this._cursor }
      }
      if (this._newlineMode && !inline) {
        // 换行模式（粘滞）下 Enter 语义是「插入换行」——粘贴流（inline return
        // 累积）结束时同样不提交：整段并入草稿（换行模式 = 编辑长文，粘贴应进
        // 草稿而非发送；bracketed paste 走 onPaste 直插，本就如此）。尾随 CR
        // 视作一次换行输入，合并文本后补一个 \n 与用户 Enter 行为一致。
        if (this._inlinePasteLines.length > 0) {
          const merged = [...this._inlinePasteLines, this.expandPastes(this._value)].join('\n')
          this._inlinePasteLines = []
          this.setValue(merged + '\n', merged.length + 1)
          return { type: 'change', value: this._value, cursor: this._cursor }
        }
        return this.insertChar('\n')
      }
      const submitted = this.expandPastes(this._value)
      const submittedImages = [...this._images]
      this.clearAfterSubmit()
      this.onImagesChangeCallback?.([])
      if (inline) {
        // 粘贴流行分隔（非 bracketed paste 终端）：累积本行不提交，流结束后
        // 一次合并提交——粘贴的换行不再逐行触发 Enter 发送。
        this._inlinePasteLines.push(submitted)
        return { type: 'change', value: '', cursor: 0 }
      }
      return this.submitFlushingPasteLines(submitted, submittedImages)
    }

    // 多行输入：Ctrl+J 插入换行
    if (name === 'ctrl_j') {
      return this.insertChar('\n')
    }

    if (name === 'tab' && !ctrl) {
      this.onTabCompleteCallback?.()
      return { type: 'tab' }
    }

    // ── Vim mode: visual（必须在 collapseSelection 之前——motion 扩展不折叠）──
    if (this._vimEnabled && this._vimMode === 'visual') {
      return this.handleVimVisual(name, char, ctrl)
    }

    // ── 键盘选区（S1）：shift+移动扩展；编辑/移动/导航折叠；剪切/复制/yank ──
    if (shift && !ctrl && !meta && (name === 'left' || name === 'right' || name === 'home' || name === 'end')) {
      return this.extendSelection(name)
    }
    if (meta && char === 'w') return this.copySelection()
    if (meta && char === 'y') return this.yankClipboard()
    if (ctrl && name === 'ctrl_k' && this.selectionRange) return this.cutSelection()
    if (!ctrl && !meta && (name === 'backspace' || name === 'delete') && this.selectionRange) {
      return this.deleteSelection()
    }
    this.collapseSelection()

    // ── Vim mode: normal ────────────────────────────────────────
    if (this._vimEnabled && this._vimMode === 'normal') {
      return this.handleVimNormal(name, char, ctrl)
    }

    // ── Insert mode ────────────────────────────────────────────
    // Meta/Option key (word-level) — check before switch
    if (meta) {
      switch (name) {
        case 'left': return this.moveWordLeft()
        case 'right': return this.moveWordRight()
        case 'backspace': return this.deleteWordBack()
        case 'delete': return this.deleteWordForward()
        default: return null
      }
    }

    switch (name) {
      case 'escape':
        if (this._vimEnabled) {
          this.sealUndo()
          this._vimMode = 'normal'
          // change 事件触发重绘——模式标签（-- NORMAL --）切换不能等下一帧
          return { type: 'change', value: this._value, cursor: this._cursor }
        }
        break // not vim → fall through to ignore

      case 'backspace':
      case 'ctrl_h': return this.backspace()
      case 'delete': return this.deleteForward()
      case 'left': return this.moveLeft()
      case 'right': return this.moveRight()
      case 'home': return this.moveHome()
      case 'end': return this.moveEnd()
      case 'up': return this.moveUpOrHistory()
      case 'down': return this.moveDownOrHistory()
      case 'pageup': return this.movePage(-1)
      case 'pagedown': return this.movePage(1)

      default: break
    }

    // Ctrl+key combos (in insert mode)
    if (ctrl) {
      switch (name) {
        case 'ctrl_a': return this.moveHome()
        case 'ctrl_e': return this.moveEnd()
        case 'ctrl_u': return this.deleteToStart()
        case 'ctrl_k': return this.deleteToEnd()
        case 'ctrl_w': return this.deleteWordBack()
        case 'ctrl_d': return this.deleteForward()
        case 'ctrl_b': return this.moveLeft()
        case 'ctrl_f': return this.moveRight()
        case 'ctrl_n': return this.historyNext()
        case 'ctrl_p': return this.historyPrev()
        case 'ctrl_minus':
        case 'ctrl_z': return this.undo()
        case 'ctrl_y': return this.redo()
        default: break
      }
      return null
    }

    // ── 可打印字符 ─────────────────────────────────────────────
    if (char && char.length > 0) {
      return this.insertChar(char)
    }

    return null
  }

  // ── Editing Operations ───────────────────────────────────────

  /**
   * 改值前记录 undo 单元（改前快照）。仅 insert-word 在光标连续时合并
   * （不新增单元）；其余 kind 每次独立成元。kind 切换即自然封口。
   */
  private recordUndo(kind: UndoKind): void {
    // 新编辑分支使 redo 失效（标准编辑器语义）——undo 本身不经此方法，不受影响。
    this._redoStack = []
    this._redoChars = 0
    const canMerge = kind === 'insert-word'
      && this._undoOpen === kind
      && this._undoExpectCursor === this._cursor
    if (!canMerge) {
      this._undoStack.push({ value: this._value, cursor: this._cursor, kind })
      this._undoChars += this._value.length
      while (this._undoStack.length > UNDO_STACK_MAX || this._undoChars > UNDO_TOTAL_CHARS_MAX) {
        const dropped = this._undoStack.shift()
        if (!dropped) break
        this._undoChars -= dropped.value.length
      }
    }
    this._undoOpen = kind
    this._undoExpectCursor = -1 // 由插入方在改值后按需重设
  }

  /** 纯光标移动/模式切换：封口袋前单元（不产生新单元）。 */
  private sealUndo(): void {
    this._undoOpen = null
    this._undoExpectCursor = -1
  }

  /** fish 式撤销：弹出最近单元恢复 {value, cursor}。Ctrl+- / Ctrl+Z。 */
  private undo(): InputLineEvent | null {
    const unit = this._undoStack.pop()
    this.sealUndo()
    if (!unit) return null
    this._undoChars -= unit.value.length
    this._redoStack.push({ value: this._value, cursor: this._cursor, kind: unit.kind })
    this._redoChars += this._value.length
    while (this._redoStack.length > UNDO_STACK_MAX || this._redoChars > UNDO_TOTAL_CHARS_MAX) {
      const dropped = this._redoStack.shift()
      if (!dropped) break
      this._redoChars -= dropped.value.length
    }
    this._value = unit.value
    this._cursor = Math.min(unit.cursor, this._value.length)
    this.onChangeCallback?.(this._value, this._cursor)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  /** 重做：恢复最近一次 undo 前的状态。Ctrl+Y。 */
  private redo(): InputLineEvent | null {
    const unit = this._redoStack.pop()
    this.sealUndo()
    if (!unit) return null
    this._redoChars -= unit.value.length
    this._undoStack.push({ value: this._value, cursor: this._cursor, kind: unit.kind })
    this._undoChars += this._value.length
    this._value = unit.value
    this._cursor = Math.min(unit.cursor, this._value.length)
    this.onChangeCallback?.(this._value, this._cursor)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  /**
   * 提交后重置缓冲：清空文本、归零光标、复位历史游标、清空图片附件。
   * 不触发 onChangeCallback —— submit 路径自己负责后续渲染，
   * 避免在 submit 回调里又触发一次 change 渲染造成竞态。
   */
  private clearAfterSubmit(): void {
    this._value = ''
    this._cursor = 0
    this._historyIdx = -1
    this._images = []
    this._undoStack = []
    this._undoChars = 0
    this._redoStack = []
    this._redoChars = 0
    this.sealUndo()
    this._draft = null
    this._pastes.clear()
    // 注意：不能在此清 _inlinePasteLines——粘贴流累积发生在 clearAfterSubmit
    // 之后（inline return 先清后推），清空会让每行覆盖上一行、合并提交退化。
    // 流的收尾由 submitFlushingPasteLines / 换行模式并入分支负责清空。
    this._selAnchor = null // 内部剪贴板随会话保留（常规剪贴板语义）
    this._visualLineWise = false
  }

  private insertChar(ch: string): InputLineEvent | null {
    if (this._value.length >= this._maxLength) return null
    const kind = classifyInsert(ch)
    this.recordUndo(kind)
    const before = this._value.slice(0, this._cursor)
    const after = this._value.slice(this._cursor)
    this._value = before + ch + after
    this._cursor += ch.length
    if (kind === 'insert-word') this._undoExpectCursor = this._cursor
    this.onChangeCallback?.(this._value, this._cursor)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  private backspace(): InputLineEvent | null {
    if (this._cursor <= 0) return null
    this.recordUndo('delete')
    // @mention 节点原子删除：光标左侧紧邻完整 token 时整体删除（@file 节点化 v1）。
    // 右侧字符必须是空白或行尾——否则光标其实在 token 中间（如 'fix @file:sr|c'），
    // 左侧形似完整 token 是误判，走 grapheme 单删。
    const left = this._value.slice(0, this._cursor)
    const mentionTail = left.match(/@(?:file|folder|symbol|codebase):(?:"[^"]+"|[^\s]+)\s?$/)
    const nextCh = this._value[this._cursor] ?? ''
    if (mentionTail && (nextCh === '' || /\s/.test(nextCh))) {
      const start = this._cursor - mentionTail[0].length
      this._value = left.slice(0, start) + this._value.slice(this._cursor)
      this._cursor = start
      this.onChangeCallback?.(this._value, this._cursor)
      return { type: 'change', value: this._value, cursor: this._cursor }
    }
    // grapheme-aware：删除光标左侧一个完整用户字符（CJK/emoji 簇）
    const start = this.prevGrapheme()
    const before = this._value.slice(0, start)
    const after = this._value.slice(this._cursor)
    this._value = before + after
    this._cursor = start
    this.onChangeCallback?.(this._value, this._cursor)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  private deleteForward(): InputLineEvent | null {
    if (this._cursor >= this._value.length) return null
    this.recordUndo('delete')
    // grapheme-aware：删除光标右侧一个完整用户字符
    const end = this.nextGrapheme()
    const before = this._value.slice(0, this._cursor)
    const after = this._value.slice(end)
    this._value = before + after
    this.onChangeCallback?.(this._value, this._cursor)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  private deleteToStart(): InputLineEvent | null {
    const { line } = this.getLineCol(this._cursor)
    const start = this.absolutePos(line, 0)
    if (this._cursor <= start) return null
    this.recordUndo('delete')
    this._value = this._value.slice(0, start) + this._value.slice(this._cursor)
    this._cursor = start
    this.onChangeCallback?.(this._value, this._cursor)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  private deleteToEnd(): InputLineEvent | null {
    const lines = this._value.split('\n')
    const { line } = this.getLineCol(this._cursor)
    const end = this.absolutePos(line, (lines[line] ?? '').length)
    if (this._cursor >= end) return null
    this.recordUndo('delete')
    this._value = this._value.slice(0, this._cursor) + this._value.slice(end)
    this.onChangeCallback?.(this._value, this._cursor)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  private deleteWordBack(): InputLineEvent | null {
    if (this._cursor <= 0) return null
    this.recordUndo('delete')
    /* jscpd:ignore-start */
    const start = this.prevWordStart()
    const before = this._value.slice(0, start)
    const after = this._value.slice(this._cursor)
    this._value = before + after
    this._cursor = start
    this.onChangeCallback?.(this._value, this._cursor)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  private deleteWordForward(): InputLineEvent | null {
    if (this._cursor >= this._value.length) return null
    this.recordUndo('delete')
    const end = this.nextWordEnd()
    const before = this._value.slice(0, this._cursor)
    const after = this._value.slice(end)
    this._value = before + after
    this.onChangeCallback?.(this._value, this._cursor)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  // ── Cursor Movement ──────────────────────────────────────────

  private moveLeft(): InputLineEvent | null {
    /* jscpd:ignore-end */
    if (this._cursor <= 0) return null
    this.sealUndo()
    this._cursor = this.prevGrapheme()
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  private moveRight(): InputLineEvent | null {
    if (this._cursor >= this._value.length) return null
    this.sealUndo()
    this._cursor = this.nextGrapheme()
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  /** 光标左侧最近的 grapheme 边界。 */
  private prevGrapheme(): number {
    if (this._cursor <= 0) return 0
    return boundaryBefore(this.graphemeBounds(), this._cursor)
  }

  /** 光标右侧最近的 grapheme 边界。 */
  private nextGrapheme(): number {
    if (this._cursor >= this._value.length) return this._value.length
    const b = boundaryAfter(this.graphemeBounds(), this._cursor)
    return b < 0 ? this._value.length : b
  }

  /** 当前 value 的 grapheme 边界（按 value 缓存，纯光标移动命中缓存）。
   *  折叠粘贴标记为原子单位：标记内部的边界被剔除，光标/删除整体越过。 */
  private graphemeBounds(): number[] {
    if (this._graphemeCache?.value === this._value) return this._graphemeCache.bounds
    let bounds = graphemeBoundaries(this._value)
    if (this._pastes.size > 0) bounds = atomicPasteMarkerBounds(this._value, bounds)
    this._graphemeCache = { value: this._value, bounds }
    return bounds
  }

  private moveHome(): InputLineEvent | null {
    const { line } = this.getLineCol(this._cursor)
    const pos = this.absolutePos(line, 0)
    if (pos === this._cursor) return null
    this.sealUndo()
    this._cursor = pos
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  private moveEnd(): InputLineEvent | null {
    const lines = this._value.split('\n')
    const { line } = this.getLineCol(this._cursor)
    const pos = this.absolutePos(line, (lines[line] ?? '').length)
    if (pos === this._cursor) return null
    this.sealUndo()
    this._cursor = pos
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  private moveWordLeft(): InputLineEvent | null {
    const start = this.prevWordStart()
    if (start === this._cursor) return null
    this.sealUndo()
    this._cursor = start
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  private moveWordRight(): InputLineEvent | null {
    const end = this.nextWordEnd()
    if (end === this._cursor || end >= this._value.length && this._cursor === this._value.length) return null
    this.sealUndo()
    this._cursor = end
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  // ── Multi-line Navigation ────────────────────────────────────

  /** 当前光标的（行,列），列以 grapheme 计（CJK/emoji/组合簇不被拆开）。 */
  private getLineCol(pos: number): { line: number; col: number } {
    const parts = this._value.slice(0, pos).split('\n')
    const last = parts[parts.length - 1]
    return { line: parts.length - 1, col: last === undefined ? 0 : graphemeBoundaries(last).length - 1 }
  }

  /** 由（行,grapheme 列）还原 code-unit 偏移，col 超出行长则贴到行尾。 */
  private posFromLineCol(line: number, col: number): number {
    const lines = this._value.split('\n')
    const clampedLine = Math.max(0, Math.min(line, lines.length - 1))
    let pos = 0
    for (let i = 0; i < clampedLine; i++) {
      const l = lines[i]
      if (l === undefined) break // unreachable: i < clampedLine <= length-1
      pos += l.length + 1 // +1 = '\n'
    }
    const last = lines[clampedLine]
    if (last !== undefined) {
      // 列号经 grapheme 边界换算偏移——code-unit 直取会落在代理对/ZWJ 簇中间
      const bounds = graphemeBoundaries(last)
      pos += bounds[Math.min(Math.max(0, col), bounds.length - 1)] ?? 0
    }
    return pos
  }

  /** 逻辑行 `line` 内 code-unit 偏移 → 整段 buffer 偏移。 */
  private absolutePos(line: number, offset: number): number {
    const lines = this._value.split('\n')
    let pos = 0
    const last = Math.min(Math.max(line, 0), Math.max(0, lines.length - 1))
    for (let i = 0; i < last; i++) {
      pos += (lines[i]?.length ?? 0) + 1
    }
    const logical = lines[last] ?? ''
    return pos + Math.min(Math.max(0, offset), logical.length)
  }

  /**
   * 按显示宽度把一行切成视觉行起点（不含自绘 █）。
   * @param logical - 一条逻辑行（不含换行符）。
   * @param maxContentWidth - 去掉 `❯ ` 前缀后的内容列数。
   */
  private visualRowStarts(logical: string, maxContentWidth: number): number[] {
    const starts = [0]
    if (logical.length === 0) return starts
    const ambiguousAsWide = ambiguousWideEnabled()
    const bounds = graphemeBoundaries(logical)
    let width = 0
    for (let g = 0; g < bounds.length - 1; g++) {
      const start = bounds[g]
      const end = bounds[g + 1]
      if (start === undefined || end === undefined) continue
      const cw = Math.max(1, inputDisplayWidth(logical.slice(start, end), ambiguousAsWide))
      if (width > 0 && width + cw > maxContentWidth) {
        starts.push(start)
        width = cw
      } else {
        width += cw
      }
    }
    return starts
  }

  /** 全部逻辑行展开后的视觉行（start/end 为该逻辑行内偏移）。 */
  private collectVisualRows(): Array<{ line: number; start: number; end: number }> {
    const prefixWidth = 2
    const maxContent = Math.max(1, (this._wrapWidth ?? 80) - prefixWidth)
    const lines = this._value.split('\n')
    const rows: Array<{ line: number; start: number; end: number }> = []
    for (let i = 0; i < lines.length; i++) {
      const logical = lines[i] ?? ''
      const starts = this.visualRowStarts(logical, maxContent)
      for (let s = 0; s < starts.length; s++) {
        const start = starts[s] ?? 0
        const end = s + 1 < starts.length ? (starts[s + 1] ?? logical.length) : logical.length
        rows.push({ line: i, start, end })
      }
    }
    return rows
  }

  /**
   * 在软折行与逻辑行之间移动。单视觉行且无换行时交给历史上翻。
   * @param delta - 负上正下；越界夹到两端（不翻历史）。
   */
  private tryMoveVisual(delta: number): 'history' | 'edge' | 'moved' {
    const rows = this.collectVisualRows()
    const wrapped = rows.length > 1 || this._value.includes('\n')
    if (!wrapped) return 'history'
    const { line } = this.getLineCol(this._cursor)
    const colOffset = this._cursor - this.absolutePos(line, 0)
    let idx = 0
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      if (row === undefined) continue
      if (row.line < line || (row.line === line && row.start <= colOffset)) idx = r
    }
    const targetIdx = Math.min(rows.length - 1, Math.max(0, idx + delta))
    if (targetIdx === idx) return 'edge'
    const current = rows[idx]
    const dest = rows[targetIdx]
    if (current === undefined || dest === undefined) return 'edge'
    this.sealUndo()
    if (dest.line !== current.line) {
      const { col } = this.getLineCol(this._cursor)
      this._cursor = this.posFromLineCol(dest.line, col)
      return 'moved'
    }
    const destOffset = Math.min(dest.end, dest.start + Math.max(0, colOffset - current.start))
    this._cursor = this.absolutePos(dest.line, destOffset)
    return 'moved'
  }

  /** Up：有折行或多行时上移视觉行，否则取上一条历史。 */
  private moveUpOrHistory(): InputLineEvent | null {
    const result = this.tryMoveVisual(-1)
    if (result === 'history') return this.historyPrev()
    if (result === 'moved') return { type: 'change', value: this._value, cursor: this._cursor }
    return null
  }

  /** Down：有折行或多行时下移视觉行，否则取下一条历史。 */
  private moveDownOrHistory(): InputLineEvent | null {
    const result = this.tryMoveVisual(1)
    if (result === 'history') return this.historyNext()
    if (result === 'moved') return { type: 'change', value: this._value, cursor: this._cursor }
    return null
  }

  /** PageUp/PageDown：按最近一次视窗行数翻页；单行短草稿不翻历史。 */
  private movePage(direction: number): InputLineEvent | null {
    const jump = Math.max(1, (this._maxDisplayLines ?? 8) - 2) * direction
    const result = this.tryMoveVisual(jump)
    if (result === 'moved') return { type: 'change', value: this._value, cursor: this._cursor }
    return null
  }

  // ── History ──────────────────────────────────────────────────

  private historyPrev(): InputLineEvent | null {
    if (this._history.length === 0) return null
    this.recordUndo('replace')
    if (this._historyIdx === -1) {
      // P1-2：首次上翻暂存在输草稿，回到 historyNext(-1) 时恢复（shell 式往返）。
      this._draft = this._value
      this._historyIdx = 0
    }
    else if (this._historyIdx < this._history.length - 1) this._historyIdx++
    else { this.sealUndo(); return null }
    this._value = this._history[this._historyIdx] ?? ''
    this._cursor = this._value.length
    this.onChangeCallback?.(this._value, this._cursor)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  private historyNext(): InputLineEvent | null {
    if (this._historyIdx < 0) return null
    this.recordUndo('replace')
    if (this._historyIdx === 0) {
      // 越过最新一条 → 恢复在输草稿（无草稿即空串）
      this._historyIdx = -1
      this._value = this._draft ?? ''
      this._draft = null
    } else {
      this._historyIdx--
      this._value = this._history[this._historyIdx] ?? ''
    }
    this._cursor = this._value.length
    this.onChangeCallback?.(this._value, this._cursor)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  // ── Vim Normal Mode ──────────────────────────────────────────

  private handleVimNormal(name: string, _char: string, _ctrl: boolean): InputLineEvent | null {
    switch (name) {
      case 'escape': return null
      case 'return': {
        const submitted = this.expandPastes(this._value)
        const submittedImages = [...this._images]
        this.clearAfterSubmit()
        this.onImagesChangeCallback?.([])
        // 与 insert 模式一致：粘贴流累积行 + 当前行合并为一次提交。
        return this.submitFlushingPasteLines(submitted, submittedImages)
      }
      case 'left':
      case 'ctrl_b': return this.moveLeft()
      case 'right':
      case 'ctrl_f': return this.moveRight()
      case 'home': return this.moveHome()
      case 'end': return this.moveEnd()
      case 'up': return this.historyPrev()
      case 'down': return this.historyNext()
      case 'ctrl_minus':
      case 'ctrl_z': return this.undo()
      case 'ctrl_y': return this.redo()
      default:
        // i → insert, a → append, I → insert at start, A → append at end
        //（模式切换 = 封口袋前 undo 单元；a/I/A 附带光标移动同理；
        //  change 事件触发重绘——模式标签切换不能等下一帧）
        if (_char === 'i') { this.sealUndo(); this._vimMode = 'insert'; return { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === 'a') { this.sealUndo(); this._cursor = Math.min(this._cursor + 1, this._value.length); this._vimMode = 'insert'; return { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === 'I') { this.sealUndo(); this._cursor = 0; this._vimMode = 'insert'; return { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === 'A') { this.sealUndo(); this._cursor = this._value.length; this._vimMode = 'insert'; return { type: 'change', value: this._value, cursor: this._cursor } }
        // x → delete char, D → delete to end
        if (_char === 'x') return this.deleteForward()
        if (_char === 'D') return this.deleteToEnd()
        // 0 → home, $ → end, ^ → first non-whitespace
        if (_char === '0') return this.moveHome()
        if (_char === '$') return this.moveEnd()
        if (_char === '^') { this.sealUndo(); this._cursor = this._value.search(/\S|$/); return { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === 'w') return this.moveWordRightVim()
        if (_char === 'b') return this.moveWordLeft()
        // v → visual charwise；V → visual linewise；p/P → 粘贴内部剪贴板
        if (_char === 'v') { this.sealUndo(); this._selAnchor = this._cursor; this._visualLineWise = false; this._vimMode = 'visual'; return { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === 'V') { this.sealUndo(); this._selAnchor = this._cursor; this._visualLineWise = true; this._vimMode = 'visual'; return { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === 'p') return this.pasteClipboard(false)
        if (_char === 'P') return this.pasteClipboard(true)
        return null
    }
  }

  // ── Vim Visual Mode ──────────────────────────────────────────

  /** vim p/P：内部剪贴板插到光标后/前（charwise 直插，不走粘贴折叠）。 */
  private pasteClipboard(before: boolean): InputLineEvent | null {
    if (!this._clipboard) return null
    const at = before ? this._cursor : Math.min(this._cursor + 1, this._value.length)
    const head = this._value.slice(0, at)
    const tail = this._value.slice(at)
    this.setValue(head + this._clipboard + tail, head.length + this._clipboard.length)
    return { type: 'change', value: this._value, cursor: this._cursor }
  }

  /** visual：motion 扩展选区（选区渲染/linewise 对齐由 selectionRange 驱动）。 */
  private handleVimVisual(name: string, _char: string, _ctrl: boolean): InputLineEvent | null {
    switch (name) {
      case 'escape':
        this.collapseSelection()
        this._visualLineWise = false
        this._vimMode = 'normal'
        return { type: 'change', value: this._value, cursor: this._cursor }
      case 'return': {
        const submitted = this.expandPastes(this._value)
        const submittedImages = [...this._images]
        this.clearAfterSubmit()
        this._visualLineWise = false
        this._vimMode = 'normal'
        this.onImagesChangeCallback?.([])
        this.onSubmitCallback?.(submitted, submittedImages)
        return { type: 'submit', value: submitted, images: submittedImages }
      }
      case 'left': this._cursor = this.prevGrapheme(); return { type: 'change', value: this._value, cursor: this._cursor }
      case 'right': this._cursor = this.nextGrapheme(); return { type: 'change', value: this._value, cursor: this._cursor }
      case 'home': this._cursor = 0; return { type: 'change', value: this._value, cursor: this._cursor }
      case 'end': this._cursor = this._value.length; return { type: 'change', value: this._value, cursor: this._cursor }
      case 'up':
      case 'down': {
        const { line, col } = this.getLineCol(this._cursor)
        const lastLine = this._value.split('\n').length - 1
        const next = name === 'up' ? Math.max(0, line - 1) : Math.min(lastLine, line + 1)
        this._cursor = this.posFromLineCol(next, col)
        return { type: 'change', value: this._value, cursor: this._cursor }
      }
      case 'backspace':
      case 'delete': {
        // vim：x/d 同义剪切（Backspace/Delete 同 d）——先取选区（linewise 对齐
        // 依赖 visual 模式态）再复位模式，顺序不可换。
        const ev = this.cutSelection()
        this._vimMode = 'normal'
        this._visualLineWise = false
        return ev
      }
      case 'ctrl_minus':
      case 'ctrl_z': return this.undo()
      case 'ctrl_y': return this.redo()
      default:
        if (_char === 'h') { this._cursor = this.prevGrapheme(); return { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === 'l') { this._cursor = this.nextGrapheme(); return { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === '0') { this._cursor = 0; return { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === '$') { this._cursor = this._value.length; return { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === '^') { this._cursor = this._value.search(/\S|$/); return { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === 'w') { const r = this.moveWordRightVim(); return r ?? { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === 'b') { const r = this.moveWordLeft(); return r ?? { type: 'change', value: this._value, cursor: this._cursor } }
        if (_char === 'j' || _char === 'k') return this.handleVimVisual(_char === 'j' ? 'down' : 'up', _char, _ctrl)
        // o：交换锚点/光标（选区另一端编辑）
        if (_char === 'o') {
          if (this._selAnchor !== null) {
            const tmp = this._selAnchor
            this._selAnchor = this._cursor
            this._cursor = tmp
          }
          return { type: 'change', value: this._value, cursor: this._cursor }
        }
        // d/x：剪切回 normal；c：剪切进 insert；y：复制回 normal；v：退出 visual
        //（均先取选区再复位模式——linewise 对齐依赖 visual 模式态，顺序不可换）
        if (_char === 'd' || _char === 'x') {
          const ev = this.cutSelection()
          this._vimMode = 'normal'
          this._visualLineWise = false
          return ev
        }
        if (_char === 'c') {
          const ev = this.cutSelection()
          this._vimMode = 'insert'
          this._visualLineWise = false
          return ev
        }
        if (_char === 'y') {
          const ev = this.copySelection()
          this._vimMode = 'normal'
          this._visualLineWise = false
          return ev
        }
        if (_char === 'v') {
          this.collapseSelection()
          this._visualLineWise = false
          this._vimMode = 'normal'
          return { type: 'change', value: this._value, cursor: this._cursor }
        }
        return null
    }
  }

  // ── Word Navigation Helpers ──────────────────────────────────

  private prevWordStart(): number {
    if (this._cursor <= 0) return 0
    let i = this._cursor - 1
    while (i > 0 && !/\w/.test(this._value[i] ?? '')) i--
    while (i > 0 && /\w/.test(this._value[i - 1] ?? '')) i--
    return i
  }

  private nextWordEnd(): number {
    if (this._cursor >= this._value.length) return this._value.length
    let i = this._cursor
    while (i < this._value.length && !/\w/.test(this._value[i] ?? '')) i++
    if (i >= this._value.length) return this._cursor
    while (i < this._value.length && /\w/.test(this._value[i] ?? '')) i++
    return i
  }

  /** Vim 'w' — move to start of next word (not end) */
  private moveWordRightVim(): InputLineEvent | null {
    if (this._cursor >= this._value.length) return null
    let i = this._cursor
    // Skip current word
    while (i < this._value.length && /\w/.test(this._value[i] ?? '')) i++
    // Skip whitespace
    while (i < this._value.length && !/\w/.test(this._value[i] ?? '')) i++
    if (i === this._cursor) return null
    this.sealUndo()
    this._cursor = i
    return { type: 'change', value: this._value, cursor: this._cursor }
  }
}
