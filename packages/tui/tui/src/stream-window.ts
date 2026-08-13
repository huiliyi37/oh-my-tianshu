const LIVE_STREAM_TRUNCATION_MARKER = '… truncated live stream output …\n'

/**
 * 追加流式输出并保持窗口上限：超过 maxChars 时只留尾部并前置截断标记。
 * @param current - 已累计的窗口内容。
 * @param next - 新到的输出片段。
 * @param maxChars - 窗口字符上限（不含截断标记本身）。
 * @returns 追加（并按需截尾）后的窗口内容。
 */
export function appendStreamWindow(current: string, next: string, maxChars: number): string {
  const combined = current + next
  if (combined.length <= maxChars) return combined
  return LIVE_STREAM_TRUNCATION_MARKER + combined.slice(-maxChars)
}
