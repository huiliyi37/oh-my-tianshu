import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { WorkflowRunId, WorkflowService } from '@deepseek-ai/dsh-workflow'
import type { WorkflowResult, WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import { CallId } from '@deepseek-ai/dsh-llm'
import SubagentService from '@deepseek-ai/dsh-subagent'
import WorkerWorkflowEngine from '@deepseek-ai/dsh-workflow-workerthread'
import * as toolWorkflow from '../src/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

const testToolSignal = new AbortController().signal

/** A controllable engine standing in behind ctx.workflows (the tool's only seam). */
class StubEngine extends WorkflowService {
  requests: WorkflowStartRequest[] = []
  cancels: string[] = []
  disposed = 0
  settle!: (result: WorkflowResult) => void
  startError: Error | undefined

  start(request: WorkflowStartRequest): WorkflowRun {
    if (this.startError) throw this.startError
    this.requests.push(request)
    const result = new Promise<WorkflowResult>((resolve) => { this.settle = resolve })
    request.signal?.addEventListener('abort', () => {
      this.settle({ value: null, stopReason: 'cancelled', error: 'signal', agentsStarted: 0 })
    }, { once: true })
    return {
      id: WorkflowRunId('run-1'),
      meta: { name: 'stub-flow', description: 'd' },
      result,
      cancel: (reason?: string) => {
        this.cancels.push(reason ?? 'cancelled')
        this.settle({ value: null, stopReason: 'cancelled', ...reason === undefined ? {} : { error: reason }, agentsStarted: 0 })
      },
      dispose: () => {
        this.disposed += 1
        return Promise.resolve()
      },
    }
  }
}

async function setup(config?: { toolName?: string; maxResultChars?: number }) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(StubEngine)
  await ctx.plugin(toolWorkflow, config ?? {})
  const engine = ctx.workflows as StubEngine
  const parent = { id: SessionId('caller'), options: {} } as unknown as Agent
  return { ctx, engine, parent }
}

const SCRIPT = 'return 1'
const META = { name: 'audit', description: 'd' }

function execute(ctx: Context, args: unknown, extra?: { agent?: Agent; signal?: AbortSignal }): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId('call-1'),
    name: 'workflow',
    arguments: args,
    ...extra?.agent ? { agent: extra.agent } : {},
    ...extra?.signal ? { signal: extra.signal } : {},
  })
}

