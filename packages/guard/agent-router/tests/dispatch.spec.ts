/**
 * dispatch.spec.ts — dsh 子代理 seam 派发（含工具限制）。
 *
 * 覆盖：start 参数形状（label/prompt/parent/signal/agentOptions/toolFilter）、
 * result/dispose 调用序、任务文本进 prompt、父会话解析、start/result 抛错
 * 路径、profile 工具集经 toolFilter 透传。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { SessionId } from '@huiliyi37/dsh-session'
import { dispatchSubagent, SUBAGENT_TASK_PREFIX } from '../src/dispatch.js'

/** 各 profile 的默认工具集（与 DEFAULT_PROFILE_TOOLS 同源，测试按真实名断言）。 */
const SCOUT_TOOLS = ['grep', 'read', 'glob', 'repo_graph', 'semantic_search', 'bash']
const VERIFIER_TOOLS = ['grep', 'read', 'glob', 'repo_graph', 'bash']

const PARENT_ID = SessionId('session-parent-1')
const CHILD_ID = SessionId('session-child-1')

function makeOptions(profile: 'code_scout' | 'verifier', task: string, targets: string[] = []): {
  profile: 'code_scout' | 'verifier'
  task: string
  targets: string[]
  provider: string
  model: string
  tools: string[]
  subagentProvider: string
  parentSessionId: SessionId
  signal: AbortSignal
  budget: { maxTurns: number; timeoutMs: number }
} {
  return {
    profile,
    task,
    targets,
    provider: 'mock',
    model: 'mock',
    tools: profile === 'code_scout' ? SCOUT_TOOLS : VERIFIER_TOOLS,
    subagentProvider: 'spawn',
    parentSessionId: PARENT_ID,
    signal: new AbortController().signal,
    budget: { maxTurns: 48, timeoutMs: 1_800_000 },
  }
}

/** mock subagents 服务：start 捕获 request 并返回可控 run。 */
function makeSeam(): {
  start: ReturnType<typeof vi.fn>
  calls: { result: number; dispose: number }
  requests: unknown[]
} {
  const calls = { result: 0, dispose: 0 }
  const requests: unknown[] = []
  const start = vi.fn(async (name: string, request: unknown) => {
    requests.push({ name, request })
    return {
      id: CHILD_ID,
      result: Promise.resolve({ stopReason: 'completed', output: [] }).then((r) => { calls.result++; return r }),
      dispose: vi.fn(async () => { calls.dispose++ }),
    }
  })
  return { start, calls, requests }
}

function makeParent(append?: (type: string, data: unknown) => void): {
  session: { append: (type: string, data: unknown) => void }
} {
  return { session: { append: append ?? (() => {}) } }
}

function makeCtx(seam: ReturnType<typeof makeSeam>, parent: unknown): Context {
  return {
    reflect: {
      get: (name: string, _strict: boolean) => {
        if (name === 'subagents') return seam
        if (name === 'agents') return { get: (_id: SessionId) => parent }
        return undefined
      },
    },
  } as unknown as Context
}

afterEach(() => { vi.restoreAllMocks() })

