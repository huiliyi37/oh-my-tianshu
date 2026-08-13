/**
 * Lifecycle-edge publication for both subagent shapes: the contained emitter,
 * the one-shot run observer, and the continuable Activation observer.
 *
 * The public payload contracts ({@link SubagentRunInfo},
 * {@link SubagentRunEndInfo}) live in `./types.ts` with the rest of the seam's
 * consumer-facing types; this module owns only the implementation and the
 * package-private {@link ActivationObserver} the continuation manager consumes.
 * Keeping the internal control interface out of the published surface is
 * deliberate: the observer's `start`/`capture`/`settle` ordering is a contract
 * between this module and one in-package caller, not something a plugin may
 * depend on.
 *
 * @module @deepseek-ai/dsh-subagent/lifecycle
 */

import { randomUUID } from 'node:crypto'
import type { Context } from 'cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { findLastMessageTurnEnd } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SubagentRunId } from './types.ts'
import type { SubagentResult, SubagentRun, SubagentRunEndInfo, SubagentRunInfo } from './types.ts'

/**
 * Lifecycle observer for one Activation's residency epoch, so continuable
 * children emit the same start/end pair as one-shot runs. Package-private: the
 * continuation manager is the only consumer, and its call ordering is an
 * in-package contract rather than a published extension point.
 */
export interface ActivationObserver {
  /**
   * Publish the start edge once the epoch is resident.
   * @param child - the resident child agent, whose log suffix bounds this epoch.
   */
  start(child: Agent): void
  /**
   * Snapshot the child-dependent terminal facts while the child is still
   * registered, because handle disposal unregisters it and consumers resolve it
   * to read the child's own log and scope.
   * @param child - the quiescent child agent about to be released.
   */
  capture(child: Agent): void
  /**
   * Publish the terminal edge exactly once, pairing this epoch's {@link start},
   * after the disposal outcome is known. Called only for a resident epoch: a
   * failure before residency publishes no edge, because inventing one would
   * report a lifecycle the child never had.
   * @param failure - the teardown or durability failure, or `undefined` on success.
   */
  settle(failure: unknown): void
}

/**
 * Publish one lifecycle edge with per-listener exception containment. Run edges
 * carry the delegating parent that keys scoped dispatch; provider removal has no
 * parent carrier and reaches listeners unscoped.
 *
 * The service owns this closure because scoped dispatch keys its carrier by the
 * exact service instance, whose own context filter composes into the carrier;
 * a narrowed stand-in would silently change scope filtering.
 */
export type LifecycleEmitter = {
  (name: 'subagent/start', info: SubagentRunInfo, parent: Agent): void
  (name: 'subagent/end', info: SubagentRunEndInfo, parent: Agent): void
  (name: 'subagent/provider-removed', info: string): void
}

/**
 * Build the contained lifecycle emitter this seam publishes every edge through.
 * Every listener is independently contained: a synchronous throw or a rejected
 * returned promise is logged without starving peer listeners, changing the run,
 * or — for provider removal, which fires from a disposer — breaking teardown.
 * @param ctx - the service's own context, owning dispatch and the logger.
 * @param carrier - resolve the scoped dispatch carrier for one delegating parent.
 * @returns the emitter both observers and the provider registry publish through.
 */
export function createLifecycleEmitter(
  ctx: Context,
  carrier: (parent: Agent) => object,
): LifecycleEmitter {
  return (
    name: 'subagent/start' | 'subagent/end' | 'subagent/provider-removed',
    info: SubagentRunInfo | SubagentRunEndInfo | string,
    parent?: Agent,
  ): void => {
    const dispatchArgs: unknown[] = parent === undefined
      ? [name, info]
      : [carrier(parent), name, info]
    for (const callback of ctx.events.dispatch('emit', dispatchArgs)) {
      try {
        const returned: unknown = callback(info)
        void Promise.resolve(returned).catch((error: unknown) => {
          ctx.logger.warn(`subagent: ${name} listener rejected: ${renderThrown(error)}`)
        })
      } catch (error: unknown) {
        ctx.logger.warn(`subagent: ${name} listener threw: ${renderThrown(error)}`)
      }
    }
  }
}

/**
 * Emit the start/end lifecycle pair for one accepted one-shot run.
 * @param emit - the contained lifecycle emitter.
 * @param provider - the provider that established the run.
 * @param parent - the delegating parent keying scoped dispatch.
 * @param run - the published run whose settlement closes the pair.
 * @returns the same run, unchanged.
 */
