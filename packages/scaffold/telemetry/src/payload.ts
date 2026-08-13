/**
 * Telemetry payload assembly.
 *
 * The payload carries the command lifecycle plus the FULL redacted content of
 * the project `cordis.yml` and `package.json`. It NEVER reads or includes `.env`
 * — secrets live only in `.env`, and the redactor is the backstop for any that
 * leak into the two reported files. A file that does not exist (the first
 * `create` run) simply omits its field, and `package.json` ships only when
 * `cordis.yml` is present: without it the directory is not an SDK project, and
 * its manifest belongs to whatever unrelated project the command ran in.
 *
 * @module @deepseek-ai/dsh-telemetry/payload
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SecretRedactor } from './secret-redactor.ts'

/** Project files whose full (redacted) content ships with the payload. */
const REPORTED_FILES = ['cordis.yml', 'package.json'] as const

/** One command's telemetry payload. */
export interface TelemetryPayload {
  /** The dsh-sdk command that ran (`start`/`dev`/`build`/`config`/`create`). */
  command: string
  /** Wall-clock duration of the command in milliseconds. */
  durationMs: number
  /** Whether the command completed without error. */
  success: boolean
  /** Redacted full text of the project `cordis.yml`, absent when the file does not exist. */
  cordisYmlContent?: string
  /** Redacted full text of the project `package.json`, absent when it or `cordis.yml` does not exist. */
  packageJsonContent?: string
}

/** Inputs for {@link buildTelemetryPayload}. */
export interface BuildTelemetryPayloadInput {
  /** The dsh-sdk command that ran. */
  command: string
  /** Wall-clock duration of the command in milliseconds. */
  durationMs: number
  /** Whether the command completed without error. */
  success: boolean
  /** Project root whose `cordis.yml` and `package.json` are read. */
  projectDir: string
  /** Redactor applied to reported file content; defaults to a fresh {@link SecretRedactor}. */
  redactor?: SecretRedactor
}

/** Read a project file's text, returning `undefined` when it cannot be read. */
async function readReportedFile(projectDir: string, name: string): Promise<string | undefined> {
  try {
    return await readFile(join(projectDir, name), 'utf8')
  } catch {
    // Missing/unreadable reported file: telemetry omits the field rather than fail.
    return undefined
  }
}

/**
 * Assemble a redacted telemetry payload for one command invocation.
 * @param input - command lifecycle facts, project directory, and optional redactor.
 * @returns the payload with redacted `cordis.yml`/`package.json` content.
 */
export async function buildTelemetryPayload(input: BuildTelemetryPayloadInput): Promise<TelemetryPayload> {
  const redactor = input.redactor ?? new SecretRedactor()
  const [cordisYml, packageJson] = await Promise.all(
    REPORTED_FILES.map(name => readReportedFile(input.projectDir, name)),
  )
  return {
    command: input.command,
    durationMs: input.durationMs,
    success: input.success,
    ...cordisYml === undefined ? {} : { cordisYmlContent: redactor.redactText(cordisYml) },
    // package.json is an SDK-project manifest only alongside cordis.yml; a
    // command run in an arbitrary directory must not upload that directory's
    // unrelated manifest.
    ...cordisYml !== undefined && packageJson !== undefined
      ? { packageJsonContent: redactor.redactText(packageJson) }
      : {},
  }
}
