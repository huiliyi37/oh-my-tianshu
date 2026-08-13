/**
 * OpenTelemetry Service provider for the DeepSeek Harness telemetry capability.
 *
 * Composes the OTel JS SDK as-is — a `LoggerProvider` with a
 * `BatchLogRecordProcessor` and an OTLP/HTTP log exporter — and maps each
 * record handed over by the capture coordinator onto `logger.emit()`. Per the Service Definition's
 * boundary axiom, everything downstream of that call (batching, retry,
 * queueing, loss policy) is the SDK's documented behavior, configured
 * verbatim through the `exporter`/`processor` passthroughs. This package owns
 * capture mode and an outer shutdown deadline: the SDK's export timeout does
 * not bound its preceding `forceFlush()` wait.
 *
 * @module @deepseek-ai/dsh-session-telemetry-otel
 */

import { createRequire } from 'node:module'
import z from 'schemastery'
import type { Context } from 'cordis'
import type {} from '@deepseek-ai/dsh-command-feedback'
import {
  Telemetry,
  TelemetryCoordinator,
  type TelemetryBackend,
  type TelemetryRecord,
  type TelemetrySeverity,
} from '@deepseek-ai/dsh-session-telemetry'
import { APP_IDENTITY } from '@deepseek-ai/dsh-llm'
import { getOrCreateAnonymousUserId } from './user-id.ts'
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type BatchLogRecordProcessorOptions,
} from '@opentelemetry/sdk-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import type { OTLPExporterNodeConfigBase } from '@opentelemetry/otlp-exporter-base'
import { SeverityNumber, type AnyValue, type Logger } from '@opentelemetry/api-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'

// The package's own manifest is the single source of the instrumentation-scope
// version (same pattern as dsh-llm's attribution identity).
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

/** Session-sharing policy selected by {@link Config.mode}. */
export enum TelemetryMode {
  FULL = 'FULL',
  FEEDBACK_ONLY = 'FEEDBACK_ONLY',
  DISABLED = 'DISABLED',
}

/** Default session-sharing policy for schema and direct construction. */
export const DEFAULT_TELEMETRY_MODE = TelemetryMode.FULL

const DISABLED_FEEDBACK_WARNING = 'session telemetry is DISABLED; nothing will be shared and this feedback remains local'
const NON_CANONICAL_FEEDBACK_WARNING = 'session telemetry ignored a feedback event absent from the canonical session log'
const DROP_RECORD: TelemetryBackend['emit'] = () => {}

/** Resolve the default and reject unknown runtime values before transport setup. */
function resolveMode(mode: TelemetryMode | undefined): TelemetryMode {
  const resolved = mode ?? DEFAULT_TELEMETRY_MODE
  switch (resolved) {
    case TelemetryMode.FULL:
    case TelemetryMode.FEEDBACK_ONLY:
    case TelemetryMode.DISABLED:
      return resolved
    default:
      return assertNever(resolved)
  }
}

/** Fail closed when direct construction bypasses the runtime config schema. */
function assertNever(value: never): never {
  throw new Error(`session-telemetry-otel: unsupported mode ${JSON.stringify(value)}`)
}

/**
 * Plugin configuration: one sharing policy, two verbatim SDK option shapes,
 * and one DSH-owned shutdown bound. Uploading modes validate their endpoint
 * and shutdown deadline at plugin load; `DISABLED` reads neither.
 */
export interface Config {
  /** Sharing policy; defaults to immediate `FULL` delivery. */
  mode?: TelemetryMode
  /**
   * Passed verbatim to the SDK's OTLP/HTTP log exporter — the complete
   * `OTLPExporterNodeConfigBase` shape (`headers`, `timeoutMillis`,
   * `compression`, `keepAlive`, …), owned and documented by the SDK. `url`
   * is the one field this package requires and validates itself.
   */
  exporter?: OTLPExporterNodeConfigBase & {
    /** Full logs endpoint (e.g. `https://collector.example.com/v1/logs`). Required outside `DISABLED`; validated at load. */
    url?: string
  }
  /**
   * Passed verbatim to `BatchLogRecordProcessor` (minus the exporter slot,
   * which this plugin fills); the SDK owns and documents these knobs.
   */
  processor?: Omit<BatchLogRecordProcessorOptions, 'exporter'>
  /** Maximum time spent awaiting the SDK provider's complete shutdown path. */
  shutdownTimeoutMillis?: number
}

