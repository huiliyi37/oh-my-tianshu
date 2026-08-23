/**
 * Pure session projections for subagent identity (mode/label), active-turn
 * duration, and running-state progress.
 *
 * @module @huiliyi37/dsh-subagent/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@huiliyi37/dsh-session-projection'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { foldSubagentDescriptor } from './descriptor.ts'
import type { SubagentDescriptorData } from './descriptor.ts'
import type {
  SubagentIdentityProjection,
  SubagentProgressProjection,
  SubagentTimingProjection,
} from './projection-types.ts'

/** turn/end reason kinds the progress projection records verbatim (see the fold below). */
const TURN_END_KINDS = new Set(['completed', 'aborted', 'blocked', 'error', 'max-tokens', 'interrupted'])

interface TimingState {
  /** Milliseconds accumulated across completed post-descriptor turns. */
  settledMs: number
  /** Current open interval kept paired inside the fold. */
  active?: { since: number; through: number }
  /** Latest pre-descriptor turn start, promoted when the child's own descriptor arrives. */
  pendingTurnStart?: number
  /** Whether the fold has crossed a descriptor in this logical log. */
  descriptorSeen: boolean
}

const activeIntervalSchema = z.object({
  since: z.number().int().nonnegative(),
  through: z.number().int().nonnegative(),
}).strict()

const projectionSchema: z.ZodType<SubagentTimingProjection> = z.object({
  settledMs: z.number().int().nonnegative(),
  active: activeIntervalSchema.optional(),
}).strict().transform(({ settledMs, active }) => ({
  settledMs,
  ...active === undefined ? {} : { active },
}))

/**
 * Fold turn boundaries around the child's own durable descriptor.
 *
 * A fork seed may contain an ancestor descriptor and completed turns. Every
 * descriptor therefore resets the accumulated state; the healthy catalog
 * admits only a child with exactly one descriptor in its own suffix, making
 * the final reset the child's authoritative timing origin.
 */
export const subagentTimingProjectionDefinition:
ProjectionDefinition<'subagentTiming', TimingState> = {
  key: 'subagentTiming',
  schema: projectionSchema,
  init: () => ({ descriptorSeen: false, settledMs: 0 }),
  apply: (state, event) => {
    if (event.type === 'turn/start') {
      return state.descriptorSeen
        ? { ...state, active: { since: event.time, through: event.time } }
        : { ...state, pendingTurnStart: event.time }
    }
    if (event.type === 'subagent/descriptor') {
      const activeSince = state.active?.since ?? state.pendingTurnStart
      return {
        descriptorSeen: true,
        settledMs: 0,
        ...(activeSince === undefined
          ? {}
          : { active: { since: activeSince, through: event.time } }),
      }
    }
    if (event.type === 'turn/end') {
      if (!state.descriptorSeen) {
        if (state.pendingTurnStart === undefined) return state
        const { pendingTurnStart: _closed, ...next } = state
        return next
      }
      if (state.active === undefined) return state
      const { active, ...rest } = state
      return {
        ...rest,
        settledMs: state.settledMs + Math.max(0, event.time - active.since),
      }
    }
    if (state.active === undefined) return state
    return { ...state, active: { ...state.active, through: event.time } }
  },
  view: state => ({
    settledMs: state.settledMs,
    ...(state.active === undefined ? {} : { active: state.active }),
  }),
  stateVersion: 2,
}

interface IdentityState {
  /** Identity from the last valid descriptor; absent before one, and after an invalid one. */
  identity?: SubagentIdentityProjection
}

// The cast bridges only the optional-label arm: Zod's optional output
// includes explicit `undefined`, which exactOptionalPropertyTypes excludes
// from the public interface. The no-value state itself is the serializable
// `null` arm — never `undefined` — so every registry read and push frame
// survives JSON.stringify losslessly.
const identitySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('one-shot'),
    label: z.string().optional(),
    seq: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    mode: z.literal('continuable'),
    label: z.string(),
    seq: z.number().int().nonnegative(),
  }).strict(),
]).nullable() as unknown as z.ZodType<SubagentIdentityProjection | null>

/** Interpret one `subagent/descriptor` event's identity; no value when the payload cannot be trusted. */
function descriptorIdentity(event: SessionEvent): SubagentIdentityProjection | undefined {
  let descriptor: SubagentDescriptorData | undefined
  try {
    descriptor = foldSubagentDescriptor([event])
  } catch {
    // Only a malformed current-version payload throws in descriptor parsing;
    // a projection fold must never throw, so damage folds to no value.
    descriptor = undefined
  }
  if (descriptor === undefined) return undefined
  return descriptor.mode === 'one-shot'
    ? {
      mode: 'one-shot',
      ...descriptor.label !== undefined ? { label: descriptor.label } : {},
      seq: event.seq,
    }
    : { mode: 'continuable', label: descriptor.label, seq: event.seq }
}

/**
 * Fold the durable mode/label identity from `subagent/descriptor` events,
 * last-wins: a fork seed may replay an ancestor's descriptor, and the child's
 * own descriptor must override it — the same reset discipline as
 * {@link subagentTimingProjectionDefinition}. A malformed or unknown-version
 * payload resets to the `null` sentinel instead of throwing, so a fork of a
 * healthy ancestor never inherits an identity its own descriptor failed to
 * establish — and the reset survives every JSON push frame, so a consumer
 * holding the earlier identity replaces it instead of keeping it stale;
 * `null` ⟺ no valid descriptor, with the causes deliberately undistinguished.
 */
