/**
 * probe-candidates.spec.ts — 探针候选生成（天枢 probe-candidates 精简移植）。
 *
 * 覆盖：存活假设生成 targeted_test（expect fail = RED 优先）、已探过跳过、
 * 预算截断、cooldown 冷却、无存活假设空、终态假设不参与。
 */
import { describe, expect, it } from 'vitest'
import { generateProbeCandidates, recordProbeFeedback, type Hypothesis } from '../src/probe-candidates.js'

function hyp(over: Partial<Hypothesis>): Hypothesis {
  return {
    id: 'h1',
    claim: 'X 导致崩溃',
    status: 'candidate',
    targets: ['src/foo.ts'],
    probed: [],
    ...over,
  }
}

describe('generateProbeCandidates', () => {
  it('存活假设生成 targeted_test 探针，expect fail（RED 优先）', () => {
    const candidates = generateProbeCandidates([hyp({})], { budget: 5 })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.kind).toBe('targeted_test')
    expect(candidates[0]!.expect).toBe('fail')
    expect(candidates[0]!.target).toBe('src/foo.ts')
  })

  it('已探过的 target 不再生成', () => {
    const candidates = generateProbeCandidates([hyp({ probed: ['src/foo.ts'] })], { budget: 5 })
    expect(candidates).toHaveLength(0)
  })

  it('预算耗尽截断', () => {
    const hypotheses = [1, 2, 3, 4].map(i => hyp({ id: `h${i}`, targets: [`src/f${i}.ts`] }))
    const candidates = generateProbeCandidates(hypotheses, { budget: 2 })
    expect(candidates).toHaveLength(2)
  })

  it('预算紧张（≤3）只出 grep 探针', () => {
    const candidates = generateProbeCandidates([hyp({})], { budget: 3 })
    expect(candidates[0]!.kind).toBe('grep')
  })

  it('cooldown：同 target 已冷却（uninformative ≥2）则跳过', () => {
    const candidates = generateProbeCandidates([hyp({})], {
      budget: 5,
      cooldown: { 'targeted_test:src/foo.ts': 2 },
    })
    expect(candidates).toHaveLength(0)
  })

  it('冷却未达阈值仍生成', () => {
    const candidates = generateProbeCandidates([hyp({})], {
      budget: 5,
      cooldown: { 'targeted_test:src/foo.ts': 1 },
    })
    expect(candidates).toHaveLength(1)
  })

  it('无存活假设（全部终态）→ 空', () => {
    const candidates = generateProbeCandidates([
      hyp({ id: 'a', status: 'supported' }),
      hyp({ id: 'b', status: 'refuted' }),
    ], { budget: 5 })
    expect(candidates).toHaveLength(0)
  })

  it('inconclusive 假设参与生成', () => {
    const candidates = generateProbeCandidates([hyp({ status: 'inconclusive' })], { budget: 5 })
    expect(candidates).toHaveLength(1)
  })
})

describe('generateProbeCandidates — 内层预算截断', () => {
  it('单假设多 target 时按 budget 截断（内层循环 break）', () => {
    const candidates = generateProbeCandidates(
      [hyp({ targets: ['src/a.ts', 'src/b.ts', 'src/c.ts'] })],
      { budget: 2 },
    )
    expect(candidates).toHaveLength(2)
    expect(candidates[0]!.target).toBe('src/a.ts')
    expect(candidates[1]!.target).toBe('src/b.ts')
  })
})

describe('recordProbeFeedback', () => {
  it('informative 清除冷却（置 0）并返回 0', () => {
    const cooldown: Record<string, number> = { 'targeted_test:src/foo.ts': 2 }
    const next = recordProbeFeedback(cooldown, 'targeted_test:src/foo.ts', true)
    expect(next).toBe(0)
    expect(cooldown['targeted_test:src/foo.ts']).toBe(0)
  })

  it('uninformative 累计冷却（首次从 0 → 1，再次 → 2）', () => {
    const cooldown: Record<string, number> = {}
    expect(recordProbeFeedback(cooldown, 'targeted_test:src/foo.ts', false)).toBe(1)
    expect(recordProbeFeedback(cooldown, 'targeted_test:src/foo.ts', false)).toBe(2)
    expect(cooldown['targeted_test:src/foo.ts']).toBe(2)
  })
})