/**
 * Schemastery validator for {@link Config}; cordis runs it before the plugin
 * starts. Shape-level only — load-bearing value checks live in the constructor
 * so their errors name the fields. Both SDK slots are opaque passthroughs:
 * the SDK owns their shapes and validates its own options;
 * re-declaring them field-by-field here would violate the boundary axiom
 * (and silently drop every field not re-declared).
 */
export const Config: z<Config> = z.object({
  mode: z.union(Object.values(TelemetryMode)).default(DEFAULT_TELEMETRY_MODE),
  exporter: z.any(),
  processor: z.any(),
  shutdownTimeoutMillis: z.number(),
})

/** Default outer allowance for the SDK's complete shutdown sequence. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MILLIS = 3_000

// Node clamps larger timer delays to one millisecond. This is a runtime
// protocol limit, not a deployment default.
const MAX_TIMER_DELAY_MILLIS = 2_147_483_647

/** Severity mapping from the Service Definition's three-level vocabulary to OTel severity numbers. */
const SEVERITY: Record<TelemetrySeverity, { severityNumber: SeverityNumber; severityText: string }> = {
  info: { severityNumber: SeverityNumber.INFO, severityText: 'INFO' },
  warn: { severityNumber: SeverityNumber.WARN, severityText: 'WARN' },
  error: { severityNumber: SeverityNumber.ERROR, severityText: 'ERROR' },
}

/**
 * The backend plugin — the only entry a deployment loads. It always registers
 * the `telemetry` service (duplicate load throws). Uploading modes wire the SDK
 * pipeline and compose {@link TelemetryCoordinator}; `DISABLED` constructs no
 * SDK state and listens only to warn when recorded feedback stays local.
 */
export class TelemetryOtel extends Telemetry {
  static inject = ['sessions']
  static Config = Config

  private readonly directEmit: TelemetryBackend['emit']
  private readonly provider: LoggerProvider | undefined
  private readonly shutdownTimeoutMillis: number

