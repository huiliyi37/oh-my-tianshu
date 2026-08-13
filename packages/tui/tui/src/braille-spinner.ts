const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Smooth braille spinner frame for a monotonically increasing tick index (S16).
 * @param tick - 单调递增的帧计数（负值也安全，双取模回卷）。
 * @returns 当前帧的盲文字符。
 */
export function brailleSpinnerFrame(tick: number): string {
  const idx = ((tick % FRAMES.length) + FRAMES.length) % FRAMES.length
  /* v8 ignore next -- 双取模后 idx 恒在 [0, FRAMES.length) 界内；noUncheckedIndexedAccess 收窄防御 */
  return FRAMES[idx] ?? ''
}

// Rotating circle (moon-phase) — the "圆图标" used for the Thinking indicator.
// Same visual vocabulary as the footer streaming dot for a consistent feel.
const CIRCLE_FRAMES = ['◐', '◓', '◑', '◒'] as const

/**
 * Rotating circle spinner frame for a monotonically increasing tick index.
 * @param tick - 单调递增的帧计数（负值也安全，双取模回卷）。
 * @returns 当前帧的月相圆圈字符。
 */
export function circleSpinnerFrame(tick: number): string {
  const idx = ((tick % CIRCLE_FRAMES.length) + CIRCLE_FRAMES.length) % CIRCLE_FRAMES.length
  /* v8 ignore next -- 双取模后 idx 恒在 [0, CIRCLE_FRAMES.length) 界内；noUncheckedIndexedAccess 收窄防御 */
  return CIRCLE_FRAMES[idx] ?? ''
}
