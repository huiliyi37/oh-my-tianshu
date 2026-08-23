/** Package-owned approval-rule audit-stream invariants. @module @huiliyi37/dsh-approval-rules/invariant */

import type { Context } from '@huiliyi37/cordis'
import type { Session, SessionEvent } from '@huiliyi37/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-approval-rules'
const DECISIONS: readonly string[] = ['allow', 'deny']
const LAYERS: readonly string[] = ['user', 'project']

/** Cordis companion plugin name. */
export const name = 'approval-rules-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** One open `approval/asked` the package's own `approval/rule` event may settle. */
interface PendingAsked {
  id: unknown
  toolName: string
  ruled: boolean
}

/**
 * Per-session fold of the asks a rule event may settle. Turn enclosure of
 * `approval/asked` / `approval/decided` is user-approval's companion's
 * contract; this trace only tracks the pairing `approval/rule` needs.
 */
type Trace = PendingAsked[]

/** Validate one rule event's payload vocabulary. */
function validateRulePayload(data: unknown, fail: InvariantFailure): void {
  if (typeof data !== 'object' || data === null) {
    fail('approval/rule data must be an object')
    return
  }
  const record = data as Record<string, unknown>
  if (typeof record['tool'] !== 'string' || record['tool'].trim() === '') {
    fail('approval/rule tool must be non-empty')
  }
  if (typeof record['pattern'] !== 'string' || record['pattern'].trim() === '') {
    fail('approval/rule pattern must be non-empty')
  }
  const decision = record['decision']
  if (typeof decision !== 'string' || !DECISIONS.includes(decision)) {
    fail(`approval/rule carries unknown decision ${JSON.stringify(decision)}`)
  }
  const ruleIndex = record['ruleIndex']
  if (typeof ruleIndex !== 'number' || !Number.isSafeInteger(ruleIndex) || ruleIndex < 0) {
    fail('approval/rule ruleIndex must be a non-negative safe integer')
  }
  const layer = record['layer']
  if (typeof layer !== 'string' || !LAYERS.includes(layer)) {
    fail(`approval/rule carries unknown layer ${JSON.stringify(layer)}`)
  }
}

/** The newest pending, not-yet-ruled ask for a tool, if any. */
function settleableAsk(trace: Trace, tool: string): PendingAsked | undefined {
  return [...trace].reverse().find(pending => pending.toolName === tool && !pending.ruled)
}

/**
 * Pre-commit validation of one `approval/rule` event: a valid payload plus a
 * pending, not-yet-ruled `approval/asked` for the same tool. A throw here
 * vetoes the append before the session log commits it.
 */
function checkEvent(trace: Trace, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'approval/rule') return
  validateRulePayload(event.data, fail)
  if (settleableAsk(trace, event.data.tool) === undefined) {
    fail(`approval/rule has no matching pending approval/asked for tool ${JSON.stringify(event.data.tool)}`)
  }
}

/** Post-commit fold application; rule events here already passed {@link checkEvent}. */
function applyEvent(trace: Trace, event: SessionEvent): void {
  if (event.type === 'approval/asked') {
    trace.push({ id: event.data.id, toolName: event.data.toolName, ruled: false })
    return
  }
  if (event.type === 'approval/rule') {
    const found = settleableAsk(trace, event.data.tool)
    /* v8 ignore next -- checkEvent already rejected the unmatched case */
    if (found !== undefined) found.ruled = true
    return
  }
  if (event.type === 'approval/decided') {
    const index = trace.findIndex(pending => pending.id === event.data.id)
    /* v8 ignore next -- user-approval's companion owns decided pairing */
    if (index !== -1) trace.splice(index, 1)
  }
}

/**
 * Install audit-stream checks for the `approval/rule` event: it must carry a
 * valid vocabulary and settle a pending `approval/asked` for the same tool,
 * with no rule repeated for one ask. Validation runs pre-commit
 * (`internal/dispatch` — a throw vetoes the append), the fold applies
 * post-commit, and replaying an existing session re-validates its history at
 * companion load.
 */
// Event owners keep transition staging local so their vocabularies never move into a central helper.
/* jscpd:ignore-start */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, Trace>()
  const seed = (session: Session): Trace => {
    const trace: Trace = []
    traces.set(session, trace)
    for (const event of session.events) {
      checkEvent(trace, event, fail)
      applyEvent(trace, event)
    }
    return trace
  }
  const traceFor = (session: Session): Trace => traces.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    checkEvent(traceFor(session), event, fail)
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    applyEvent(traceFor(session), event)
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
