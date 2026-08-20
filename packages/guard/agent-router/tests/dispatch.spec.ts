/**
 * dispatch.spec.ts — dsh 原生子代理派发（含工具限制）。
 *
 * 覆盖：create/followup/whenIdle/dispose 调用序、任务文本进 followup、
 * sessionId 生成、错误时 dispose 清理、setup 内 restrict 工具集
 * （profile → allow 列表）、restrict 抛错/缺失 tools 服务时 fail loud。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { dispatchSubagent } from '../src/dispatch.js'

/** 各 profile 的默认工具集（与 DEFAULT_PROFILE_TOOLS 同源，测试按真实名断言）。 */
const SCOUT_TOOLS = ['grep', 'read', 'glob', 'repo_graph', 'semantic_search', 'bash']
const VERIFIER_TOOLS = ['grep', 'read', 'glob', 'repo_graph', 'bash']

function makeOptions(profile: 'code_scout' | 'verifier', task: string, targets: string[] = []): {
  profile: 'code_scout' | 'verifier'
  task: string
  targets: string[]
  provider: string
  model: string
  tools: string[]
} {
  return {
    profile,
    task,
    targets,
    provider: 'mock',
    model: 'mock',
    tools: profile === 'code_scout' ? SCOUT_TOOLS : VERIFIER_TOOLS,
  }
}

/** mock agents 服务：create 捕获 setup 并调用（返回 handle）。 */
function makeAgents(): {
  create: ReturnType<typeof vi.fn>
  calls: { followup: unknown[]; whenIdle: number; dispose: number }
  setupCalls: unknown[]
  restrictCalls: { allow?: string[]; deny?: string[] }[]
} {
  const calls = { followup: [] as unknown[], whenIdle: 0, dispose: 0 }
  const setupCalls: unknown[] = []
  const restrictCalls: { allow?: string[]; deny?: string[] }[] = []
  const agent = {
    followup: vi.fn(async (input: unknown) => { calls.followup.push(input) }),
    whenIdle: vi.fn(async () => { calls.whenIdle++ }),
  }
  const handle = {
    agent,
    dispose: vi.fn(async () => { calls.dispose++ }),
  }
  // setup 调用时：agentCtx.tools.restrict 记录调用
  const create = vi.fn(async (opts: { setup?: (agentCtx: unknown) => unknown }) => {
    if (opts.setup !== undefined) {
      const agentCtx = {
        tools: {
          restrict: (filter: { allow?: string[]; deny?: string[] }) => {
            restrictCalls.push(filter)
            return () => {}
          },
        },
      }
      setupCalls.push(agentCtx)
      await opts.setup(agentCtx)
    }
    return handle
  })
  return { create, calls, setupCalls, restrictCalls }
}

function makeCtx(agents: ReturnType<typeof makeAgents>): Context {
  return {
    agents: { create: agents.create },
    get: () => undefined,
    reflect: { get: (_name: string, _strict: boolean) => ({ create: agents.create }) },
  } as unknown as Context
}

afterEach(() => { vi.restoreAllMocks() })

