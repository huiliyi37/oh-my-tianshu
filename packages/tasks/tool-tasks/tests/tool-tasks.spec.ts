import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TaskId } from '@deepseek-ai/dsh-tasks'
import LocalTaskService from '@deepseek-ai/dsh-tasks-local'
import type { TaskHooks, TaskOutcome, TaskSnapshot, TaskStart } from '@deepseek-ai/dsh-tasks'
import * as ToolTasks from '@deepseek-ai/dsh-tool-tasks'
import { statusLine } from '@deepseek-ai/dsh-tool-tasks'

const testToolSignal = new AbortController().signal

const agentRegistryDisposers = new WeakMap<Agent, () => void>()

async function setup(config: ToolTasks.Config = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  const agentsFiber = await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalTaskService)
  const toolsFiber = await ctx.plugin(ToolTasks, config)
  return { ctx, agentsFiber, toolsFiber }
}

/**
 * A fake agent with the shared agent/session identity, registered in
 * `ctx.agents` with a dedicated lifecycle scope.
 */
function fakeAgent(ctx: Context, sessionId: string, inject: (...args: unknown[]) => void = () => {}): Agent {
  const scopeFiber = ctx.plugin(() => {})
  const id = SessionId(sessionId)
  const agent = {
    id,
    ctx: scopeFiber.ctx,
    inject,
    session: { id, header: { version: 0, id, createdAt: 0 } },
  } as unknown as Agent
  agentRegistryDisposers.set(agent, ctx.agents.register(agent))
  return agent
}

function detachAgent(agent: Agent): void {
  const dispose = agentRegistryDisposers.get(agent)
  if (dispose === undefined) throw new Error(`missing registry disposer for agent "${agent.id}"`)
  dispose()
}

/** A controllable producer start-spec (settle `done` on demand, record cancels). */
function producer(overrides: Partial<Omit<TaskStart, 'run'> & TaskHooks> = {}) {
  let settle!: (outcome: TaskOutcome) => void
  const cancels: (string | undefined)[] = []
  const { kind = 'bash', label = 'sleep 60', owner, outputLimitBytes, ...hookOverrides } = overrides
  const hooks: TaskHooks = {
    cancel(reason) { cancels.push(reason) },
    done: new Promise<TaskOutcome>((res) => { settle = res }),
    ...hookOverrides,
  }
  const spec: TaskStart = {
    kind,
    label,
    ...owner !== undefined ? { owner } : {},
    ...outputLimitBytes !== undefined ? { outputLimitBytes } : {},
    run: () => { return hooks },
  }
  return { spec, settle, cancels }
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, agent?: Agent) {
  return ctx.tools.execute({ signal: testToolSignal, callId: CallId(`call-${++callCounter}`), name, arguments: args, ...agent ? { agent } : {} })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const tick = () => new Promise<void>(r => setTimeout(r, 0))

describe('tool-tasks setup', () => {
  it('attaches the control surface on load and detaches it with the fiber', async () => {
    const { ctx, toolsFiber } = await setup()
    expect(() => ctx.tasks.start(producer().spec)).not.toThrow()
    await toolsFiber.dispose()
    expect(() => ctx.tasks.start(producer().spec)).toThrow('no control surface is attached')
  })

  it('rejects a config whose default wait exceeds the cap', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LocalTaskService)
    await expect(ctx.plugin(ToolTasks, { waitTimeoutMs: 100, maxWaitTimeoutMs: 50 }))
      .rejects.toThrow('waitTimeoutMs (100) exceeds maxWaitTimeoutMs (50)')
  })

  it('renders status lines with and without producer detail', () => {
    const base = { id: 'bash-1', kind: 'bash', label: 'x', startedAt: 0, reported: false } as unknown as TaskSnapshot
    expect(statusLine({ ...base, status: 'running' })).toBe('[status: running]')
    expect(statusLine({ ...base, status: 'completed', detail: 'exit code: 0' })).toBe('[status: completed, exit code: 0]')
  })

  it('applies the built-in wait bounds when apply() receives a bare config', async () => {
    // Bypasses the schemastery defaults on purpose: apply() must stand on its
    // own `??` fallbacks when embedded programmatically without the schema.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LocalTaskService)
    ToolTasks.apply(ctx, {})
    expect(ctx.tools.get('task_output')).toBeDefined()
    expect(() => ctx.tasks.start(producer().spec)).not.toThrow()
  })
})

