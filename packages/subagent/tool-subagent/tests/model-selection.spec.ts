/**
 * model-selection — 子代理模型路由纯核心、持久策略事件与设置段（子浪 A）。
 * 路由参数的工具 schema 暴露与执行器强制在子浪 B 接线。
 */
import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import {
  assertAllowedModelRoutes,
  assertAllowedModelSelection,
  hasConfiguredLlmSelection,
  hasDelegationModelRequest,
  modelRouteKey,
  preflightChildLlmRoute,
  requestedAgentOptions,
} from '../src/model-selection.ts'
import { recordSubagentModelSelection, subagentModelSelectionPolicy } from '../src/model-selection-state.ts'

describe('assertAllowedModelRoutes', () => {
  it('接受非空精确路由并去重检测', () => {
    const routes = [{ provider: 'alpha', model: 'fast' }, { provider: 'beta', model: 'big' }]
    expect(() => assertAllowedModelRoutes(routes)).not.toThrow()
    expect(() => assertAllowedModelRoutes([{ provider: 'a', model: 'x' }, { provider: 'a', model: 'x' }]))
      .toThrow(/repeats route "a\/x"/)
  })

  it('拒绝非数组、缺字段、空 id', () => {
    expect(() => assertAllowedModelRoutes('nope')).toThrow(/array of routes/)
    expect(() => assertAllowedModelRoutes([{ provider: 'a' }])).toThrow(/non-empty provider and model/)
    expect(() => assertAllowedModelRoutes([{ provider: '', model: 'x' }])).toThrow(/non-empty provider and model/)
  })

  it('modelRouteKey 与提供方无关地唯一化路由', () => {
    expect(modelRouteKey({ provider: 'a', model: 'x' })).toBe(modelRouteKey({ provider: 'a', model: 'x' }))
    expect(modelRouteKey({ provider: 'a', model: 'x' })).not.toBe(modelRouteKey({ provider: 'a', model: 'y' }))
  })
})

describe('requestedAgentOptions（合并语义）', () => {
  const parent = { provider: 'p1', model: 'm1', maxTokens: 100 }

  it('无模型可见选择时保留配置缺省', () => {
    expect(requestedAgentOptions(parent, { provider: 'p2', model: 'm2' }, {}, true))
      .toEqual({ provider: 'p2', model: 'm2' })
    expect(requestedAgentOptions(parent, undefined, {}, true)).toBeUndefined()
  })

  it('禁用实例拒绝任何模型可见选择', () => {
    expect(() => requestedAgentOptions(parent, undefined, { provider: 'p2', model: 'm2' }, false))
      .toThrow(/disabled/)
  })

  it('provider/model 必须成对；空串拒绝', () => {
    expect(() => requestedAgentOptions(parent, undefined, { provider: 'p2' }, true))
      .toThrow(/supplied together/)
    expect(() => requestedAgentOptions(parent, undefined, { provider: '', model: 'm' }, true))
      .toThrow(/non-empty/)
  })

  it('换路由且未点名 effort 时清除配置路由的 effort；显式 effort 落 branded id', () => {
    const configured = { provider: 'p1', model: 'm1', reasoningEffort: ReasoningEffortId('high') }
    const switched = requestedAgentOptions(parent, configured, { provider: 'p2', model: 'm2' }, true)
    expect(switched).toEqual({ provider: 'p2', model: 'm2' })
    const explicit = requestedAgentOptions(parent, configured, { provider: 'p2', model: 'm2', reasoning_effort: 'low' }, true)
    expect(explicit?.reasoningEffort).toBe('low')
    // 未换路由：配置 effort 保留
    const sameRoute = requestedAgentOptions(parent, configured, { provider: 'p1', model: 'm1' }, true)
    expect(sameRoute?.reasoningEffort).toBe('high')
  })
})

