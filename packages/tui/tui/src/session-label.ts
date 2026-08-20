/**
 * session-label — 会话 id 的显示短标签。
 *
 * SessionId 形如 `session-<uuid>`：直接 `slice(0, 8)` 恰好截出常量前缀
 * `session-`，所有展示位（tab 标签、欢迎页可恢复列表、委派树回退、对话流
 * subagent 标签）都会退化为无区分度的空壳。统一经此 helper 剥离前缀后再
 * 截断；非 `session-` 形态的 id（历史/外部形状）行为不变（取前 8 位）。
 *
 * @module @huiliyi37/dsh-tui/session-label
 */

/** `session-` 前缀的长度（8）——与短标签长度相同，正是空壳病灶的来源。 */
const SESSION_ID_PREFIX = 'session-'

/**
 * 会话 id → 8 位显示短标签（剥离 `session-` 前缀后截断）。
 * @param id - 会话 id（`session-<uuid>` 或其他形状）。
 * @returns 8 位短标签；空 id 返回空串。
 */
export function shortSessionLabel(id: string): string {
  const bare = id.startsWith(SESSION_ID_PREFIX) ? id.slice(SESSION_ID_PREFIX.length) : id
  return bare.slice(0, 8)
}
