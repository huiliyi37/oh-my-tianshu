/**
 * transcript viewer overlay — 全屏转录查看器（T5，/scroll）。
 *
 * 数据源：scrollback 文本（CommitEngine.getContent()，RingBuffer 封顶），经
 * scrollback-transcript.ts 解析为消息级单元——该 API 自登记起即为此预留
 * （见其模块注释），本 overlay 是其唯一消费端。
 *
 * 与 Ctrl+F 历史搜索（HistorySearchOverlay，数据源为投影层消息文本）互补：
 * 搜索 overlay 按消息文本定位，本查看器翻看屏幕上确切的 scrollback 记录
 * （含命令回显、steer、/btw 折叠答案、工具卡），并可轮次跳转。
 *
 * 模式：纯状态机 + 渲染，零 I/O（对齐 MemoryBrowserOverlay / RewindOverlay）。
 * 数据在激活时由装配方 setContent 注入；打开期间为快照——流式新增的
 * scrollback 不推送到 overlay（alt screen 遮住主屏，关闭后主屏自然最新）。
 * 这是 v1 已知限制，记录在 Agent Note。
 *
 * 渲染：把消息行按当前终端宽度预折行为显示行平面（wrapToDisplayWidth，与
 * scrollback-transcript 的行高估算同口径），视口按 scrollRow 切片——宽度
 * 变化才重建平面，帧内零重估。
 *
 * 交互（按键路由见 app.ts activeId() === 'transcript' 分支）：
 * - ↑/↓ 或 j/k：单行滚动
 * - PageUp/PageDown（Ctrl+U/Ctrl+D 同义）：半屏滚动
 * - home/end（g/G 同义）：跳顶/跳底
 * - [ / ]：上一/下一轮（user 消息起点，循环）
 * - /：进入搜索——字符累积 query 实时跳首个匹配；n/N 循环下一/上一匹配；
 *   Enter = n；Esc 清 query 保持打开（再 Esc 关闭）；Ctrl+C 直接关闭
 * - Esc/Ctrl+C：关闭（装配方 deactivate）
 *
 * @module @huiliyi37/dsh-tui/format/transcript-viewer
 */

import type { OverlayRenderer } from '../engine/overlay-engine.js'
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { getTheme } from '../theme.js'
import { truncateToDisplayWidth, wrapToDisplayWidth } from '../width.js'
import {
  cumulativeRowsToMessage,
  findNextMatch,
  findPrevMatch,
  parseScrollbackTranscript,
  searchTranscript,
  type TranscriptMessage,
} from '../scrollback-transcript.js'

/** setContent 的注入选项。 */
export interface TranscriptViewerOptions {
  /** scrollback 缓冲已封顶丢弃更早内容（顶栏提示截断）。 */
  truncated?: boolean
  /** 缓冲行数上限（truncated 时的提示数字）。 */
  maxLines?: number
}

/** 首帧 render 前的缺省终端宽度（按键路径的平面重建兜底）。 */
const DEFAULT_WIDTH = 80
/** 首帧 render 前的缺省终端高度（半屏步长/视口行数兜底）。 */
const DEFAULT_HEIGHT = 24

/** 全屏转录查看器 overlay：scrollback 平面化 + 行滚动/轮次跳转/搜索（纯状态机，零 I/O）。 */
export class TranscriptViewer implements OverlayRenderer {
  private messages: TranscriptMessage[] = []
  /** 平面化后的显示行（预折行到平面宽度）。 */
  private rows: string[] = []
  /** 每条消息在 rows 中的起始显示行（与 cumulativeRowsToMessage 同口径）。 */
  private msgStart: number[] = []
  /** 视口顶部所在显示行（绝对）。 */
  private scrollRow = 0
  /** 平面缓存的宽度；-1 = 未建立（下次 render 重建）。 */
  private flatWidth = -1
  /** 上次 render 的高度（半屏步长与视口行数数据源）。 */
  private lastHeight = DEFAULT_HEIGHT
  private searchMode = false
  private query = ''
  private matches: number[] = []
  private matchIdx = 0
  private truncated = false
  private maxLines: number | undefined
  private readonly theme: RivetTheme

  constructor(theme?: RivetTheme) {
    this.theme = theme ?? getTheme()
  }

  /**
   * 装配方注入 scrollback 快照（激活时调用一次）；重复设置重置全部状态。
   * @param content - CommitEngine.getContent() 的 scrollback 全文（可含 ANSI）。
   * @param options - 截断提示（缓冲封顶时顶栏显示）。
   */
  setContent(content: string, options: TranscriptViewerOptions = {}): void {
    this.messages = parseScrollbackTranscript(content)
    this.truncated = options.truncated ?? false
    this.maxLines = options.maxLines
    this.rows = []
    this.msgStart = []
    this.flatWidth = -1
    this.scrollRow = 0
    this.searchMode = false
    this.query = ''
    this.matches = []
    this.matchIdx = 0
  }

