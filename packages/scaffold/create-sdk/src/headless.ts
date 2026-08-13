/**
 * Headless create input: a structured project spec supplied by an agent or CI
 * instead of interactive prompts.
 *
 * @module @deepseek-ai/create-sdk/headless
 */

import { readFile } from 'node:fs/promises'
import type { FeatureSelection, PackageManagerName, RunInterface } from '@deepseek-ai/dsh-helper'
import type { CreateArgs } from './args.ts'

/**
 * Structured, non-interactive create input. Scalar fields mirror {@link CreateArgs}
 * project answers; `features` is the headless feature plan handed to `CreateWizard`
 * (the interactive tree/suggests prompts are skipped). Absent required answers make
 * the run fail loud through `HeadlessPromptPort` rather than blocking.
 */
interface HeadlessCreateSpec {
  directory?: string
  description?: string
  provider?: 'deepseek-official' | 'custom'
  baseURL?: string
  apiKey?: string
  model?: string
  interface?: RunInterface
  pm?: PackageManagerName
  install?: boolean
  linkWorkspace?: boolean
  features?: readonly FeatureSelection[]
}

/** Resolved headless input: the args the wizard reads plus the feature plan. */
export interface ResolvedHeadless {
  args: CreateArgs
  features: readonly FeatureSelection[] | undefined
}

function asRecord(value: unknown, source: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source}: expected a JSON object`)
  }
  return value as Record<string, unknown>
}

/** Parse and shallow-validate a headless spec from JSON text. */
function parseHeadlessSpec(text: string, source: string): HeadlessCreateSpec {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    /* v8 ignore next -- JSON.parse only throws Error instances; the String() branch is defensive */
    throw new Error(`${source}: invalid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  const record = asRecord(parsed, source)
  if (record.features !== undefined && !Array.isArray(record.features)) {
    throw new Error(`${source}: "features" must be an array`)
  }
  return record
}

/**
 * Load a headless spec from `--config-json` (inline) or `--config` (a JSON file),
 * returning `undefined` when neither is supplied.
 * @param args - parsed create args.
 * @param readFileText - File-reader hook for tests.
 * @returns the resolved args + feature plan, or `undefined` for interactive runs.
 */
export async function resolveHeadless(
  args: CreateArgs,
  readFileText: (path: string) => Promise<string> = path => readFile(path, 'utf8'),
): Promise<ResolvedHeadless | undefined> {
  let text: string
  let source: string
  if (args.configJson !== undefined) {
    text = args.configJson
    source = '--config-json'
  } else if (args.config !== undefined) {
    source = args.config
    text = await readFileText(args.config)
  } else {
    return undefined
  }
  const spec = parseHeadlessSpec(text, source)
  const resolvedArgs: CreateArgs = {
    ...spec.directory === undefined ? {} : { directory: spec.directory },
    ...spec.description === undefined ? {} : { description: spec.description },
    ...spec.provider === undefined ? {} : { provider: spec.provider },
    ...spec.baseURL === undefined ? {} : { baseURL: spec.baseURL },
    ...spec.apiKey === undefined ? {} : { apiKey: spec.apiKey },
    ...spec.model === undefined ? {} : { model: spec.model },
    ...spec.interface === undefined ? {} : { runInterface: spec.interface },
    ...spec.pm === undefined ? {} : { packageManager: spec.pm },
    ...spec.install === undefined ? {} : { install: spec.install },
    ...spec.linkWorkspace ? { linkWorkspace: true } : {},
    help: false,
  }
  return { args: resolvedArgs, features: spec.features }
}
