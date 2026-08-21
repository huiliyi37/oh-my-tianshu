/**
 * Pure client-safe subagent projection vocabulary.
 *
 * @module @huiliyi37/dsh-subagent/projection-types
 */

/** Durable active-turn timing for one descriptor-backed child session. */
export interface SubagentTimingProjection {
  /** Milliseconds accumulated across completed turns after the child's own descriptor. */
  settledMs: number
  /** Same-cut bounds of the currently open turn, when one has not reached `turn/end`. */
  active?: {
    /** Start of the open turn. */
    since: number
    /** Latest event time folded into this projection cut. */
    through: number
  }
}

/**
 * Running-state projection for one descriptor-backed subagent session: turn /
 * tool counts, latest token accounting, and the current tool activity, all
 * folded from the child's own log events (`turn/end`, `tool/call`,
 * `tool/result`, `assistant/message` usage). Deliberately excludes facts the
 * log cannot carry: `contextPct` needs the live `contextWindow` query, and the
 * terminal `stopReason` (whose `refusal` variant is not log-derivable) stays
 * on the `subagent/end` plugin-event path.
 */
export interface SubagentProgressProjection {
  /** `turn/end` count after the child's own descriptor (seed replay excluded). */
  turns: number
  /** `tool/call` count after the child's own descriptor. */
  toolCalls: number
  /** Billed total (input+output+cacheRead+cacheWrite) of the latest `assistant/message` usage. */
  tokensUsed: number
  /** `reasoningTokens` of the latest usage, when the adapter reported it. */
  reasoningTokens?: number
  /** Name of the latest `tool/call` (absent when the child made none). */
  lastTool?: string
  /** The latest `tool/call` has no paired `tool/result` yet. */
  toolInFlight: boolean
  /** Kind of the latest `turn/end` reason; `turn/start` clears it so an open turn is not terminal. */
  lastTurnEnd?: 'completed' | 'aborted' | 'blocked' | 'error' | 'max-tokens' | 'interrupted'
  /**
   * Live execution-state bit: whether the child currently has an open turn
   * after its own descriptor (`turn/start` sets it, `turn/end` clears it).
   * `true` ⟺ executing; `false` with `lastTurnEnd` set ⟺ the last turn ended
   * (settled work or an idle continuable child waiting for delivery).
   */
  running: boolean
}

/**
 * Durable identity of one descriptor-backed subagent session: lifecycle mode
 * plus creation label, folded last-wins from `subagent/descriptor` events.
 * Label strength follows the descriptor schema: a continuable child always
 * carries one, a one-shot child may omit it.
 */
export type SubagentIdentityProjection =
  | {
    /** A terminal one-shot child. */
    mode: 'one-shot'
    /** Optional durable creation label from the child's descriptor. */
    label?: string
    /**
     * Seq of the `subagent/descriptor` event this identity was folded from.
     * `seq >= header.seedLength` proves the identity comes from the child's
     * OWN log suffix — where a descriptor is immutable once appended — and
     * not from a fork seed's replayed ancestor descriptor.
     */
    seq: number
  }
  | {
    /** A resumable conversation. */
    mode: 'continuable'
    /** Durable creation label from the child's descriptor. */
    label: string
    /** Seq of the folded descriptor event; see the one-shot arm for the own-suffix proof. */
    seq: number
  }

declare module '@huiliyi37/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Active-turn duration for a descriptor-backed subagent session. */
    subagentTiming: SubagentTimingProjection
    /** Running-state activity/token/turn facts for a descriptor-backed subagent session. */
    subagentProgress: SubagentProgressProjection
    /**
     * Identity of a descriptor-backed subagent session. `null` ⟺ no valid
     * descriptor (missing, malformed, or unrecognized-version — deliberately
     * undistinguished). The sentinel is deliberately serializable: a
     * value pushed over JSON transports must survive `JSON.stringify`
     * losslessly, where an `undefined` field would be dropped and a stale
     * identity would survive on the receiving side. The entry itself stays
     * non-optional.
     */
    subagent: SubagentIdentityProjection | null
  }
}
