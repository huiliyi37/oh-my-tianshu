/**
 * Enforce physical line-count ceilings from
 * `scripts/source-budgets.manifest.json` on named monolith source files.
 * The manifest is a ratchet: each ceiling sits at the file's known size, so
 * splits lower it over time while any growth needs a manifest edit in the
 * same PR, keeping expansion review-visible. Missing files and invalid
 * ceilings fail; `--list` reports current usage. The roster names
 * hand-written logic monoliths only — generated catalogs and data-table
 * modules track API surface or data volume, not coupling, and stay
 * unbudgeted.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

const MANIFEST_PATH = resolve(root, 'scripts/source-budgets.manifest.json')

/**
 * Count physical lines the way `wc -l` does: one per newline, so a file with
 * the repo-mandated single trailing newline counts its visible lines exactly.
 * @param text - full file contents.
 * @returns the physical line count.
 */
export function countLines(text: string): number {
  if (text.length === 0) return 0
  const segments = text.split('\n').length
  return text.endsWith('\n') ? segments - 1 : segments
}

/** One manifest entry's verdict against the working tree. */
export interface SourceBudgetRow {
  path: string
  ceiling: number
  kind: 'ok' | 'over' | 'missing' | 'invalid'
  /** Current line count; undefined when the file is missing or the ceiling is malformed. */
  lines: number | undefined
  /** Human-readable failure; undefined exactly when `kind` is `'ok'`. */
  failure: string | undefined
}

/**
 * Evaluate every manifest entry against the tree under `rootDir`.
 * @param manifest - budgeted paths (relative to `rootDir`) and their ceilings.
 * @param rootDir - repository root the manifest paths resolve against.
 * @returns one row per manifest entry, in manifest order.
 */
export function evaluateSourceBudgets(manifest: Record<string, number>, rootDir: string): SourceBudgetRow[] {
  return Object.entries(manifest).map(([path, ceiling]) => {
    if (!Number.isInteger(ceiling) || ceiling <= 0) {
      return {
        path,
        ceiling,
        kind: 'invalid' as const,
        lines: undefined,
        failure: `${path}: ceiling must be a positive integer, got ${ceiling}`,
      }
    }
    const abs = resolve(rootDir, path)
    if (!existsSync(abs)) {
      return {
        path,
        ceiling,
        kind: 'missing' as const,
        lines: undefined,
        failure: `${path}: budgeted file does not exist (split, renamed, or deleted? update scripts/source-budgets.manifest.json in the same change)`,
      }
    }
    const lines = countLines(readFileSync(abs, 'utf8'))
    if (lines > ceiling) {
      return {
        path,
        ceiling,
        kind: 'over' as const,
        lines,
        failure: `${path}: ${lines} lines exceeds the ${ceiling}-line ceiling — split the module along its seams instead of growing it (raising the ceiling requires editing scripts/source-budgets.manifest.json with justification in the PR)`,
      }
    }
    return { path, ceiling, kind: 'ok' as const, lines, failure: undefined }
  })
}

// Run only when invoked as a script, not when imported by the spec.
if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, number>
  const rows = evaluateSourceBudgets(manifest, root)

  if (process.argv.includes('--list')) {
    const label = { ok: 'ok  ', over: 'OVER', missing: 'MISS', invalid: 'BAD ' } as const
    for (const row of rows) {
      console.log(`${label[row.kind]}  ${String(row.lines ?? '—').padStart(6)} / ${String(row.ceiling).padEnd(6)} ${row.path}`)
    }
    process.exit(0)
  }

  const failures = rows.filter(row => row.failure !== undefined)
  if (failures.length > 0) {
    console.error('verify-source-budgets failed:\n')
    for (const row of failures) console.error(`  ${row.failure}`)
    console.error('\nNamed monoliths only shrink: split along seams, or update scripts/source-budgets.manifest.json with justification in the same PR.')
    process.exit(1)
  }

  console.log(`verify-source-budgets: ${rows.length} budgeted source files within ceiling.`)
}