  constructor(ctx: Context, config: Config) {
    const mode = resolveMode(config.mode)
    super(ctx)
    if (mode === TelemetryMode.DISABLED) {
      this.directEmit = DROP_RECORD
      this.provider = undefined
      this.shutdownTimeoutMillis = DEFAULT_SHUTDOWN_TIMEOUT_MILLIS
      ctx.on('session/event', (_session, event) => {
        if (event.type === 'feedback/record') ctx.logger.warn(DISABLED_FEEDBACK_WARNING)
      })
      return
    }

    const url = config.exporter?.url
    if (url === undefined || url.length === 0) {
      throw new Error('session-telemetry-otel: exporter.url is required (the full OTLP logs endpoint)')
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      // Re-thrown as a config error: the only way here is a malformed url string.
      throw new Error(`session-telemetry-otel: exporter.url is not a valid URL: ${JSON.stringify(url)}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`session-telemetry-otel: exporter.url must be http(s), got ${parsed.protocol}`)
    }
    // The one processor field checked beyond the SDK's own validation: the
    // SDK accepts a non-positive batch size, but its shutdown drain then
    // splices empty batches without consuming the queue — dispose would hang
    // forever with records queued. Misconfiguration fails at load instead.
    const batchSize = config.processor?.maxExportBatchSize
    if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
      throw new Error(`session-telemetry-otel: processor.maxExportBatchSize must be a positive integer, got ${String(batchSize)}`)
    }
    const shutdownTimeoutMillis = config.shutdownTimeoutMillis ?? DEFAULT_SHUTDOWN_TIMEOUT_MILLIS
    if (!Number.isFinite(shutdownTimeoutMillis) || shutdownTimeoutMillis <= 0 || shutdownTimeoutMillis > MAX_TIMER_DELAY_MILLIS) {
      throw new Error(`session-telemetry-otel: shutdownTimeoutMillis must be a positive finite number no greater than ${MAX_TIMER_DELAY_MILLIS}, got ${String(shutdownTimeoutMillis)}`)
    }
    this.shutdownTimeoutMillis = shutdownTimeoutMillis
    this.provider = new LoggerProvider({
      resource: resourceFromAttributes({
        'service.name': APP_IDENTITY.product,
        'service.version': APP_IDENTITY.version,
        // OTel semconv's standard user attribute, carried once per export
        // batch on the Resource rather than per record: the collector
        // aggregates by Resource, and the id is process-stable anyway.
        'user.id': getOrCreateAnonymousUserId(),
      }),
      processors: [
        new BatchLogRecordProcessor({
          ...config.processor,
          // The complete validated exporter object, verbatim: every SDK
          // option (`timeoutMillis`, `compression`, `keepAlive`, …) reaches
          // the exporter — rebuilding selected fields here would silently
          // ignore the rest. App identity travels in the Resource
          // (service.name/version); the transport-level user-agent is the
          // SDK's own, per the axiom.
          exporter: new OTLPLogExporter(config.exporter),
        }),
      ],
    })
    const ledger = this.provider.getLogger('@deepseek-ai/dsh-session-telemetry-otel', version)
    const ops = this.provider.getLogger('@deepseek-ai/dsh-session-telemetry-otel/ops', version)
    const enqueue: TelemetryBackend['emit'] = (record) => {
      const logger: Logger = record.channel === 'ops' ? ops : ledger
      logger.emit({
        timestamp: record.time,
        observedTimestamp: record.time,
        ...SEVERITY[record.severity],
        // JSON-serializable by the seam's contract (validated at Session.append),
        // which is exactly the AnyValue subset.
        body: record.body as AnyValue,
        attributes: record.attributes,
      })
    }
    const backend: TelemetryBackend = {
      emit: enqueue,
      shutdown: () => this.shutdown(),
    }
    if (mode === TelemetryMode.FULL) {
      this.directEmit = enqueue
      new TelemetryCoordinator(ctx, backend, 'live')
      return
    }
    this.directEmit = DROP_RECORD
    const coordinator = new TelemetryCoordinator(ctx, backend, 'on-demand')
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'feedback/record') return
      // Consent is the committed record, not an independently emitted bus value.
      if (session.events[event.seq] !== event) {
        ctx.logger.warn(NON_CANONICAL_FEEDBACK_WARNING)
        return
      }
      coordinator.captureSession(session, event.seq)
    })
  }

  /**
   * Hand a direct service record to the SDK only in `FULL`. Direct calls are
   * no-ops in `FEEDBACK_ONLY` and `DISABLED`; feedback replay uses a private
   * backend capability created only for the canonical feedback listener.
   * @param record - the logical record offered directly to the service.
   */
  emit(record: TelemetryRecord): void {
    this.directEmit(record)
  }

  // The Service Definition's optional flush() hint is deliberately NOT implemented. The
  // batch processor exports on its own cadence (`processor.scheduledDelayMillis`,
  // the SDK's documented knob), and this backend is the SDK pipeline's only
  // caller — forwarding the hint to `forceFlush()` was the sole source of
  // concurrent flushes, whose undocumented interactions with shutdown's
  // internal drain (concurrent-flush guard, provider-level flush timeout)
  // silently dropped tail records. Removal history and the revival trigger:
  // the revival Agent Note.

  /**
   * Ask the SDK to drain and quiesce, but reject after the backend-owned
   * deadline. OTel's processor export timeout wraps `exportCompleted` only;
   * shutdown awaits `exporter.forceFlush()` first, which can remain pending
   * when the transport never obtains a socket. The provider promise remains
   * observed after the deadline so a later rejection cannot become unhandled.
   * `DISABLED` has no provider and resolves immediately.
   * @returns resolves when the SDK pipeline quiesces or is disabled, or rejects at the configured deadline.
   */
  async shutdown(): Promise<void> {
    if (this.provider === undefined) return
    const providerShutdown = this.provider.shutdown()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`session-telemetry-otel: provider shutdown exceeded ${this.shutdownTimeoutMillis}ms`))
      }, this.shutdownTimeoutMillis)
    })
    try {
      await Promise.race([providerShutdown, deadline])
    } finally {
      /* v8 ignore else -- the Promise executor assigns timer synchronously before this race starts. */
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

export default TelemetryOtel
