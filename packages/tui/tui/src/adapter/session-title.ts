/**
 * Session title surface — `/session list` 每行展示的会话标题。
 *
 * 只读纯函数层。数据源是官方 harness 的 log-backed `session/title` 事件
 * （`@huiliyi37/dsh-session-title` 服务写入；LLM 标题由装配在 dsh-base 的
 * `session-title-llm` provider 在会话活跃时自动生成，first-prompt cadence）。
 * TUI 不做任何生成：不调 API、不写 sidecar、不发明事件——「纯展示层」纪律与
 * 「所有渲染状态派生自会话事件」在本模块保持成立（dsh-base 装配见宿主
 * cordis.patch.yml：session-title + session-title-llm）。
 *
 * 展示优先级：
 * 1. 已折叠的最新 `session/title` 事件（fallback / LLM provider / 用户 rename 源）；
 * 2. 确定性 fallback——首条真人消息的前几个词（与 dsh-base 装配配置
 *    `fallbackMaxWords: 5` / `fallbackMaxBytes: 40` 对齐；历史会话无标题事件
 *    时免费可用，纯函数现算、不落盘）；
 * 3. 无任何真人聊天记录 → {@link EMPTY_TITLE}。
 *
 * @module @huiliyi37/dsh-tui/adapter/session-title
 */

import type { SessionEvent } from '@huiliyi37/dsh-session'
import {
  collectSessionTitleMessages,
  fallbackSessionTitle,
  foldSessionTitle,
} from '@huiliyi37/dsh-session-title'

/** 无任何真人聊天记录的会话直接展示的占位标题（状态而非内容）。 */
export const EMPTY_TITLE = '新对话'
/** fallback 词数上限（与 dsh-base 装配的 session-title config 对齐）。 */
export const FALLBACK_MAX_WORDS = 5
/** fallback 字节上限（与 dsh-base 装配的 session-title config 对齐）。 */
export const FALLBACK_MAX_BYTES = 40

/**
 * 计算一个会话在 `/session list` 中的展示标题。
 * 纯函数、同步、无副作用：fold 官方标题事件 → 确定性 fallback → 「新对话」。
 * @param events - 会话事件日志（live 或持久化重放）。
 * @returns 展示标题（恒非空）。
 */
export function sessionTitleFor(events: readonly SessionEvent[]): string {
  const folded = foldSessionTitle(events)
  if (folded !== undefined) return folded.title
  // 无标题事件：历史会话（标题服务上线前创建）或标题尚未生成。
  // 取首条真人消息的确定性 fallback；合成注入消息被官方收集器过滤。
  /* v8 ignore next -- collectSessionTitleMessages 恒返回数组，[0] 可能 undefined；noUncheckedIndexedAccess 收窄防御 */
  const first = collectSessionTitleMessages(events)[0]
  if (first !== undefined) {
    return fallbackSessionTitle(first.text, FALLBACK_MAX_WORDS, FALLBACK_MAX_BYTES)
  }
  return EMPTY_TITLE
}
