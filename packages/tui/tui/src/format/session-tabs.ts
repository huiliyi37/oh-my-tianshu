/**
 * session-tabs — 会话 Tab 栏(纯渲染;Claude Code 桌面版并行会话的 TUI 形态)。
 *
 * 单行契约:短 id tab 列表,当前会话 ● + 高亮;窄宽从旧到新丢 tab,
 * 超限折叠为 `+N`;任何宽度下显示宽度 ≤ width。
 * 数据源:调用方传入(attach/newSession/switchSession 后经 listSessions 缓存)。
 *
 * @module @huiliyi37/dsh-tui/session-tabs
 */

import { color } from '../engine/ansi.js'
import type { LiveRegionLine } from '../engine/live-engine.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'

/** 一个会话 tab。 */
export interface SessionTab {
  /** 会话 id(完整;渲染用 label)。 */
  id: string
  /** 展示标签(调用方截短,如 `s-3a2f`)。 */
  label: string
  /** 当前会话标记(● + 高亮)。 */
  current?: boolean
}

/**
 * 会话 id → tab 短标签：剥掉 `session-` 前缀再取 8 字，避免全部显示成 `[session-]`。
 * @param id - 完整会话 id。
 * @returns 至多 8 个字符的展示标签。
 */
export function sessionTabLabel(id: string): string {
  const rest = id.startsWith('session-') ? id.slice(8) : id
  return rest.slice(0, 8)
}

/** tab 分隔符。 */
const TAB_GAP = ' '

/**
 * 渲染会话 tab 栏单行:`[label] [label●] …`;当前 tab ● 高亮(primary bold),
 * 其余 dim;放不下时从旧到新丢 tab,最后保留 `+N` 折叠段(最旧优先丢,
 * 当前 tab 恒保留——丢任何 tab 前先丢非当前)。
 * @param tabs - 会话 tab 列表(顺序 = 新旧顺序,末位最新)。
 * @param width - 可用显示宽度。
 * @param theme - 当前主题。
 * @returns 单行 live 内容;tabs 为空返回空数组。
 */
export function formatSessionTabs(
  tabs: readonly SessionTab[],
  width: number,
  theme: RivetTheme,
): LiveRegionLine[] {
  if (tabs.length === 0 || width <= 0) return []
  const segs = tabs.map(tab => ({ tab, text: `[${tab.label}${tab.current === true ? '●' : ''}]` }))
  for (;;) {
    // 每次评估都带折叠段(被丢 tab 数);放得下即渲染。
    const hidden = tabs.length - segs.length
    const suffix = hidden > 0 ? ` +${hidden}` : ''
    const text = `${segs.map(s => s.text).join(TAB_GAP)}${suffix}`
    if (displayWidth(text) <= width) {
      const parts = segs.map((s) => {
        return s.tab.current === true
          ? color(s.text, theme.primary, { bold: true })
          : color(s.text, theme.dim)
      })
      if (suffix !== '') parts.push(color(suffix.trim(), theme.muted))
      return [{ text: parts.join(TAB_GAP) }]
    }
    // 丢最旧的非当前 tab(当前恒保留);无候选(只剩当前)则整体截断。
    const drop = segs.findIndex(s => s.tab.current !== true)
    if (drop === -1) {
      return [{ text: truncateToWidth(segs.map(s => s.text).join(TAB_GAP), width) }]
    }
    segs.splice(drop, 1)
    if (segs.length === 0) return []
  }
}

/** 按显示宽度截断(仅截断时尾部补 …)。 */
function truncateToWidth(text: string, width: number): string {
  if (width <= 1) return '…'
  let out = ''
  let w = 0
  for (const ch of text) {
    const cw = displayWidth(ch)
    if (w + cw > width - 1) break
    out += ch
    w += cw
  }
  return w < displayWidth(text) ? `${out}…` : out
}