describe('dispatchSubagent', () => {
  it('start（label/prompt/parent/toolFilter）→ result → dispose，返回子代理 sessionId', async () => {
    const seam = makeSeam()
    const ctx = makeCtx(seam, makeParent())
    const id = await dispatchSubagent(ctx, makeOptions('code_scout', '侦查 src/foo.ts', ['src/foo.ts']))
    expect(seam.start).toHaveBeenCalledTimes(1)
    const entry = seam.requests[0] as { name: string; request: Record<string, unknown> }
    expect(entry.name).toBe('spawn')
    const request = entry.request
    expect(request.label).toBe('router-code_scout')
    expect(request.parent).toBeDefined()
    expect(request.signal).toBeInstanceOf(AbortSignal)
    expect(request.agentOptions).toEqual({ provider: 'mock', model: 'mock' })
    // 工具限制：profile → toolFilter allow 列表（真实工具名）
    const toolFilter = request.toolFilter as { allow: string[] }
    expect(toolFilter.allow).toContain('grep')
    expect(toolFilter.allow).toContain('read')
    expect(toolFilter.allow).toContain('repo_graph')
    expect(toolFilter.allow).not.toContain('read_file')
    // 任务文本进 prompt（SUBAGENT_TASK_PREFIX 契约）
    const prompt = request.prompt as Array<{ text: string }>
    const task = prompt.map(b => b.text).join('\n')
    expect(task).toContain(SUBAGENT_TASK_PREFIX)
    expect(task).toContain('侦查 src/foo.ts')
    expect(task).toContain('目标文件: src/foo.ts')
    // result/dispose 各一次，返回派发终态（id/stopReason/output）
    expect(seam.calls.result).toBe(1)
    expect(seam.calls.dispose).toBe(1)
    expect(id.sessionId).toBe(CHILD_ID)
    expect(id.stopReason).toBe('completed')
    expect(id.output).toEqual([])
    expect(id.budget.maxTurns).toBe(48)
  })

  it('acceptance 落 router/route、settle 后落 router/outcome（终态可自日志重建）', async () => {
    const seam = makeSeam()
    const appended: Array<{ type: string; data: unknown }> = []
    const ctx = makeCtx(seam, makeParent((type, data) => { appended.push({ type, data }) }))
    const outcome = await dispatchSubagent(ctx, makeOptions('verifier', '复核修复', ['src/a.ts']))
    expect(appended).toHaveLength(2)
    expect(appended[0]!.type).toBe('router/route')
    const route = appended[0]!.data as {
      profile: string
      task: string
      targets: string[]
      subagentSessionId: string
      budget: { maxTurns: number; deadlineMs: number }
    }
    expect(route.profile).toBe('verifier')
    expect(route.task).toBe('复核修复')
    expect(route.targets).toEqual(['src/a.ts'])
    expect(route.subagentSessionId).toBe(CHILD_ID)
    expect(route.budget.maxTurns).toBe(48)
    expect(route.budget.deadlineMs).toBeGreaterThan(Date.now() - 10_000)
    expect(appended[1]!.type).toBe('router/outcome')
    const outcomeRecord = appended[1]!.data as { subagentSessionId: string; stopReason: string }
    expect(outcomeRecord.subagentSessionId).toBe(CHILD_ID)
    expect(outcomeRecord.stopReason).toBe(outcome.stopReason)
  })

  it('父 agent 无 session 时记录失败 fail loud 且 dispose 已启动的子代理', async () => {
    const seam = makeSeam()
    const ctx = makeCtx(seam, {})
    await expect(dispatchSubagent(ctx, makeOptions('code_scout', 'x'))).rejects.toThrow(/no session/)
    expect(seam.calls.dispose).toBe(1)
  })

  it('verifier profile 允许 bash（跑测试验证）', async () => {
    const seam = makeSeam()
    const ctx = makeCtx(seam, makeParent())
    await dispatchSubagent(ctx, makeOptions('verifier', '复核修复'))
    const request = (seam.requests[0] as { request: { toolFilter: { allow: string[] } } }).request
    expect(request.toolFilter.allow).toContain('bash')
    const prompt = (seam.requests[0] as { request: { prompt: Array<{ text: string }> } }).request.prompt
    expect(prompt.map(b => b.text).join('\n')).toContain('复核修复')
  })

  it('父会话不是活 agent 时 fail loud', async () => {
    const seam = makeSeam()
    const ctx = makeCtx(seam, undefined)
    await expect(dispatchSubagent(ctx, makeOptions('code_scout', 'x'))).rejects.toThrow(/parent session not live/)
    expect(seam.start).not.toHaveBeenCalled()
  })

  it('subagents 服务缺失时 fail loud', async () => {
    const ctx = {
      reflect: { get: (name: string, _strict: boolean) => name === 'agents' ? { get: () => ({}) } : undefined },
    } as unknown as Context
    await expect(dispatchSubagent(ctx, makeOptions('code_scout', 'x'))).rejects.toThrow(/subagents service unavailable/)
  })

  it('start 抛错（如未知工具名）时拒绝且无 dispose 泄漏', async () => {
    const seam = makeSeam()
    seam.start.mockRejectedValue(new Error('tools.restrict() names unknown global tool "nope"'))
    const ctx = makeCtx(seam, makeParent())
    await expect(dispatchSubagent(ctx, makeOptions('code_scout', 'x'))).rejects.toThrow(/unknown global tool/)
    expect(seam.calls.dispose).toBe(0)
  })

  it('result 基础设施故障 reject 时仍 dispose 清理', async () => {
    const seam = makeSeam()
    seam.start.mockResolvedValue({
      id: CHILD_ID,
      result: Promise.reject(new Error('infra fault')),
      dispose: vi.fn(async () => { seam.calls.dispose++ }),
    })
    const ctx = makeCtx(seam, makeParent())
    await expect(dispatchSubagent(ctx, makeOptions('code_scout', 'x'))).rejects.toThrow('infra fault')
    expect(seam.calls.dispose).toBe(1)
  })
})
