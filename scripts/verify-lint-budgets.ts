/**
 * Enforce per-file type-aware lint debt ceilings from
 * `scripts/lint-budgets.manifest.json` — a ratchet in the same spirit as
 * `source-budgets.manifest.json` (line ceilings) and
 * `doc-budgets.manifest.json` (documentation parity).
 *
 * The manifest lists files that are *allowed* to carry type-aware oxlint
 * diagnostics (the `typescript/*` rule family — the debt class this repo
 * reviews by hand) and how many. Any file not listed must have zero. Every
 * entry sits at the file's current count, so fixes lower it over time while
 * new debt needs a manifest edit in the same PR, keeping expansion
 * review-visible. Missing files and invalid allowances fail; `--list`
 * reports current usage.
 *
 * The full-repo `pnpm run lint` gate stays the authority for *all*
 * diagnostics; this ratchet exists to attribute type-aware debt per file and
 * to force explicit review before any new debt lands.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveOxlintInvocation, oxlintBinaryPath } from './run-oxlint.ts'

const root = resolve(import.meta.dirname, '..')

const MANIFEST_PATH = resolve(root, 'scripts/lint-budgets.manifest.json')

/** One raw oxlint JSON diagnostic (the fields this ratchet reads). */
export interface LintDiagnostic {
  /** Rule identifier in `family(rule)` form, e.g. `typescript(no-unnecessary-condition)`. */
  code: string
  /** Path relative to the invocation cwd (the repo root for repo runs). */
  filename: string
}

/** Whether a diagnostic belongs to the type-aware family this ratchet tracks. */
export function isTypeAware(code: string): boolean {
  return code.startsWith('typescript(')
}

/**
 * Aggregate diagnostics per file, type-aware family only.
 * @param diagnostics - raw diagnostics (any family; non-type-aware ignored).
 * @returns filename → type-aware diagnostic count.
 */
export function countByFile(diagnostics: readonly LintDiagnostic[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const d of diagnostics) {
    if (!isTypeAware(d.code)) continue
    counts.set(d.filename, (counts.get(d.filename) ?? 0) + 1)
  }
  return counts
}

/** One manifest entry's verdict against the reported diagnostics. */
export interface LintBudgetRow {
  path: string
  allowance: number
  actual: number
  kind: 'ok' | 'over' | 'invalid'
  /** Human-readable failure; undefined exactly when `kind` is `'ok'`. */
  failure: string | undefined
}

/**
 * Evaluate per-file allowances against type-aware diagnostic counts.
 * Files absent from the manifest have a zero allowance; every manifest path
 * with diagnostics is checked regardless of direction (a listed allowance
 * with no diagnostics passes — it just sits high).
 * @param allowances - manifest: relative path → allowed type-aware count.
 * @param diagnostics - raw oxlint diagnostics.
 * @returns one row per manifest entry, plus an `over` row per unlisted file
 *   that carries diagnostics.
 */
export function evaluateLintBudgets(
  allowances: Record<string, number>,
  diagnostics: readonly LintDiagnostic[],
): LintBudgetRow[] {
  const counts = countByFile(diagnostics)
  const rows: LintBudgetRow[] = []
  for (const [path, allowance] of Object.entries(allowances)) {
    if (!Number.isInteger(allowance) || allowance < 0) {
      rows.push({
        path,
        allowance,
        actual: 0,
        kind: 'invalid' as const,
        failure: `${path}: allowance must be a non-negative integer, got ${allowance}`,
      })
      continue
    }
    const actual = counts.get(path) ?? 0
    if (actual > allowance) {
      rows.push({
        path,
        allowance,
        actual,
        kind: 'over' as const,
        failure: `${path}: ${actual} type-aware lint diagnostics exceed the ${allowance} allowance — fix them, or raise the allowance in scripts/lint-budgets.manifest.json with justification in the same PR`,
      })
      continue
    }
    rows.push({ path, allowance, actual, kind: 'ok' as const, failure: undefined })
  }
  for (const [path, actual] of counts) {
    if (!(path in allowances) && actual > 0) {
      rows.push({
        path,
        allowance: 0,
        actual,
        kind: 'over' as const,
        failure: `${path}: ${actual} type-aware lint diagnostics but no allowance — every file defaults to zero; add an entry to scripts/lint-budgets.manifest.json only with justification in the same PR`,
      })
    }
  }
  return rows
}

// Run only when invoked as a script, not when imported by the spec.
if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, number>
  const targets = process.argv.slice(2).filter(arg => arg !== '--list')
  const scopes = targets.length > 0 ? targets : ['.']

  const invocation = resolveOxlintInvocation(['--format', 'json', ...scopes], process.env)
  const result = spawnSync(process.execPath, [oxlintBinaryPath(), ...invocation.args], {
    encoding: 'utf8',
    env: invocation.env,
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }

  const parsed = JSON.parse(result.stdout) as { diagnostics: LintDiagnostic[] }
  const rows = evaluateLintBudgets(manifest, parsed.diagnostics)

  if (process.argv.includes('--list')) {
    const label = { ok: 'ok  ', over: 'OVER', invalid: 'BAD ' } as const
    const listed = new Set(Object.keys(manifest))
    for (const row of rows) {
      if (!listed.has(row.path)) continue
      console.log(`${label[row.kind]}  ${String(row.actual).padStart(4)} / ${String(row.allowance).padEnd(4)} ${row.path}`)
    }
    process.exit(0)
  }

  const failures = rows.filter(row => row.failure !== undefined)
  if (failures.length > 0) {
    console.error('verify-lint-budgets failed:\n')
    for (const row of failures) console.error(`  ${row.failure}`)
    console.error('\nType-aware lint debt only shrinks: fix diagnostics, or update scripts/lint-budgets.manifest.json with justification in the same PR.')
    process.exit(1)
  }

  console.log(`verify-lint-budgets: ${Object.keys(manifest).length} budgeted files within allowance; ${rows.length - Object.keys(manifest).length} unlisted file(s) clean.`)
}
