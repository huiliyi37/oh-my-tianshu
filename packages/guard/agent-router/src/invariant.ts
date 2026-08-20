/**
 * Package-owned durable agent-router invariants.
 *
 * The owned relationship is the `router/route` record on the PARENT session's
 * log (written at acceptance by dispatch): a valid payload — profile in
 * {code_scout, verifier}, non-empty `task`, string-array `targets`, non-empty
 * `subagentSessionId` — and, when the routed child session is live, lineage
 * consistency: the child's `header.parentSession` must equal the session
 * holding the record. A session may route many delegates (no uniqueness
 * check); loaded history re-validates through the same path at late
 * registration, where a not-live child downgrades to shape-only (its header
 * is not inspectable without loading the child's log).
 *
 * @module @huiliyi37/dsh-agent-router/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'
import type { Session, SessionEvent } from '@huiliyi37/dsh-session'
import { SessionId as brandSessionId } from '@huiliyi37/dsh-session'

const PACKAGE_NAME = '@huiliyi37/dsh-agent-router'

/** Cordis companion plugin name. */
export const name = 'agent-router-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Known route profiles (mirrors {@link RouterAction} in router.ts). */
const ROUTE_PROFILES: ReadonlySet<unknown> = new Set(['code_scout', 'verifier'])

/** Known trigger reasons. */
const DECISION_REASONS: ReadonlySet<unknown> = new Set(['turn-end'])
/** Known trigger modes. */
const DECISION_MODES: ReadonlySet<unknown> = new Set(['shadow', 'auto'])

/**
 * Validate one event against the route/decision-record invariants; unrelated
 * events pass through.
 *
 * @param event Any session event.
 * @param fail Package-bound failure reporter.
 */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'router/route') {
    const { profile, task, targets, subagentSessionId } = event.data as {
      profile?: unknown
      task?: unknown
      targets?: unknown
      subagentSessionId?: unknown
    }
    if (!ROUTE_PROFILES.has(profile)) {
      fail(`agent-router: a route record must carry a known profile (code_scout | verifier), got ${JSON.stringify(profile)}`)
    }
    if (typeof task !== 'string' || task === '') {
      fail('agent-router: a route record must carry a non-empty task')
    }
    if (!Array.isArray(targets) || targets.some(target => typeof target !== 'string')) {
      fail('agent-router: a route record must carry a string-array targets')
    }
    if (typeof subagentSessionId !== 'string' || subagentSessionId === '') {
      fail('agent-router: a route record must carry a non-empty subagentSessionId')
    }
    return
  }
  if (event.type === 'router/outcome') {
    const { subagentSessionId, stopReason } = event.data as {
      subagentSessionId?: unknown
      stopReason?: unknown
    }
    if (typeof subagentSessionId !== 'string' || subagentSessionId === '') {
      fail('agent-router: an outcome record must carry a non-empty subagentSessionId')
    }
    if (typeof stopReason !== 'string' || stopReason === '') {
      fail('agent-router: an outcome record must carry a non-empty stopReason')
    }
    return
  }
  if (event.type === 'router/decision') {
    const { profile, task, targets, reason, mode, dispatched, subagentSessionId } = event.data as {
      profile?: unknown
      task?: unknown
      targets?: unknown
      reason?: unknown
      mode?: unknown
      dispatched?: unknown
      subagentSessionId?: unknown
    }
    if (!ROUTE_PROFILES.has(profile)) {
      fail(`agent-router: a decision record must carry a known profile (code_scout | verifier), got ${JSON.stringify(profile)}`)
    }
    if (typeof task !== 'string' || task === '') {
      fail('agent-router: a decision record must carry a non-empty task')
    }
    if (!Array.isArray(targets) || targets.some(target => typeof target !== 'string')) {
      fail('agent-router: a decision record must carry a string-array targets')
    }
    if (!DECISION_REASONS.has(reason)) {
      fail(`agent-router: a decision record must carry a known reason (turn-end), got ${JSON.stringify(reason)}`)
    }
    if (!DECISION_MODES.has(mode)) {
      fail(`agent-router: a decision record must carry a known mode (shadow | auto), got ${JSON.stringify(mode)}`)
    }
    if (typeof dispatched !== 'boolean') {
      fail('agent-router: a decision record must carry a boolean dispatched')
    }
    if (subagentSessionId !== undefined && (typeof subagentSessionId !== 'string' || subagentSessionId === '')) {
      fail('agent-router: a decision record subagentSessionId must be a non-empty string when present')
    }
    if (dispatched === true && subagentSessionId === undefined) {
      fail('agent-router: a dispatched decision record must carry its subagentSessionId')
    }
    if (dispatched === false && subagentSessionId !== undefined) {
      fail('agent-router: a non-dispatched decision record must not carry a subagentSessionId')
    }
  }
}

/** Install validation for live appends and loaded history at late registration. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const track = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'router/route' && event.type !== 'router/decision' && event.type !== 'router/outcome') return
    validateEvent(event, fail)
    // 血统一致性（child 在场时）：记录所在会话必须是该 child 的 parent。
    const { subagentSessionId } = event.data as { subagentSessionId?: unknown }
    if (typeof subagentSessionId !== 'string' || subagentSessionId === '') return
    const child = ctx.sessions.get(brandSessionId(subagentSessionId))
    if (child !== undefined && child.header.parentSession !== session.id) {
      fail(`agent-router: record on ${session.id} names child ${subagentSessionId} whose parentSession is ${String(child.header.parentSession)}`)
    }
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
/* jscpd:ignore-end */
