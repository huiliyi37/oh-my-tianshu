/**
 * Launcher-side telemetry for the dsh-sdk toolchain: secret redaction, consent
 * resolution, anonymous id, payload assembly, and a fire-and-forget reporter.
 *
 * This package is a plain library the launcher imports around each command — it
 * is NOT a Cordis plugin (several commands never boot Cordis). Wiring it into
 * the launcher command dispatch and the helper feature catalog lives outside
 * this package.
 *
 * FIXME: rename to `@deepseek-ai/dsh-sdk-telemetry` before the first tagged release —
 * the current name collides with the `dsh-session-telemetry` family; this is
 * launcher-side SDK telemetry
 * ([regrouping Agent Note](../../../../.agents/notes/implemented/architecture/2026-07-29-package-regrouping.md)).
 *
 * @module @deepseek-ai/dsh-telemetry
 */

export {
  DEFAULT_ENTROPY_THRESHOLD,
  DEFAULT_MIN_TOKEN_LENGTH,
  DEFAULT_REDACTION_PLACEHOLDER,
  SecretRedactor,
  keyLooksSecret,
} from './secret-redactor.ts'
export type { SecretRedactorOptions } from './secret-redactor.ts'
export {
  ConsentResolver,
  DEFAULT_TELEMETRY_PLUGIN_NAME,
} from './consent-resolver.ts'
export type {
  ConsentDecision,
  ConsentReason,
  ConsentResolverOptions,
} from './consent-resolver.ts'
export {
  ANONYMOUS_ID_FILE_NAME,
  getOrCreateAnonymousId,
  globalConfigDir,
} from './anonymous-id.ts'
export type { AnonymousId, AnonymousIdOptions } from './anonymous-id.ts'
export { buildTelemetryPayload } from './payload.ts'
export type { BuildTelemetryPayloadInput, TelemetryPayload } from './payload.ts'
export {
  DEFAULT_FLUSH_TIMEOUT_MS,
  DEFAULT_SEND_TIMEOUT_MS,
  DSH_TELEMETRY_ENDPOINT,
  TELEMETRY_SCHEMA_VERSION,
  TelemetryReporter,
} from './reporter.ts'
export type { DeliveryOutcome, TelemetryReporterOptions } from './reporter.ts'
