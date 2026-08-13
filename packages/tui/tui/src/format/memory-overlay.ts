/**
 * memory overlay — 记忆浏览器（P2 交互打磨）。
 *
 * 上下布局（终端宽度限制下左右分栏不友好）：上部为记忆列表（过滤后视口），
 * 下部为选中项完整内容。交互：
 * - ↑↓/j k：移动选中
 * - 可打印字符：进过滤 query（text/tags 子串，大小写不敏感）
 * - Backspace：退过滤
 * - x：删除选中（异步执行 onDelete + refetch 刷新；注意：x/X 已专用于删除，
 *   不进入过滤 query——只有字母数字/符号等非控制字符才进 query。若用户想输入
 *   含 'x' 的过滤词，可用大写 'X' 代替——但 'X' 目前同 x 语义。后续可选：改为
 *   dd 双键确认删除，释放单 x 给过滤。）
 * - Ctrl+N/Ctrl+P：下/上一页（分页，每页 20 条）
 * - Esc/Ctrl+C：关闭（装配方 deactivate）
 *
 * 数据源由装配方注入（TuiApp.openMemoryBrowser 经 memory 服务 list/delete），
 * overlay 本身不碰 I/O——纯状态机 + 渲染（对齐 RewindOverlay 模式）。
 */

import type { OverlayRenderer } from '../engine/overlay-engine.js'
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { getTheme } from '../theme.js'
import { truncateToDisplayWidth } from '../width.js'

/** 记忆浏览器条目（memory 服务 list() 返回形状的最小消费面）。 */
export interface MemoryBrowserItem {
  readonly id: string
  readonly text: string
  readonly tags: readonly string[]
  readonly createdAt: number
  readonly scope: string
}

/** 装配方提供的数据源回调。 */
export interface MemoryBrowserSources {
  /** 重新拉取全量条目（删除后刷新；无记忆时返回空数组）。 */
  refetch(): Promise<MemoryBrowserItem[]>
  /** 删除一条记忆（按 id）。 */
  onDelete(id: string): Promise<void>
  /** 分页拉取（offset 跳过前 N 条，limit 最多返回条数）。 */
  fetchPage(offset: number, limit: number): Promise<MemoryBrowserItem[]>
}

/** 每页条目数（与 grok-build memory 视图对齐：~20 条/页）。 */
const PAGE_SIZE = 20

/** 记忆浏览器 overlay：过滤列表 + 选中项内容，删除/分页经装配方注入的回调（纯状态机 + 渲染，零 I/O）。 */
export class MemoryBrowserOverlay implements OverlayRenderer {
  private items: MemoryBrowserItem[] = []
  private query = ''
  private selected = 0
  private sources: MemoryBrowserSources | null = null
  /** 删除/翻页执行中（渲染占位，防连点）。 */
  private deleting = false
  /** 分页：是否还有更多页（setItems 装配方判定；翻页后按实拉条数刷新）。 */
  private hasMore = false
  private readonly theme: RivetTheme

  constructor(theme?: RivetTheme) {
    this.theme = theme ?? getTheme()
  }

  /**
   * 装配方提供条目快照 + 数据源回调；重复设置重置状态（回到首页）。
   * @param items - 首页条目快照。
   * @param sources - 删除/刷新/分页回调。
   * @param hasMore - 首页之后是否还有更多条目（Ctrl+N 翻页前提）。
   */
  setItems(items: MemoryBrowserItem[], sources: MemoryBrowserSources, hasMore: boolean): void {
    this.items = items
    this.sources = sources
    this.query = ''
    this.selected = 0
    this.deleting = false
    this.hasMore = hasMore
  }

  /** 过滤后的条目（query 为空 = 全量）。 */
  private get filtered(): MemoryBrowserItem[] {
    const needle = this.query.toLowerCase()
    if (needle === '') return this.items
    return this.items.filter(item =>
      item.text.toLowerCase().includes(needle)
      || item.tags.some(tag => tag.toLowerCase().includes(needle)))
  }

  /**
   * 处理按键；返回 true 表示已消费（Esc/Ctrl+C 由装配方关闭 overlay）。
   * @param name - 按键名（up/down/backspace/ctrl_n/ctrl_p/escape/ctrl_c 等）。
   * @param char - 可打印字符（j/k 移动，x/X 删除，其余进过滤 query）。
   * @returns 已消费时 true。
   */
  handleKey(name: string, char: string): boolean {
    if (this.deleting) return true
    if (name === 'up' || char === 'k') {
      this.selected = Math.max(0, this.selected - 1)
      return true
    }
    if (name === 'down' || char === 'j') {
      this.selected = Math.min(this.filtered.length - 1, this.selected + 1)
      return true
    }
    if (name === 'backspace') {
      if (this.query !== '') {
        this.query = this.query.slice(0, -1)
        this.selected = Math.min(this.selected, Math.max(0, this.filtered.length - 1))
      }
      return true
    }
    if (char === 'x' || char === 'X') {
      void this.deleteSelected()
      return true
    }
    if (name === 'ctrl_n') { void this.nextPage(); return true }
    if (name === 'ctrl_p') { void this.prevPage(); return true }
    if (char !== '' && char !== ' ') {
      this.query += char
      this.selected = 0
      return true
    }
    return name === 'escape' || name === 'ctrl_c'
  }

