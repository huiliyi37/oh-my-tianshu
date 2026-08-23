/**
 * Package-owned durable agent-router invariants.
 *
 * Owned relationships on the session's own log:
 * - `router/route` (written at acceptance by dispatch): a valid payload —
 *   profile in {code_scout, verifier}, non-empty `task`, string-array
 *   `targets`, non-empty `subagentSessionId` — and, when the routed child
 *   session is live, lineage consistency: the child's `header.parentSession`
 *   must equal the session holding the record. A session may route many
 *   delegates (no uniqueness check).
 * - `router/decision`: the discriminated self/delegate ledger — branded
 *   `decisionId`, known action/mode/reason, full `RouterMetrics`; self
 *   records carry no delegate-only fields, delegate records pair
 *   `dispatched` with (`absent | present`) `subagentSessionId`.
 * - `router/evaluation`: at most one per decision, and its `decisionId`
 *   must reference an EARLIER decision on the same log.
 * - `router/gate`: known kind/verdict; veto verdicts must cite ≥1 signal,
 *   pass verdicts must cite none.
 *
 * Loaded history re-validates through the same path at late registration,
 * where a not-live child downgrades to shape-only (its header is not
 * inspectable without loading the child's log).
 *
 * @module @huiliyi37/dsh-agent-router/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@huiliyi37/cordis'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'
import type { Session, SessionEvent } from '@huiliyi37/dsh-session'
import { SessionId as brandSessionId } from '@huiliyi37/dsh-session'
// 限界常量与父边界净化同源（finding.ts 是 owner），校验面零漂移。
import { FINDING_ITEM_MAX_CHARS, FINDING_ITEMS_MAX, FINDING_SUMMARY_MAX_CHARS } from './finding.js'

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
/** Known decision actions (discriminant of the decision union). */
const DECISION_ACTIONS: ReadonlySet<unknown> = new Set(['self', 'delegate'])
/** Known intervention levels (RouterMetrics.interventionLevel). */
const INTERVENTION_LEVELS: ReadonlySet<unknown> = new Set(['none', 'hint', 'gate', 'escalate'])
/** Known observation classifications. */
const EVALUATION_CLASSIFICATIONS: ReadonlySet<unknown> = new Set(['recovered', 'persisted', 'inconclusive'])
/** Known gate kinds. */
const GATE_KINDS: ReadonlySet<unknown> = new Set(['shadow-readiness', 'canary-health'])
/** Known gate verdicts. */
const GATE_VERDICTS: ReadonlySet<unknown> = new Set(['pass', 'veto'])

/**
 * Validate the full RouterMetrics payload of a decision record.
 * @param metrics - Raw metrics value from the event data.
 * @param fail - Package-bound failure reporter.
 */
function validateDecisionMetrics(metrics: unknown, fail: InvariantFailure): void {
  if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) {
    fail('agent-router: a decision record must carry a metrics object')
    return
  }
  const m = metrics as Record<string, unknown>
  if (!INTERVENTION_LEVELS.has(m.interventionLevel)) {
    fail(`agent-router: a decision record metrics.interventionLevel must be a known level (none | hint | gate | escalate), got ${JSON.stringify(m.interventionLevel)}`)
  }
  for (const key of ['consecutiveFailures', 'unresolvedHigh', 'verifications', 'probeCooledTargets']) {
    const value = m[key]
    if (!Number.isInteger(value) || (value as number) < 0) {
      fail(`agent-router: a decision record metrics.${key} must be a non-negative integer, got ${JSON.stringify(value)}`)
    }
  }
}


/** Finding discriminants (closed unions owned by finding.ts). */
const FINDING_KINDS: ReadonlySet<unknown> = new Set(['scout', 'verify'])
const FINDING_VERDICTS: ReadonlySet<unknown> = new Set(['supported', 'unsupported', 'inconclusive'])

/**
 * Validate an optional bounded finding on a router/outcome record: closed
 * discriminant shape, non-empty summary, bounded string-array findings, verdict
 * only on verify findings.
 * @param finding - Raw finding value from the event data.
 * @param fail - Package-bound failure reporter.
 */
