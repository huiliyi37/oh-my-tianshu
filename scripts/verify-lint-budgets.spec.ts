import { describe, expect, it } from 'vitest'
import {
  countByFile,
  evaluateLintBudgets,
  isTypeAware,
  type LintDiagnostic,
} from './verify-lint-budgets.ts'

const diag = (code: string, filename: string): LintDiagnostic => ({ code, filename })

describe('isTypeAware', () => {
  it('accepts the typescript family and rejects others', () => {
    expect(isTypeAware('typescript(no-unnecessary-condition)')).toBe(true)
    expect(isTypeAware('typescript(unbound-method)')).toBe(true)
    expect(isTypeAware('eslint(no-unused-vars)')).toBe(false)
    expect(isTypeAware('@stylistic(max-len)')).toBe(false)
    expect(isTypeAware('no-unnecessary-condition')).toBe(false)
  })
})

describe('countByFile', () => {
  it('aggregates type-aware diagnostics per file and ignores other families', () => {
    const counts = countByFile([
      diag('typescript(no-unnecessary-condition)', 'a.ts'),
      diag('typescript(unbound-method)', 'a.ts'),
      diag('eslint(no-unused-vars)', 'a.ts'),
      diag('typescript(restrict-plus-operands)', 'b.ts'),
    ])
    expect(counts.get('a.ts')).toBe(2)
    expect(counts.get('b.ts')).toBe(1)
    expect(counts.size).toBe(2)
  })
})

describe('evaluateLintBudgets', () => {
  it('passes files at or under their allowance', () => {
    const rows = evaluateLintBudgets({ 'a.ts': 2 }, [diag('typescript(unbound-method)', 'a.ts')])
    expect(rows).toEqual([
      { path: 'a.ts', allowance: 2, actual: 1, kind: 'ok', failure: undefined },
    ])
  })

  it('fails a listed file over its allowance', () => {
    const rows = evaluateLintBudgets({ 'a.ts': 1 }, [
      diag('typescript(unbound-method)', 'a.ts'),
      diag('typescript(no-unnecessary-condition)', 'a.ts'),
    ])
    expect(rows[0]?.kind).toBe('over')
    expect(rows[0]?.failure).toContain('2 type-aware lint diagnostics exceed the 1 allowance')
  })

  it('fails unlisted files carrying any type-aware diagnostic (zero default)', () => {
    const rows = evaluateLintBudgets({}, [diag('typescript(unbound-method)', 'new.ts')])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('over')
    expect(rows[0]?.path).toBe('new.ts')
    expect(rows[0]?.allowance).toBe(0)
    expect(rows[0]?.failure).toContain('no allowance')
  })

  it('ignores non-type-aware diagnostics entirely', () => {
    const rows = evaluateLintBudgets({}, [diag('eslint(no-unused-vars)', 'new.ts')])
    expect(rows).toEqual([])
  })

  it('rejects malformed allowances', () => {
    const rows = evaluateLintBudgets({ 'a.ts': -1 }, [])
    expect(rows[0]?.kind).toBe('invalid')
    expect(rows[0]?.failure).toContain('non-negative integer')
  })

  it('passes a listed allowance with no diagnostics (sits high until lowered)', () => {
    const rows = evaluateLintBudgets({ 'a.ts': 3 }, [])
    expect(rows).toEqual([
      { path: 'a.ts', allowance: 3, actual: 0, kind: 'ok', failure: undefined },
    ])
  })
})