  /**
   * 当前是否处于搜索态（app 层据此区分 Esc=清 query 保持打开 与 Esc=关闭）。
   * @returns 搜索态为 true。
   */
  isSearchMode(): boolean {
    return this.searchMode
  }

  /**
   * 处理按键；返回 true 表示已消费（Esc/Ctrl+C 由装配方关闭 overlay，
   * 搜索态 Esc 只清 query）。
   * @param name - 按键名（up/down/pageup/pagedown/home/end/backspace/return/escape/ctrl_c/ctrl_u/ctrl_d）。
   * @param char - 可打印字符（j/k/g/G/[ ]//n/N 与搜索 query 字符）。
   * @returns 已消费时 true。
   */
  handleKey(name: string, char: string): boolean {
    if (this.searchMode) return this.handleSearchKey(name, char)
    if (name === 'up' || char === 'k') { this.scrollBy(-1); return true }
    if (name === 'down' || char === 'j') { this.scrollBy(1); return true }
    if (name === 'pageup' || name === 'ctrl_u') { this.scrollBy(-this.pageStep()); return true }
    if (name === 'pagedown' || name === 'ctrl_d') { this.scrollBy(this.pageStep()); return true }
    if (name === 'home' || char === 'g') { this.scrollTo(0); return true }
    if (name === 'end' || char === 'G') { this.scrollToEnd(); return true }
    if (char === '[') { this.jumpTurn(-1); return true }
    if (char === ']') { this.jumpTurn(1); return true }
    if (char === '/') { this.enterSearch(); return true }
    // 未绑定键不消费（app 层 overlay 打开期间仍吞掉该键，输入行不可达）。
    return name === 'escape' || name === 'ctrl_c'
  }

  /**
   * 渲染 overlay 内容（顶栏 + 视口切片 + 键提示；宽度变化重建平面）。
   * @param width - 终端列数（<1 按 1）。
   * @param height - 终端行数（<1 按 1）。
   * @returns ANSI 行数组。
   */
  render(width: number, height: number): string[] {
    this.lastHeight = Math.max(1, height)
    const cols = Math.max(1, width)
    if (this.flatWidth !== cols) this.flatten(cols)
    if (this.messages.length === 0) {
      return [
        color('📜 transcript', this.theme.secondary),
        color('（暂无内容——会话尚未产生 scrollback）', this.theme.muted),
      ]
    }
    const total = this.totalRows()
    const cur = this.messageAtRow(this.scrollRow)
    let header = `📜 transcript · 消息 ${cur + 1}/${this.messages.length} · 行 ${this.scrollRow + 1}/${total}`
    if (this.searchMode) {
      const pos = this.matches.length === 0 ? 0 : this.matchIdx + 1
      header += ` · /${this.query} 命中 ${pos}/${this.matches.length}`
    }
    if (this.truncated) header += ` · ⚠ 仅显示最近 ${this.maxLines ?? 'N'} 行`
    const rows: string[] = [
      truncateToDisplayWidth(color(header, this.theme.secondary), cols),
      ...this.rows.slice(this.scrollRow, this.scrollRow + Math.max(1, height - 2)),
      truncateToDisplayWidth(
        color('↑↓ jk 行 · PgUp/PgDn 半屏 · [ ] 轮次 · / 搜索 · g/G 顶底 · Esc 关闭', this.theme.muted),
        cols,
      ),
    ]
    return rows
  }

  /** 搜索态按键：Esc 清 query；字符累积实时重算并跳首个匹配；n/N 循环。 */
  private handleSearchKey(name: string, char: string): boolean {
    if (name === 'escape') { this.exitSearch(); return true }
    if (name === 'backspace') {
      if (this.query !== '') {
        this.query = this.query.slice(0, -1)
        this.research(true)
      }
      return true
    }
    if (name === 'return' || char === 'n') { this.jumpMatch(1); return true }
    if (char === 'N') { this.jumpMatch(-1); return true }
    if (char !== '' && char !== ' ') {
      this.query += char
      this.research(true)
      return true
    }
    // 搜索态吞掉其余按键（Ctrl+C 由装配方关闭）。
    return true
  }

  /** 进入搜索态（清空 query 与匹配）。 */
  private enterSearch(): void {
    this.searchMode = true
    this.query = ''
    this.matches = []
    this.matchIdx = 0
  }

