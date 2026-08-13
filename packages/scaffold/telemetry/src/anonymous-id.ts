/**
 * Per-harness-home anonymous telemetry id.
 *
 * The id is a random UUID persisted directly in the harness home resolved by
 * {@link resolveDshHome} (`$DSH_HOME` > `~/.dsh`), and never derived from the
 * git remote, repository URL, or any other identifying source (a derived id
 * would make "anonymous" a fiction). The id is scoped to the harness home, not
 * the machine: every command sharing one `$DSH_HOME` reuses the same id, so the
 * default `~/.dsh` counts per-OS-user home directories, while a relocated
 * `$DSH_HOME` moves the id with the rest of the harness data — the single-root
 * convention this package shares, not a telemetry-specific policy.
 *
 * @module @deepseek-ai/dsh-telemetry/anonymous-id
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { resolveDshHome } from '@deepseek-ai/dsh-paths'

/** A harness-home-scoped anonymous telemetry id (random UUID v4). */
export type AnonymousId = Branded<'AnonymousId'>

/** Default file, inside the harness home, storing the anonymous id. */
export const ANONYMOUS_ID_FILE_NAME = 'telemetry.json'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ambient hooks for locating and generating the id; every field has a default. */
export interface AnonymousIdOptions {
  /** Environment consulted for `DSH_HOME`; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** UUID generator; defaults to `crypto.randomUUID` (test hook). */
  randomUUID?: () => string
}

/**
 * Resolve the single-root harness home that stores the anonymous id.
 * Delegates to {@link resolveDshHome} so telemetry shares the harness's one
 * home-resolution policy (`DSH_HOME` > `~/.dsh`) instead of maintaining a
 * second config-directory convention.
 * @param options - Environment hook.
 * @returns absolute harness home path.
 */
export function globalConfigDir(options: AnonymousIdOptions = {}): string {
  return resolveDshHome(undefined, options.env ?? process.env)
}

/** Read a valid persisted id from the store, or `undefined` when absent/corrupt. */
async function readPersistedId(file: string): Promise<AnonymousId | undefined> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    // Absent or unreadable: the caller mints and persists a fresh id.
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Corrupt JSON: the caller overwrites the store with a fresh id.
    return undefined
  }
  if (parsed !== null && typeof parsed === 'object') {
    const value = (parsed as Record<string, unknown>).anonymousId
    if (typeof value === 'string' && UUID_PATTERN.test(value)) return value as AnonymousId
  }
  return undefined
}

/**
 * Return the harness home's anonymous id, creating and persisting one on first use.
 * Persistence is best-effort: a write failure still returns a usable id for the
 * current run so telemetry is never blocked by config-dir permissions.
 * @param options - config-location and UUID-generation hooks.
 * @returns the stable per-harness-home anonymous id.
 */
export async function getOrCreateAnonymousId(options: AnonymousIdOptions = {}): Promise<AnonymousId> {
  const file = join(globalConfigDir(options), ANONYMOUS_ID_FILE_NAME)
  const existing = await readPersistedId(file)
  if (existing !== undefined) return existing
  const generate = options.randomUUID ?? randomUUID
  const created = generate() as AnonymousId
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify({ anonymousId: created }, null, 2)}\n`, 'utf8')
  } catch {
    // Best-effort persistence: return the fresh id even when the store is unwritable.
  }
  return created
}