describe('dispatchSubagent', () => {
  it('create → setup 注入 restrict(allow 只读工具) → followup → whenIdle → dispose', async () => {
    const agents = makeAgents()
    const ctx = makeCtx(agents)
    const id = await dispatchSubagent(ctx, makeOptions('code_scout', '侦查 src/foo.ts', ['src/foo.ts']))
    // create 带 sessionId/agentOptions/setup
    expect(agents.create).toHaveBeenCalledTimes(1)
    const createArg = agents.create.mock.calls[0]![0] as { sessionId: string; setup?: unknown }
    expect(createArg.setup).toBeTypeOf('function')
    expect(createArg.sessionId).toMatch(/^session-router-/)
    // setup 内 restrict 被调用（code_scout → 只读 allow 列表）
    expect(agents.restrictCalls).toHaveLength(1)
    const filter = agents.restrictCalls[0]!
    expect(filter.allow).toContain('grep')
    expect(filter.allow).toContain('read')
    expect(filter.allow).toContain('repo_graph')
    expect(filter.allow).not.toContain('read_file')
    // followup 带任务文本
    expect(agents.calls.followup).toHaveLength(1)
    const message = agents.calls.followup[0] as { content: { text: string }[]; role?: string; source?: { kind: string } }
    const task = message.content.map(b => b.text).join('\n')
    expect(task).toContain('侦查 src/foo.ts')
    // 修复契约（7f44edc）：followup 消息必须带 source: { kind: 'user' }——缺 source 时
    // agent-loop 的 pre-step 监听者（repeat-tool-guard 等读 message.source.kind）崩溃。
    expect(message.role).toBe('user')
    expect(message.source).toEqual({ kind: 'user' })
    // whenIdle/dispose 各一次
    expect(agents.calls.whenIdle).toBe(1)
    expect(agents.calls.dispose).toBe(1)
    expect(id).toBe(createArg.sessionId)
  })

  it('verifier profile 允许 bash（跑测试验证）', async () => {
    const agents = makeAgents()
    const ctx = makeCtx(agents)
    await dispatchSubagent(ctx, makeOptions('verifier', '复核修复'))
    expect(agents.restrictCalls[0]!.allow).toContain('bash')
    const task = (agents.calls.followup[0] as { content: { text: string }[] }).content.map(b => b.text).join('\n')
    expect(task).toContain('复核修复')
  })

  it('restrict 抛错（未知工具名）时 fail loud——中止派发且不静默放宽', async () => {
    const agents = makeAgents()
    // 改 agentCtx.tools.restrict 抛错（真实 restrict 的 unknown-name 报错形态）
    agents.create.mockImplementation((opts: { setup?: (agentCtx: unknown) => unknown }) => {
      if (opts.setup !== undefined) {
        void opts.setup({ tools: { restrict: () => { throw new Error('tools.restrict() names unknown global tool "nope"') } } })
      }
      return { agent: { followup: async () => {}, whenIdle: async () => {} }, dispose: async () => {} }
    })
    const ctx = makeCtx(agents)
    await expect(dispatchSubagent(ctx, makeOptions('code_scout', 'x'))).rejects.toThrow(/unknown global tool/)
  })

  it('agentCtx 缺失 tools 服务时 fail loud', async () => {
    const agents = makeAgents()
    agents.create.mockImplementation((opts: { setup?: (agentCtx: unknown) => unknown }) => {
      if (opts.setup !== undefined) void opts.setup({})
      return { agent: { followup: async () => {}, whenIdle: async () => {} }, dispose: async () => {} }
    })
    const ctx = makeCtx(agents)
    await expect(dispatchSubagent(ctx, makeOptions('code_scout', 'x'))).rejects.toThrow(/tools service unavailable/)
  })

  it('create 抛错时不调用 followup，且无 dispose 泄漏', async () => {
    const agents = makeAgents()
    agents.create.mockRejectedValue(new Error('create failed'))
    const ctx = makeCtx(agents)
    await expect(dispatchSubagent(ctx, makeOptions('code_scout', 'x'))).rejects.toThrow('create failed')
    expect(agents.calls.followup).toHaveLength(0)
    expect(agents.calls.dispose).toBe(0)
  })

  it('followup 抛错时仍 dispose 清理', async () => {
    const agents = makeAgents()
    agents.create.mockImplementation(() => ({
      agent: {
        followup: () => { throw new Error('followup failed') },
        whenIdle: async () => {},
      },
      dispose: async () => { agents.calls.dispose++ },
    }))
    const ctx = makeCtx(agents)
    await expect(dispatchSubagent(ctx, makeOptions('code_scout', 'x'))).rejects.toThrow('followup failed')
    expect(agents.calls.dispose).toBe(1)
  })
})