describe('task_output', () => {
  it('reads a consuming delta with a trailing status line', async () => {
    const { ctx } = await setup()
    const chunks = ['line one\n', '']
    ctx.tasks.start(producer({ readOutput: () => chunks.shift() ?? '' }).spec)

    // A body already ending in a newline gets no doubled separator.
    const first = await call(ctx, 'task_output', { task_id: 'bash-1' })
    if (first.isError) throw new Error('expected task_output success')
    const firstValue = first.value as { text: string; task: Record<string, unknown> }
    expect(firstValue).toMatchObject({
      text: 'line one\n',
      task: { id: 'bash-1', kind: 'bash', label: 'sleep 60', status: 'running' },
    })
    expect(firstValue.task).not.toHaveProperty('ownerSession')
    expect(firstValue.task).not.toHaveProperty('reported')
    expect(text(first)).toBe('line one\n[status: running]')
    expect(text(await call(ctx, 'task_output', { task_id: 'bash-1' }))).toBe('(no new output)\n[status: running]')
  })

  it('returns the final output of a settled final-output task', async () => {
    const { ctx } = await setup()
    const p = producer({ kind: 'subagent', label: 'research' })
    ctx.tasks.start(p.spec)
    expect(text(await call(ctx, 'task_output', { task_id: 'subagent-1' }))).toBe('(no new output)\n[status: running]')

    p.settle({ status: 'completed', detail: 'completed', output: 'the answer' })
    await tick()
    expect(text(await call(ctx, 'task_output', { task_id: 'subagent-1' }))).toBe('the answer\n[status: completed, completed]')
  })

  it('applies a producer limit to the complete body and status result', async () => {
    const { ctx } = await setup()
    ctx.tasks.start(producer({
      outputLimitBytes: 48,
      readOutput: () => '界'.repeat(100),
    }).spec)

    const output = text(await call(ctx, 'task_output', { task_id: 'bash-1' }))
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(48)
    expect(output).toContain('[status: running]')
  })

  it('preserves empty and newline-terminated output under a producer limit', async () => {
    const { ctx } = await setup()
    const chunks = ['', 'line\n']
    ctx.tasks.start(producer({
      outputLimitBytes: 64,
      readOutput: () => chunks.shift() ?? '',
    }).spec)

    expect(text(await call(ctx, 'task_output', { task_id: 'bash-1' })))
      .toBe('(no new output)\n[status: running]')
    expect(text(await call(ctx, 'task_output', { task_id: 'bash-1' })))
      .toBe('line\n[status: running]')
  })

  it('bounds post-policy output without restoring the canonical status rendering', async () => {
    const { ctx } = await setup()
    ctx.tasks.start(producer({
      outputLimitBytes: 64,
      readOutput: () => 'canonical output',
    }).spec)
    ctx.on('tools/post-execute', (exec, _result, next) => {
      if (exec.name !== 'task_output') return next()
      return Promise.resolve({ kind: 'accept', content: [{ type: 'text', text: 'p'.repeat(1_000) }] })
    })

    const result = await call(ctx, 'task_output', { task_id: 'bash-1' })
    expect(Buffer.byteLength(text(result))).toBeLessThanOrEqual(64)
    expect(text(result)).toContain('[result truncated]')
    expect(text(result)).not.toContain('[status: running]')
  })

  it('applies a producer limit to a normalized read failure', async () => {
    const { ctx } = await setup()
    ctx.tasks.start(producer({
      outputLimitBytes: 64,
      readOutput: () => { throw new Error('read failed: '.repeat(100)) },
    }).spec)

    const result = await call(ctx, 'task_output', { task_id: 'bash-1' })
    expect(result.isError).toBe(true)
    expect(Buffer.byteLength(text(result))).toBeLessThanOrEqual(64)
    expect(text(result)).toContain('[result truncated]')
  })

  it('bounds pre-, around-, and post-execute policy outcomes and failures', async () => {
    const { ctx } = await setup()
    for (let index = 0; index < 5; index += 1) {
      ctx.tasks.start(producer({ outputLimitBytes: 64 }).spec)
    }
    ctx.on('tools/pre-execute', async (exec, next) => {
      const taskId = (exec.arguments as { task_id?: unknown }).task_id
      if (taskId === 'bash-1') return { kind: 'deny', reason: 'd'.repeat(1_000) }
      if (taskId === 'bash-3') throw new Error(`pre failed: ${'p'.repeat(1_000)}`)
      return next()
    })
    ctx.on('tools/execute', async (exec, next) => {
      const taskId = (exec.arguments as { task_id?: unknown }).task_id
      if (taskId === 'bash-2') {
        return {
          content: [],
          isError: false,
          value: {
            text: 'a'.repeat(1_000),
            task: {
              id: 'bash-2', kind: 'bash', label: 'sleep 60', status: 'running', startedAt: 0,
            },
          },
        }
      }
      if (taskId === 'bash-4') throw new Error(`around failed: ${'e'.repeat(1_000)}`)
      return next()
    })
    ctx.on('tools/post-execute', async (exec, _result, next) => {
      const taskId = (exec.arguments as { task_id?: unknown }).task_id
      if (taskId === 'bash-5') throw new Error(`post failed: ${'o'.repeat(1_000)}`)
      return next()
    })

    const denied = await call(ctx, 'task_output', { task_id: 'bash-1' })
    expect(denied.isError).toBe(true)
    expect(Buffer.byteLength(text(denied))).toBeLessThanOrEqual(64)
    expect(text(denied)).toContain('[result truncated]')

    const shortCircuited = await call(ctx, 'task_output', { task_id: 'bash-2' })
    expect(shortCircuited.isError).toBe(false)
    expect(Buffer.byteLength(text(shortCircuited))).toBeLessThanOrEqual(64)
    expect(text(shortCircuited)).toContain('[output truncated]')

    const failures = [
      await call(ctx, 'task_output', { task_id: 'bash-3' }),
      await call(ctx, 'task_output', { task_id: 'bash-4' }),
      await call(ctx, 'task_output', { task_id: 'bash-5' }),
    ]
    for (const failure of failures) {
      expect(failure.isError).toBe(true)
      expect(Buffer.byteLength(text(failure))).toBeLessThanOrEqual(64)
      expect(text(failure)).toContain('[result truncated]')
    }
  })

  it('wait: true blocks until settlement and reports the terminal state', async () => {
    const { ctx } = await setup()
    const p = producer({ kind: 'subagent', label: 'research' })
    ctx.tasks.start(p.spec)

    const pending = call(ctx, 'task_output', { task_id: 'subagent-1', wait: true })
    p.settle({ status: 'completed', output: 'done deal' })
    expect(text(await pending)).toBe('done deal\n[status: completed]')
  })

  it('wait: true times out against the configured cap and leaves the task alive', async () => {
    const { ctx } = await setup({ waitTimeoutMs: 10, maxWaitTimeoutMs: 20 })
    ctx.tasks.start(producer().spec)

    // A model-supplied timeout far above the cap is clamped: this returns
    // promptly (≤ the 20ms cap), not after ten minutes.
    const result = await call(ctx, 'task_output', { task_id: 'bash-1', wait: true, timeout_ms: 600_000 })
    expect(text(result)).toBe('(no new output)\n[status: running]')
  })

  it('rejects an empty or unknown task id as an errored result', async () => {
    const { ctx } = await setup()
    expect((await call(ctx, 'task_output', { task_id: '' })).isError).toBe(true)
    const unknown = await call(ctx, 'task_output', { task_id: 'bash-99' })
    expect(unknown.isError).toBe(true)
    expect(text(unknown)).toContain('unknown task bash-99')
  })
})