function validateFinding(finding: unknown, fail: InvariantFailure): void {
  if (finding === undefined) return
  if (typeof finding !== 'object' || finding === null || Array.isArray(finding)) {
    fail('agent-router: an outcome finding must be an object when present')
    return
  }
  const f = finding as Record<string, unknown>
  if (!FINDING_KINDS.has(f.kind)) {
    fail(`agent-router: an outcome finding kind must be scout | verify, got ${JSON.stringify(f.kind)}`)
    return
  }
  if (typeof f.summary !== 'string' || f.summary === '' || f.summary.length > FINDING_SUMMARY_MAX_CHARS) {
    fail(`agent-router: an outcome finding summary must be a non-empty string of at most ${FINDING_SUMMARY_MAX_CHARS} chars`)
  }
  const findings = f.findings
  if (!Array.isArray(findings) || findings.length > FINDING_ITEMS_MAX
    || findings.some(item => typeof item !== 'string' || item.length > FINDING_ITEM_MAX_CHARS)) {
    fail(`agent-router: an outcome finding findings must be at most ${FINDING_ITEMS_MAX} strings of at most ${FINDING_ITEM_MAX_CHARS} chars each`)
  }
  if (f.kind === 'verify') {
    if (!FINDING_VERDICTS.has(f.verdict)) {
      fail(`agent-router: a verify finding verdict must be supported | unsupported | inconclusive, got ${JSON.stringify(f.verdict)}`)
    }
  } else if (f.verdict !== undefined) {
    fail('agent-router: a scout finding must not carry a verdict')
  }
}

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
    const budget = (event.data as { budget?: unknown }).budget
    if (budget !== undefined) {
      const { maxTurns, deadlineMs } = budget as { maxTurns?: unknown; deadlineMs?: unknown }
      if (!Number.isInteger(maxTurns) || (maxTurns as number) < 1) {
        fail('agent-router: a route record budget.maxTurns must be a positive integer')
      }
      if (typeof deadlineMs !== 'number' || !Number.isFinite(deadlineMs) || deadlineMs <= 0) {
        fail('agent-router: a route record budget.deadlineMs must be a positive finite number')
      }
    }
    return
  }
  if (event.type === 'router/outcome') {
    const { subagentSessionId, stopReason, finding } = event.data as {
      subagentSessionId?: unknown
      stopReason?: unknown
      finding?: unknown
    }
    if (typeof subagentSessionId !== 'string' || subagentSessionId === '') {
      fail('agent-router: an outcome record must carry a non-empty subagentSessionId')
    }
    if (typeof stopReason !== 'string' || stopReason === '') {
      fail('agent-router: an outcome record must carry a non-empty stopReason')
    }
    validateFinding(finding, fail)
    return
  }
  if (event.type === 'router/adoption') {
    const { subagentSessionId, verdict, reason } = event.data as {
      subagentSessionId?: unknown
      verdict?: unknown
      reason?: unknown
    }
    if (typeof subagentSessionId !== 'string' || subagentSessionId === '') {
      fail('agent-router: an adoption record must carry a non-empty subagentSessionId')
    }
    if (verdict !== 'adopt' && verdict !== 'reject') {
      fail(`agent-router: an adoption record must carry a known verdict (adopt | reject), got ${JSON.stringify(verdict)}`)
    }
    if (typeof reason !== 'string' || reason === '') {
      fail('agent-router: an adoption record must carry a non-empty reason')
    }
  }
  if (event.type === 'router/decision') {
    const { decisionId, action, profile, task, targets, reason, mode, dispatched, subagentSessionId, metrics } = event.data as {
      decisionId?: unknown
      action?: unknown
      profile?: unknown
      task?: unknown
      targets?: unknown
      reason?: unknown
      mode?: unknown
      dispatched?: unknown
      subagentSessionId?: unknown
      metrics?: unknown
    }
    if (typeof decisionId !== 'string' || decisionId === '') {
      fail('agent-router: a decision record must carry a non-empty branded decisionId')
    }
    if (!DECISION_ACTIONS.has(action)) {
      fail(`agent-router: a decision record must carry a known action (self | delegate), got ${JSON.stringify(action)}`)
    }
    if (!DECISION_REASONS.has(reason)) {
      fail(`agent-router: a decision record must carry a known reason (turn-end), got ${JSON.stringify(reason)}`)
    }
    if (!DECISION_MODES.has(mode)) {
      fail(`agent-router: a decision record must carry a known mode (shadow | auto), got ${JSON.stringify(mode)}`)
    }
    validateDecisionMetrics(metrics, fail)
    if (action === 'self') {
      // self 分支：不携带 delegate 专属字段，且永不派发（判别联合卫生）。
      if (dispatched !== false) {
        fail('agent-router: a self decision record must carry dispatched false')
      }
      if (profile !== undefined || task !== undefined || targets !== undefined || subagentSessionId !== undefined) {
        fail('agent-router: a self decision record must not carry delegate-only fields (profile/task/targets/subagentSessionId)')
      }
      return
    }
    if (!ROUTE_PROFILES.has(profile)) {
      fail(`agent-router: a delegate decision record must carry a known profile (code_scout | verifier), got ${JSON.stringify(profile)}`)
    }
    if (typeof task !== 'string' || task === '') {
      fail('agent-router: a delegate decision record must carry a non-empty task')
    }
    if (!Array.isArray(targets) || targets.some(target => typeof target !== 'string')) {
      fail('agent-router: a delegate decision record must carry a string-array targets')
    }
    if (typeof dispatched !== 'boolean') {
      fail('agent-router: a delegate decision record must carry a boolean dispatched')
    }
    if (subagentSessionId !== undefined && (typeof subagentSessionId !== 'string' || subagentSessionId === '')) {
      fail('agent-router: a delegate decision record subagentSessionId must be a non-empty string when present')
    }
    if (dispatched && subagentSessionId === undefined) {
      fail('agent-router: a dispatched decision record must carry its subagentSessionId')
    }
    if (!dispatched && subagentSessionId !== undefined) {
      fail('agent-router: a non-dispatched decision record must not carry a subagentSessionId')
    }
    return
  }
  if (event.type === 'router/evaluation') {
    const { decisionId, classification, samples, windowFailures } = event.data as {
      decisionId?: unknown
      classification?: unknown
      samples?: unknown
      windowFailures?: unknown
    }
    if (typeof decisionId !== 'string' || decisionId === '') {
      fail('agent-router: an evaluation record must carry a non-empty decisionId')
    }
    if (!EVALUATION_CLASSIFICATIONS.has(classification)) {
      fail(`agent-router: an evaluation record must carry a known classification (recovered | persisted | inconclusive), got ${JSON.stringify(classification)}`)
    }
    for (const [key, value] of [['samples', samples], ['windowFailures', windowFailures]] as const) {
      if (!Number.isInteger(value) || (value as number) < 0) {
        fail(`agent-router: an evaluation record ${key} must be a non-negative integer, got ${JSON.stringify(value)}`)
      }
    }
    return
  }
  if (event.type === 'router/gate') {
    const { kind, verdict, vetoSignals } = event.data as {
      kind?: unknown
      verdict?: unknown
      vetoSignals?: unknown
    }
    if (!GATE_KINDS.has(kind)) {
      fail(`agent-router: a gate record must carry a known kind (shadow-readiness | canary-health), got ${JSON.stringify(kind)}`)
    }
    if (!GATE_VERDICTS.has(verdict)) {
      fail(`agent-router: a gate record must carry a known verdict (pass | veto), got ${JSON.stringify(verdict)}`)
    }
    if (!Array.isArray(vetoSignals) || vetoSignals.some(signal => typeof signal !== 'string')) {
      fail('agent-router: a gate record must carry a string-array vetoSignals')
    } else if (verdict === 'veto' && vetoSignals.length === 0) {
      fail('agent-router: a veto gate record must cite at least one veto signal')
    } else if (verdict === 'pass' && vetoSignals.length > 0) {
      fail('agent-router: a passing gate record must cite no veto signals')
    }
  }
}

