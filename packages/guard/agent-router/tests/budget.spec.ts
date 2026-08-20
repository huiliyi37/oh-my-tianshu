/**
 * budget.spec.ts — 派发预算纯函数（天枢 budget-shape 的 DSH 形态）。
 *
 * 覆盖：resolveBudgetConfig 校验、shapeWriteBudget 定价与双帽、显式覆盖
 * 逐字段优先。
 */
import { describe, expect, it } from 'vitest'
import { mergeBudgetOverride, resolveBudgetConfig, shapeWriteBudget } from '../src/budget.js'

const BASE = resolveBudgetConfig({})

describe('resolveBudgetConfig', () => {
  it('缺省与天枢同源（48/100/30min/每文件 +6 回合）', () => {
    expect(BASE).toEqual({
      defaultMaxTurns: 48,
      ceilMaxTurns: 100,
      ceilTimeoutMs: 1_800_000,
      turnsPerExtraFile: 6,
    })
  })

  it('非法形状 fail loud', () => {
    expect(() => resolveBudgetConfig({ defaultMaxTurns: -1 })).toThrow(/non-negative/)
    expect(() => resolveBudgetConfig({ ceilMaxTurns: 10 })).toThrow(/ceilMaxTurns/)
    expect(() => resolveBudgetConfig({ ceilTimeoutMs: Number.NaN })).toThrow(/non-negative/)
  })
})

describe('shapeWriteBudget', () => {
  it('单文件用缺省；多文件按目标数线性追加', () => {
    expect(shapeWriteBudget(1, BASE).maxTurns).toBe(48)
    expect(shapeWriteBudget(3, BASE).maxTurns).toBe(60)
    expect(shapeWriteBudget(0, BASE).maxTurns).toBe(48)
  })

  it('绝对帽钳制（超帽钳回）', () => {
    const tight = resolveBudgetConfig({ defaultMaxTurns: 48, ceilMaxTurns: 50 })
    expect(shapeWriteBudget(10, tight).maxTurns).toBe(50)
  })

  it('墙钟预算即单发绝对帽', () => {
    expect(shapeWriteBudget(5, BASE).timeoutMs).toBe(1_800_000)
  })
})

describe('mergeBudgetOverride', () => {
  it('显式覆盖逐字段优先，缺省落 shape', () => {
    const shape = shapeWriteBudget(2, BASE)
    expect(mergeBudgetOverride(undefined, shape)).toEqual(shape)
    expect(mergeBudgetOverride({ maxTurns: 20 }, shape).maxTurns).toBe(20)
    expect(mergeBudgetOverride({ timeoutMs: 60_000 }, shape).timeoutMs).toBe(60_000)
  })
})