describe('task_list', () => {
  it('lists caller-visible tasks and renders the empty case', async () => {
    const { ctx } = await setup()
    expect(text(await call(ctx, 'task_list', {}))).toBe('(no background tasks)')

    const alice = fakeAgent(ctx, 'sess-alice')
    ctx.tasks.start(producer({ owner: alice, label: 'pnpm test' }).spec)
    ctx.tasks.start(producer({ kind: 'subagent', label: 'open research' }).spec)
    const p = producer({ owner: alice, label: 'build' })
    ctx.tasks.start(p.spec)
    p.settle({ status: 'completed', detail: 'exit code: 0' })
    await tick()

    const listed = await call(ctx, 'task_list', {}, alice)
    if (listed.isError) throw new Error('expected task_list success')
    const listedValue = listed.value as Array<Record<string, unknown>>
    expect(listedValue).toHaveLength(3)
    expect(listedValue[0]).toMatchObject({ id: 'bash-1', kind: 'bash', label: 'pnpm test', status: 'running' })
    expect(listedValue[2]).toMatchObject({ id: 'bash-2', kind: 'bash', label: 'build', status: 'completed', detail: 'exit code: 0' })
    for (const task of listedValue) {
      expect(task).not.toHaveProperty('ownerSession')
      expect(task).not.toHaveProperty('reported')
    }
    expect(text(listed)).toBe([
      'bash-1 [bash] running — pnpm test',
      'subagent-1 [subagent] running — open research',
      'bash-2 [bash] completed — build',
    ].join('\n'))
    // A different caller sees only the unowned task.
    const bob = fakeAgent(ctx, 'sess-bob')
    expect(text(await call(ctx, 'task_list', {}, bob))).toBe('subagent-1 [subagent] running — open research')
  })
})