describe('assertAllowedModelSelection（执行器侧强制）', () => {
  const parent = { provider: 'p1', model: 'm1' }
  const policy = { routes: [{ provider: 'p2', model: 'm2' }] }

  it('无策略或无显式选择时放行（纯继承不受限）', () => {
    expect(() => assertAllowedModelSelection(undefined, parent, undefined, { provider: 'px', model: 'mx' })).not.toThrow()
    expect(() => assertAllowedModelSelection(policy, parent, undefined, {})).not.toThrow()
  })

  it('有效路由放行；带外路由拒绝', () => {
    expect(() => assertAllowedModelSelection(policy, parent, { provider: 'p2', model: 'm2' }, { provider: 'p2', model: 'm2' })).not.toThrow()
    expect(() => assertAllowedModelSelection(policy, parent, undefined, { reasoning_effort: 'low' }))
      .toThrow(/not allowed for this Session/)
  })
})

describe('hasDelegationModelRequest / hasConfiguredLlmSelection', () => {
  it('任一路由/effort 字段即视为显式选择', () => {
    expect(hasDelegationModelRequest({})).toBe(false)
    expect(hasDelegationModelRequest({ reasoning_effort: 'low' })).toBe(true)
    expect(hasConfiguredLlmSelection(undefined)).toBe(false)
    expect(hasConfiguredLlmSelection({ maxTokens: 5 })).toBe(false)
    expect(hasConfiguredLlmSelection({ provider: 'p', model: 'm' })).toBe(true)
  })
})

describe('preflightChildLlmRoute', () => {
  it('解析有效路由并携带路由感知的 effort；取消信号透传', async () => {
    const resolveCallConfig = vi.fn(async (config: unknown) => config)
    const llm = { resolveCallConfig } as never
    await preflightChildLlmRoute(llm, { provider: 'p1', model: 'm1', reasoningEffort: ReasoningEffortId('high') },
      undefined, new AbortController().signal)
    // 未换路由：继承父 effort
    expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'p1', model: 'm1', reasoningEffort: 'high' }, expect.any(AbortSignal))
    resolveCallConfig.mockClear()
    await preflightChildLlmRoute(llm, { provider: 'p1', model: 'm1', reasoningEffort: ReasoningEffortId('high') },
      { provider: 'p2', model: 'm2' }, new AbortController().signal)
    // 换路由：不继承父 effort（由新模型自解析默认）
    expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'p2', model: 'm2' }, expect.any(AbortSignal))
  })

  it('父级缺 provider/model 时 fail loud', async () => {
    const llm = { resolveCallConfig: vi.fn() } as never
    await expect(preflightChildLlmRoute(llm, {}, undefined, new AbortController().signal))
      .rejects.toThrow(/without an effective provider and model/)
  })
})

describe('model-selection-state（持久策略事件）', () => {
  it('记录一次、读取解耦副本；空路由 fail loud', () => {
    const session = Session.create(SessionId('policy-1'))
    expect(subagentModelSelectionPolicy(session)).toBeUndefined()
    recordSubagentModelSelection(session, [{ provider: 'alpha', model: 'fast' }])
    // 记录一次：重复调用不追加
    recordSubagentModelSelection(session, [{ provider: 'beta', model: 'big' }])
    const policy = subagentModelSelectionPolicy(session)
    expect(policy).toEqual([{ provider: 'alpha', model: 'fast' }])
    // 解耦副本：拿到的是浅拷贝数组，替换元素不影响日志
    const detached = subagentModelSelectionPolicy(session)!
    expect(detached).not.toBe(subagentModelSelectionPolicy(session))
    expect(subagentModelSelectionPolicy(session)![0]!.provider).toBe('alpha')
  })

  it('无策略事件 = 固定路由定义（undefined）', () => {
    const session = Session.create(SessionId('policy-2'))
    session.append('turn/start', { turn: 1 })
    expect(subagentModelSelectionPolicy(session)).toBeUndefined()
  })
})
