/**
 * Package-owned durable zen-phase invariants.
 *
 * The owned relationship is the logged `zen/phase` sequence itself: payloads
 * are durable whole values (`phase` paired with `reason` per the event's
 * JSDoc), a session arms at most once (`'zen'` always first, always reason
 * `'arm'`), and every later entry is a single promotion to `'full'` — the MVP
 * has no re-entry, and {@link foldZenPhase} consumers (face reinstall on
 * resume, the `zen:policy` section, promotion idempotence) all assume this
 * shape. Loaded sessions replay through the same validation; live appends are
 * checked on the authoritative `session/event` dispatch.
 *
 * @module @huiliyi37/dsh-zen/invariant
 */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'
import type { Session, SessionEvent } from '@huiliyi37/dsh-session'

const PACKAGE_NAME = '@huiliyi37/dsh-zen'

/** Cordis companion plugin name. */
export const name = 'zen-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The reasons a `zen/phase` promotion to `'full'` may carry. */
const PROMOTION_REASONS: ReadonlySet<unknown> = new Set(['anchor', 'timeout', 'triage'])

/**
 * Validate one `zen/phase` event's payload shape and its position in the
 * once-armed, forward-only sequence.
 *
 * @param event Any session event; non-`zen/phase` events pass through.
 * @param previous The session's last validated phase, if any was seen.
 * @param fail Package-bound failure reporter.
 * @returns The validated phase, or `undefined` for unrelated events.
 */
function validateEvent(
  event: SessionEvent,
  previous: 'zen' | 'full' | undefined,
  fail: InvariantFailure,
): 'zen' | 'full' | undefined {
  if (event.type !== 'zen/phase') return undefined
  const { phase, reason } = event.data as { phase?: unknown; reason?: unknown }
  if (phase === 'zen') {
    if (reason !== 'arm') fail(`zen/phase 'zen' must carry reason 'arm', got ${JSON.stringify(reason)}`)
    if (previous !== undefined) fail(`zen/phase 'zen' after '${previous}' — a session arms at most once`)
    return 'zen'
  }
  if (phase === 'full') {
    if (!PROMOTION_REASONS.has(reason)) {
      fail(`zen/phase 'full' must carry a promotion reason (anchor | timeout | triage), got ${JSON.stringify(reason)}`)
    }
    if (previous === undefined) fail("zen/phase 'full' without a prior 'zen' — promotion requires an armed session")
    if (previous === 'full') fail("zen/phase 'full' after 'full' — promotion is idempotent and must not re-log")
    return 'full'
  }
  fail(`zen/phase carries invalid phase ${JSON.stringify(phase)}; expected 'zen' | 'full'`)
}

/** Install validation for loaded and newly appended zen-phase state. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const lastPhase = new WeakMap<Session, 'zen' | 'full'>()
  const track = (session: Session, event: SessionEvent): void => {
    const phase = validateEvent(event, lastPhase.get(session), fail)
    if (phase !== undefined) lastPhase.set(session, phase)
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