export const subagentIdentityProjectionDefinition:
ProjectionDefinition<'subagent', IdentityState> = {
  key: 'subagent',
  schema: identitySchema,
  init: () => ({}),
  apply: (state, event) => {
    if (event.type !== 'subagent/descriptor') return state
    const identity = descriptorIdentity(event)
    return identity === undefined ? {} : { identity }
  },
  view: state => state.identity ?? null,
  // Bumped when the identity gained its `seq` field: an older checkpoint row
  // would replay into a value the schema rejects, so it must refold instead.
  stateVersion: 2,
}

interface ProgressState {
  /** Whether the fold has crossed a descriptor in this logical log. */
  descriptorSeen: boolean
  /** Whether a turn is currently open after the descriptor (execution-state bit). */
  inTurn: boolean
  /** `turn/end` count after the child's own descriptor. */
  turns: number
  /** `tool/call` count after the child's own descriptor. */
  toolCalls: number
  /** Billed total of the latest `assistant/message` usage (last-wins). */
  tokensUsed: number
  /** `reasoningTokens` of the latest usage (last-wins). */
  reasoningTokens?: number
  /** Name of the latest `tool/call`. */
  lastTool?: string
  /** Kind of the latest post-descriptor `turn/end` reason. */
  lastTurnEnd?: string
  /** callId → tool name for calls that have not reached `tool/result`. Plain JSON (persisted-cache precondition). */
  pending: Record<string, string>
  /** callId of the latest `tool/call`. */
  lastCallId?: string
}

const progressSchema = z.object({
  turns: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  lastTool: z.string().min(1).optional(),
  toolInFlight: z.boolean(),
  lastTurnEnd: z.enum([
    'completed', 'aborted', 'blocked', 'error', 'max-tokens', 'interrupted',
  ]).optional(),
  running: z.boolean(),
}).strict() as unknown as z.ZodType<SubagentProgressProjection>

/**
 * Fold running activity facts from the child's own log: turn/tool counts,
 * latest token accounting, the current tool activity, and the `running`
 * execution-state bit (open turn after the descriptor). Every fact traces
 * to an existing session event — `turn/start`, `turn/end`, `tool/call`,
 * `tool/result`, `assistant/message` usage — so no new event vocabulary is
 * introduced (Model-visible ⟺ logged). The descriptor resets accumulation
 * (a fork seed may replay an ancestor's work), and a malformed payload never
 * throws: it folds to no value, mirroring the identity unit's damage
 * discipline.
 */
export const subagentProgressProjectionDefinition:
ProjectionDefinition<'subagentProgress', ProgressState> = {
  key: 'subagentProgress',
  schema: progressSchema,
  init: () => ({ descriptorSeen: false, inTurn: false, turns: 0, toolCalls: 0, tokensUsed: 0, pending: {} }),
  apply: (state, event) => {
    if (event.type === 'subagent/descriptor') {
      return { descriptorSeen: true, inTurn: false, turns: 0, toolCalls: 0, tokensUsed: 0, pending: {} }
    }
    if (!state.descriptorSeen) return state
    switch (event.type) {
      case 'turn/start': {
        if (state.lastTurnEnd === undefined) return { ...state, inTurn: true }
        const { lastTurnEnd: _closed, ...rest } = state
        return { ...rest, inTurn: true }
      }
      case 'tool/call': {
        const { name, callId } = event.data
        return {
          ...state,
          toolCalls: state.toolCalls + 1,
          lastTool: name,
          lastCallId: callId,
          pending: { ...state.pending, [callId]: name },
        }
      }
      case 'tool/result': {
        const callId = event.data.message.source.callId
        if (!Object.hasOwn(state.pending, callId)) return state
        return {
          ...state,
          pending: Object.fromEntries(Object.entries(state.pending).filter(([id]) => id !== callId)),
        }
      }
      case 'assistant/message': {
        const usage = event.data.usage
        if (usage === undefined) return state
        const tokensUsed = usage.inputTokens + usage.outputTokens
          + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
        const { reasoningTokens: _prior, ...rest } = state
        return {
          ...rest,
          tokensUsed,
          ...usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {},
        }
      }
      case 'turn/end': {
        const kind = event.data.reason.kind
        if (TURN_END_KINDS.has(kind)) {
          return { ...state, inTurn: false, turns: state.turns + 1, lastTurnEnd: kind }
        }
        // An unknown merged reason kind is not our vocabulary: count the turn
        // but ignore the kind rather than guess (no record ≠ zero value).
        return { ...state, inTurn: false, turns: state.turns + 1 }
      }
      default:
        return state
    }
  },
  view: (state) => {
    const toolInFlight = state.lastCallId !== undefined
      && Object.hasOwn(state.pending, state.lastCallId)
    return {
      turns: state.turns,
      toolCalls: state.toolCalls,
      tokensUsed: state.tokensUsed,
      ...state.reasoningTokens !== undefined ? { reasoningTokens: state.reasoningTokens } : {},
      ...state.lastTool !== undefined ? { lastTool: state.lastTool } : {},
      toolInFlight,
      ...state.lastTurnEnd !== undefined
        ? { lastTurnEnd: state.lastTurnEnd as NonNullable<SubagentProgressProjection['lastTurnEnd']> }
        : {},
      running: state.inTurn,
    }
  },
  // Bumped for the `running` execution-state bit: older checkpoint rows replay
  // into a value the schema rejects, so they must refold instead.
  stateVersion: 2,
}
