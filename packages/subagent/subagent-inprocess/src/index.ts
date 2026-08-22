/**
 * Shared driver for in-process ONE-SHOT subagent providers. The agent factory's
 * creation transaction owns unpublished setup and rollback; after publication
 * the returned AgentHandle is the one quiescent lifecycle owner held by the
 * provider's caller.
 *
 * Continuable children never come through here: the continuation manager
 * composes and drives them directly, so this driver owns exactly one turn with
 * one result.
 *
 * @module @huiliyi37/dsh-subagent-inprocess
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@huiliyi37/cordis'
import type { Agent, AgentHandle } from '@huiliyi37/dsh-agent'
import { findLastMessageTurnEnd, SessionId, type SessionEvent, type TurnEndReason } from '@huiliyi37/dsh-session'
import { createUserMessage, type ContentBlock } from '@huiliyi37/dsh-llm'
import {
  applyChildComposition,
  assertSubagentMaxDepth,
  childSessionMeta,
  resolveChildAgentOptions,
  resolveChildDepth,
} from '@huiliyi37/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentDescriptorData,
  SubagentResult,
  SubagentRun,
  SubagentStopReason,
} from '@huiliyi37/dsh-subagent'
// Type-only: make `ctx.get('sandboxPolicy')` / `ctx.get('approval')` resolve
// to the policy services when composed — the driver consumes both
// opportunistically (the documented `ctx.get` pattern), never as a hard dep.
import type {} from '@huiliyi37/dsh-sandbox-policy'
import type {} from '@huiliyi37/dsh-user-approval'
// Type-only: same optional-service pattern for the subagent-role pin
// (`ctx.get('modelRoles')`), resolved live at child creation.
import type {} from '@huiliyi37/dsh-model-roles'
import {
  attachStructuredRuntime,
  type StructuredAttachment,
} from './structured.ts'

export {
  STRUCTURED_OUTPUT_TOOL,
  STRUCTURED_OUTPUT_INSTRUCTION,
} from './structured.ts'

/** Map a session turn outcome to the subagent seam's terminal vocabulary. */
function toStopReason(reason: TurnEndReason | undefined): SubagentStopReason {
  switch (reason?.kind) {
    case 'completed':
      return 'completed'
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
      return 'aborted'
    case 'error':
    case 'interrupted':
    default:
      return 'error'
  }
}

/** Extra inputs the spawn and fork providers supply to the shared driver. */
export interface InProcessRunOptions {
  /** Completed-turn seed for fork, or undefined for a fresh spawn. */
  readonly seed?: SessionEvent[]
}

/**
 * One budgeted run's shared enforcement state: written by the child-scoped
 * pre-step listener (step bound) and the wall-clock timer, read by
 * {@link readResult} to settle `budget-exhausted` instead of a plain abort.
 */
export interface RunBudgetState {
  /** Whether either budget bound fired before the child finished on its own. */
  exhausted: boolean
}

/** Error used when cancellation wins before the child publication boundary. */
function prePublicationAbort(): Error {
  return new Error('subagent request was aborted before child publication')
}

/**
 * Child-scoped step-budget enforcement: count entered pre-steps and trip the
 * budget controller once a step BEYOND `maxSteps` is proposed. The listener
 * still delegates with `next()` — enforcement rides the ordinary cancellation
 * path, so turn enclosure and cleanup stay canonical; readResult later maps
 * the flag to the distinguishable `budget-exhausted` stop reason.
 */
function attachStepBudget(childCtx: Context, maxSteps: number, state: RunBudgetState, trip: () => void): void {
  let lastStep = 0
  childCtx.on('agent/pre-step', async ({ step }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    lastStep = Math.max(lastStep, step)
    if (lastStep > maxSteps && !state.exhausted) trip()
    return decision
  })
}

/** Append one one-shot descriptor inside the child's initial turn before its first request. */
function attachDescriptorAppend(childCtx: Context, descriptor: SubagentDescriptorData): void {
  let appended = false
  childCtx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (!appended && decision.kind === 'enter') {
      appended = true
      agent.session.append('subagent/descriptor', descriptor)
    }
    return decision
  })
}

/**
 * Establish and drive one in-process one-shot child. Fulfillment means the agent
 * is already published in the registry and transfers its turn, cancellation,
 * and disposal work through the returned run. Rejection means the agent
 * factory's unpublished creation transaction reached quiescence without
 * publishing a child. Every start appends its resolved descriptor inside the
 * child's initial turn.
 * @param request - the trusted typed start request, including its required signal.
 * @param options - the optional fork seed.
 * @returns a published holder-owned run.
 */
