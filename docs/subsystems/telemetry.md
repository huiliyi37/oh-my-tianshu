# Telemetry

English | [中文](telemetry.zh.md)

Outbound session reporting is split as a [capability seam](../capability-seams.md): the Service Definition and capture coordinator ([dsh-session-telemetry](../../packages/session/session-telemetry), `ctx.telemetry`) own the capture points, fixed chunk projection, `telemetry/record` redaction waterfall, handoff cursor, and minimal backend contract; the Service provider a deployment loads ([dsh-session-telemetry-otel](../../packages/session/session-telemetry-otel)) is the OpenTelemetry JS SDK's log pipeline configured verbatim. It is one optional capability, not part of the agent-loop spine, and nothing here reaches a model request. The boundary axiom — the harness's aspect ends at `emit()`; batching, retry, queueing, and loss policy belong to the reporting SDK — and the rejected alternatives are pinned in the [revival Agent Note](../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md); the capture points, cursor, and projection contracts live in the [Service Definition README](../../packages/session/session-telemetry/README.md).

Source: [`packages/session/session-telemetry/src/index.ts`](../../packages/session/session-telemetry/src/index.ts)

## The logical record

```ts type-equiv
/**
 * Severity of a telemetry record, pre-mapped at capture so a receiver can
 * alert with zero configuration: `error` for events whose own outcome flag
 * says so (the tool-result block's `isError`, `turn/end` error reasons) and for
 * `agent-error` operational records. Captured events otherwise default to
 * `info`; `warn` remains available to `telemetry/record` policies and
 * backends.
 */
type TelemetrySeverity = 'info' | 'warn' | 'error'
```

```ts type-equiv
/**
 * One logical record handed to a backend — the capture contract's whole outbound
 * vocabulary. Ledger records mirror session-log events one-to-one;
 * operational records (`channel: 'ops'`) carry the two signals with no log
 * home (`agent-error`, `shutdown`) and deliberately omit `event.seq`-style
 * identity so they can never be mistaken for ledger rows.
 */
interface TelemetryRecord {
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
```

Only the first `assistant/chunk` of each `(turn, step)` ships — the stream-started signal; the rest drop at capture, so `seq` gaps are routine on the wire and never a loss signal. Every other [session event](session.md) type, including plugin-merged ones the seam never heard of, passes through whole. Delivery is best-effort: the cursor marks handed-off, not delivered, records can be lost (crash, reload window) and duplicated (cursor-less re-adoption, SDK retries), so receivers dedupe ledger records on `(session.id, event.seq)`; ops records deliberately omit that identity — they are signals to alert on, not entries to sum, and tolerate duplicates instead.

## The backend contract

```ts type-equiv
/**
 * The backend contract the coordinator hands records to — the minimum any
 * reporting SDK satisfies with zero bending. {@link Telemetry} is its
 * service-registered form; tests compose the coordinator with a bare
 * implementation of this interface.
 */
interface TelemetryBackend {
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
```

`Telemetry` (`ctx.telemetry`, [signatures](#ctxtelemetry--telemetry-abstract-seam)) is the contract's loadable form — one implementation per context, duplicate load throws — and a backend composes the seam's `TelemetryCoordinator` in its constructor to install the capture side.

## The redact waterfall: `telemetry/record`

Every record passes the `telemetry/record` [waterfall](../cordis-primer.md#cordis-waterfall-semantics) between projection and `emit()` ([event entry](#telemetryrecord--waterfall)). The seam ships NO rules of its own: with no listener mounted, records reach the backend exactly as captured, so exported data is precisely as clean as the rules a deployment mounts. Listeners stack by transforming `next()`'s return value; returning without `next()` replaces everything beneath; a throwing listener withholds that one record fail-closed inside the coordinator's containment. Redaction applies to the exported copy only — the canonical session log is never rewritten.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis surface

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` surface lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtelemetry--telemetry-abstract-seam"></a>

### `ctx.telemetry` — `Telemetry` (abstract seam)

The backend contract in its loadable form: one implementation per context — the cordis `Service` registration under the `telemetry` key throws on a duplicate, cordis' standard behavior. A backend composes a TelemetryCoordinator in its constructor to install the capture side.

```ts cordis-catalog
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
```

Source: [`packages/session/session-telemetry/src/index.ts:140`](../../packages/session/session-telemetry/src/index.ts)

<a id="telemetry-events"></a>

### `telemetry/*` events

<a id="telemetryrecord--waterfall"></a>

#### `telemetry/record` — waterfall

Transform one outbound record before it reaches the backend. This waterfall is the Service Definition's redaction extension point. It ships NO rules of its own: the innermost `next()` passes the record through unchanged, and with no listener mounted records reach the backend as captured, so exported data is exactly as clean as the rules a deployment mounts. Listeners stack by transforming `next()`'s return value; returning without `next()` replaces everything beneath. Dispatched synchronously on the capture hot path inside the coordinator's containment: a throwing listener withholds that one record (fail-closed) and never reaches the agent loop. Live capture dispatches at append time; on-demand capture dispatches while reading the canonical log. Redaction applies to the exported copy only; the canonical session log is never rewritten.

```ts cordis-catalog
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
```

Source: [`packages/session/session-telemetry/src/index.ts:43`](../../packages/session/session-telemetry/src/index.ts)
<!-- END GENERATED cordis-surface -->