  /** 退出搜索态（保持视口位置）。 */
  private exitSearch(): void {
    this.searchMode = false
    this.query = ''
    this.matches = []
    this.matchIdx = 0
  }

  /** 重算匹配；jump 时跳到首个匹配（typing 实时反馈）。 */
  private research(jump: boolean): void {
    this.matches = searchTranscript(this.messages, this.query)
    this.matchIdx = 0
    if (jump && this.matches.length > 0) {
      const first = this.matches[0]
      /* v8 ignore next -- matches.length > 0 已在上方守卫 */
      if (first === undefined) return
      this.jumpToMessage(first)
    }
  }

  /** n/N：从视口顶消息起找下一/上一匹配并跳转（循环）。 */
  private jumpMatch(delta: 1 | -1): void {
    if (this.matches.length === 0) return
    const current = this.messageAtRow(this.scrollRow)
    const target = delta === 1
      ? findNextMatch(this.messages, current, this.query)
      : findPrevMatch(this.messages, current, this.query)
    const pos = this.matches.indexOf(target)
    if (pos >= 0) this.matchIdx = pos
    this.jumpToMessage(target)
  }

  /** [ ]：上一/下一轮——从视口顶消息起找上/下一条 user 消息（循环）。 */
  private jumpTurn(delta: 1 | -1): void {
    const n = this.messages.length
    if (n === 0) return
    const current = this.messageAtRow(this.scrollRow)
    for (let step = 1; step <= n; step++) {
      const idx = (((current + delta * step) % n) + n) % n
      if (this.messages[idx]?.role === 'user') {
        this.jumpToMessage(idx)
        return
      }
    }
    // 无 user 消息（如仅工具卡回放的极端会话）：不跳。
  }

  /** 跳转到指定消息的起始显示行。 */
  private jumpToMessage(idx: number): void {
    this.ensureFlat()
    const start = this.msgStart[idx]
    /* v8 ignore next -- idx 来自 messages 下标，msgStart 同长，恒有值 */
    if (start === undefined) return
    this.scrollTo(start)
  }

  /** 视口顶部所在消息下标（线性扫描，消息数受缓冲封顶约束）。 */
  private messageAtRow(row: number): number {
    let idx = 0
    for (let i = 0; i < this.msgStart.length; i++) {
      const start = this.msgStart[i]
      /* v8 ignore next -- 下标恒在界内；noUncheckedIndexedAccess 收窄防御 */
      if (start === undefined) continue
      if (start <= row) idx = i
      else break
    }
    return idx
  }

  /** 重建显示行平面（消息行按宽度预折行；msgStart 与估算 API 同口径）。 */
  private flatten(width: number): void {
    this.rows = []
    this.msgStart = []
    const max = Math.max(1, width)
    for (let i = 0; i < this.messages.length; i++) {
      const message = this.messages[i]
      /* v8 ignore next -- 下标恒在界内；noUncheckedIndexedAccess 收窄防御 */
      if (message === undefined) continue
      this.msgStart.push(cumulativeRowsToMessage(this.messages, i, max))
      for (const line of message.lines) {
        this.rows.push(...wrapToDisplayWidth(line, max))
      }
    }
    this.flatWidth = width
    this.scrollRow = Math.min(this.scrollRow, this.maxScroll())
  }

  /** 平面未建立时按缺省宽度先建（首帧 render 前的按键路径）。 */
  private ensureFlat(): void {
    if (this.flatWidth === -1) this.flatten(DEFAULT_WIDTH)
  }

  /** 视口正文行数（顶栏+底栏各占一行）。 */
  private viewportRows(): number {
    return Math.max(1, this.lastHeight - 2)
  }

  /** 半屏滚动步长。 */
  private pageStep(): number {
    return Math.max(1, Math.floor(this.viewportRows() / 2))
  }

  /** 视口顶可到的最大显示行（尾页填满视口）。 */
  private maxScroll(): number {
    return Math.max(0, this.totalRows() - this.viewportRows())
  }

  /** 平面总显示行数。 */
  private totalRows(): number {
    return this.rows.length
  }

  /** 滚动到绝对行（clamp 到 [0, maxScroll]）。 */
  private scrollTo(row: number): void {
    this.ensureFlat()
    this.scrollRow = Math.max(0, Math.min(row, this.maxScroll()))
  }

  /** 滚动到尾页（视口填满尾部内容）。 */
  private scrollToEnd(): void {
    this.ensureFlat()
    this.scrollTo(this.maxScroll())
  }

  /** 相对滚动。 */
  private scrollBy(delta: number): void {
    this.scrollTo(this.scrollRow + delta)
  }
}
