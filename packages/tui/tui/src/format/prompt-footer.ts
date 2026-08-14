/**
 * 底部 footer（format/prompt-footer.ts）— 纯渲染（C4 概念稿 C 三行底部区）。
 *
 * 输入行下方的模式/快捷键提示行：mode 段（normal + [plan]/[plan…]/[auto]
 * 徽标，与 statusline 徽标词汇一致）在前，快捷键提示在后。窄宽从后往前
 * 丢段（ctrl+p 面板 → / 命令 → Enter 发送），mode 恒保留。
 * 右侧状态段（token/模型/API 等）右对齐合并进同一行；放不下从后往前丢右段，
 * 绝不另起 theme.primary 第二行。宽度守恒：任何输入下每行显示宽度 ≤ width。
 */
import { color } from '../engine/ansi.js'
import { CHROME_INACTIVE_SHIMMER, CHROME_SUBTLE } from './chrome-colors.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'

/** formatPromptFooter 的渲染输入。 */
export interface FormatPromptFooterInput {
  width: number
  /** plan 模式已生效（mode 段渲染 [plan]）。 */
  planActive?: boolean
  /** plan 切换待请求边界落地（渲染 [plan…]，优先于 planActive）。 */
  planPending?: boolean
  /** always-approve 生效（mode 段渲染 [auto]）。 */
  alwaysApprove?: boolean
  /** 审批挂起：快捷键换成 y/n/a/esc，避免仍提示「Enter 发送」。 */
  approvalPending?: boolean
  /** 右侧状态段（token/模型/API 等）；右对齐合并进同一行，放不下从后丢段。 */
  rightSegments?: readonly string[]
}

/**
 * 渲染底部 footer：mode 段 + 快捷键提示段，右侧状态段右对齐合并进同一行。
 * @param input - 宽度、模式徽标与右侧状态段。
 * @param theme - 当前主题（plan/auto 徽标走 warning/error；其余用雾蓝 chrome）。
 * @returns 单行 ANSI；任何宽度下 ≤ width。
 */
export function formatPromptFooter(input: FormatPromptFooterInput, theme: RivetTheme): string[] {
  const { width, planActive, planPending, alwaysApprove } = input
  const badge = planPending === true ? ' [plan…]' : planActive === true ? ' [plan]' : ''
  const auto = alwaysApprove === true ? ' [auto]' : ''
  const mode = `normal${badge}${auto}`
  const modeColor = planPending === true || planActive === true
    ? theme.warning
    : alwaysApprove === true ? theme.error : CHROME_INACTIVE_SHIMMER
  const hints = input.approvalPending === true
    ? ['y 允许', 'n 拒绝', 'a 放行', 'esc 取消']
    : ['Enter 发送', '/ 命令', 'ctrl+p 面板']
  // 从后往前丢段直到放得下（mode 恒保留）。
  let segs = hints
  for (;;) {
    const text = [mode, ...segs].join(' · ')
    if (displayWidth(text) <= width) {
      const parts = [color(mode, modeColor)]
      for (const s of segs) {
        parts.push(color(s, CHROME_SUBTLE))
      }
      const leftAnsi = parts.join(' · ')
      const right = input.rightSegments
      if (right !== undefined && right.length > 0) {
        return mergeRightSegments(leftAnsi, text, right, width)
      }
      return [leftAnsi]
    }
    if (segs.length === 0) break
    segs = segs.slice(0, -1)
  }
  return [color(mode, modeColor)]
}

/**
 * 左侧 + 右侧状态段合并为一行（右对齐）；右段放不下时从后往前丢。
 * @param leftAnsi - 已着色的左侧文本。
 * @param leftPlain - 左侧纯文本（宽度度量用）。
 * @param right - 右侧状态段（纯文本）。
 * @param width - 目标行宽。
 * @returns 合并后的单行 ANSI。
 */
function mergeRightSegments(
  leftAnsi: string,
  leftPlain: string,
  right: readonly string[],
  width: number,
): string[] {
  let rightSegs = [...right]
  for (;;) {
    if (rightSegs.length === 0) return [leftAnsi]
    const rightPlain = rightSegs.join(' · ')
    const pad = width - displayWidth(leftPlain) - displayWidth(rightPlain)
    if (pad >= 0) {
      const rightAnsi = rightSegs.map(s => color(s, CHROME_INACTIVE_SHIMMER)).join(' · ')
      return [`${leftAnsi}${' '.repeat(pad)}${rightAnsi}`]
    }
    rightSegs = rightSegs.slice(0, -1)
  }
}
