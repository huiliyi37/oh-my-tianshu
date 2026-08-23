/**
 * Prefix fingerprinting: three-source SHA256 over the bytes that constitute a
 * provider's cached prefix (system text, tool schemas, call config), with
 * drift attribution for `request/header` changes. Adapted from the opencode-tui
 * upstream `src/prompt/fingerprint.ts` (system/tools/stableVolatile) with the
 * third source mapped to the harness call config (`header.config` +
 * `adapterDefaults`), which is the epoch-level state the loop already treats
 * as cache-reuse sensitive (`@huiliyi37/dsh-llm` call-config).
 *
 * Pure module: callers serialize the config text; this module never touches
 * the session log or the service registry.
 *
 * @module @huiliyi37/dsh-cache-diagnostic/fingerprint
 */

import { createHash } from 'crypto'

/** SHA256 digests of the three prefix sources plus their composition. */
export interface PrefixFingerprint {
  systemSha256: string
  toolsSha256: string
  configSha256: string
  combinedSha256: string
}

/** Which of the three prefix sources changed since the baseline. */
export interface DriftEvent {
  systemChanged: boolean
  toolsChanged: boolean
  configChanged: boolean
  /** Human-readable attribution; joined from the changed source names. */
  message: string
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Tool schema serialization for the tools fingerprint. Order-independent (name
 * sort) so that a catalog reorder alone never counts as drift; content changes
 * (description/parameters) still change the digest.
 * @param tools - the tool schemas of one request header; `undefined` or empty hash identically.
 * @returns the canonical serialized form, or the empty string for an empty catalog.
 */
function serializeTools(tools: readonly { name: string }[] | undefined): string {
  if (tools === undefined || tools.length === 0) return ''
  return JSON.stringify(
    [...tools].sort((a, b) => a.name.localeCompare(b.name)),
  )
}

/**
 * Compute the three-source fingerprint of one request header's prefix bytes.
 * @param systemText - the assembled system prompt (empty string when absent).
 * @param tools - the request's tool schemas, or undefined when the catalog is empty.
 * @param configText - canonical serialization of the call config (`provider`/`model`/`reasoningEffort`/`maxTokens` and adapter defaults).
 * @returns the detached fingerprint.
 */
export function computeFingerprint(
  systemText: string,
  tools: readonly { name: string }[] | undefined,
  configText: string,
): PrefixFingerprint {
  const systemSha256 = sha256(systemText)
  const toolsSha256 = sha256(serializeTools(tools))
  const configSha256 = sha256(configText)
  const combinedSha256 = sha256(`${systemSha256}:${toolsSha256}:${configSha256}`)
  return { systemSha256, toolsSha256, configSha256, combinedSha256 }
}

/**
 * Compare a baseline fingerprint against a current one and attribute the
 * drift, if any.
 * @param baseline - the fingerprint recorded at an earlier header.
 * @param current - the fingerprint of the current header.
 * @returns the drift event, or null when the combined digest is unchanged.
 */
export function detectDrift(
  baseline: PrefixFingerprint,
  current: PrefixFingerprint,
): DriftEvent | null {
  if (baseline.combinedSha256 === current.combinedSha256) return null

  const systemChanged = baseline.systemSha256 !== current.systemSha256
  const toolsChanged = baseline.toolsSha256 !== current.toolsSha256
  const configChanged = baseline.configSha256 !== current.configSha256

  const parts: string[] = []
  if (systemChanged) parts.push('system prompt')
  if (toolsChanged) parts.push('tool definitions')
  if (configChanged) parts.push('call config')
  const message = `Prefix cache drift detected: ${parts.join(' and ')} changed`

  return { systemChanged, toolsChanged, configChanged, message }
}
