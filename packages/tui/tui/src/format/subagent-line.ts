/**
 * subagent 对话流状态行（format/subagent-line.ts）— 纯渲染
 * （grok scrollback/blocks/subagent.rs 移植，dsh 精简版）。
 *
 * 运行中：live 区动态行 `⠋ 子代理 <label>`（braille spinner 帧随 tick 变化；
 * 活动带启用时由 format/activity-band 统一渲染，本函数保留为逃生门散行回退）；
 * 终态：提交 scrollback 的静态行 `✓ {label} · {N 工具} · {X tok} · 43s`
 * （completed）、`◌ …`（aborted）、`✗ … (error)`（error/max-tokens/refusal
 * 及 merge-extensible 未知 reason；统计段零值/缺失省略——CC 对标单行格式）。
 * 宽度守恒、ascii 降级。
 */
import { color } from '../engine/ansi.js'
import { brailleSpinnerFrame } from '../braille-spinner.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'
import { formatTokenCount } from './glance-bar.js'
import { formatElapsedHuman } from './spinner-status.js'

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

/** 终态统计段（child 投影缓存快照；缺失/零值段省略——不伪造）。 */
export interface SubagentDoneStats {
  /** 工具调用总数（>0 才渲染）。 */
  toolCalls?: number
  /** 最新 token 数（>0 才渲染）。 */
  tokensUsed?: number
}

/** 终态状态行的渲染输入。 */
export interface SubagentDoneInput {
  width: number
  label: string
  /** 运行耗时（毫秒）。 */
  elapsedMs: number
  /** 终止原因（SubagentStopReason；merge-extensible，未知走默认失败态）。 */
  stopReason: string
  /** 可选统计段（CC 对标 `Done (N tools · tokens · elapsed)`；缺省仅耗时）。 */
  stats?: SubagentDoneStats
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
 * 渲染运行中状态行：`⠋ 子代理 <label>`（live 区动态帧；活动带逃生门回退）。
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
 * 渲染终态状态行：`✓/◌/✗ {label} · {N 工具} · {X tok} · {耗时}[ (reason)]`
 * （提交 scrollback）。completed → ✓ success；aborted → ◌ muted；其余
 * （error/max-tokens/refusal/未知）→ ✗ error 且带 reason 后缀（completed/
 * aborted 无后缀）。统计段零值/缺失省略；窄宽时尾部（reason → 耗时 → 统计
 * 段 → label）先被截断。
 * @param input - 宽度、标签、耗时、终止原因与可选统计段。
 * @param theme - 当前主题（状态标记着色；其余 muted）。
 * @returns 单行 ANSI；宽度守恒（label 截断优先于 reason 后缀）。
 */
export function formatSubagentDone(input: SubagentDoneInput, theme: RivetTheme): string {
  const { width, label, elapsedMs, stopReason } = input
  const mark = stopReason === 'completed' ? '✓' : stopReason === 'aborted' ? '◌' : '✗'
  const markColor = stopReason === 'completed'
    ? theme.success
    : stopReason === 'aborted' ? theme.muted : theme.error
  const reason = stopReason === 'completed' || stopReason === 'aborted'
    ? ''
    : ` (${stopReason})`
  const segments: string[] = []
  const toolCalls = input.stats?.toolCalls
  if (toolCalls !== undefined && toolCalls > 0) segments.push(`${toolCalls} 工具`)
  const tokensUsed = input.stats?.tokensUsed
  if (tokensUsed !== undefined && tokensUsed > 0) segments.push(`${formatTokenCount(tokensUsed)} tok`)
  segments.push(formatElapsedHuman(elapsedMs))
  const text = `${mark} ${label}${segments.length > 0 ? ` · ${segments.join(' · ')}` : ''}${reason}`
  const markAnsi = color(mark, markColor)
  const restPlain = text.slice(1)
  const rest = truncateTo(restPlain, Math.max(0, width - displayWidth(mark)))
  return `${markAnsi}${color(rest, theme.muted)}`
}
