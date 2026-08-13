/**
 * Launcher-side telemetry wiring: resolve consent and send one fire-and-forget
 * event around each dsh-sdk command. Best-effort — never affects the command's
 * outcome or exit code.
 *
 * @module @deepseek-ai/dsh-scripts/telemetry
 */

import {
  ConsentResolver,
  TelemetryReporter,
  buildTelemetryPayload,
  type ConsentDecision,
} from '@deepseek-ai/dsh-telemetry'

/** One command's telemetry lifecycle facts. */
export interface CommandTelemetryEvent {
  /** The dsh-sdk command that ran. */
  command: string
  /** Project directory whose consent, `cordis.yml`, and `package.json` are read. */
  cwd: string
  /** Wall-clock duration in milliseconds. */
  durationMs: number
  /** Whether the command completed without error. */
  success: boolean
}

/** Injectable consent and delivery hooks for tests. */
export interface CommandTelemetryDeps {
  resolve?: (cwd: string) => Promise<ConsentDecision>
  reporter?: Pick<TelemetryReporter, 'report' | 'flush'>
}

/**
 * Resolve consent for the project and, when allowed, assemble and send one
 * telemetry event, draining in-flight sends before returning. Swallows every
 * error so telemetry can never change a command's result.
 * @param event - the command lifecycle facts.
 * @param deps - Consent and delivery hooks; defaults hit the real endpoint.
 */
export async function reportCommandTelemetry(
  event: CommandTelemetryEvent,
  deps: CommandTelemetryDeps = {},
): Promise<void> {
  try {
    /* v8 ignore next -- the production ConsentResolver is exercised by the built-bin smoke */
    const resolve = deps.resolve ?? (cwd => new ConsentResolver().resolve(cwd))
    const consent = await resolve(event.cwd)
    if (!consent.allowed) return
    const payload = await buildTelemetryPayload({
      command: event.command,
      durationMs: event.durationMs,
      success: event.success,
      projectDir: event.cwd,
    })
    /* v8 ignore next -- the production TelemetryReporter is exercised by the built-bin smoke */
    const reporter = deps.reporter ?? new TelemetryReporter()
    reporter.report(payload, consent)
    await reporter.flush()
  } catch {
    // Telemetry is best-effort; a consent, payload, or delivery fault never reaches the command.
  }
}