export function observeRun(
  emit: LifecycleEmitter,
  provider: string,
  parent: Agent,
  run: SubagentRun,
): SubagentRun {
  const identity = {
    runId: SubagentRunId(randomUUID()),
    provider,
    id: run.id,
    local: run.localAgent !== undefined,
  }
  // Attach the terminal observer before dispatching start. Promise reactions
  // still run after this synchronous start emission, preserving start → end.
  void run.result.then(
    (result) => {
      emit('subagent/end', {
        ...identity,
        stopReason: result.stopReason,
        lastAssistantMessage: result.output,
      }, parent)
    },
    () => {
      emit('subagent/end', { ...identity, stopReason: 'error' }, parent)
    },
  )
  emit('subagent/start', identity, parent)
  return run
}

/**
 * Build the observer for one continuable Activation's residency epoch. Observers
 * see the same vocabulary as a one-shot run, so a child's start and settlement
 * remain observable without exposing whether the manager materialized, woke, or
 * cold-resumed it. Creation failure before residency emits no lifecycle edge.
 * @param emit - the contained lifecycle emitter.
 * @param provider - the provider name recorded in the durable descriptor.
 * @param childId - the durable child session id.
 * @param parent - the exact live direct parent keying scoped dispatch.
 * @returns the observer whose edges this epoch publishes.
 */
export function createActivationObserver(
  emit: LifecycleEmitter,
  provider: string,
  childId: SessionId,
  parent: Agent,
): ActivationObserver {
  const identity = { runId: SubagentRunId(randomUUID()), provider, id: childId, local: true }
  // A cold resume replays earlier turns, so this epoch's telemetry must come
  // from the suffix it actually produced — never the whole session, which
  // would report a previous epoch's answer when this one opened no turn.
  let boundary = 0
  // Assigned by `capture()`, which the disposal path always runs before
  // `settle()`; a resident epoch therefore always has its facts by then.
  let captured: { stopReason: SubagentResult['stopReason']; output?: ContentBlock[] } = {
    stopReason: 'completed',
  }
  return {
    start: (child: Agent): void => {
      boundary = child.session.events.length
      emit('subagent/start', identity, parent)
    },
    capture: (child: Agent): void => {
      const own = child.session.events.slice(boundary)
      const output = lastAssistantOutput(own)
      captured = {
        stopReason: epochStopReason(own),
        ...output !== undefined ? { output } : {},
      }
    },
    settle: (failure: unknown): void => {
      const output = failure === undefined ? captured.output : undefined
      emit('subagent/end', {
        ...identity,
        stopReason: failure === undefined ? captured.stopReason : 'error',
        ...output === undefined ? {} : { lastAssistantMessage: output },
      }, parent)
    },
  }
}

/**
 * Why this child's last ordinary turn ended, for the terminal lifecycle edge.
 * The child's own `turn/end` is authoritative: teardown succeeding says nothing
 * about whether the model errored, hit its token ceiling, or was cancelled, so
 * deriving the reason from disposal would report failed work as completed.
 * @param events - this epoch's own event suffix.
 * @returns its terminal stop reason; `completed` when no ordinary turn closed.
 */
function epochStopReason(events: readonly SessionEvent[]): SubagentResult['stopReason'] {
  const reason = findLastMessageTurnEnd(events)?.data.reason
  // No ordinary turn closed, so nothing failed either.
  if (reason === undefined) return 'completed'
  switch (reason.kind) {
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
    case 'interrupted':
      return 'aborted'
    case 'error':
      return 'error'
    case 'completed':
      return 'completed'
    /* v8 ignore next 3 -- `TurnEndReason` is merge-extensible, so this arm needs a
     * backend that adds a variant; treating an unnameable reason as success would
     * report failed work as completed. */
    default:
      return 'error'
  }
}

/**
 * The child's last assistant message content, for one Activation's terminal
 * lifecycle edge. Absent when no assistant message reached the log.
 * @param events - this epoch's own event suffix.
 * @returns its final assistant content, or `undefined` when it produced none.
 */
function lastAssistantOutput(events: readonly SessionEvent[]): ContentBlock[] | undefined {
  const message = events.findLast(
    (event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message',
  )
  return message?.data.message.content
}

/** Render any listener-thrown value without letting coercion escape containment. */
function renderThrown(value: unknown): string {
  try {
    return value instanceof Error ? `${value.name}: ${value.message}` : String(value)
  } catch {
    return '<unrenderable thrown value>'
  }
}
