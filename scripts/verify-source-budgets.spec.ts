/**
 * Acceptance-path coverage for `verify-source-budgets`: a file at or under
 * its ceiling passes, growth past the ceiling fails with the split-first
 * message, a vanished budgeted file fails as manifest drift, and a malformed
 * ceiling is rejected. The live manifest must also hold against the working
 * tree, so a ceiling raise is always a deliberate manifest edit.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countLines, evaluateSourceBudgets } from './verify-source-budgets.ts'

const repoRoot = resolve(import.meta.dirname, '..')

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function layout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'source-budgets-'))
  roots.push(root)
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(root, rel), content)
  }
  return root
}

describe('countLines', () => {
  it('counts physical lines like wc -l', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('one\n')).toBe(1)
    expect(countLines('one\ntwo\n')).toBe(2)
    // Missing trailing newline still counts the final partial line.
    expect(countLines('one\ntwo')).toBe(2)
  })
})

describe('evaluateSourceBudgets', () => {
  it('passes files at or under their ceiling', () => {
    const root = layout({ 'small.ts': 'a\nb\n', 'exact.ts': 'a\nb\nc\n' })

    const rows = evaluateSourceBudgets({ 'small.ts': 10, 'exact.ts': 3 }, root)

    expect(rows).toEqual([
      { path: 'small.ts', ceiling: 10, kind: 'ok', lines: 2, failure: undefined },
      { path: 'exact.ts', ceiling: 3, kind: 'ok', lines: 3, failure: undefined },
    ])
  })

  it('rejects growth past the ceiling with the split-first message', () => {
    const root = layout({ 'monolith.ts': 'a\nb\nc\nd\n' })

    const [row] = evaluateSourceBudgets({ 'monolith.ts': 3 }, root)

    expect(row).toMatchObject({ kind: 'over', lines: 4 })
    expect(row?.failure).toContain('4 lines exceeds the 3-line ceiling')
    expect(row?.failure).toContain('split the module')
    expect(row?.failure).toContain('scripts/source-budgets.manifest.json')
  })

  it('rejects a budgeted file that no longer exists as manifest drift', () => {
    const root = layout({})

    const [row] = evaluateSourceBudgets({ 'gone.ts': 100 }, root)

    expect(row).toMatchObject({ kind: 'missing', lines: undefined })
    expect(row?.failure).toContain('update scripts/source-budgets.manifest.json in the same change')
  })

  it('rejects malformed ceilings', () => {
    const root = layout({ 'file.ts': 'a\n' })

    const rows = evaluateSourceBudgets({ 'file.ts': 0, 'other.ts': 1.5 }, root)

    expect(rows.map(row => row.kind)).toEqual(['invalid', 'invalid'])
    expect(rows[0]?.failure).toContain('positive integer')
  })

  it('holds against the live manifest and working tree', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(repoRoot, 'scripts/source-budgets.manifest.json'), 'utf8'),
    ) as Record<string, number>

    const failures = evaluateSourceBudgets(manifest, repoRoot).filter(row => row.failure !== undefined)

    expect(failures).toEqual([])
  })
})
