/**
 * 折叠/截断提示的单一事实来源。
 *
 * 渲染端（tool-card / collapsed-*）产出这些标记，scrollback pager 解析端
 * （scrollback-transcript.ts）反向识别它们来判定「这条消息被截断过、可展开」。
 * 两边各写各的字符串会在文案调整时静默失联——pager 的展开入口消失而没有任何报错，
 * 所以放在这里共享。
 */

/**
 * 折叠 N 行的提示：`… +25 行`（纯计数，不带展开快捷键——ctrl+o 已被占用且无消费端）。
 * @param omitted - 被折叠的行/项数。
 * @param unit - 计数单位（缺省「行」；diff 场景可传「行 diff」等）。
 * @returns 截断计数提示行。
 */
export function truncationHint(omitted: number, unit = '行'): string {
  return `… +${omitted} ${unit}`
}

/**
 * 截断标记识别。生产端形态统一锚 `… +N 行` 计数，展开提示可选（兼容
 * /resume 载入旧会话里的 `… +25 行 · ctrl+o 展开` 与历史英文
 * `… +N lines [Ctrl+O]`，不认会让旧会话的展开入口失效）。
 */
export const TRUNCATION_MARKER_RE =
  /…\s*\+\s*\d+\s*行(?:\s*·\s*ctrl\+o\s*展开)?|…\s*\+\s*\d+\s*行 diff|…\s*\+\s*\d+\s*lines\s*\[Ctrl\+O\]/i
