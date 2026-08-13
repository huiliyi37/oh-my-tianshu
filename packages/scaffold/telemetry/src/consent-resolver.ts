/**
 * Consent resolution for dsh-sdk telemetry.
 *
 * Telemetry is OFF only when `cordis.yml` contains a telemetry entry that is
 * explicitly `disabled`; every other file state reports (no `cordis.yml`, an
 * enabled entry, or no telemetry entry at all). The resolver PARSES `cordis.yml`
 * — it never boots a Cordis application — because several launcher commands
 * (`build`, `create`) never boot Cordis at all. `DO_NOT_TRACK` and CI
 * environment signals force a denial regardless of file state.
 *
 * @module @deepseek-ai/dsh-telemetry/consent-resolver
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument, type ScalarTag } from 'yaml'

/** Default `cordis.yml` entry name that carries telemetry consent. */
export const DEFAULT_TELEMETRY_PLUGIN_NAME = '@deepseek-ai/dsh-telemetry'

/**
 * Passthrough for Cordis' `!!js` expression tag so parsing consent never fails
 * on projects that inline JavaScript expressions; the resolver only reads plain
 * `name`/`disabled` scalars and does not evaluate expressions.
 */
const JS_EXPRESSION_TAG: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: value => value,
}

/** Why telemetry is or is not permitted for one command. */
export type ConsentReason =
  | 'enabled'
  | 'disabled'
  | 'absent'
  | 'no-config'
  | 'do-not-track'
  | 'ci'
  | 'unreadable'

/** Resolved telemetry consent for one command invocation. */
export interface ConsentDecision {
  /** Whether telemetry may be sent. */
  allowed: boolean
  /** The signal that determined {@link allowed}. */
  reason: ConsentReason
}

/** Tuning for {@link ConsentResolver}; every field defaults to a documented value. */
export interface ConsentResolverOptions {
  /** `cordis.yml` entry name whose enabled state carries consent. */
  telemetryPluginName?: string
  /** Environment used for `DO_NOT_TRACK`/CI checks; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Honor `DO_NOT_TRACK`/CI env signals as a hard opt-out. Defaults to `true`. */
  honorEnvOptOut?: boolean
  /** Consent when `cordis.yml` does not exist yet (first `create`). Defaults to `true` (telemetry is default-on). */
  allowWhenNoConfig?: boolean
  /** Consent when `cordis.yml` exists but has no telemetry entry. Defaults to `true` (report unless a present entry is disabled). */
  allowWhenEntryAbsent?: boolean
}

/** Whether an environment variable is set to a non-empty, non-"0"/"false" value. */
function envEnabled(value: string | undefined): boolean {
  if (value === undefined) return false
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 && normalized !== '0' && normalized !== 'false'
}

/** Read a `cordis.yml` entry's `name`/`disabled` scalars, tolerating `!!js` tags. */
function readTelemetryEntry(text: string, pluginName: string): { present: boolean; disabled: boolean } {
  const document = parseDocument(text, { customTags: [JS_EXPRESSION_TAG] })
  const contents: unknown = document.toJS({ maxAliasCount: -1 })
  if (!Array.isArray(contents)) return { present: false, disabled: false }
  for (const entry of contents) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (record.name === pluginName) return { present: true, disabled: record.disabled === true }
  }
  return { present: false, disabled: false }
}

/** Resolve telemetry consent by parsing a project's `cordis.yml` and the environment. */
export class ConsentResolver {
  readonly #pluginName: string
  readonly #env: NodeJS.ProcessEnv
  readonly #honorEnvOptOut: boolean
  readonly #allowWhenNoConfig: boolean
  readonly #allowWhenEntryAbsent: boolean

  /** @param options - plugin name, environment, and default-decision knobs. */
  constructor(options: ConsentResolverOptions = {}) {
    this.#pluginName = options.telemetryPluginName ?? DEFAULT_TELEMETRY_PLUGIN_NAME
    this.#env = options.env ?? process.env
    this.#honorEnvOptOut = options.honorEnvOptOut ?? true
    this.#allowWhenNoConfig = options.allowWhenNoConfig ?? true
    this.#allowWhenEntryAbsent = options.allowWhenEntryAbsent ?? true
  }

  /**
   * Resolve consent for a command run in the given project directory.
   * @param projectDir - absolute or relative project root containing `cordis.yml`.
   * @returns the consent decision and the signal that produced it.
   */
  async resolve(projectDir: string): Promise<ConsentDecision> {
    if (this.#honorEnvOptOut) {
      if (envEnabled(this.#env.DO_NOT_TRACK)) return { allowed: false, reason: 'do-not-track' }
      if (envEnabled(this.#env.CI)) return { allowed: false, reason: 'ci' }
    }
    let text: string
    try {
      text = await readFile(join(projectDir, 'cordis.yml'), 'utf8')
    } catch (error) {
      // Missing cordis.yml is the first-init (`create`) path; any other read
      // fault is treated conservatively as its own reason.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { allowed: this.#allowWhenNoConfig, reason: 'no-config' }
      }
      return { allowed: false, reason: 'unreadable' }
    }
    const entry = readTelemetryEntry(text, this.#pluginName)
    if (!entry.present) { return { allowed: this.#allowWhenEntryAbsent, reason: 'absent' } }
    return entry.disabled ? { allowed: false, reason: 'disabled' } : { allowed: true, reason: 'enabled' }
  }
}
