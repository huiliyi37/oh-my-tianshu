# 遥测（telemetry）

[English](telemetry.md) | 中文

对外的会话上报拆分为一项[能力 seam](../capability-seams.md)：Service Definition 与捕获协调器（[dsh-session-telemetry](../../packages/session/session-telemetry)，`ctx.telemetry`）拥有捕获点、固定分片投影、`telemetry/record` 脱敏 waterfall（瀑布式事件）、handoff 游标与最小后端约定；部署方加载的 Service provider（[dsh-session-telemetry-otel](../../packages/session/session-telemetry-otel)）则是原样配置的 OpenTelemetry JS SDK 日志流水线。它是一项可选能力，不属于 agent loop（智能体循环）主干，这里也没有任何内容会进入模型请求。边界公理（harness 的职责止于 `emit()`；批处理、重试、排队与丢失策略都属于上报 SDK）连同被否决的替代方案，均已在[复活 Agent Note（agent 决策记录）](../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md)中定案；捕获点、游标与投影的约定见 [Service Definition README](../../packages/session/session-telemetry/README.md)。

源码：[`packages/session/session-telemetry/src/index.ts`](../../packages/session/session-telemetry/src/index.ts)

## 逻辑记录

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

每个 `(turn, step)` 只发出第一条 `assistant/chunk`，即「流已开始」的信号；其余分片在捕获时丢弃，因此导出流中的 `seq` 缺口是常态，绝不是丢失信号。其他所有[会话事件](session.md)类型都会完整透传，包括该 seam 从未听说过、由插件合并进来的事件类型。投递是尽力而为的：游标标记的是「已交接」而非「已送达」，记录可能丢失（崩溃、重载窗口）也可能重复（无游标的重新接管、SDK 重试），因此接收端对 ledger 记录基于 `(session.id, event.seq)` 去重；ops 记录刻意省略这类标识——它们是用于告警的信号，而非用于累加的条目，重复被容忍而非被去重。

## 后端约定

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

`Telemetry`（`ctx.telemetry`，[签名](#ctxtelemetry--telemetry-abstract-seam)）是该约定的可加载形态：每个上下文只允许一个实现，重复加载会抛出异常；后端在其构造函数中组合 seam 的 `TelemetryCoordinator`，以此装配捕获侧。

## 脱敏 waterfall：`telemetry/record`

每条记录在投影与 `emit()` 之间都要经过 `telemetry/record` [waterfall](../cordis-primer.md#cordis-waterfall-semantics)（[事件条目](#telemetryrecord--waterfall)）。seam 自身不带任何规则：未挂载监听器时，记录以捕获时的原样到达后端；导出数据能干净到什么程度，恰恰取决于部署方挂载了什么规则。监听器通过变换 `next()` 的返回值来堆叠；不调用 `next()` 就返回，即替换其下方的全部逻辑；抛出异常的监听器会在协调器的隔离范围内以 fail-closed 方式扣下这一条记录。脱敏只作用于导出副本；权威会话日志永不改写。

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
