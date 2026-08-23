/** Package-owned approval-rule audit-stream invariants. @module @huiliyi37/dsh-approval-rules/invariant */

import type { Context } from '@huiliyi37/cordis'
import type { Session, SessionEvent } from '@huiliyi37/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-approval-rules'
const DECISIONS = ['allow', 'deny'] as const
const LAYERS = ['user', 'project'] as const

/** Cordis companion plugin name. */
export const name = 'approval-rules-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

interface PendingAsked {
  id: unknown
  toolName: string
  ruled: boolean
}

/** Per-session fold tracking the open-turn boundary and outstanding asked events. */
interface Trace {
  openTurn: boolean
  pending: PendingAsked[]
}

/** Validate one rule event's payload vocabulary. */
function validateRulePayload(data: unknown, fail: InvariantFailure): void {
  if (typeof data !== 'object' || data === null) {
    fail('approval/rule data must be an object')
    return
  }
  const record = data as Record<string, unknown>
  if (typeof record['tool'] !== 'string' || (record['tool'] as string).trim() === '') {
    fail('approval/rule tool must be non-empty')
  }
  if (typeof record['pattern'] !== 'string' || (record['pattern'] as string).trim() === '') {
    fail('approval/rule pattern must be non-empty')
  }
  const decision = record['decision']
  if (typeof decision !== 'string' || !(DECISIONS as readonly string[]).includes(decision)) {
    fail(`approval/rule carries unknown decision ${JSON.stringify(decision)}`)
  }
  const ruleIndex = record['ruleIndex']
  if (typeof ruleIndex !== 'number' || !Number.isSafeInteger(ruleIndex) || ruleIndex < 0) {
    fail('approval/rule ruleIndex must be a non-negative safe integer')
  }
  const layer = record['layer']
  if (typeof layer !== 'string' || !(LAYERS as readonly string[]).includes(layer)) {
    fail(`approval/rule carries unknown layer ${JSON.stringify(layer)}`)
  }
}

/** Validate one event against the trace, mutating the trace only on valid transitions. */
function validateEvent(trace: Trace, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'turn/start') {
    trace.openTurn = true
    return
  }
  if (event.type === 'turn/end') {
    trace.openTurn = false
    return
  }
  if (event.type === 'approval/asked') {
    if (!trace.openTurn) fail('approval/asked appended outside any open turn')
    trace.pending.push({ id: event.data.id, toolName: event.data.toolName, ruled: false })
    return
  }
  if (event.type === 'approval/rule') {
    if (!trace.openTurn) fail('approval/rule appended outside any open turn')
    validateRulePayload(event.data, fail)
    const found = [...trace.pending].reverse().find(pending => pending.toolName === event.data.tool && !pending.ruled)
    if (found === undefined) {
      fail(`approval/rule has no matching pending approval/asked for tool ${JSON.stringify(event.data.tool)}`)
    } else {
      found.ruled = true
    }
    return
  }
  if (event.type === 'approval/decided') {
    if (!trace.openTurn) fail('approval/decided appended outside any open turn')
    const index = trace.pending.findIndex(pending => pending.id === event.data.id)
    if (index === -1) {
      fail(`approval/decided has no matching approval/asked for id ${JSON.stringify(event.data.id)}`)
    } else {
      trace.pending.splice(index, 1)
    }
  }
}

/**
 * Install audit-stream checks for the `approval/rule` event: it must be
 * turn-enclosed, carry a valid vocabulary, and sit between an `approval/asked`
 * (same tool) and its `approval/decided` — with no rule repeated for one ask.
 */
// Event owners keep transition staging local so their vocabularies never move into a central helper.
/* jscpd:ignore-start */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, Trace>()
  const seed = (session: Session): Trace => {
    const trace: Trace = { openTurn: false, pending: [] }
    traces.set(session, trace)
    for (const event of session.events) validateEvent(trace, event, fail)
    return trace
  }
  const traceFor = (session: Session): Trace => traces.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/start' && event.type !== 'turn/end'
      && event.type !== 'approval/asked' && event.type !== 'approval/rule'
      && event.type !== 'approval/decided') return
    const trace = traceFor(session)
    validateEvent(trace, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the approval-rules invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
