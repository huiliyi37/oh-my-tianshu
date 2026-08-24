/**
 * Post-release npm-mirror propagation audit.
 *
 * npmmirror syncs per package on its own cadence and, for a low-traffic scope
 * published as one burst, strands a tail of packages at the previous version
 * (or never creates them). The anonymous `/-/sync` trigger is gone, so the
 * remedy is human: the package page's sync action. This script turns the
 * mirror state into that actionable list instead of letting CN users discover
 * the gap as `ETARGET`.
 *
 * Usage: tsx scripts/audit-mirror-sync.ts [--manifest <path>] [--mirror <url>]
 * Defaults: newest baseline manifest under `.artifacts/npm-baseline`, npmmirror.
 * Exit 1 when any package lags the manifest version.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

interface ManifestPackage {
  readonly name: string
  readonly version?: string
}

interface BaselineManifest {
  readonly version: string
  readonly packages: readonly ManifestPackage[]
}

const options = parseArgs(process.argv.slice(2))
const manifest = readManifest(options.manifest)
const mirror = options.mirror ?? 'https://registry.npmmirror.com'

const lagging: Array<{ name: string; state: string }> = []
let checked = 0
for (const pkg of manifest.packages) {
  const state = await latestOn(mirror, pkg.name)
  checked += 1
  if (state !== manifest.version) {
    lagging.push({ name: pkg.name, state: state === undefined ? 'missing' : state })
  }
}

console.log(`audit-mirror-sync: ${checked} package(s) checked against ${mirror} for ${manifest.version}.`)
if (lagging.length === 0) {
  console.log('audit-mirror-sync: mirror is complete.')
  process.exit(0)
}
console.log(`audit-mirror-sync: ${lagging.length} package(s) lag — trigger the sync action on each package page:`)
for (const entry of lagging) {
  console.log(`  ${entry.state === 'missing' ? 'missing' : `stuck at ${entry.state}`}: https://npmmirror.com/package/${entry.name}`)
}
process.exit(1)

interface AuditOptions {
  readonly manifest?: string
  readonly mirror?: string
}

function parseArgs(argv: readonly string[]): AuditOptions {
  const parsed: { manifest?: string; mirror?: string } = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === undefined || value === undefined || !flag.startsWith('--')) throw new Error(`audit-mirror-sync: expected --flag <value> pairs, got ${JSON.stringify(argv)}`)
    if (flag === '--manifest') parsed.manifest = value
    else if (flag === '--mirror') parsed.mirror = value
    else throw new Error(`audit-mirror-sync: unknown flag ${flag}`)
  }
  return parsed
}

/** Load the requested manifest, or the newest baseline artifact when omitted. */
function readManifest(explicit: string | undefined): BaselineManifest {
  const path = explicit ?? newestBaselineManifest()
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as BaselineManifest
  if (typeof manifest.version !== 'string' || !Array.isArray(manifest.packages)) {
    throw new Error(`audit-mirror-sync: ${path} is not a baseline manifest`)
  }
  return manifest
}

/** Newest `.artifacts/npm-baseline/<version>/manifest.json` by version sort. */
function newestBaselineManifest(): string {
  const root = resolve(import.meta.dirname, '../.artifacts/npm-baseline')
  if (!existsSync(root)) {
    throw new Error('audit-mirror-sync: no --manifest given and .artifacts/npm-baseline is absent (run a release first)')
  }
  const versions = readdirSync(root).filter(entry => existsSync(join(root, entry, 'manifest.json'))).sort()
  const newest = versions.at(-1)
  if (newest === undefined) throw new Error('audit-mirror-sync: no baseline manifest found under .artifacts/npm-baseline')
  return join(root, newest, 'manifest.json')
}

/** Latest dist version the mirror reports for one package; undefined when absent. */
async function latestOn(mirror: string, name: string): Promise<string | undefined> {
  const response = await fetch(`${mirror}/${name}`, { signal: AbortSignal.timeout(25_000) })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`audit-mirror-sync: ${name} answered HTTP ${response.status}`)
  const document = await response.json() as { versions?: Record<string, unknown> }
  const versions = Object.keys(document.versions ?? {})
  return versions.at(-1)
}
