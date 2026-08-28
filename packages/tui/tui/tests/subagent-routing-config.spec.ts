/**
 * subagent-routing-config — 路由推荐探测、目录校验与发现性提示（回流自
 * opencode-tui 01313be6c 的引导三件套）。
 */
import { describe, expect, it } from 'vitest'
import {
  findRecommendedRoute,
  routeResolvesDirectory,
  subagentRoutingNudgeText,
  type RoutingDirectoryProvider,
} from '../src/subagent-routing-config.js'

const dir = (entries: Record<string, readonly string[]>): RoutingDirectoryProvider[] =>
  Object.entries(entries).map(([id, models]) => ({ id, models }))

describe('findRecommendedRoute', () => {
  it('flash 模型优先（跨 provider 扫描）', () => {
    expect(findRecommendedRoute(dir({ 'big-co': ['pro'], 'fast-co': ['lite-flash'] })))
      .toEqual({ provider: 'fast-co', model: 'lite-flash' })
  })

  it('无 flash 时 deepseek 系优先（provider 名或模型名命中）', () => {
    expect(findRecommendedRoute(dir({ 'alpha': ['x1'], 'deepseek-official': ['chat'] })))
      .toEqual({ provider: 'deepseek-official', model: 'chat' })
    expect(findRecommendedRoute(dir({ 'alpha': ['deepseek-v4'] })))
      .toEqual({ provider: 'alpha', model: 'deepseek-v4' })
  })

  it('都未命中取首个目录模型；空目录返回 null', () => {
    expect(findRecommendedRoute(dir({ 'alpha': ['a1'], 'beta': ['b1'] })))
      .toEqual({ provider: 'alpha', model: 'a1' })
    expect(findRecommendedRoute(dir({ 'alpha': [] }))).toBeNull()
    expect(findRecommendedRoute([])).toBeNull()
  })
})

describe('routeResolvesDirectory', () => {
  it('provider 已注册且目录含该 model id 才可解析', () => {
    const providers = dir({ 'alpha': ['fast', 'big'] })
    expect(routeResolvesDirectory({ provider: 'alpha', model: 'fast' }, providers)).toBe(true)
    expect(routeResolvesDirectory({ provider: 'alpha', model: 'gone' }, providers)).toBe(false)
    expect(routeResolvesDirectory({ provider: 'beta', model: 'fast' }, providers)).toBe(false)
    expect(routeResolvesDirectory({ provider: 'alpha', model: 'fast' }, [])).toBe(false)
  })
})

describe('subagentRoutingNudgeText', () => {
  it('提示行指向 /config 子代理模型类目', () => {
    const text = subagentRoutingNudgeText()
    expect(text).toContain('/config')
    expect(text).toContain('子代理')
  })
})