/** Install validation for live appends and loaded history at late registration. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  // 每会话配对状态：outcome 已见 / 已声明（adoption 必须引用本会话在先的
  // outcome，且每条 outcome 至多一条声明）；decision 已见 / 已评估
  // （evaluation 必须引用本会话在先的 decision，且每条 decision 至多一条）。
  const seen = new WeakMap<Session, { outcomes: Set<string>; adopted: Set<string>; decisions: Set<string>; evaluated: Set<string> }>()
  const stateOf = (session: Session): { outcomes: Set<string>; adopted: Set<string>; decisions: Set<string>; evaluated: Set<string> } =>
    seen.get(session) ?? { outcomes: new Set(), adopted: new Set(), decisions: new Set(), evaluated: new Set() }
  const track = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'router/route' && event.type !== 'router/decision' && event.type !== 'router/outcome' && event.type !== 'router/adoption' && event.type !== 'router/evaluation' && event.type !== 'router/gate') return
    // 形状校验先行：配对簿记只在形状通过后提交（失败记录不留配对状态）。
    validateEvent(event, fail)
    const state = stateOf(session)
    if (event.type === 'router/outcome') {
      const { subagentSessionId } = event.data as { subagentSessionId?: unknown }
      if (typeof subagentSessionId === 'string' && subagentSessionId !== '') {
        state.outcomes.add(subagentSessionId)
      }
      seen.set(session, state)
    }
    if (event.type === 'router/adoption') {
      const { subagentSessionId } = event.data as { subagentSessionId?: unknown }
      if (typeof subagentSessionId === 'string' && subagentSessionId !== '') {
        if (!state.outcomes.has(subagentSessionId)) {
          fail(`agent-router: adoption on ${session.id} names child ${subagentSessionId} without a prior outcome record`)
        }
        if (state.adopted.has(subagentSessionId)) {
          fail(`agent-router: adoption on ${session.id} repeats child ${subagentSessionId} — at most one declaration per outcome`)
        }
        state.adopted.add(subagentSessionId)
      }
      seen.set(session, state)
    }
    if (event.type === 'router/decision') {
      const { decisionId } = event.data as { decisionId?: unknown }
      if (typeof decisionId === 'string' && decisionId !== '') {
        state.decisions.add(decisionId)
      }
      seen.set(session, state)
    }
    if (event.type === 'router/evaluation') {
      const { decisionId } = event.data as { decisionId?: unknown }
      if (typeof decisionId === 'string' && decisionId !== '') {
        if (!state.decisions.has(decisionId)) {
          fail(`agent-router: evaluation on ${session.id} references unknown decision ${decisionId} — it must cite an earlier router/decision on the same log`)
        }
        if (state.evaluated.has(decisionId)) {
          fail(`agent-router: evaluation on ${session.id} repeats decision ${decisionId} — at most one evaluation per decision`)
        }
        state.evaluated.add(decisionId)
      }
      seen.set(session, state)
    }
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