  /** 删除当前选中项（异步：onDelete + refetch 刷新；失败静默保持列表）。 */
  private async deleteSelected(): Promise<void> {
    const sources = this.sources
    const item = this.filtered[this.selected]
    if (sources === null || item === undefined) return
    this.deleting = true
    try {
      await sources.onDelete(item.id)
      this.items = await sources.refetch()
      this.selected = Math.min(this.selected, Math.max(0, this.filtered.length - 1))
    } finally {
      this.deleting = false
    }
  }

  /** 下一页（异步拉取，加载中静默）。offset 语义 = 已加载条数（fetchPage
   * 跳过前 N 条）；成功后 hasMore 按实拉条数刷新（满页 = 可能还有）。 */
  private async nextPage(): Promise<void> {
    const sources = this.sources
    if (sources === null || !this.hasMore) return
    this.deleting = true
    try {
      const nextOffset = this.items.length
      const page = await sources.fetchPage(nextOffset, PAGE_SIZE)
      if (page.length > 0) {
        this.items = [...this.items, ...page]
        this.hasMore = page.length >= PAGE_SIZE
        this.selected = Math.min(this.selected, Math.max(0, this.filtered.length - 1))
      }
    } finally {
      this.deleting = false
    }
  }

  /** 上一页（Ctrl+P：无条件回到首页——fetchPage(0, limit) 覆盖为首页，幂等）。 */
  private async prevPage(): Promise<void> {
    const sources = this.sources
    if (sources === null) return
    this.deleting = true
    try {
      const page = await sources.fetchPage(0, PAGE_SIZE)
      this.items = page
      this.hasMore = page.length >= PAGE_SIZE
      this.selected = 0
    } finally {
      this.deleting = false
    }
  }

  render(width: number, height: number): string[] {
    const theme = this.theme
    const contentWidth = Math.max(1, width - 2)
    if (this.items.length === 0) {
      return [
        color('🧠 memory', theme.secondary),
        color('（暂无记忆）', theme.muted),
        color('用 /remember <text> 保存第一条', theme.muted),
      ]
    }
    if (this.deleting) {
      return [color('🧠 memory', theme.secondary), color('删除中…', theme.muted)]
    }
    const filtered = this.filtered
    const rows: string[] = [
      color(`🧠 memory${this.query === '' ? '' : ` · filter: ${this.query}`}（${filtered.length}/${this.items.length} 条）`, theme.secondary),
    ]
    if (filtered.length === 0) {
      rows.push(color('（无匹配条目——Backspace 清除过滤）', theme.muted))
      rows.push(color('─'.repeat(contentWidth), theme.muted))
      rows.push(color('↑↓ 选择 · 输入过滤 · x 删除 · Ctrl+N/P 翻页 · Esc 关闭', theme.muted))
      return rows
    }
    // 列表区（上半）：视口滚动跟随选中。
    const listHeight = Math.max(1, Math.floor((height - 3) / 2))
    const offset = Math.max(0, Math.min(this.selected - listHeight + 1, filtered.length - listHeight))
    for (let i = offset; i < Math.min(offset + listHeight, filtered.length); i++) {
      const item = filtered[i]
      if (item === undefined) continue
      const sel = i === this.selected
      const firstLine = (item.text.split('\n')[0] ?? '').replace(/\n/g, ' ')
      const tags = item.tags.length > 0 ? ` #${item.tags.join(' #')}` : ''
      const line = truncateToDisplayWidth(`[${item.id.slice(0, 8)}] ${firstLine}${tags}`, contentWidth - 2)
      rows.push(sel ? color(`▸ ${line}`, theme.success) : `  ${line}`)
    }
    rows.push(color('─'.repeat(contentWidth), theme.muted))
    // 内容区（下半）：选中项完整内容（截断到剩余高度）。
    const selected = filtered[this.selected]
    if (selected !== undefined) {
      const remaining = Math.max(1, height - rows.length - 2)
      const contentLines = selected.text.split('\n')
      for (let i = 0; i < Math.min(remaining, contentLines.length); i++) {
        const line = contentLines[i]
        if (line !== undefined) rows.push(truncateToDisplayWidth(line, contentWidth))
      }
      if (contentLines.length > remaining) {
        rows.push(color(`…（共 ${contentLines.length} 行）`, theme.muted))
      }
    }
    rows.push(color('↑↓ 选择 · 输入过滤 · x 删除 · Ctrl+N/P 翻页 · Esc 关闭', theme.muted))
    return rows
  }
}
