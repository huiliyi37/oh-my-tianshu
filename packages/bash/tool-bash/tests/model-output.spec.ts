/** Model-output shaping: body composition, drop predicate, success fold, error-aware selection. */
import { describe, expect, it } from 'vitest'
import { composeResultBody, environmentDiagnosis, outputShapingDropsLines, shapeModelOutput } from '../src/model-output.ts'
import type { BashRunResult } from '@huiliyi37/dsh-bash'

const DEFAULTS = { successTailLines: 20, errorThresholdLines: 40, errorBudgetLines: 60 }

function run(over: { stdout?: BashRunResult['stdout']; stderr?: BashRunResult['stderr'] } = {}): Pick<BashRunResult, 'stdout' | 'stderr'> {
  return {
    stdout: over.stdout ?? { text: '', truncated: false },
    stderr: over.stderr ?? { text: '', truncated: false },
  }
}

/** N numbered lines with a trailing newline (the common command shape). */
function numbered(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n'
}

describe('composeResultBody', () => {
  it('stdout only → stdout text verbatim', () => {
    expect(composeResultBody(run({ stdout: { text: 'ok\n', truncated: false } }))).toBe('ok\n')
  })

  it('stdout + stderr → marked stderr section after stdout', () => {
    expect(composeResultBody(run({
      stdout: { text: 'out', truncated: false },
      stderr: { text: 'bad', truncated: false },
    }))).toBe('out\n[stderr]\nbad')
  })

  it('executor truncation notices are part of the body (shaping sees them)', () => {
    expect(composeResultBody(run({
      stdout: { text: 'tail', truncated: true, spillPath: '/x' },
    }))).toBe('tail\n[output truncated; full output: /x]')
  })
})

describe('outputShapingDropsLines', () => {
  it('empty body never drops', () => {
    expect(outputShapingDropsLines('', { failed: true, ...DEFAULTS })).toBe(false)
  })

  it('success below tail threshold passes through', () => {
    expect(outputShapingDropsLines(numbered(20), { failed: false, ...DEFAULTS })).toBe(false)
    expect(outputShapingDropsLines(numbered(21), { failed: false, ...DEFAULTS })).toBe(true)
  })

  it('failure uses the error threshold instead', () => {
    expect(outputShapingDropsLines(numbered(40), { failed: true, ...DEFAULTS })).toBe(false)
    expect(outputShapingDropsLines(numbered(41), { failed: true, ...DEFAULTS })).toBe(true)
  })

  it('0 disables the matching arm', () => {
    expect(outputShapingDropsLines(numbered(500), { failed: false, ...DEFAULTS, successTailLines: 0 })).toBe(false)
    expect(outputShapingDropsLines(numbered(500), { failed: true, ...DEFAULTS, errorThresholdLines: 0 })).toBe(false)
  })
})

describe('shapeModelOutput — success fold', () => {
  it('folds to the tail with an exact omission count and keeps the trailing newline', () => {
    const shaped = shapeModelOutput(numbered(50), { failed: false, ...DEFAULTS })
    expect(shaped.startsWith('[30 earlier lines omitted]\n')).toBe(true)
    expect(sharedTail(shaped)).toContain('line 31\n')
    expect(shaped.endsWith('line 50\n')).toBe(true)
    expect(shaped).not.toContain('line 5\n')
  })

  it('attaches the spill path to the omission notice', () => {
    const shaped = shapeModelOutput(numbered(50), { failed: false, ...DEFAULTS, spillPath: '/spill/bash.txt' })
    expect(shaped.startsWith('[30 earlier lines omitted; full output: /spill/bash.txt]\n')).toBe(true)
  })

  it('bodies at or below the threshold are byte-identical', () => {
    const body = numbered(20)
    expect(shapeModelOutput(body, { failed: false, ...DEFAULTS })).toBe(body)
  })

  it('singular line count grammar', () => {
    const shaped = shapeModelOutput(numbered(21), { failed: false, ...DEFAULTS })
    expect(shaped.startsWith('[1 earlier line omitted]\n')).toBe(true)
  })
})

describe('shapeModelOutput — error-aware selection', () => {
  /** 60 行,第 40 行是错误行。 */
  function failedBody(): string {
    const lines = Array.from({ length: 60 }, (_, i) => (i === 39 ? 'FATAL: boom' : `row ${i + 1}`))
    return `${lines.join('\n')}\n`
  }

  it('keeps head anchors, the error window, and tail anchors with omission counts', () => {
    const shaped = shapeModelOutput(failedBody(), { failed: true, ...DEFAULTS })
    expect(shaped.startsWith('[50 lines omitted — error-relevant lines kept]\n')).toBe(true)
    expect(shaped).toContain('row 1\n')
    expect(shaped).toContain('FATAL: boom')
    // 错误行 ±2 上下文窗口。
    expect(shaped).toContain('row 38')
    expect(shaped).toContain('row 42')
    // 尾锚。
    expect(shaped).toContain('row 60\n')
    expect(shaped).not.toContain('row 20\n')
    expect(shaped.endsWith('row 60\n')).toBe(true)
  })

  it('failure at or below the threshold is byte-identical', () => {
    const body = numbered(40)
    expect(shapeModelOutput(body, { failed: true, ...DEFAULTS })).toBe(body)
  })

  it('over-budget selection falls back to a head+tail split within the budget', () => {
    // 100 行几乎全是错误行 → 选集必然超预算(60)→ 回退 head+tail。
    const lines = Array.from({ length: 100 }, (_, i) => `ERROR ${i + 1}`)
    const shaped = shapeModelOutput(`${lines.join('\n')}\n`, {
      failed: true, ...DEFAULTS, errorBudgetLines: 10,
    })
    const kept = shaped.split('\n').filter(line => line.startsWith('ERROR ')).length
    expect(kept).toBeLessThanOrEqual(10)
    expect(shaped).toContain('ERROR 1\n')
    expect(shaped).toContain('ERROR 100\n')
    expect(shaped.startsWith('[90 lines omitted — error-relevant lines kept]\n')).toBe(true)
  })
})

/** 成功折叠后的正文(去掉首行通知)。 */
function sharedTail(shaped: string): string {
  return shaped.slice(shaped.indexOf('\n') + 1)
}

describe('environmentDiagnosis — 环境失败标准化', () => {
  it('exit 127 + 短正文 → command-not-found 诊断', () => {
    expect(environmentDiagnosis(127, 1)).toBe('[environment: exit 127 — command not found — verify the command name and PATH before retrying]')
  })

  it('有真实输出的长正文 → 不诊断(交给 error-aware 精选)', () => {
    expect(environmentDiagnosis(127, 10)).toBeUndefined()
  })

  it('未知退出码与空指针不诊断', () => {
    expect(environmentDiagnosis(1, 0)).toBeUndefined()
    expect(environmentDiagnosis(null, 1)).toBeUndefined()
  })
})
