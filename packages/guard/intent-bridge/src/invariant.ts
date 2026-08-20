/**
 * Package-owned durable intent-bridge invariants.
 *
 * The owned relationship is the handoff itself, observed from the
 * authoritative session log of the MAIN session: at most one
 * `intent-bridge/handoff` record per session (the bridge creates one main
 * session per alignment), the record carries a non-empty `alignSessionId`
 * and a known `reason`, and — the task-card contract the handoff relies on —
 * a carded first user message keeps a non-empty verbatim original under the
 * marker. Loaded sessions replay through the same validation; live appends
 * are checked on the authoritative `session/event` dispatch.
 *
 * @module @huiliyi37/dsh-intent-bridge/invariant
 */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'
import type { Session, SessionEvent } from '@huiliyi37/dsh-session'
import { ORIGINAL_MARKER } from '@huiliyi37/dsh-task-card'

const PACKAGE_NAME = '@huiliyi37/dsh-intent-bridge'

/** Cordis companion plugin name. */
export const name = 'intent-bridge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Known handoff reasons. */
const HANDOFF_REASONS: ReadonlySet<unknown> = new Set(['anchor', 'rounds-exhausted', 'alignment-error'])

/** Join a user message's text blocks; non-text blocks contribute nothing. */
function textOf(event: SessionEvent): string {
  if (event.type !== 'user/message') return ''
  return event.data.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('')
}

/**
 * Validate one event against the handoff invariants; unrelated events pass
 * through.
 *
 * @param event Any session event.
 * @param seenHandoff Whether a handoff record was already seen.
 * @param fail Package-bound failure reporter.
 * @returns the updated seen-handoff flag.
 */
function validateEvent(event: SessionEvent, seenHandoff: boolean, fail: InvariantFailure): boolean {
  if (event.type === 'intent-bridge/handoff') {
    const { alignSessionId, reason } = event.data as { alignSessionId?: unknown; reason?: unknown }
    if (typeof alignSessionId !== 'string' || alignSessionId === '') {
      fail('intent-bridge: a handoff record must carry a non-empty alignSessionId')
    }
    if (!HANDOFF_REASONS.has(reason)) {
      fail(`intent-bridge: a handoff record must carry a known reason (anchor | rounds-exhausted | alignment-error), got ${JSON.stringify(reason)}`)
    }
    if (seenHandoff) {
      fail('intent-bridge: a session records at most one handoff')
    }
    return true
  }
  if (event.type === 'user/message' && seenHandoff) {
    const text = textOf(event)
    if (text.includes(ORIGINAL_MARKER)) {
      const original = text.split(ORIGINAL_MARKER)[1] ?? ''
      if (original.trim() === '') {
        fail('intent-bridge: a handoff card must keep a non-empty verbatim original under the marker')
      }
    }
  }
  return seenHandoff
}

/** Install validation for loaded and newly appended handoff state. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const seen = new WeakMap<Session, boolean>()
  const track = (session: Session, event: SessionEvent): void => {
    const current = seen.get(session) ?? false
    seen.set(session, validateEvent(event, current, fail))
  }
  const seed = (session: Session): void => {
    for (const event of session.events) track(session, event)
  }
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    track(session, event)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
