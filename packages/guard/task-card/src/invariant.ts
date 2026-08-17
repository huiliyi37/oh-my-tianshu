/**
 * Package-owned durable task-card invariants.
 *
 * The owned relationship is the rewrite itself, as observed from the
 * authoritative session log: a `user/message` that carries the card marker
 * must (1) keep a non-empty verbatim original under
 * {@link ORIGINAL_MARKER} — the rewrite never loses the user's input; (2)
 * keep `source.kind === 'user'` — it is an enhancement of the user message,
 * not a plugin insertion; and (3) be the FIRST `user/message` of its session
 * — the rewrite is first-message-only, which also makes a second carded
 * message impossible (consumers: resume/fork, transcript). Loaded sessions
 * replay through the same validation; live appends are checked on the
 * authoritative `session/event` dispatch.
 *
 * @module @huiliyi37/dsh-task-card/invariant
 */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'
import type { Session, SessionEvent } from '@huiliyi37/dsh-session'
import { ORIGINAL_MARKER } from './generate.ts'

const PACKAGE_NAME = '@huiliyi37/dsh-task-card'

/** Cordis companion plugin name. */
export const name = 'task-card-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Per-session rewrite state folded from the log. */
interface RewriteState {
  /** Whether any user message was already seen. */
  sawUserMessage: boolean
}

/** Join a user message's text blocks; non-text blocks contribute nothing. */
function textOf(event: SessionEvent): string {
  if (event.type !== 'user/message') return ''
  return event.data.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('')
}

/**
 * Validate one event against the rewrite invariants; non-`user/message`
 * events pass through untouched.
 *
 * @param event Any session event.
 * @param state The session's folded rewrite state, or `undefined` before the
 *   first user message.
 * @param fail Package-bound failure reporter.
 * @returns The updated rewrite state (created lazily on the first user message).
 */
function validateEvent(
  event: SessionEvent,
  state: RewriteState | undefined,
  fail: InvariantFailure,
): RewriteState | undefined {
  if (event.type !== 'user/message') return state
  const text = textOf(event)
  const carded = text.includes(ORIGINAL_MARKER)
  if (carded) {
    const original = text.split(ORIGINAL_MARKER)[1] ?? ''
    if (original.trim() === '') {
      fail('task-card: a carded message must keep a non-empty verbatim original under the marker')
    }
    if (event.data.source.kind !== 'user') {
      fail(`task-card: a carded message must keep source.kind 'user', got ${JSON.stringify(event.data.source.kind)}`)
    }
    if (state?.sawUserMessage === true) {
      fail('task-card: the rewrite is first-message-only — a carded message appeared after an earlier user message')
    }
  }
  return { sawUserMessage: true }
}

/** Install validation for loaded and newly appended task-card rewrite state. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const state = new WeakMap<Session, RewriteState>()
  const track = (session: Session, event: SessionEvent): void => {
    const next = validateEvent(event, state.get(session), fail)
    if (next !== undefined) state.set(session, next)
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
