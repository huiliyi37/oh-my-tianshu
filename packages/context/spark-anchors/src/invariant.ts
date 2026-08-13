/**
 * Package-owned spark-anchors invariants：本插件注入的每个模型可见 user
 * message 都带本插件 source 标记且非空（Model-visible ⟺ logged 的包级校验）。
 * @module @huiliyi37/dsh-spark-anchors/invariant
 */

import type { Context } from '@huiliyi37/cordis'
import type { Session, SessionEvent } from '@huiliyi37/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-spark-anchors'
const SOURCE_NAME = 'spark-anchors'

/** Cordis companion plugin name. */
export const name = 'spark-anchors-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one plugin-attributed injection: exactly one text block, non-empty. */
function validateInjection(event: SessionEvent<'user/message'>, fail: InvariantFailure): void {
  const textBlocks = event.data.content.filter(block => block.type === 'text')
  if (textBlocks.length !== 1 || textBlocks[0]?.text === '') {
    fail('spark-anchors injections must carry exactly one non-empty text block')
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate all package-owned injections already present in one session. */
function validateSession(session: Session, fail: InvariantFailure): void {
  for (const event of session.events) {
    if (event.type !== 'user/message'
      || event.data.source.kind !== 'plugin'
      || event.data.source.plugin !== SOURCE_NAME) continue
    validateInjection(event, fail)
  }
}

/** Install validation for loaded and newly appended spark-anchors injections. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    if (event.type !== 'user/message'
      || event.data.source.kind !== 'plugin'
      || event.data.source.plugin !== SOURCE_NAME) return
    validateInjection(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the spark-anchors invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
