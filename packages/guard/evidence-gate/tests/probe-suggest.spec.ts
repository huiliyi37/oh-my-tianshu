/**
 * probe-suggest.spec.ts — 精准 RED 探针建议算法（S4）。
 *
 * 覆盖：目标选择、已验证命令降级 grep、冷却跳过、testPath 生成、
 * 预算截断、无可用目标空数组。
 */
import { describe, expect, it } from 'vitest'
import { deriveTestPath, suggestRedProbe } from '../src/probe-suggest.js'

const obligation = { claim: '修复 X 崩溃', targets: ['src/foo.ts'] }

describe('suggestRedProbe', () => {
  it('未验证目标 → targeted_test + expect fail + testPath 生成', () => {
    const probes = suggestRedProbe(obligation, { verifiedCommands: [], cooldown: {} })
    expect(probes).toHaveLength(1)
    expect(probes[0]!.kind).toBe('targeted_test')
    expect(probes[0]!.expect).toBe('fail')
    expect(probes[0]!.target).toBe('src/foo.ts')
    expect(probes[0]!.testPath).toBe('tests/foo.spec.ts')
  })

  it('已验证命令含目标 → 降级 grep（避免重复 targeted_test）', () => {
    const probes = suggestRedProbe(obligation, {
      verifiedCommands: ['pnpm vitest run tests/foo.spec.ts'],
      cooldown: {},
    })
    expect(probes[0]!.kind).toBe('grep')
    expect(probes[0]!.expect).toBe('inspect')
  })

  it('冷却表 ≥2 → 跳过该目标', () => {
    const probes = suggestRedProbe(obligation, {
      verifiedCommands: [],
      cooldown: { 'targeted_test:src/foo.ts': 2 },
    })
    expect(probes).toHaveLength(0)
  })

  it('预算截断（多个目标只出前 budget 个）', () => {
    const probes = suggestRedProbe(
      { claim: 'X', targets: ['src/a.ts', 'src/b.ts', 'src/c.ts'] },
      { verifiedCommands: [], cooldown: {} },
      2,
    )
    expect(probes).toHaveLength(2)
    expect(probes[0]!.target).toBe('src/a.ts')
    expect(probes[1]!.target).toBe('src/b.ts')
  })

  it('无目标 → 空数组', () => {
    expect(suggestRedProbe({ claim: 'X', targets: [] }, { verifiedCommands: [], cooldown: {} })).toEqual([])
  })

  it('多目标：已验证的降级，未验证的保持 targeted_test', () => {
    const probes = suggestRedProbe(
      { claim: 'X', targets: ['src/alpha.ts', 'src/beta.ts'] },
      { verifiedCommands: ['pnpm vitest run tests/alpha.spec.ts'], cooldown: {} },
    )
    expect(probes).toHaveLength(2)
    expect(probes[0]!.kind).toBe('grep') // alpha 已验证 → grep
    expect(probes[1]!.kind).toBe('targeted_test') // beta 未验证 → targeted
  })

  it('note 携带假设陈述', () => {
    const probes = suggestRedProbe(obligation, { verifiedCommands: [], cooldown: {} })
    expect(probes[0]!.note).toContain('修复 X 崩溃')
  })
})

describe('commandCoversTarget 与 deriveTestPath 补充', () => {
  it('已验证命令含完整目标路径 → 命中降级 grep（includes 完整路径分支）', () => {
    const probes = suggestRedProbe(obligation, {
      verifiedCommands: ['pnpm vitest run src/foo.ts'],
      cooldown: {},
    })
    expect(probes[0]!.kind).toBe('grep')
  })

  it('deriveTestPath 空 basename → undefined', () => {
    expect(deriveTestPath('')).toBeUndefined()
  })

  it('deriveTestPath 无扩展名词干（全点 basename）→ undefined', () => {
    expect(deriveTestPath('.git')).toBeUndefined()
  })

  it('suggestRedProbe 目标无法派生 testPath 时不带 testPath 字段', () => {
    const probes = suggestRedProbe(
      { claim: 'X', targets: ['.git'] },
      { verifiedCommands: [], cooldown: {} },
    )
    expect(probes).toHaveLength(1)
    expect(probes[0]!.testPath).toBeUndefined()
    expect('testPath' in probes[0]!).toBe(false)
  })

  it('重复目标只建议一次（seen 去重）', () => {
    const probes = suggestRedProbe(
      { claim: 'X', targets: ['src/a.ts', 'src/a.ts'] },
      { verifiedCommands: [], cooldown: {} },
    )
    expect(probes).toHaveLength(1)
  })
})
