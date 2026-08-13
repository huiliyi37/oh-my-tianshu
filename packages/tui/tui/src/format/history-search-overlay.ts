/**
 * C2 项 2：历史搜索 overlay — 全屏 alt-screen 内 smart-case 搜索对话历史。
 *
 * 设计决策（C2 文档）：
 * - 不引入 Worker（DSH 单会话规模小，主线程同步搜索够）
 * - 数据源：transcript.view.messages（adapter 事件投影，消费 text 字段）
 * - smart-case：查询含大写 → 精确匹配；否则大小写不敏感
 * - 输入实时搜索（type 即重算），n/N 循环跳转，Esc 退出
 */

import type { OverlayRenderer } from '../engine/overlay-engine.js'
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { getTheme } from '../theme.js'
import { truncateToDisplayWidth } from '../width.js'

/** 搜索数据源的最小形状（adapter/transcript 的 TranscriptMessage.text 满足它）。 */
export interface SearchableMessage {
  text: string
}

/** smart-case：查询含大写字母 → 精确匹配；否则不敏感。 */
function hasUpper(query: string): boolean {
  return /[A-Z]/.test(query)
}

/** 历史搜索 overlay：smart-case 子串搜索对话历史，输入实时重算，n/N 循环跳转（主线程同步搜索，零 I/O）。 */
export class HistorySearchOverlay implements OverlayRenderer {
  private query = ''
  private matches: number[] = []
  private current = 0
  private messages: readonly SearchableMessage[] = []
  private readonly theme: RivetTheme

  constructor(theme?: RivetTheme) {
    this.theme = theme ?? getTheme()
  }

  /**
   * 装配方提供消息快照（transcript.view.messages）；重复设置重算搜索。
   * @param messages - 可搜索的消息快照。
   */
  setMessages(messages: readonly SearchableMessage[]): void {
    this.messages = messages
    this.research()
  }

  /**
   * 输入字符：累积进 query 并实时搜索。
   * @param char - 追加到 query 的可打印字符。
   */
  type(char: string): void {
    this.query += char
    this.research()
  }

  /** 退格：删末字符并重算。 */
  backspace(): void {
    this.query = this.query.slice(0, -1)
    this.research()
  }

  /** 清空查询（overlay 关闭时调用）。 */
  clear(): void {
    this.query = ''
    this.matches = []
    this.current = 0
  }

  /** 下一个匹配（循环）。 */
  goNext(): void {
    if (this.matches.length === 0) return
    this.current = (this.current + 1) % this.matches.length
  }

  /** 上一个匹配（循环）。 */
  goPrev(): void {
    if (this.matches.length === 0) return
    this.current = (this.current - 1 + this.matches.length) % this.matches.length
  }

  /**
   * 当前匹配数。
   * @returns 命中的消息条数。
   */
  matchCount(): number {
    return this.matches.length
  }

  /**
   * 当前匹配的消息索引；无匹配返回 -1。
   * @returns messages 数组下标，或 -1。
   */
  currentIndex(): number {
    /* v8 ignore next -- current 经 % matches.length 归一化恒在界内（goNext/goPrev），索引必有值 */
    return this.matches.length === 0 ? -1 : this.matches[this.current] ?? -1
  }

  private research(): void {
    this.current = 0
    if (this.query === '') {
      this.matches = []
      return
    }
    const sensitive = hasUpper(this.query)
    const q = sensitive ? this.query : this.query.toLowerCase()
    this.matches = []
    for (let i = 0; i < this.messages.length; i++) {
      const message = this.messages[i]
      /* v8 ignore next -- 数组元素由装配方构造，无 undefined；noUncheckedIndexedAccess 防御 */
      if (message === undefined) continue
      const haystack = sensitive ? message.text : message.text.toLowerCase()
      if (haystack.includes(q)) this.matches.push(i)
    }
  }

  render(width: number, height: number): string[] {
    const theme = this.theme
    const rows: string[] = []
    // 搜索栏
    const queryText = this.query === '' ? '输入搜索词（n/N 跳转，Esc 退出）' : this.query
    const counter = this.matches.length > 0 ? `  ${this.current + 1}/${this.matches.length}` : ''
    rows.push(color(`/ ${queryText}${this.query === '' ? '' : '▌'}${counter}`, theme.secondary))
    // 消息区：从当前匹配（或第一条）开始渲染，单行截断
    const bodyHeight = Math.max(1, height - 2)
    const start = this.currentIndex() >= 0 ? this.currentIndex() : 0
    const contentWidth = Math.max(10, width - 2)
    let used = 0
    for (let i = start; i < this.messages.length; i++) {
      if (used >= bodyHeight) break
      const message = this.messages[i]
      /* v8 ignore next -- 数组元素由装配方构造，无 undefined；noUncheckedIndexedAccess 防御 */
      if (message === undefined) continue
      const isMatch = this.matches.includes(i)
      const text = message.text === '' ? '(空消息)' : message.text
      const line = truncateToDisplayWidth(text, contentWidth)
      rows.push(isMatch
        ? color(`▸ ${line}`, theme.success)
        : `  ${line}`)
      used++
    }
    // 底部 hints
    rows.push(color('n/N 下一个/上一个 · Esc 退出', theme.muted))
    return rows
  }

  /* v8 ignore next -- 空实现：消息快照由装配方在激活时 setMessages，无自有语句可覆盖 */
  onActivate(): void {
    // 消息快照由装配方在激活时 setMessages
  }

  onDeactivate(): void {
    this.clear()
  }
}
