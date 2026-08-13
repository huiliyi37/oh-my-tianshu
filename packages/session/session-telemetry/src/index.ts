/**
 * Telemetry Service Definition for the DeepSeek Harness.
 *
 * This package owns the CAPTURE side of session-event reporting — which records
 * exist (the chunk projection), what they carry (the logical record), when
 * they are captured (adoption, the per-append firehose, lifecycle
 * forwarding), live versus on-demand canonical-log capture, and the HMR
 * cursor. Everything downstream of
 * {@link Telemetry.emit} — batching, retry, queueing, and loss policy — is the
 * reporting SDK's territory and is deliberately not modelled here. The
 * design and its trade-offs are pinned in
 * .agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md.
 *
 * @module @deepseek-ai/dsh-session-telemetry
 */

import { Context, Service } from 'cordis'

declare module 'cordis' {
  interface Context {
    telemetry: Telemetry
  }

  interface Events {
    /**
     * Transform one outbound record before it reaches the backend. This
     * waterfall is the Service Definition's redaction extension point. It ships NO rules
     * of its own: the
     * innermost `next()` passes the record through unchanged, and with no
     * listener mounted records reach the backend as captured, so exported
     * data is exactly as clean as the rules a deployment mounts. Listeners
     * stack by transforming `next()`'s return value; returning without
     * `next()` replaces everything beneath. Dispatched synchronously on the
     * capture hot path inside the coordinator's containment: a throwing
     * listener withholds that one record (fail-closed) and never reaches the
     * agent loop. Live capture dispatches at append time; on-demand capture
     * dispatches while reading the canonical log. Redaction applies to the
     * exported copy only; the canonical session log is never rewritten.
     * @param record - the candidate record, already the coordinator's own deep
     *   copy; listeners return a (possibly new) record and must not mutate it.
     * @mode waterfall
     */
    'telemetry/record'(record: TelemetryRecord, next: () => TelemetryRecord): TelemetryRecord
  }
}

/**
 * Severity of a telemetry record, pre-mapped at capture so a receiver can
 * alert with zero configuration: `error` for events whose own outcome flag
 * says so (the tool-result block's `isError`, `turn/end` error reasons) and for
 * `agent-error` operational records. Captured events otherwise default to
 * `info`; `warn` remains available to `telemetry/record` policies and
 * backends.
 */
export type TelemetrySeverity = 'info' | 'warn' | 'error'

/**
 * One logical record handed to a backend — the capture contract's whole outbound
 * vocabulary. Ledger records mirror session-log events one-to-one;
 * operational records (`channel: 'ops'`) carry the two signals with no log
 * home (`agent-error`, `shutdown`) and deliberately omit `event.seq`-style
 * identity so they can never be mistaken for ledger rows.
 */
export interface TelemetryRecord {
  /** Ledger (session-log mirror) or ops (operational signal) channel; backends keep the two under separate instrumentation scopes. */
  channel: 'ledger' | 'ops'
  /** Unix epoch milliseconds — the source event's append time for ledger records, the emission time for ops records. */
  time: number
  /** Pre-mapped alerting severity; see {@link TelemetrySeverity}. */
  severity: TelemetrySeverity
  /**
   * Identity attributes, deliberately minimal: ledger records carry
   * `session.id`, `event.type`, `event.seq`, plus `session.cwd` /
   * `session.parent_id` / `session.seed_length` when the header has them;
   * ops records carry `telemetry.op`, `session.id`, and (for `agent-error`)
   * `agent.id`, `turn`, `step`, `error.name`. Anything recoverable from the
   * body is intentionally NOT duplicated here.
   */
  attributes: Record<string, string | number>
  /**
   * The complete payload: a deep copy of the session event's `data` for
   * ledger records (JSON-serializable by `Session.append`'s own
   * validation), or the op payload for ops records. Never mutated after
   * handoff.
   */
  body: unknown
}

/**
 * The backend contract the coordinator hands records to — the minimum any
 * reporting SDK satisfies with zero bending. {@link Telemetry} is its
 * service-registered form; tests compose the coordinator with a bare
 * implementation of this interface.
 */
export interface TelemetryBackend {
  /**
   * Hand one record to the backend's pipeline. MUST be a non-blocking
   * enqueue — the coordinator calls this synchronously from the
   * `session/event` hot path or an explicit canonical-log capture, so anything
   * slower than a queue push would tax the agent loop or feedback handling.
   * Errors thrown here are contained by the coordinator and logged; they
   * never reach the loop.
   * @param record - the logical record to report; owned by the backend after the call.
   */
  emit(record: TelemetryRecord): void
  /**
   * Optional hint that a natural boundary (turn end) passed — a backend may
   * forward it to its SDK's flush so records land at turn boundaries. Called
   * fire-and-forget; implementations must not block and must not throw
   * meaningfully (the coordinator contains exceptions). Most backends should
   * leave this unimplemented and let their SDK's own batching cadence govern
   * export timing: a backend that does implement it owns the interaction
   * between its concurrent flushes and {@link shutdown}'s drain (the OTel
   * backend removed its implementation for exactly that hazard — see the
   * revival Agent Note).
   */
  flush?(): void
  /**
   * Forward the fiber's disposal to the SDK: flush whatever is queued and
   * reach quiescence, per the SDK's own shutdown contract. Everything
   * emitted before this call must still be delivered — including records
   * enqueued while a {@link flush} hint is in flight, so a backend whose SDK
   * guards against concurrent flushes orders behind the outstanding one (the
   * coordinator emits its dispose-time `shutdown` markers immediately before
   * calling this). Awaited by the coordinator's dispose; a rejection is
   * logged as a warning and never fails application teardown.
   * The coordinator captures dispose-time shutdown markers immediately before
   * this call for live capture; on-demand capture creates no ops records.
   * @returns resolves when the backend's pipeline has quiesced.
   */
  shutdown(): Promise<void>
}

/**
 * The backend contract in its loadable form: one implementation per context —
 * the cordis `Service` registration under the `telemetry` key throws on a
 * duplicate, cordis' standard behavior. A backend composes a
 * {@link TelemetryCoordinator} in its constructor to install the capture side.
 */
export abstract class Telemetry extends Service implements TelemetryBackend {
  constructor(ctx: Context) {
    super(ctx, 'telemetry')
  }

  /**
   * See {@link TelemetryBackend.emit} — that declaration is the contract's one home.
   * @param record - the logical record to report; owned by the backend after the call.
   */
  abstract emit(record: TelemetryRecord): void

  /** See {@link TelemetryBackend.flush}. */
  flush?(): void

  /**
   * See {@link TelemetryBackend.shutdown}.
   * @returns resolves when the backend's pipeline has quiesced.
   */
  abstract shutdown(): Promise<void>
}

export { TelemetryCoordinator, type TelemetryCapture } from './coordinator.ts'
