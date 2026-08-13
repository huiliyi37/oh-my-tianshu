/**
 * subagent 对话流状态行（format/subagent-line.ts）— 纯渲染
 * （grok scrollback/blocks/subagent.rs 移植，dsh 精简版）。
 *
 * 运行中：live 区动态行 `⠋ 子代理 <label>`（braille spinner 帧随 tick 变化）；
 * 终态：提交 scrollback 的静态行 `✓ 子代理 <label> · 43s`（completed）、
 * `◌ …`（aborted）、`✗ … · 12s (error)`（error/max-tokens/refusal 及
 * merge-extensible 未知 reason）。宽度守恒、ascii 降级。
 */
import { color } from '../engine/ansi.js'
import { brailleSpinnerFrame } from '../braille-spinner.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'

/** 运行中状态行的渲染输入。 */
export interface SubagentRunningInput {
  width: number
  /** 显示标签（label 或 id 短哈希）。 */
  label: string
  /** spinner 帧计数（单调递增；缺省 0）。 */
  tick?: number
  /** ascii 降级（spinner → `*`）。 */
  ascii?: boolean
}

/** 终态状态行的渲染输入。 */
export interface SubagentDoneInput {
  width: number
  label: string
  /** 运行耗时（毫秒）。 */
  elapsedMs: number
  /** 终止原因（SubagentStopReason；merge-extensible，未知走默认失败态）。 */
  stopReason: string
}

function truncateTo(text: string, columns: number): string {
  let out = ''
  for (const ch of text) {
    if (displayWidth(out + ch) > columns) break
    out += ch
  }
  return out
}

/** 耗时 → 秒文本（一位小数，delegation-panel 同款）。 */
function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * 渲染运行中状态行：`⠋ 子代理 <label>`（live 区动态帧）。
 * @param input - 宽度、标签与帧计数。
 * @param theme - 当前主题（整行 primary）。
 * @returns 单行 ANSI；宽度守恒。
 */
export function formatSubagentRunning(input: SubagentRunningInput, theme: RivetTheme): string[] {
  const spinner = input.ascii === true ? '*' : brailleSpinnerFrame(input.tick ?? 0)
  const text = `${spinner} 子代理 ${input.label}`
  return [color(truncateTo(text, input.width), theme.primary)]
}

/**
 * 渲染终态状态行：`✓/◌/✗ 子代理 <label> · <耗时>[ (reason)]`（提交 scrollback）。
 * completed → ✓ success；aborted → ◌ muted；其余（error/max-tokens/refusal/
 * 未知）→ ✗ error 且带 reason 后缀（completed/aborted 无后缀）。
 * @param input - 宽度、标签、耗时与终止原因。
 * @param theme - 当前主题（状态标记着色；label 与耗时 muted）。
 * @returns 单行 ANSI；宽度守恒（label 截断优先于 reason 后缀）。
 */
export function formatSubagentDone(input: SubagentDoneInput, theme: RivetTheme): string {
  const { width, label, elapsedMs, stopReason } = input
  const mark = stopReason === 'completed' ? '✓' : stopReason === 'aborted' ? '◌' : '✗'
  const markColor = stopReason === 'completed'
    ? theme.success
    : stopReason === 'aborted' ? theme.muted : theme.error
  const suffix = stopReason === 'completed' || stopReason === 'aborted'
    ? ''
    : ` (${stopReason})`
  const text = `${mark} 子代理 ${label} · ${formatElapsed(elapsedMs)}${suffix}`
  const markAnsi = color(mark, markColor)
  const restPlain = text.slice(1)
  const rest = truncateTo(restPlain, Math.max(0, width - displayWidth(mark)))
  return `${markAnsi}${color(rest, theme.muted)}`
}
