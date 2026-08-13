/**
 * Fire-and-forget telemetry reporter for the dsh-sdk launcher.
 *
 * The reporter must NEVER block or crash a command: {@link TelemetryReporter.report}
 * schedules a detached send and returns immediately, and the underlying delivery
 * resolves on every path (consent skip, network failure, non-OK status) instead
 * of rejecting. {@link TelemetryReporter.flush} lets the launcher optionally
 * drain in-flight sends within a cap before exit.
 *
 * @module @huiliyi37/dsh-telemetry/reporter
 */

import type { ConsentDecision } from './consent-resolver.ts'
import type { TelemetryPayload } from './payload.ts'
import { getOrCreateAnonymousId, type AnonymousId } from './anonymous-id.ts'
import { SecretRedactor } from './secret-redactor.ts'

/**
 * Fail-safe placeholder collection endpoint. The `.invalid` TLD guarantees
 * delivery fails harmlessly until a collector is deployed. This is a fixed
 * protocol constant, not a deployment tunable.
 */
// TODO(telemetry-endpoint): Replace the placeholder before release.
export const DSH_TELEMETRY_ENDPOINT = 'https://telemetry.example.invalid/v1/dsh-sdk'

/** Wire-envelope schema version; bump on any incompatible body change. */
export const TELEMETRY_SCHEMA_VERSION = 1

/** Default per-request send timeout in milliseconds. */
export const DEFAULT_SEND_TIMEOUT_MS = 3000

/** Default cap for {@link TelemetryReporter.flush} in milliseconds. */
export const DEFAULT_FLUSH_TIMEOUT_MS = 2000

/** Outcome of one delivery attempt; delivery never rejects. */
export type DeliveryOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'sent' }
  | { status: 'failed'; error: string }

/** The JSON body posted to the telemetry endpoint. */
interface TelemetryEnvelope extends TelemetryPayload {
  schemaVersion: number
  anonymousId: AnonymousId
  sentAt: string
}

/** Injectable dependencies for {@link TelemetryReporter}; every field has a default. */
export interface TelemetryReporterOptions {
  /** Collection endpoint; defaults to {@link DSH_TELEMETRY_ENDPOINT}. */
  endpoint?: string
  /** `fetch` implementation; defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch
  /** Anonymous-id provider; defaults to {@link getOrCreateAnonymousId}. */
  anonymousId?: () => Promise<AnonymousId>
  /** Redactor applied to the assembled envelope as a final backstop; defaults to a fresh {@link SecretRedactor}. */
  redactor?: SecretRedactor
  /** Per-request send timeout in milliseconds. */
  timeoutMs?: number
  /** Clock for the envelope timestamp; defaults to `Date.now`. */
  now?: () => number
}

/** Sends telemetry payloads fire-and-forget, swallowing every failure. */
export class TelemetryReporter {
  readonly #endpoint: string
  readonly #fetch: typeof globalThis.fetch
  readonly #anonymousId: () => Promise<AnonymousId>
  readonly #redactor: SecretRedactor
  readonly #timeoutMs: number
  readonly #now: () => number
  readonly #inflight = new Set<Promise<DeliveryOutcome>>()

  /** @param options - endpoint, transport, id provider, and timing dependencies. */
  constructor(options: TelemetryReporterOptions = {}) {
    this.#endpoint = options.endpoint ?? DSH_TELEMETRY_ENDPOINT
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#anonymousId = options.anonymousId ?? getOrCreateAnonymousId
    this.#redactor = options.redactor ?? new SecretRedactor()
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS
    this.#now = options.now ?? Date.now
  }

  /**
   * Schedule a detached, non-blocking send. Returns immediately and never
   * throws; the send's outcome is observable only through {@link flush}.
   * @param payload - the command payload to report.
   * @param consent - resolved consent; a denial short-circuits to a skip.
   */
  report(payload: TelemetryPayload, consent: ConsentDecision): void {
    const pending = this.#deliver(payload, consent)
    this.#inflight.add(pending)
    void pending.finally(() => { return this.#inflight.delete(pending) })
  }

  /**
   * Await in-flight sends up to a timeout so a caller can drain before exit.
   * Resolves on the cap regardless of send progress; never rejects.
   * @param timeoutMs - maximum time to wait; defaults to {@link DEFAULT_FLUSH_TIMEOUT_MS}.
   */
  async flush(timeoutMs: number = DEFAULT_FLUSH_TIMEOUT_MS): Promise<void> {
    if (this.#inflight.size === 0) return
    const drained = Promise.allSettled([...this.#inflight]).then(() => undefined)
    let timer!: ReturnType<typeof setTimeout>
    const capped = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    })
    try {
      await Promise.race([drained, capped])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Deliver one payload, resolving to an outcome on every path (never rejects). */
  async #deliver(payload: TelemetryPayload, consent: ConsentDecision): Promise<DeliveryOutcome> {
    if (!consent.allowed) return { status: 'skipped', reason: consent.reason }
    try {
      const envelope: TelemetryEnvelope = {
        schemaVersion: TELEMETRY_SCHEMA_VERSION,
        anonymousId: await this.#anonymousId(),
        sentAt: new Date(this.#now()).toISOString(),
        ...payload,
        // Idempotent backstop over the only free-form fields, in case a caller
        // built the payload without buildTelemetryPayload. Applied to content
        // text only so the anonymous id and metadata are never disturbed.
        ...payload.cordisYmlContent !== undefined
          ? { cordisYmlContent: this.#redactor.redactText(payload.cordisYmlContent) }
          : {},
        ...payload.packageJsonContent !== undefined
          ? { packageJsonContent: this.#redactor.redactText(payload.packageJsonContent) }
          : {},
      }
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
      if (!response.ok) return { status: 'failed', error: `HTTP ${response.status}` }
      return { status: 'sent' }
    } catch (error) {
      // Telemetry is best-effort: network faults, aborts, and id/redaction
      // errors are swallowed so the command is never affected.
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
  }
}
