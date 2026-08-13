/**
 * Turn 结束统计摘要（format/turn-summary.ts）— 纯渲染。
 *
 * 行结构：`turn N · trail · 读X 改Y · ✓Z · elapsed`。
 * trail 按 phase 顺序用 glyph 连接；窄宽时从尾部 drop 次要段。
 * ascii 入参决定 trail glyph；任何宽度下不破版。
 */
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'
import { formatElapsedHuman } from './spinner-status.js'

/** turn 内的阶段（trail glyph 的判别标签）。 */
export type TurnPhase = 'thinking' | 'streaming' | 'tool' | 'verifying' | 'done'

/** formatTurnSummary 的渲染输入。 */
export interface TurnSummaryInput {
  turnNumber: number
  segments: readonly TurnPhase[]
  filesRead: number
  filesModified: number
  width: number
  verifiedCount?: number
  elapsedMs?: number
  ascii?: boolean
}

const GLYPHS: Record<TurnPhase, { box: string; ascii: string }> = {
  thinking: { box: '◐', ascii: 'o' },
  streaming: { box: '▸', ascii: '>' },
  tool: { box: '●', ascii: '*' },
  verifying: { box: '✓', ascii: 'v' },
  done: { box: '◆', ascii: '!' },
}

function truncateTo(text: string, columns: number): string {
  let out = ''
  for (const ch of text) {
    if (displayWidth(out + ch) > columns) break
    out += ch
  }
  return out
}

/**
 * turn 结束统计摘要单行渲染：`turn N · trail · 读X 改Y · ✓Z · elapsed`。
 * 窄宽从尾部渐进 drop 次要段，最终仅剩 turn 段时按宽度截断。
 * @param input - turn 序号、阶段轨迹、读改计数与宽度等。
 * @param theme - 当前主题（整行 dim 色）。
 * @returns 单元素 ANSI 行数组，显示宽度 ≤ input.width。
 */
export function formatTurnSummary(input: TurnSummaryInput, theme: RivetTheme): string[] {
  const width = input.width
  const ascii = input.ascii === true
  const parts: string[] = [`turn ${input.turnNumber}`]
  const trail = input.segments.length > 0
    ? input.segments.map(s => (ascii ? GLYPHS[s].ascii : GLYPHS[s].box)).join(' → ')
    : undefined
  if (trail !== undefined) parts.push(trail)
  parts.push(`读${input.filesRead} 改${input.filesModified}`)
  if (input.verifiedCount !== undefined && input.verifiedCount > 0) {
    parts.push(`${ascii ? 'v' : '✓'}${input.verifiedCount}`)
  }
  if (input.elapsedMs !== undefined) {
    parts.push(formatElapsedHuman(input.elapsedMs))
  }
  const dim = (s: string) => color(s, theme.dim)
  // 窄宽渐进 drop：尾部段先掉（elapsed → ✓ → 读改 → trail → turn 截断）。
  const dropTail = (list: string[]): string[] => list.slice(0, -1)
  let list = parts
  for (;;) {
    const joined = list.join(' · ')
    if (displayWidth(joined) <= width) {
      return [dim(joined)]
    }
    if (list.length <= 1) {
      return [dim(truncateTo(joined, width))]
    }
    list = dropTail(list)
  }
}