describe('dsh-tool-workflow', () => {
  it('starts a run with the script/args/parent/signal and renders the completed value', async () => {
    const { ctx, engine, parent } = await setup()
    const controller = new AbortController()
    const pending = execute(ctx, { script: SCRIPT, meta: META, args: { files: ['a.ts'] } }, { agent: parent, signal: controller.signal })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(1) })
    expect(engine.requests[0]).toMatchObject({ script: SCRIPT, meta: META, args: { files: ['a.ts'] }, parent })
    expect(engine.requests[0]!.signal).toBe(controller.signal)
    engine.settle({ value: { findings: [1, 2] }, stopReason: 'completed', agentsStarted: 7 })
    const result = await pending
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected workflow success')
    expect(result.value).toEqual({ runId: 'run-1', agentsStarted: 7, result: { findings: [1, 2] } })
    const rendered = (result.content[0] as { text: string }).text
    expect(rendered).toContain('workflow "audit" completed (7 agents)')
    expect(rendered).toContain('"findings"')
    expect(engine.disposed).toBe(1)
  })

  it('maps a non-completed stop reason to an isError result (and still disposes)', async () => {
    const { ctx, engine, parent } = await setup()
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(1) })
    engine.settle({ value: null, stopReason: 'error', error: 'script threw: boom', agentsStarted: 2 })
    const result = await pending
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('workflow run failed: script threw: boom')
    expect(engine.disposed).toBe(1)
  })

  it('reports a cancelled run distinctly (with and without a reason)', async () => {
    const { ctx, engine, parent } = await setup()
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(1) })
    engine.settle({ value: null, stopReason: 'cancelled', error: 'user', agentsStarted: 0 })
    const result = await pending
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('workflow run was cancelled (user)')

    const bare = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(2) })
    engine.settle({ value: null, stopReason: 'cancelled', agentsStarted: 0 })
    expect(((await bare).content[0] as { text: string }).text.trim().endsWith('cancelled')).toBe(true)
  })

  it('an error result without a message renders the unknown-error fallback', async () => {
    const { ctx, engine, parent } = await setup()
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(1) })
    engine.settle({ value: null, stopReason: 'error', agentsStarted: 0 })
    expect(((await pending).content[0] as { text: string }).text).toContain('unknown error')
  })

  it('cancels the run when exec.signal aborts MID-FLIGHT (the abort bridge)', async () => {
    const { ctx, engine, parent } = await setup()
    const controller = new AbortController()
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent, signal: controller.signal })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(1) })
    controller.abort()
    const result = await pending
    expect(result.isError).toBe(true)
    expect(engine.cancels).toContain('parent step aborted')
    expect(engine.disposed).toBe(1)
  })

  it('a synchronous engine start throw (meta/parse failure) becomes an isError result', async () => {
    const { ctx, engine, parent } = await setup()
    engine.startError = new Error('invalid meta: meta.name must be a non-empty string')
    const result = await execute(ctx, { script: 'nope', meta: { name: '', description: 'd' } }, { agent: parent })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('meta.name must be a non-empty string')
  })

  it('requires a calling agent (fails loud without exec.agent)', async () => {
    const { ctx, engine } = await setup()
    const result = await execute(ctx, { script: SCRIPT, meta: META })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('requires a calling agent')
    expect(engine.requests.length).toBe(0)
  })

  it('validates its own arguments via the schema DSL (missing script)', async () => {
    const { ctx, parent } = await setup()
    const result = await execute(ctx, {}, { agent: parent })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('INVALID_ARGS')
  })

  it('skips workflow startup when exec.signal is already aborted', async () => {
    const { ctx, engine, parent } = await setup()
    const controller = new AbortController()
    controller.abort()
    const result = await execute(ctx, { script: SCRIPT, meta: META }, { agent: parent, signal: controller.signal })
    expect(result.isError).toBe(true)
    expect(result.error).toEqual({
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    })
    expect(engine.requests).toHaveLength(0)
    expect(engine.cancels).toHaveLength(0)
    expect(engine.disposed).toBe(0)
  })

  it('truncates an oversized rendered value with a notice (maxResultChars)', async () => {
    const { ctx, engine, parent } = await setup({ maxResultChars: 40 })
    const pending = execute(ctx, { script: SCRIPT, meta: META }, { agent: parent })
    await vi.waitFor(() => { expect(engine.requests.length).toBe(1) })
    engine.settle({ value: { blob: 'x'.repeat(500) }, stopReason: 'completed', agentsStarted: 1 })
    const result = await pending
    if (result.isError) throw new Error('expected workflow success')
    expect(result.value).toEqual({ runId: 'run-1', agentsStarted: 1, result: { blob: 'x'.repeat(500) } })
    const rendered = (result.content[0] as { text: string }).text
    expect(rendered).toContain('[truncated:')
    expect(rendered.length).toBeLessThan(400)
  })

  it('registers under a configured toolName and unregisters on fiber dispose (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(StubEngine)
    const fiber = await ctx.plugin(toolWorkflow, { toolName: 'orchestrate' })
    expect(ctx.tools.get('orchestrate')).toBeDefined()
    expect(ctx.tools.get('workflow')).toBeUndefined()
    // The usage-policy prompt section rides the same registration: present
    // under the CONFIGURED name (its guidance names the tool it describes)…
    const sections = (await ctx.systemPrompt.assemble()).sections
    const section = sections.find(s => s.name === 'tool:orchestrate')
    expect(section?.text).toContain('orchestrate')
    expect(sections.some(s => s.name === 'tool:workflow')).toBe(false)
    await fiber.dispose()
    expect(ctx.tools.get('orchestrate')).toBeUndefined()
    // …and gone with the fiber — a reload must not leak a stale section.
    expect((await ctx.systemPrompt.assemble()).sections.some(s => s.name === 'tool:orchestrate')).toBe(false)
  })

  it('presents a generic pending card titled by the meta name, with the script as rawInput', async () => {
    const { ctx } = await setup()
    const tool = ctx.tools.get('workflow')!
    const view = tool.presentCall!({ script: SCRIPT, meta: META })
    expect(view).toMatchObject({ card: 'generic', title: 'workflow: audit', rawInput: SCRIPT })
  })

  it('presentResult keeps the generic card; presentation is pure and replay-safe on malformed args', async () => {
    const { ctx } = await setup()
    const tool = ctx.tools.get('workflow')!
    expect(tool.presentResult!({ script: SCRIPT, meta: META }, { content: [], isError: false })).toEqual({ card: 'generic' })
    // defineTool soft-validates presentation args: a malformed logged shape
    // (wrong fields entirely, or a call missing its meta) falls back to
    // undefined instead of throwing mid-replay.
    expect(tool.presentCall!({ not: 'the schema' })).toBeUndefined()
    expect(tool.presentCall!({ script: SCRIPT })).toBeUndefined()
  })

  it('has the namespace-plugin export shape (no stray default)', () => {
    expect('default' in toolWorkflow).toBe(false)
    expect(toolWorkflow.name).toBe('tool-workflow')
    expect(toolWorkflow.inject).toEqual(['tools', 'workflows', 'systemPrompt'])
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolWorkflow) as Record<string, unknown>
    expect(unwrapped).toBe(toolWorkflow)
    expect(typeof unwrapped.apply).toBe('function')
  })

  describe('composition with the REAL worker-thread engine (the mock above must stay honest)', () => {
    it('an abort releases the tool even when the script parks on a promise no hook owns', async () => {
      // The tool and loop await run.result before cleanup, so cancellation must settle a script
      // parked on an unowned promise. Exercise that guarantee through the real registry and worker.
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRegistry)
      await ctx.plugin(SubagentService)
      ctx.subagents.registerProvider({
        name: 'spawn',
        capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
        inheritsParentContext: false,
        start: () => Promise.reject(new Error('the parked-script fixture must not start a child')),
      })
      await ctx.plugin(WorkerWorkflowEngine, { disposeGraceMs: 30 })
      await ctx.plugin(toolWorkflow, {})
      const parent = { id: SessionId('caller'), options: {} } as unknown as Agent
      const controller = new AbortController()
      const pending = execute(ctx, {
        script: 'await new Promise(() => {})\nreturn 1',
        meta: { name: 'stuck', description: 'parks forever' },
      }, { agent: parent, signal: controller.signal })
      // Give the run a beat to start (past its synchronous slice), then abort.
      await new Promise(resolve => setTimeout(resolve, 20))
      controller.abort('user abort')
      const result = await pending
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain('cancelled')
    })
  })
})
