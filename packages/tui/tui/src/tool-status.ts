/**
 * tool-status — 工具卡状态形色双通道辅助。
 *
 * 状态推导优先级：错误 > 待答 > 进行中 > 成功。
 * 颜色映射：success/error/question/running → 主题语义色。
 * 字形：成功 › / 错误 ✗x / 待答 ? / 进行中 ⠋ 或动画帧（ascii 四帧）。
 */
import type { RivetTheme } from './theme.js'

/** 工具卡状态（toolRunStatus 推导结果）。 */
export type ToolRunStatus = 'success' | 'error' | 'running' | 'question'

/** 状态推导输入标志（均缺省 = 成功）。 */
export interface ToolRunFlags {
  isError?: boolean
  isQuestion?: boolean
  streaming?: boolean
}

/**
 * 状态推导：错误 > 待答 > 进行中 > 成功。
 * @param flags - 输入标志。
 * @returns 推导状态。
 */
export function toolRunStatus(flags: ToolRunFlags): ToolRunStatus {
  if (flags.isError) return 'error'
  if (flags.isQuestion) return 'question'
  if (flags.streaming) return 'running'
  return 'success'
}

/**
 * 状态 → 主题语义色。
 * @param status - 工具卡状态。
 * @param theme - 主题。
 * @returns 语义色值。
 */
export function toolStatusColor(status: ToolRunStatus, theme: RivetTheme): string {
  switch (status) {
    case 'success': return theme.success
    case 'error': return theme.error
    case 'question': return theme.warning
    case 'running': return theme.dim
  }
}

const BRAILLE_FRAMES = ['⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const ASCII_FRAMES = ['-', '\\', '|', '/']

/** 字形选项（仅影响 running 态）。 */
export interface ToolStatusGlyphOptions {
  /** 动画帧序号；提供时 running 用动画帧而非静态 glyph。 */
  tick?: number
  /** 覆盖静态 running glyph（live 卡 ●）。 */
  idleGlyph?: string
}

/**
 * 状态 → 字形（running 支持动画帧；负 tick 归一化到帧池）。
 * @param status - 工具卡状态。
 * @param ascii - 是否 ASCII 降级轨（错误 x、动画四帧）。
 * @param opts - running 态字形选项。
 * @returns 单字符字形。
 */
export function toolStatusGlyph(status: ToolRunStatus, ascii: boolean, opts: ToolStatusGlyphOptions = {}): string {
  switch (status) {
    case 'success': return '›'
    case 'error': return ascii ? 'x' : '✗'
    case 'question': return '?'
    case 'running': {
      if (opts.tick === undefined) return opts.idleGlyph ?? (ascii ? '-' : '⠋')
      const frames = ascii ? ASCII_FRAMES : BRAILLE_FRAMES
      const idx = ((opts.tick % frames.length) + frames.length) % frames.length
      /* v8 ignore next -- idx 经双向取模归一化后恒在 [0, frames.length) 界内；noUncheckedIndexedAccess 收窄防御 */
      return frames[idx] ?? (ascii ? '-' : '⠋')
    }
  }
}