describe('task_kill', () => {
  it('requests cancellation with the forwarded reason', async () => {
    const { ctx } = await setup()
    const p = producer()
    ctx.tasks.start(p.spec)

    const result = await call(ctx, 'task_kill', { task_id: 'bash-1', reason: 'superseded' })
    if (result.isError) throw new Error('expected task_kill success')
    const killValue = result.value as { outcome: string; task: Record<string, unknown> }
    expect(killValue).toMatchObject({
      outcome: 'cancellation-requested',
      task: { id: 'bash-1', kind: 'bash', label: 'sleep 60', status: 'stopping' },
    })
    expect(killValue.task).not.toHaveProperty('ownerSession')
    expect(killValue.task).not.toHaveProperty('reported')
    expect(text(result)).toBe('requested cancellation of task bash-1')
    expect(p.cancels).toEqual(['superseded'])
  })

  it('applies the producer output limit to a cancellation acknowledgement', async () => {
    const { ctx } = await setup()
    const p = producer({ outputLimitBytes: 8 })
    ctx.tasks.start(p.spec)

    const result = await call(ctx, 'task_kill', { task_id: 'bash-1' })
    expect(Buffer.byteLength(text(result))).toBeLessThanOrEqual(8)
    expect(p.cancels).toEqual([undefined])
  })

  it('applies the producer output limit to a normalized cancellation failure', async () => {
    const { ctx } = await setup()
    ctx.tasks.start(producer({
      outputLimitBytes: 64,
      cancel: () => { throw new Error('cancel failed: '.repeat(100)) },
    }).spec)

    const result = await call(ctx, 'task_kill', { task_id: 'bash-1' })
    expect(result.isError).toBe(true)
    expect(Buffer.byteLength(text(result))).toBeLessThanOrEqual(64)
    expect(text(result)).toContain('[result truncated]')
    expect(ctx.tasks.get(TaskId('bash-1'))).toMatchObject({ status: 'running', reported: false })
  })

  it('bounds single-text post policy while preserving structured policy results', async () => {
    const { ctx } = await setup()
    ctx.on('tools/post-execute', (exec, _result, next) => {
      if (exec.name !== 'task_kill') { return next() }
      const reason = (exec.arguments as { reason?: unknown }).reason
      if (reason === 'replace') {
        return Promise.resolve({ kind: 'accept', content: [{ type: 'text', text: 'r'.repeat(1_000) }] })
      }
      if (reason === 'block') {
        return Promise.resolve({ kind: 'block', feedback: [{ type: 'text', text: 'b'.repeat(1_000) }] })
      }
      if (reason === 'multi') {
        return Promise.resolve({
          kind: 'block',
          feedback: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }],
        })
      }
      if (reason === 'reasoning') {
        return Promise.resolve({ kind: 'block', feedback: [{ type: 'reasoning', text: 'policy detail' }] })
      }
      return next()
    })
    for (let index = 0; index < 4; index += 1) {
      ctx.tasks.start(producer({ outputLimitBytes: 64 }).spec)
    }

    const replaced = await call(ctx, 'task_kill', { task_id: 'bash-1', reason: 'replace' })
    expect(replaced.isError).toBe(false)
    expect(Buffer.byteLength(text(replaced))).toBeLessThanOrEqual(64)
    expect(text(replaced)).toContain('[result truncated]')

    const blocked = await call(ctx, 'task_kill', { task_id: 'bash-2', reason: 'block' })
    expect(blocked.isError).toBe(true)
    expect(Buffer.byteLength(text(blocked))).toBeLessThanOrEqual(64)
    expect(text(blocked)).toContain('[result truncated]')

    const multi = await call(ctx, 'task_kill', { task_id: 'bash-3', reason: 'multi' })
    expect(multi.content).toEqual([{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }])

    const reasoning = await call(ctx, 'task_kill', { task_id: 'bash-4', reason: 'reasoning' })
    expect(reasoning.content).toEqual([{ type: 'reasoning', text: 'policy detail' }])
  })

  it('reports an already-finished task without consuming its pending delta', async () => {
    const { ctx } = await setup()
    let delta = 'unread tail'
    const p = producer({ readOutput: () => { const d = delta; delta = ''; return d } })
    ctx.tasks.start(p.spec)
    p.settle({ status: 'completed', detail: 'exit code: 0' })
    await tick()

    const killed = await call(ctx, 'task_kill', { task_id: 'bash-1' })
    if (killed.isError) throw new Error('expected task_kill success')
    expect(killed.value).toMatchObject({
      outcome: 'already-finished',
      task: { id: 'bash-1', kind: 'bash', label: 'sleep 60', status: 'completed', detail: 'exit code: 0' },
    })
    expect(text(killed)).toBe('task bash-1 had already finished [status: completed, exit code: 0]')
    // The kill described the task via a non-consuming snapshot: the delta is intact.
    expect(text(await call(ctx, 'task_output', { task_id: 'bash-1' }))).toBe('unread tail\n[status: completed, exit code: 0]')
  })

  it('rejects an empty task id as an errored result', async () => {
    const { ctx } = await setup()
    expect((await call(ctx, 'task_kill', { task_id: '' })).isError).toBe(true)
  })
})

