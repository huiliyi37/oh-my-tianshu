/**
 * Runtime invariant companion for @huiliyi37/dsh-adaptive-memory.
 *
 * Owned relation（model-visible ⟺ logged 的本包一侧）：
 * - 每个含 `memory:stm` section 的 context-snapshot user/message，其渲染行里
 *   的短 id 必须是此前最近一次 `memory/stm-selected` 事件 entryIds 的前缀——
 *   模型看到的 STM 内容必须能从日志重建；未记录的 STM 快照即违例。
 * - `memory/*` 事件一律 log-only（无 surfaceOp），entryIds 去重、turn 为
 *   正安全整数、intentId/intentKey 非空。
 *
 * @module @huiliyi37/dsh-adaptive-memory/invariant
 */
/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
import type { Context } from '@huiliyi37/cordis'
import type { Session, SessionEvent } from '@huiliyi37/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-adaptive-memory'
/** context-snapshot 的归属 plugin（RuntimeContextProjection 的常量，非本包名）。 */
const SNAPSHOT_SOURCE = '@huiliyi37/dsh-system-prompt'
const STM_SECTION = 'memory:stm'
/** STM 渲染行的短 id（`- <id8> | …`，与 render.ts 的行格式对齐）。 */
const STM_LINE_ID = /^- ([0-9a-f-]{8}) \| /gm

/** Cordis companion plugin name. */
export const name = 'adaptive-memory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** 校验单个 memory/* log-only 事件的形状。 */
function validateMemoryEvent(event: SessionEvent, fail: InvariantFailure): void {
  // log-only 事件类型上没有 surfaceOp 字段；运行时的越界事件用宽类型读取再判定。
  const surfaceOp = (event as { surfaceOp?: unknown }).surfaceOp
  if (surfaceOp !== undefined) fail(`${event.type} must be log-only (no surfaceOp)`)
  const data = event.data as { intentId: string; intentKey: string; turn: number; entryIds?: string[] }
  if (data.intentId === '' || data.intentKey === '') fail(`${event.type} must name a non-empty intent`)
  if (!Number.isSafeInteger(data.turn) || data.turn < 1) fail(`${event.type} turn must be a positive safe integer`)
  const entryIds = data.entryIds
  if (event.type === 'memory/stm-selected' && entryIds !== undefined
    && new Set(entryIds).size !== entryIds.length) {
    fail('memory/stm-selected entryIds must be unique')
  }
}

/** 校验一个 STM 快照事件的渲染短 id 都能由此前最近的 stm-selected 还原。 */
function validateSnapshot(
  history: readonly SessionEvent[],
  event: Extract<SessionEvent, { type: 'user/message' }>,
  fail: InvariantFailure,
): void {
  const source = event.data.source
  if (source.kind !== 'plugin' || source.plugin !== SNAPSHOT_SOURCE || source.form !== 'snapshot') return
  const section = source.sections.find(item => item.name === STM_SECTION)
  if (section === undefined) return
  let selected: string[] | undefined
  for (const prior of [...history].reverse()) {
    if (prior.type === 'memory/stm-selected') {
      selected = prior.data.entryIds
      break
    }
  }
  if (selected === undefined) fail('an STM snapshot must follow a memory/stm-selected decision event')
  STM_LINE_ID.lastIndex = 0
  for (const match of section.text.matchAll(STM_LINE_ID)) {
    const shortId = match[1]
    if (shortId !== undefined && !selected.some(id => id.startsWith(shortId))) {
      fail(`STM snapshot line id ${shortId} is not covered by the preceding memory/stm-selected`)
    }
  }
}

/** 校验一个会话中已有的全部本包事件。 */
function validateSession(session: Session, fail: InvariantFailure): void {
  for (const [index, event] of session.events.entries()) {
    if (event.type.startsWith('memory/')) validateMemoryEvent(event, fail)
    if (event.type === 'user/message') validateSnapshot(session.events.slice(0, index), event, fail)
  }
}

/** Install validation for loaded and newly appended memory/STM events. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type.startsWith('memory/')) validateMemoryEvent(event, fail)
    if (event.type === 'user/message') validateSnapshot(session.events, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the adaptive-memory invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