export async function startInProcessRun(
  request: ResolvedSubagentStartRequest,
  options: InProcessRunOptions,
): Promise<SubagentRun> {
  assertSubagentMaxDepth(request.maxDepth)
  if (request.signal.aborted) throw prePublicationAbort()
  const parent = request.parent
  const childDepth = resolveChildDepth(parent, request.maxDepth)

  const childId = SessionId(randomUUID())
  const seed = options.seed
  const activationBoundary = seed?.length ?? 0

  // Capture before the first await: a later parent switch belongs to the
  // parent's future.
  const inheritedMode = parent.ctx.get('sandboxPolicy')?.overrideOf(parent.session)
  const inheritedPolicy = parent.ctx.get('approval')?.overrideOf(parent.session)

  let structured: StructuredAttachment | undefined
  // Run-budget enforcement (capability-gated upstream): a child-scoped step
  // listener (creation window) plus a wall-clock timer (drive window) share one
  // trip channel; tripping aborts the composed signal the run already treats
  // as its cancellation path, and readResult settles the distinguishable
  // `budget-exhausted` stop reason from the shared flag.
  const budget = request.runBudget === undefined
    ? undefined
    : { ...request.runBudget, state: { exhausted: false } as RunBudgetState, controller: new AbortController() }
  const setup = (childCtx: Context): void => {
    // Inherited overrides land on the child's own log, so its effective policy
    // is reconstructable from that log alone.
    const childSession = (childCtx.agent as Agent).session
    if (inheritedMode !== undefined) {
      childSession.append('sandbox/mode', { mode: inheritedMode, source: 'delegation' })
    }
    if (inheritedPolicy !== undefined) {
      childSession.append('approval/policy', { policy: inheritedPolicy, source: 'delegation' })
    }
    applyChildComposition(childCtx, {
      persona: request.persona,
      toolFilter: request.toolFilter,
      sandboxMode: request.sandboxMode,
    })
    if (request.outputSchema !== undefined) {
      structured = attachStructuredRuntime(childCtx, request.outputSchema)
    }
    attachDescriptorAppend(childCtx, request.descriptor)
    if (budget !== undefined) {
      budget.controller.signal.addEventListener('abort', () => { budget.state.exhausted = true }, { once: true })
      attachStepBudget(childCtx, budget.maxSteps, budget.state, () => { budget.controller.abort() })
    }
  }

  const handle = await parent.ctx.agents.create({
    sessionId: childId,
    meta: childSessionMeta(parent, childDepth, activationBoundary),
    ...seed !== undefined ? { seed } : {},
    agentOptions: resolveChildAgentOptions(
      parent,
      request.agentOptions,
      childDepth,
      parent.ctx.get('modelRoles')?.resolve('subagent'),
    ),
    signal: request.signal,
    setup,
  })
  return drivePublishedRun(
    handle,
    request.signal,
    request.prompt,
    childId,
    activationBoundary,
    structured,
    budget,
  )
}

/**
 * Internal budget bundle handed from the start path to the drive path: the
 * validated relative budget, its shared exhaustion flag, and the trip channel
 * both bounds fire.
 */
interface RunBudget {
  maxSteps: number
  timeoutMs: number
  state: RunBudgetState
  controller: AbortController
}

/**
 * Wrap a published child in the single run lifecycle that owns signal handoff,
 * one turn, result settlement, and quiescent disposal. A budget composes the
 * caller signal with a wall-clock timer and the child-scoped step listener's
 * trip channel; either bound settles the run `budget-exhausted` (unless the
 * child already completed), while a bare caller abort stays `aborted`.
 */
function drivePublishedRun(
  handle: AgentHandle,
  signal: AbortSignal,
  prompt: ContentBlock[],
  childId: SessionId,
  boundary: number,
  structured: StructuredAttachment | undefined,
  budget: RunBudget | undefined,
): SubagentRun {
  const child = handle.agent
  const runSignal = budget === undefined
    ? signal
    : AbortSignal.any([signal, budget.controller.signal])
  const timer = budget === undefined ? undefined : setTimeout(
    () => { budget.controller.abort() },
    budget.timeoutMs,
  )
  const flags = { cancelled: false }
  const onAbort = (): void => {
    flags.cancelled = true
    child.cancel({ kind: 'parent' })
  }
  runSignal.addEventListener('abort', onAbort, { once: true })
  // Agent creation detaches its creation-only listener before returning. The
  // post-registration check closes that handoff without treating an already
  // published child as a failed start.
  if (runSignal.aborted) onAbort()

  const result: Promise<SubagentResult> = (async () => {
    try {
      if (!flags.cancelled) {
        child.followup(createUserMessage({ content: prompt, source: { kind: 'user' } }))
        await child.whenIdle()
      }
      return readResult(
        child,
        boundary,
        flags.cancelled,
        structured ? { captured: structured.captured() } : undefined,
        budget !== undefined && budget.state.exhausted,
      )
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      runSignal.removeEventListener('abort', onAbort)
    }
  })()

  return {
    id: childId,
    localAgent: child,
    result,
    async dispose(): Promise<void> {
      if (timer !== undefined) clearTimeout(timer)
      runSignal.removeEventListener('abort', onAbort)
      flags.cancelled = true
      const settlements = await Promise.allSettled([handle.dispose(), result])
      const disposal = settlements[0]
      // The result channel owns run faults; disposal reports only failure to
      // release the published handle after both operations settle.
      if (disposal.status === 'rejected') throw disposal.reason
    },
  }
}

/** Read one settled child's result from events after its activation boundary. */
function readResult(
  child: Agent,
  boundary: number,
  cancelled: boolean,
  structured?: { captured?: { value: unknown } | undefined },
  budgetExhausted: boolean = false,
): SubagentResult {
  const own = child.session.events.slice(boundary)
  const lastMessage = own.findLast((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
  const lastEnd = findLastMessageTurnEnd(own)
  const output: Array<ContentBlock> = lastMessage?.data.message.content ?? []
  const recorded = toStopReason(lastEnd?.data.reason)
  // Disposal can tear the owner down before the loop records its ordinary
  // `aborted` end, yielding `disposed` instead.
  let stopReason: SubagentStopReason = cancelled && recorded !== 'completed' ? 'aborted' : recorded
  // A fired budget bound wins over the abort it caused, unless the child had
  // already completed — the budget never retroactively fails a finished run.
  if (budgetExhausted && stopReason !== 'completed') stopReason = 'budget-exhausted'
  if (structured !== undefined) {
    if (structured.captured !== undefined) {
      return { output, structured: structured.captured.value, stopReason }
    }
    if (stopReason === 'completed') return { output, stopReason: cancelled ? 'aborted' : 'error' }
  }
  return { output, stopReason }
}
