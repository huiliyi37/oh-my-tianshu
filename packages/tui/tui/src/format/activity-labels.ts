/**
 * 实时活动标签（format/activity-labels.ts）— 纯渲染。
 *
 * 词池轮换是纯函数：`seq` 入参决定池内下标（投影器维护单调序号），
 * 无模块级计数器 → 同一 seq 恒同一词（可复现）。
 * tool_use / lifecycle 的 detail 截断到 40 字符。
 * 返回 LiveRegionLine[]，单行。
 */
import { color } from '../engine/ansi.js'
import type { LiveRegionLine } from '../engine/live-engine.js'
import type { RivetTheme } from '../theme.js'

/** 活动事件类别（决定词池与着色）。 */
export type ActivityKind = 'tool_use' | 'tool_result' | 'thinking' | 'lifecycle' | 'text'

/** 活动标签渲染输入。 */
export interface ActivityLabelInput {
  kind: ActivityKind
  /** 单调递增序号（词池轮换下标）。 */
  seq: number
  /** tool_use/lifecycle 的补充细节。 */
  detail?: string
  /** ascii 模式：glyph 用 `>`。 */
  ascii?: boolean
}

const THINKING_VERBS = ['思考中', '推理中', '推演中', '权衡中', '校准中', '收敛中']
const TOOL_RESULT_VERBS = ['已收到结果', '结果已就绪', '正在消化', '记录结果']
const TEXT_VERBS = ['写作中', '润色中', '整理中', '落笔中', '打磨中', '成稿中']

const DETAIL_LIMIT = 40

function pick(verbs: readonly string[], seq: number): string {
  /* v8 ignore next -- 词池恒非空数组，verbs[0] 恒存在，?? '' 右侧不可达（NaN 越界由 verbs[0] 承接，测试已覆盖） */
  return verbs[seq % verbs.length] ?? verbs[0] ?? ''
}

/**
 * 词池短语（纯函数，无全局状态）。
 * @param input - 类别、轮换序号与可选 detail（tool_use 截 40 字符，lifecycle 直用）。
 * @returns 当前 seq 对应的短语文本。
 */
export function activityPhrase(input: Omit<ActivityLabelInput, 'ascii'>): string {
  const { kind, detail, seq } = input
  switch (kind) {
    case 'tool_use': {
      if (detail === undefined) return '调用工具'
      const clipped = detail.length > DETAIL_LIMIT ? detail.slice(0, DETAIL_LIMIT) : detail
      return `调用 ${clipped}`
    }
    case 'thinking':
      return pick(THINKING_VERBS, seq)
    case 'tool_result':
      return pick(TOOL_RESULT_VERBS, seq)
    case 'text':
      return pick(TEXT_VERBS, seq)
    case 'lifecycle':
      return detail ?? '补偿轮'
  }
}

/**
 * 活动标签行（glyph + 短语，单行）。
 * @param input - 类别、轮换序号、detail 与 ascii 模式。
 * @param theme - 当前主题（工具类事件用 toolColor('shell')，其余 pulseActive）。
 * @returns 单行 live 区内容。
 */
export function formatActivityLabel(input: ActivityLabelInput, theme: RivetTheme): LiveRegionLine[] {
  const glyph = input.ascii ? '>' : '●'
  const phrase = activityPhrase(input)
  const hex = input.kind === 'tool_use' || input.kind === 'tool_result' ? theme.toolColor('shell') : theme.pulseActive
  return [{ text: color(`${glyph} ${phrase}`, hex) }]
}