describe('tool-owned UI presentation (presentCall)', () => {
  it('renders generic cards for all three control tools', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.get('task_output')?.presentCall?.({ task_id: 'bash-1' }))
      .toEqual({ card: 'generic', title: 'Read output from background task bash-1', kind: 'read', rawInput: 'bash-1' })
    expect(ctx.tools.get('task_list')?.presentCall?.({}))
      .toEqual({ card: 'generic', title: 'List background tasks', kind: 'read' })
    expect(ctx.tools.get('task_kill')?.presentCall?.({ task_id: 'subagent-2' }))
      .toEqual({ card: 'generic', title: 'Kill background task subagent-2', kind: 'execute', rawInput: 'subagent-2' })
  })
})

describe('completion notices', () => {
  it('injects a notice into the owning agent when an unreported task settles', async () => {
    const { ctx } = await setup()
    const inject = vi.fn()
    const owner = fakeAgent(ctx, 'sess-1', inject)
    const p = producer({ owner, label: 'pnpm test' })
    ctx.tasks.start(p.spec)

    p.settle({ status: 'completed', detail: 'exit code: 0' })
    await tick()
    expect(inject).toHaveBeenCalledTimes(1)
    expect(inject).toHaveBeenCalledWith({
      id: expect.any(String) as unknown,
      role: 'user',
      content: [{ type: 'text', text: 'background task bash-1 (bash: pnpm test) finished [status: completed, exit code: 0]. Read its output with task_output.' }],
      source: {
        kind: 'plugin',
        plugin: 'tool-tasks',
        form: 'notice',
        summary: 'bash pnpm test [status: completed, exit code: 0]',
      },
    })
  })

  it('preserves task ids and collection guidance in bounded completion notices', async () => {
    const { ctx } = await setup()
    const inject = vi.fn()
    const owner = fakeAgent(ctx, 'sess-1', inject)
    const first = producer({
      owner,
      kind: 'subagent',
      label: 'x'.repeat(1_000),
      outputLimitBytes: 64,
    })
    ctx.tasks.start(first.spec)
    first.settle({ status: 'completed', detail: 'd'.repeat(1_000) })
    await tick()

    expect(inject).toHaveBeenNthCalledWith(
      1,
      {
        id: expect.any(String) as unknown,
        role: 'user',
        content: [{ type: 'text', text: 'background task subagent-1\n[notice truncated]\nDone; task_output.' }],
        // The label and status detail are unbounded caller text, so the durable
        // one-line account caps itself rather than committing their full length.
        source: {
          kind: 'plugin',
          plugin: 'tool-tasks',
          form: 'notice',
          summary: `subagent ${'x'.repeat(110)}…`,
        },
      },
    )

    const second = producer({
      owner,
      kind: 'subagent',
      label: 'x'.repeat(1_000),
      outputLimitBytes: 80,
    })
    ctx.tasks.start(second.spec)
    second.settle({ status: 'completed', detail: 'd'.repeat(1_000) })
    await tick()

    const content = (inject.mock.calls[1]?.[0] as { content?: Array<{ type: string; text?: string }> } | undefined)?.content
    const notice = content?.[0]?.text ?? ''
    expect(Buffer.byteLength(notice)).toBeLessThanOrEqual(80)
    expect(notice).toContain('background task subagent-2 (subagent: xxxx')
    expect(notice).toContain('[notice truncated]\nDone; task_output.')
  })

  it('keeps the complete PTY task id and collection action at the minimum PTY limit', async () => {
    const { ctx } = await setup()
    for (let index = 0; index < 99; index += 1) {
      const prior = producer({ kind: 'pty-send' })
      ctx.tasks.start(prior.spec)
      prior.settle({ status: 'completed' })
    }
    const inject = vi.fn()
    const owner = fakeAgent(ctx, 'sess-1', inject)
    const target = producer({
      owner,
      kind: 'pty-send',
      label: 'x'.repeat(1_000),
      outputLimitBytes: 64,
    })
    ctx.tasks.start(target.spec)

    target.settle({ status: 'completed', detail: 'd'.repeat(1_000) })
    await tick()

    const content = (inject.mock.calls[0]?.[0] as { content?: Array<{ type: string; text?: string }> } | undefined)?.content
    const notice = content?.[0]?.text ?? ''
    expect(Buffer.byteLength(notice)).toBeLessThanOrEqual(64)
    expect(notice).toBe('background task pty-send-100\nDone; task_output.')
  })

  it('reserves the collection-action tail when a producer supplies a smaller budget', async () => {
    const { ctx } = await setup()
    const inject = vi.fn()
    const owner = fakeAgent(ctx, 'sess-1', inject)
    const tiny = producer({ owner, kind: 'pty-send', label: 'x'.repeat(100), outputLimitBytes: 8 })
    const short = producer({ owner, kind: 'pty-send', label: 'x'.repeat(100), outputLimitBytes: 32 })
    ctx.tasks.start(tiny.spec)
    ctx.tasks.start(short.spec)

    tiny.settle({ status: 'completed' })
    short.settle({ status: 'completed' })
    await tick()

    const tinyNotice = (inject.mock.calls[0]?.[0] as { content?: Array<{ text?: string }> } | undefined)?.content?.[0]?.text ?? ''
    const shortNotice = (inject.mock.calls[1]?.[0] as { content?: Array<{ text?: string }> } | undefined)?.content?.[0]?.text ?? ''
    expect(Buffer.byteLength(tinyNotice)).toBeLessThanOrEqual(8)
    expect(tinyNotice).toBe('_output.')
    expect(Buffer.byteLength(shortNotice)).toBeLessThanOrEqual(32)
    expect(shortNotice).toBe('background ta\nDone; task_output.')
  })

  it('suppresses the notice for a task the model already killed', async () => {
    const { ctx } = await setup()
    const inject = vi.fn()
    const owner = fakeAgent(ctx, 'sess-1', inject)
    const p = producer({ owner })
    ctx.tasks.start(p.spec)

    await call(ctx, 'task_kill', { task_id: 'bash-1' }, owner)
    p.settle({ status: 'killed' })
    await tick()
    expect(inject).not.toHaveBeenCalled()
  })

  it('suppresses the notice when a wait returned the terminal state', async () => {
    const { ctx } = await setup()
    const inject = vi.fn()
    const owner = fakeAgent(ctx, 'sess-1', inject)
    const p = producer({ owner, kind: 'subagent' })
    ctx.tasks.start(p.spec)

    const pending = call(ctx, 'task_output', { task_id: 'subagent-1', wait: true }, owner)
    p.settle({ status: 'completed', output: 'answer' })
    expect(text(await pending)).toContain('answer')
    expect(inject).not.toHaveBeenCalled()
  })

  it('drops the notice for unowned tasks without throwing', async () => {
    const { ctx } = await setup()
    // Unowned: settles with nobody to notify — nothing throws.
    const unowned = producer()
    ctx.tasks.start(unowned.spec)
    unowned.settle({ status: 'completed' })
    await tick()
  })

  it('does not route an old owner completion notice to a same-session replacement', async () => {
    const { ctx } = await setup()
    // Delivery into a tearing-down owner is a plain inject: the loop has no
    // terminal state, so the notice lands in the old owner's (detached)
    // session instead of throwing or re-routing.
    const oldInject = vi.fn()
    const oldOwner = fakeAgent(ctx, 'shared', oldInject)
    const p = producer({ owner: oldOwner })
    ctx.tasks.start(p.spec)

    detachAgent(oldOwner)
    const replacementInject = vi.fn()
    fakeAgent(ctx, 'shared', replacementInject)
    p.settle({ status: 'completed' })
    await tick()

    expect(oldInject).toHaveBeenCalledTimes(1)
    expect(replacementInject).not.toHaveBeenCalled()
  })

  it('surfaces an inject failure through listener containment (a real bug must be visible)', async () => {
    const { ctx } = await setup()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const owner = fakeAgent(ctx, 'sess-1', () => { throw new Error('unexpected inject bug') })
    const p = producer({ owner })
    ctx.tasks.start(p.spec)
    p.settle({ status: 'completed' })
    await tick()
    // The throw escapes the notice listener and is contained (logged) by the
    // registry's per-listener containment — visible, not swallowed.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unexpected inject bug'))
  })

  it('keeps using the exact owner after the agent registry is gone', async () => {
    const { ctx, agentsFiber } = await setup()
    const inject = vi.fn()
    const owner = fakeAgent(ctx, 'sess-1', inject)

    // Settlement must not depend on a later registry lookup: the exact owner
    // supplied at start remains the destination while its own scope is live.
    const p1 = producer({ owner })
    ctx.tasks.start(p1.spec)
    const p2 = producer({ owner })
    ctx.tasks.start(p2.spec)

    await agentsFiber.dispose()
    p1.settle({ status: 'completed' })
    p2.settle({ status: 'failed' })
    await tick()
    expect(inject).toHaveBeenCalledTimes(2)
  })
})
