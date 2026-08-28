import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { CallId } from '@huiliyi37/dsh-llm'
import { BashExecutor } from '@huiliyi37/dsh-bash'
import type { BashExecRequest, BashExecSpec, BashProcess, BashProcessRead, BashRunResult } from '@huiliyi37/dsh-bash'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import ToolRegistry, { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from '@huiliyi37/dsh-tools'
import AgentRegistry from '@huiliyi37/dsh-agent'
import type { Agent } from '@huiliyi37/dsh-agent'
import SessionStore, { SessionId } from '@huiliyi37/dsh-session'
import SessionPersistenceJsonl from '@huiliyi37/dsh-session-persistence-jsonl'
import LocalTaskService from '@huiliyi37/dsh-tasks-local'
import * as ToolTasks from '@huiliyi37/dsh-tool-tasks'
import ApprovalService from '@huiliyi37/dsh-user-approval'
import type { ApprovalOutcome } from '@huiliyi37/dsh-user-approval'
import { LocalBashExecutor } from '@huiliyi37/dsh-bash-local'
import LocalSubprocessService from '@huiliyi37/dsh-subprocess-local'
import SandboxPolicyService from '@huiliyi37/dsh-sandbox-policy'
import * as ToolBash from '@huiliyi37/dsh-tool-bash'
import * as BashEnvPlugin from '@huiliyi37/dsh-bash-env'
import { processOutcome } from '../src/background.ts'
import { parseExitStatus, renderProcessRead, renderResult } from '../src/render.ts'
import SpillStore, { SpillLocator } from '@huiliyi37/dsh-spill'
import type { SaveTextSpill, SpillRef } from '@huiliyi37/dsh-spill'

const testToolSignal = new AbortController().signal

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-tool-bash-spec-'))

/** Foreground-only harness: no task runtime (backgrounding fails loud here). */
async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalSubprocessService)
  ;(ctx.subprocess as LocalSubprocessService).internals = { spillDir }
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
  await ctx.plugin(ToolBash)
  return ctx
}

/** Full harness: the generic task runtime + its control surface, then the bash tool. */
async function setupWithTasks() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalTaskService)
  await ctx.plugin(ToolTasks)
  await ctx.plugin(LocalSubprocessService)
  ;(ctx.subprocess as LocalSubprocessService).internals = { spillDir }
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
  await ctx.plugin(ToolBash)
  return ctx
}

/**
 * Build a fake {@link Agent} with the shared agent/session identity, give it a
 * dedicated lifecycle fiber for `Agent.ctx`, and register it in `ctx.agents`.
 */
function registerFakeAgent(ctx: Context, sessionId: string, inject: (...args: unknown[]) => void = () => {}): Agent {
  const scopeFiber = ctx.plugin(() => {})
  const id = SessionId(sessionId)
  const agent = {
    id,
    ctx: scopeFiber.ctx,
    inject,
    session: { id, header: { version: 0, id, createdAt: 0 } },
  } as unknown as Agent
  ctx.agents.register(agent)
  return agent
}
let callCounter = 0
function call(ctx: Context, name: string, args: unknown, agent?: Agent) {
  return ctx.tools.execute({ signal: testToolSignal, callId: CallId(`call-${++callCounter}`), name, arguments: args, ...agent ? { agent } : {} })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

async function callUntilText(
  ctx: Context,
  name: string,
  args: unknown,
  expected: string,
  timeoutMs = 5_000,
): Promise<Awaited<ReturnType<typeof call>>> {
  const deadline = Date.now() + timeoutMs
  let last: Awaited<ReturnType<typeof call>> | undefined
  while (Date.now() < deadline) {
    last = await call(ctx, name, args)
    if (text(last).includes(expected)) return last
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`${name} output did not include ${JSON.stringify(expected)}; last text was ${JSON.stringify(last !== undefined ? text(last) : '')}`)
}

class RecordingSandboxExecutor extends BashExecutor {
  readonly modes: Array<string | undefined> = []

  override get sandboxMode() {
    return 'read-only' as const
  }

  resolve(request: BashExecRequest): BashExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      timeoutMs: request.timeoutMs ?? 1000,
      ...request.signal ? { signal: request.signal } : {},
      sandboxPolicy: request.sandboxPolicy ?? { mode: 'read-only', workspaceRoot: process.cwd() },
    }
  }

  run(spec: BashExecSpec): Promise<BashRunResult> {
    this.modes.push(spec.sandboxPolicy?.mode)
    return Promise.resolve({
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: 'ok', truncated: false },
      stderr: { text: '', truncated: false },
      sandbox: {
        mode: spec.sandboxPolicy?.mode ?? 'read-only',
        denied: false,
        ...spec.command === 'without optional sandbox facts'
          ? {}
          : { enforcement: 'full' as const, runnerFailed: false },
      },
    })
  }

  start(spec: BashExecSpec): BashProcess {
    this.modes.push(spec.sandboxPolicy?.mode)
    return {
      status: 'completed',
      exitCode: 0,
      signal: null,
      done: Promise.resolve(),
      sandbox: { mode: spec.sandboxPolicy?.mode ?? 'read-only', denied: false },
      readOutput: () => ({ delta: '', lossy: false }),
      kill: () => false,
    }
  }
}

/** Test executor that records whether the background start boundary was crossed. */
class CountingStartExecutor extends BashExecutor {
  starts = 0

  resolve(request: BashExecRequest): BashExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? '/x',
      timeoutMs: request.timeoutMs ?? 0,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  run(): Promise<BashRunResult> { return Promise.reject(new Error('unused')) }

  start(): BashProcess {
    this.starts += 1
    return {
      status: 'completed',
      exitCode: 0,
      signal: null,
      done: Promise.resolve(),
      readOutput: () => ({ delta: '', lossy: false }),
      kill: () => false,
    }
  }
}

async function setupSandboxed(withApproval = false) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalTaskService)
  await ctx.plugin(ToolTasks)
  await ctx.plugin(SandboxPolicyService, {})
  await ctx.plugin(RecordingSandboxExecutor)
  if (withApproval) { await ctx.plugin(ApprovalService) }
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(ToolBash)
  return { ctx, bash: ctx.bash as RecordingSandboxExecutor }
}

function sandboxAgent(
  mode?: 'read-only' | 'workspace-write' | 'danger-full-access',
  ctx?: Context,
  onAppend?: (type: string) => void,
): Agent {
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [{ type: 'turn/start' }]
  if (mode !== undefined) events.push({ type: 'sandbox/mode', data: { mode } })
  const id = SessionId('sandbox-session')
  return {
    id,
    ...ctx === undefined ? {} : { ctx: ctx.plugin(() => {}).ctx },
    session: {
      id,
      header: { version: 0, id, createdAt: 0 },
      events,
      append: (type: string, data: Record<string, unknown>) => {
        const event = { type, data }
        events.push(event)
        onAppend?.(type)
        return event
      },
    },
  } as unknown as Agent
}

describe('bash tool', () => {
  it('returns stdout for a successful command', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'bash', { command: 'echo hello', description: 'test command' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected bash success')
    expect(result.value).toMatchObject({
      kind: 'foreground',
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      stdout: { text: 'hello\n', truncated: false },
      stderr: { text: '', truncated: false },
    })
    expect(text(result)).toBe('hello\n')
  })

  it('reports (no output) for silent commands', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'bash', { command: 'true', description: 'test command' })
    expect(text(result)).toBe('(no output)')
  })

  it('marks stderr sections', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'bash', { command: 'echo out; echo err >&2', description: 'test command' })
    expect(text(result)).toBe('out\n[stderr]\nerr\n')
    expect(result.isError).toBe(false)
  })

  it('reports non-zero exits without isError', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'bash', { command: 'echo failing; exit 3', description: 'test command' })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('failing\n[exit code: 3]')
  })

  it('reports timeout kills with both markers (timeout first)', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'bash', { command: 'sleep 60', description: 'test command', timeoutMs: 100 })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('(no output)\n[timed out after 100ms]\n[killed by signal: SIGTERM]')
  })

  it('reports a timeout even when the command traps the signal and exits 0', async () => {
    // The signal-independent timeout marker: a trapped SIGTERM that exits 0
    // after our timer fired must NOT look like a clean success. (bash may
    // print "Terminated" to stderr for the killed sleep — environment
    // dependent — so assert the marker, not the exact body.)
    const ctx = await setup()
    const result = await call(ctx, 'bash', { command: 'trap "exit 0" TERM; sleep 60', description: 'test command', timeoutMs: 100 })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('[timed out after 100ms]')
    expect(text(result)).not.toContain('[exit code:')
  })

  it('reports truncation with the spill path', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LocalSubprocessService)
    ;(ctx.subprocess as LocalSubprocessService).internals = { spillDir }
    await ctx.plugin(LocalBashExecutor, { maxOutputBytes: 100, graceMs: 200 })
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(ToolBash)
    const result = await call(ctx, 'bash', { command: 'for i in $(seq 1 100); do printf "line-%04d\\n" $i; done', description: 'test command' })
    expect(text(result)).toContain('[output truncated; full output: ')
    expect(text(result)).toContain('line-0100')
  })

  it('honors workdir', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'bash', { command: 'pwd', description: 'test command', workdir: '/tmp' })
    expect(text(result).trim()).toMatch(/\/tmp$/)
  })

  it('surfaces spawn failures as isError', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'bash', { command: 'true', description: 'test command', workdir: '/nonexistent-dsh' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/ENOENT/)
  })

  it('surfaces foreground aborts as the structured TOOL_ABORTED error', async () => {
    const ctx = await setup()
    const controller = new AbortController()
    const pending = ctx.tools.execute({
      callId: CallId('call-abort'),
      name: 'bash',
      arguments: { command: 'sleep 60', description: 'test command' },
      signal: controller.signal,
    })
    setTimeout(() => { controller.abort() }, 50)
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({
      message: 'tool call aborted',
      info: { name: 'AbortError', code: TOOL_ABORTED },
    })
  })

  // Type and required-key violations are rejected by the harness
  // (defineTool validates against the ParameterSchemaSpec — the arg-validation Agent Note) before execute.
  it.each([
    [{}, /missing required property "command"/],
    [{ command: 42, description: 'd' }, /"command" must be a string/],
    [{ command: 'x' }, /missing required property "description"/],
    [{ command: 'x', description: 7 }, /"description" must be a string/],
    [{ command: 'x', description: 'd', timeoutMs: 'soon' }, /"timeoutMs" must be a number/],
    [{ command: 'x', description: 'd', workdir: 7 }, /"workdir" must be a string/],
    [{ command: 'x', description: 'd', run_in_background: 'yes' }, /"run_in_background" must be a boolean/],
  ])('rejects schema-invalid args %j', async (args, pattern) => {
    const ctx = await setup()
    const result = await call(ctx, 'bash', args)
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(pattern)
  })

  // Value constraints the ParameterSchemaSpec can't express stay in the tool body.
  it.each([
    [{ command: '  ', description: 'd' }, /invalid command/],
    [{ command: 'x', description: '   ' }, /invalid description/],
    [{ command: 'x', description: 'd', timeoutMs: -1 }, /invalid timeoutMs/],
  ])('rejects value-invalid args %j', async (args, pattern) => {
    const ctx = await setup()
    const result = await call(ctx, 'bash', args)
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(pattern)
  })

  it('rejects a non-JSON numeric argument before tool-specific validation', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'bash', {
      command: 'x', description: 'd', timeoutMs: Number.NaN,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('tool execution arguments must be losslessly JSON-serializable')
  })

  it('registers the bash schema with run_in_background exposed by default', async () => {
    const ctx = await setup()
    const schemas = ctx.tools.schemas()
    expect(schemas.map(schema => schema.name)).toEqual(['bash'])
    const bashSchema = schemas[0]!
    expect(bashSchema.parameters).toMatchObject({
      type: 'object',
      required: ['command', 'description'],
    })
    expect(Object.keys(bashSchema.parameters.properties as Record<string, unknown>))
      .toContain('run_in_background')
    expect(bashSchema.description).toContain('task_output')
  })

  it('contributes the exit-code habit as its prompt section (guidance the descriptions cannot carry)', async () => {
    const ctx = await setup()
    // bash 现在落在稀疏表 TOOL_BASH=160：探针取相邻带位（150/170）
    ctx.systemPrompt.section({ name: 'test:before-bash', order: 150, text: 'before' })
    ctx.systemPrompt.section({ name: 'test:after-bash', order: 170, text: 'after' })
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(s => s.name === 'tool:bash')
    expect(assembly.sections.map(s => s.name)).toEqual([
      'harness:identity',
      'deployment:persona',
      'test:before-bash',
      'tool:bash',
      'test:after-bash',
    ])
    expect(section?.text).toContain('[exit code: N]')
  })

  it('unregisters everything when the plugin fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LocalSubprocessService)
    await ctx.plugin(LocalBashExecutor, {})
    await ctx.plugin(BashEnvPlugin)
    const fiber = await ctx.plugin(ToolBash)
    expect(ctx.tools.schemas()).toHaveLength(1)
    expect((await ctx.systemPrompt.assemble()).sections.map(s => s.name)).toEqual(['harness:identity', 'deployment:persona', 'tool:bash'])
    await fiber.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
    // Only the system-prompt plugin's own built-in sections remain.
    expect((await ctx.systemPrompt.assemble()).sections.map(s => s.name)).toEqual(['harness:identity', 'deployment:persona'])
  })

  it('tools depend on the executor: no registration without ctx.bash', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    // inject: ['tools', 'bash'] keeps the plugin pending until bash exists.
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(ToolBash)
    expect(ctx.tools.schemas()).toHaveLength(0)
    await ctx.plugin(LocalSubprocessService)
    await ctx.plugin(LocalBashExecutor, {})
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctx.tools.schemas()).toHaveLength(1)
  })

  it('applies the built-in background default when apply() receives a bare config', async () => {
    // Bypasses the schemastery defaults on purpose: apply() must stand on its
    // own `?? true` fallback when embedded programmatically without the schema.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LocalSubprocessService)
    await ctx.plugin(LocalBashExecutor, {})
    ToolBash.apply(ctx, {})
    const schema = ctx.tools.schemas()[0]!
    expect(Object.keys(schema.parameters.properties as Record<string, unknown>))
      .toContain('run_in_background')
  })
})

describe('background execution through the task runtime', () => {
  it('run_in_background acks with the task id, readable through the REAL task_output tool', async () => {
    const ctx = await setupWithTasks()
    const started = await call(ctx, 'bash', { command: 'echo bg-ok', description: 'test command', run_in_background: true })
    expect(started.isError).toBe(false)
    if (started.isError) throw new Error('expected background bash success')
    expect(started.value).toEqual({ kind: 'background', taskId: 'bash-1' })
    expect(text(started)).toBe('started background task bash-1')

    const read = await callUntilText(ctx, 'task_output', { task_id: 'bash-1' }, 'bg-ok')
    expect(text(read)).toContain('bg-ok')
    // A later read reports the terminal outcome in the generic status line.
    const final = await callUntilText(ctx, 'task_output', { task_id: 'bash-1' }, '[status: completed, exit code: 0]')
    expect(final.isError).toBe(false)
  })

  it('a running background task is killable through the REAL task_kill tool', async () => {
    const ctx = await setupWithTasks()
    await call(ctx, 'bash', { command: 'sleep 60', description: 'test command', run_in_background: true })

    const killed = await call(ctx, 'task_kill', { task_id: 'bash-1' })
    expect(text(killed)).toBe('requested cancellation of task bash-1')
    // The cancel reached the process handle; the task settles as killed with
    // the signal detail mapped by processOutcome.
    const final = await call(ctx, 'task_output', { task_id: 'bash-1', wait: true })
    expect(text(final)).toContain('[status: killed, signal: SIGTERM]')
  })

  it('a self-signal background exit is reported as killed through the REAL task_output tool', async () => {
    const ctx = await setupWithTasks()
    await call(ctx, 'bash', { command: 'kill -TERM $$', description: 'test command', run_in_background: true })

    const final = await call(ctx, 'task_output', { task_id: 'bash-1', wait: true })
    expect(text(final)).toContain('[status: killed, signal: SIGTERM]')
  })

  it('a background task started by an agent is registered with that agent as owner', async () => {
    // The producer must forward exec.agent as the task owner.
    const ctx = await setupWithTasks()
    const agent = registerFakeAgent(ctx, 'sess-owner')
    const started = await call(ctx, 'bash', { command: 'sleep 60', description: 'test command', run_in_background: true }, agent)
    expect(text(started)).toBe('started background task bash-1')

    const anon = await call(ctx, 'task_output', { task_id: 'bash-1' })
    expect(anon.isError).toBe(true)
    expect(text(anon)).toMatch(/belongs to another session/)

    const killed = await call(ctx, 'task_kill', { task_id: 'bash-1' }, agent)
    expect(killed.isError).toBe(false)
    await call(ctx, 'task_output', { task_id: 'bash-1', wait: true }, agent) // await settlement — no orphan
  })

  it('fails loud when the task runtime is not loaded', async () => {
    const ctx = await setup() // no LocalTaskService / ToolTasks
    const result = await call(ctx, 'bash', { command: 'sleep 60', description: 'test command', run_in_background: true })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('background tasks unavailable: load @huiliyi37/dsh-tasks and @huiliyi37/dsh-tool-tasks')
  })

  it('a pre-aborted call is skipped before the process starts', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalTaskService)
    await ctx.plugin(ToolTasks)
    await ctx.plugin(CountingStartExecutor)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(ToolBash)

    const controller = new AbortController()
    controller.abort()
    const result = await ctx.tools.execute({
      callId: CallId('call-pre-aborted'),
      name: 'bash',
      arguments: { command: 'sleep 60', description: 'test command', run_in_background: true },
      signal: controller.signal,
    })
    expect(result.isError).toBe(true)
    expect(result.error).toEqual({
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    })
    expect(text(result)).toBe('Error: tool call aborted before dispatch')
    expect((ctx.bash as CountingStartExecutor).starts).toBe(0)
  })

  it('never spawns the process when tasks.start preflight throws (no orphan, by construction)', async () => {
    // With no control surface, task preflight fails before the executor can spawn.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalTaskService)
    await ctx.plugin(CountingStartExecutor)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(ToolBash)

    const result = await call(ctx, 'bash', { command: 'sleep 60', description: 'test command', run_in_background: true })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no control surface is attached')
    // Declare-then-execute: the failed preflight means no process ever ran.
    expect((ctx.bash as CountingStartExecutor).starts).toBe(0)
  })

  it('enableRunInBackground: false removes the parameter and flips the description', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LocalSubprocessService)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(LocalBashExecutor, {})
    await ctx.plugin(ToolBash, { enableRunInBackground: false })

    const schema = ctx.tools.schemas().find(s => s.name === 'bash')!
    expect(Object.keys(schema.parameters.properties as Record<string, unknown>))
      .toEqual(['command', 'description', 'timeoutMs', 'workdir'])
    expect(schema.description).toContain('Background execution is not available')
    expect(schema.description).not.toContain('run_in_background')
    // The registry-held definition agrees (schema and capability never disagree).
    const parameters = ctx.tools.get('bash')!.parameters as { properties: Record<string, unknown> }
    expect('run_in_background' in parameters.properties).toBe(false)

    // Schema omission is advertising; execution must also enforce the opt-out.
    const forced = await call(ctx, 'bash', { command: 'echo hi', description: 'test command', run_in_background: true })
    expect(forced.isError).toBe(true)
    expect(text(forced)).toContain('run_in_background is disabled for this deployment')
    const foreground = await call(ctx, 'bash', { command: 'echo hi', description: 'test command' })
    expect(foreground.isError).toBe(false)
  })
})

describe('sandbox escalation through the generic task producer', () => {
  const escalate = {
    command: 'true',
    description: 'test escalation',
    sandbox_permissions: 'workspace-write',
    justification: 'the command needs workspace writes',
  }

  it('fails load when a confining executor has no shared sandbox-policy resolver', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(RecordingSandboxExecutor)
    await ctx.plugin(BashEnvPlugin)
    await expect(ctx.plugin(ToolBash)).rejects.toThrow('tool-bash: the mounted bash executor confines but ctx.sandboxPolicy is missing')
  })

  it('advertises the sandbox fields and validates their pairing', async () => {
    const { ctx } = await setupSandboxed()
    const schema = ctx.tools.schemas().find(item => item.name === 'bash')!
    const properties = schema.parameters.properties as Record<string, { enum?: string[] }>
    expect(properties['sandbox_permissions']?.enum).toEqual(['workspace-write', 'danger-full-access'])
    expect(schema.description).toContain('approval prompt')

    for (const args of [
      { command: 'true', description: 'd', sandbox_permissions: 'workspace-write' },
      { command: 'true', description: 'd', justification: 'why' },
      { command: 'true', description: 'd', sandbox_permissions: 'workspace-write', justification: ' ' },
    ]) {
      expect((await call(ctx, 'bash', args)).isError).toBe(true)
    }
  })

  it('rejects injected escalation without a sandbox and non-widening escalation without prompting', async () => {
    const plain = await setup()
    expect(text(await call(plain, 'bash', escalate))).toContain('not available in this composition')

    const { ctx } = await setupSandboxed(true)
    const prompted = vi.fn()
    ctx.on('approval/request', () => { prompted(); return Promise.resolve<ApprovalOutcome>('allowed-once') })
    const result = await call(ctx, 'bash', { ...escalate, sandbox_permissions: 'workspace-write' }, sandboxAgent('workspace-write'))
    expect(text(result)).toContain('not strictly wider')
    expect(prompted).not.toHaveBeenCalled()

    const malformed = sandboxAgent()
    ;(malformed.session.events as unknown as Array<{ type: string; data: { mode: string } }>).push({
      type: 'sandbox/mode',
      data: { mode: 'unknown-mode' },
    })
    expect(text(await call(ctx, 'bash', escalate, malformed))).toContain('not strictly wider')
  })

  it('fails closed when approval cannot be routed', async () => {
    const withoutService = await setupSandboxed()
    expect(text(await call(withoutService.ctx, 'bash', escalate, sandboxAgent()))).toContain('no approval service')

    const withService = await setupSandboxed(true)
    expect(text(await call(withService.ctx, 'bash', escalate))).toContain('no agent to route')
    expect(text(await call(withService.ctx, 'bash', escalate, sandboxAgent()))).toContain('no approval channel')
  })

  it.each([
    ['rejected', 'user rejected'],
    ['cancelled', 'was cancelled'],
  ] as const)('maps an approval %s to its distinct failure', async (outcome, message) => {
    const { ctx, bash } = await setupSandboxed(true)
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>(outcome))
    const result = await call(ctx, 'bash', escalate, sandboxAgent())
    expect(text(result)).toContain(message)
    expect(bash.modes).toEqual([])
  })

  it('runs a granted foreground or background call under the approved mode', async () => {
    const { ctx, bash } = await setupSandboxed(true)
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    const agent = sandboxAgent(undefined, ctx)
    ctx.agents.register(agent)
    const foreground = await ctx.tools.execute({
      callId: CallId('sandbox-signal'),
      name: 'bash',
      arguments: escalate,
      agent,
      signal: new AbortController().signal,
    })
    expect(foreground.isError).toBe(false)
    const background = await call(ctx, 'bash', { ...escalate, run_in_background: true }, agent)
    expect(text(background)).toBe('started background task bash-1')
    expect(bash.modes).toEqual(['workspace-write', 'workspace-write'])
  })

  it('does not publish detached work when cancellation follows the escalation grant', async () => {
    const { ctx, bash } = await setupSandboxed(true)
    const controller = new AbortController()
    const agent = sandboxAgent(undefined, ctx, (type) => {
      if (type === 'approval/decided') controller.abort()
    })
    ctx.agents.register(agent)
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    const start = vi.spyOn(bash, 'start')

    const result = await ctx.tools.execute({
      callId: CallId('cancelled-escalation-background'),
      name: 'bash',
      arguments: { ...escalate, run_in_background: true },
      agent,
      signal: controller.signal,
    })

    expect(result.error).toEqual({
      message: 'tool call aborted',
      info: { name: 'AbortError', code: TOOL_ABORTED },
    })
    expect(text(result)).toBe('Error: tool call aborted')
    expect(start).not.toHaveBeenCalled()
  })

  it('uses the session override for ordinary calls and evaluates widening against it', async () => {
    const { ctx, bash } = await setupSandboxed(true)
    const agent = sandboxAgent('workspace-write')
    await call(ctx, 'bash', { command: 'true', description: 'ordinary' }, agent)
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    await call(ctx, 'bash', { ...escalate, sandbox_permissions: 'danger-full-access' }, agent)
    expect(bash.modes).toEqual(['workspace-write', 'danger-full-access'])
  })

  it('omits sandbox facts the executor did not acquire from the canonical result', async () => {
    const { ctx } = await setupSandboxed()
    const result = await call(ctx, 'bash', {
      command: 'without optional sandbox facts',
      description: 'exercise optional sandbox facts',
    })

    if (result.isError) throw new Error('expected foreground bash success')
    expect(result.value).toMatchObject({
      kind: 'foreground',
      sandbox: { mode: 'read-only', denied: false },
    })
    expect((result.value as { sandbox: object }).sandbox).not.toHaveProperty('enforcement')
    expect((result.value as { sandbox: object }).sandbox).not.toHaveProperty('runnerFailed')
  })

  it('keeps the exhaustiveness backstop for a rogue approval implementation', async () => {
    const { ctx } = await setupSandboxed(true)
    ctx.approval.request = () => Promise.resolve('rogue' as ApprovalOutcome)
    const result = await call(ctx, 'bash', escalate, sandboxAgent())
    expect(text(result)).toContain('unreachable variant in EscalationOutcome')
  })
})

describe('renderProcessRead', () => {
  const base: BashProcessRead = { delta: 'out\n', lossy: false }

  it('returns the delta verbatim for a lossless read', () => {
    expect(renderProcessRead(base)).toBe('out\n')
    expect(renderProcessRead({ delta: '', lossy: false })).toBe('')
  })

  it('appends the loss notice with the available spill paths', () => {
    expect(renderProcessRead({ ...base, lossy: true, stdoutSpillPath: '/spill/out.log' }))
      .toBe('out\n[some output was dropped from memory; full output: /spill/out.log]')
    expect(renderProcessRead({ ...base, lossy: true, stdoutSpillPath: '/spill/out.log', stderrSpillPath: '/spill/err.log' }))
      .toBe('out\n[some output was dropped from memory; full output: /spill/out.log, /spill/err.log]')
  })

  it('reports (unavailable) when a lossy read has no safe spill path', () => {
    expect(renderProcessRead({ ...base, lossy: true }))
      .toBe('out\n[some output was dropped from memory; full output: (unavailable)]')
  })

  it('an empty lossy delta is the notice alone', () => {
    expect(renderProcessRead({ delta: '', lossy: true, stderrSpillPath: '/spill/err.log' }))
      .toBe('[some output was dropped from memory; full output: /spill/err.log]')
  })

  it('inserts the separating newline only when the delta lacks one', () => {
    expect(renderProcessRead({ delta: 'tail', lossy: true }))
      .toBe('tail\n[some output was dropped from memory; full output: (unavailable)]')
    expect(renderProcessRead({ delta: 'tail\n', lossy: true }))
      .toBe('tail\n[some output was dropped from memory; full output: (unavailable)]')
  })

  it('appends settled sandbox denial and runner-failure facts', () => {
    expect(renderProcessRead(base, { mode: 'read-only', denied: true }, ['workspace-write']))
      .toContain('[sandbox: escalation available')
    expect(renderProcessRead({ delta: 'tail', lossy: false }, { mode: 'read-only', denied: true }))
      .toBe('tail\n[sandbox: file access denied under read-only mode]')
    const runner = renderProcessRead(
      { delta: '', lossy: false },
      { mode: 'workspace-write', denied: true, runnerFailed: true },
      ['danger-full-access'],
    )
    expect(runner).toContain('sandbox runner itself failed under workspace-write mode')
    expect(runner).not.toContain('file access denied')
  })
})

describe('processOutcome', () => {
  function settled(over: Partial<BashProcess>): BashProcess {
    return {
      status: 'completed',
      exitCode: 0,
      signal: null,
      done: Promise.resolve(),
      readOutput: () => ({ delta: '', lossy: false }),
      kill: () => false,
      ...over,
    }
  }

  it('maps a signal-killed process to killed with the signal detail', () => {
    expect(processOutcome(settled({ status: 'killed', signal: 'SIGTERM' })))
      .toEqual({ status: 'killed', detail: 'signal: SIGTERM' })
  })

  it('maps a killed process without a recorded signal (kill raced exit / spawn failure)', () => {
    expect(processOutcome(settled({ status: 'killed', exitCode: null })))
      .toEqual({ status: 'killed', detail: 'killed before exit' })
  })

  it('maps a completed process to its exit code', () => {
    expect(processOutcome(settled({ exitCode: 3 })))
      .toEqual({ status: 'completed', detail: 'exit code: 3' })
  })

  it('defensively reads a null exit code as 0 (handle shapes from other executors)', () => {
    expect(processOutcome(settled({ exitCode: null })))
      .toEqual({ status: 'completed', detail: 'exit code: 0' })
  })
})

describe('session-cwd routing (per-session workdir)', () => {
  // An agent whose session header carries a cwd (what session/new records).
  const agentInCwd = (cwd: string) =>
    ({ inject: () => undefined, session: { header: { version: 0, id: 'c', createdAt: 0, cwd } } }) as unknown as Agent

  it('defaults bash to the agent\'s session cwd (not the server launch dir)', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'bash', { command: 'pwd', description: 'pwd' }, agentInCwd('/tmp'))
    expect(text(result).trim()).toMatch(/\/tmp$/)
  })

  it('an explicit absolute workdir overrides the session cwd', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'bash', { command: 'pwd', description: 'pwd', workdir: '/tmp' }, agentInCwd('/'))
    expect(text(result).trim()).toMatch(/\/tmp$/)
  })

  it('a relative workdir is resolved against the session cwd', async () => {
    const ctx = await setup()
    // session cwd /usr + relative 'bin' → /usr/bin
    const result = await call(ctx, 'bash', { command: 'pwd', description: 'pwd', workdir: 'bin' }, agentInCwd('/usr'))
    expect(text(result).trim()).toMatch(/\/usr\/bin$/)
  })

  it('two sessions with different cwds each run bash in their own dir', async () => {
    const ctx = await setup()
    const inUsr = await call(ctx, 'bash', { command: 'pwd', description: 'pwd' }, agentInCwd('/usr'))
    const inTmp = await call(ctx, 'bash', { command: 'pwd', description: 'pwd' }, agentInCwd('/tmp'))
    expect(text(inUsr).trim()).toMatch(/\/usr$/)
    expect(text(inTmp).trim()).toMatch(/\/tmp$/)
  })

  it('falls back to the executor default when the agent has no session cwd', async () => {
    const ctx = await setup()
    // No exec.agent at all → executor uses its config/process.cwd() default.
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('cwd-noagent'), name: 'bash', arguments: { command: 'pwd', description: 'pwd' } })
    expect(result.isError).toBe(false)
    expect(text(result).trim().length).toBeGreaterThan(0)
  })
})

describe('renderResult', () => {
  const base = {
    exitCode: 0 as number | null,
    signal: null as NodeJS.Signals | null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
  }

  it('renders stderr-only output without a stdout prefix', () => {
    expect(renderResult({ ...base, stderr: { text: 'err\n', truncated: false } }))
      .toBe('[stderr]\nerr\n')
  })

  it('adds a separator when stdout does not end with a newline', () => {
    expect(renderResult({
      ...base,
      stdout: { text: 'out', truncated: false },
      stderr: { text: 'err', truncated: false },
    })).toBe('out\n[stderr]\nerr')
  })

  it('appends exit-code markers after a newline for unterminated output', () => {
    expect(renderResult({ ...base, exitCode: 7, stdout: { text: 'x', truncated: false } }))
      .toBe('x\n[exit code: 7]')
  })

  it('renders signal kills without the timeout marker when not timed out', () => {
    expect(renderResult({ ...base, exitCode: null, signal: 'SIGKILL' }))
      .toBe('(no output)\n[killed by signal: SIGKILL]')
  })

  it('reports a timeout that exited 0 (trapped signal) without a kill marker', () => {
    expect(renderResult({ ...base, exitCode: 0, signal: null, timedOut: true }))
      .toBe('(no output)\n[timed out after 1000ms]')
  })

  it('orders the timeout marker before a kill marker', () => {
    expect(renderResult({ ...base, exitCode: null, signal: 'SIGTERM', timedOut: true }))
      .toBe('(no output)\n[timed out after 1000ms]\n[killed by signal: SIGTERM]')
  })

  it('notes truncation with a fallback when the spill path is missing', () => {
    expect(renderResult({ ...base, stdout: { text: 'tail', truncated: true } }))
      .toBe('tail\n[output truncated; full output: (unavailable)]')
  })

  it('reports sandbox denials before exit status and hints only when escalation is advertised', () => {
    const result: BashRunResult = {
      exitCode: 1,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: 1000,
      stdout: { text: '', truncated: false },
      stderr: { text: 'denied', truncated: false },
      sandbox: { mode: 'read-only', denied: true },
    }
    expect(renderResult(result)).toMatch(/denied under read-only mode\]\n\[exit code: 1\]$/)
    expect(renderResult(result, ['workspace-write'])).toContain('[sandbox: escalation available')
    expect(renderResult({ ...result, sandbox: { mode: 'read-only', denied: false } }, ['workspace-write']))
      .not.toContain('[sandbox:')
  })
})

describe('tool-owned UI presentation (presentCall / presentResult)', () => {
  it('bash presentCall: a foreground run is a terminal card (command title, description, workdir → cwd absolute or relative)', async () => {
    const ctx = await setup()
    // No explicit workdir → a terminal card with no cwd (the UI bridge fills the
    // session cwd it owns; the pure presenter can't see it).
    expect(ctx.tools.get('bash')?.presentCall?.({ command: 'ls -la src', description: 'List files in src' }))
      .toEqual({ card: 'terminal', title: 'ls -la src', description: 'List files in src' })
    // An ABSOLUTE workdir is surfaced verbatim as the terminal cwd header.
    expect(ctx.tools.get('bash')?.presentCall?.({ command: 'pwd', description: 'Print dir', workdir: '/tmp/x' }))
      .toEqual({ card: 'terminal', title: 'pwd', description: 'Print dir', cwd: '/tmp/x' })
    // A RELATIVE workdir is passed through AS-IS (the bridge resolves it against
    // the session cwd, matching where execution runs) — not dropped.
    expect(ctx.tools.get('bash')?.presentCall?.({ command: 'pwd', description: 'Print dir', workdir: 'sub' }))
      .toEqual({ card: 'terminal', title: 'pwd', description: 'Print dir', cwd: 'sub' })
  })

  it('bash presentResult: a terminal result carries RAW output (newlines intact) + parsed exit code', async () => {
    const ctx = await setup()
    const present = ctx.tools.get('bash')!.presentResult!(
      { command: 'printf "hi\\n\\n"', description: 'echo' },
      // A clean run renders no exit marker at all, so the body is the raw bytes.
      { content: [{ type: 'text', text: 'hi\n\n' }], isError: false },
    )
    // A terminal result keeps the RAW bytes (newlines intact) a terminal renderer
    // needs; the bridge derives the fenced fallback.
    expect(present).toEqual({ card: 'terminal', output: 'hi\n\n', exitCode: 0 })
  })

  it('bash presentResult: a non-zero exit and a signal kill parse into exitCode / signal', async () => {
    const ctx = await setup()
    const args = { command: 'x', description: 'x' }
    const nonzero = ctx.tools.get('bash')!.presentResult!(args, { content: [{ type: 'text', text: 'oops\n[exit code: 3]' }], isError: false })
    expect(nonzero).toEqual({ card: 'terminal', output: 'oops', exitCode: 3 })
    const killed = ctx.tools.get('bash')!.presentResult!(args, { content: [{ type: 'text', text: 'gone\n[killed by signal: SIGKILL]' }], isError: false })
    expect(killed).toEqual({ card: 'terminal', output: 'gone', signal: 'SIGKILL' })
  })

  it('bash presentResult: markers a pill CANNOT show (timeout, sandbox denial) stay in the terminal output', async () => {
    const ctx = await setup()
    const args = { command: 'x', description: 'x' }
    const timedOut = ctx.tools.get('bash')!.presentResult!(
      args,
      { content: [{ type: 'text', text: 'slow\n[timed out after 100ms]\n[exit code: 143]' }], isError: false },
    )
    expect(timedOut).toEqual({ card: 'terminal', output: 'slow\n[timed out after 100ms]', exitCode: 143 })
  })

  it('bash presentResult exit parse is the inverse of renderResult markers (round-trip)', async () => {
    const ctx = await setup()
    const present = ctx.tools.get('bash')!
    // For each renderResult outcome, the rendered text fed back through
    // presentResult recovers the matching structured exit — the parse and the
    // marker emission co-evolve in one file, so this pins the pair.
    const base = {
      aborted: false,
      timeoutMs: 1000,
      stdout: { text: 'out', truncated: false },
      stderr: { text: '', truncated: false },
    }
    const cases = [
      { result: { ...base, exitCode: 0, signal: null, timedOut: false }, expect: { exitCode: 0 } },
      { result: { ...base, exitCode: 7, signal: null, timedOut: false }, expect: { exitCode: 7 } },
      { result: { ...base, exitCode: null, signal: 'SIGTERM' as const, timedOut: false }, expect: { signal: 'SIGTERM' } },
      // A trapped-timeout run that exits 0 has no signal/exit marker → reads as exit 0 (it did exit 0).
      { result: { ...base, exitCode: 0, signal: null, timedOut: true }, expect: { exitCode: 0 } },
    ]
    for (const c of cases) {
      const rendered = renderResult(c.result)
      const out = present.presentResult!({ command: 'x', description: 'x' }, { content: [{ type: 'text', text: rendered }], isError: false })
      // Drop card + output; the remaining fields are the parsed exit.
      const { card: _c, output, ...exit } = out as { card: string; output?: string; exitCode?: number; signal?: string }
      expect(exit).toEqual(c.expect)
      // Whatever the parse consumed is gone from the body, so a card with an exit
      // pill never shows the same status twice.
      expect(output).not.toMatch(/\[exit code: \d+\]|\[killed by signal: /)
    }
  })

  it('bash presentResult: a clean exit-0 whose output ENDS in marker-like text is NOT read as a failure', async () => {
    const ctx = await setup()
    const args = { command: 'printf "[exit code: 5]"', description: 'print' }
    // A successful command may print marker-like text. A clean result appends no marker or
    // newline; parsing requires the leading newline emitted for real markers, so this stays exit 0.
    const out = ctx.tools.get('bash')!.presentResult!(args, { content: [{ type: 'text', text: '[exit code: 5]' }], isError: false })
    expect(out).toEqual({ card: 'terminal', output: '[exit code: 5]', exitCode: 0 })
    // Unparsed marker-like text is real output, so it is NOT stripped from the body.
    // Same for a fake signal marker with no leading newline.
    const sig = ctx.tools.get('bash')!.presentResult!(args, { content: [{ type: 'text', text: '[killed by signal: SIGKILL]' }], isError: false })
    expect(sig).toEqual({ card: 'terminal', output: '[killed by signal: SIGKILL]', exitCode: 0 })
  })

  it('bash presentCall/presentResult: a run_in_background call is a generic card and its ack carries no exit pill', async () => {
    const ctx = await setup()
    // The background start returns a task-id ack, not a streamed run — a generic
    // execute card with the command as rawInput and the description as content.
    const call = ctx.tools.get('bash')!.presentCall!({ command: 'sleep 100', description: 'wait', run_in_background: true })
    expect(call).toEqual({ card: 'generic', title: 'sleep 100', kind: 'execute', rawInput: 'sleep 100', content: [{ type: 'text', text: 'wait' }] })
    // The ack result is a generic fenced-text card — no terminal output / exit pill.
    const result = ctx.tools.get('bash')!.presentResult!(
      { command: 'sleep 100', description: 'wait', run_in_background: true },
      { content: [{ type: 'text', text: 'started background task bash-1' }], isError: false },
    )
    expect(result).toEqual({ card: 'generic', content: [{ type: 'text', text: '```console\nstarted background task bash-1\n```' }] })
  })

  it('bash presentResult: an isError result is a generic card (no real process exit to report)', async () => {
    const ctx = await setup()
    // A spawn failure / abort has no process exit — the body is an error message,
    // not renderResult output, so a generic fenced card, no terminal output/exit.
    const out = ctx.tools.get('bash')!.presentResult!(
      { command: 'x', description: 'x' },
      { content: [{ type: 'text', text: 'tool call aborted' }], isError: true },
    )
    expect(out).toEqual({ card: 'generic', content: [{ type: 'text', text: '```console\ntool call aborted\n```' }] })
  })

  it('bash presentResult: leaves a non-text (unexpected) result untouched → undefined (UI keeps raw content)', async () => {
    const ctx = await setup()
    const present = ctx.tools.get('bash')!.presentResult!(
      { command: 'x', description: 'x' },
      { content: [{ type: 'reasoning', text: 'unexpected' }], isError: false },
    )
    expect(present).toBeUndefined()
  })

  it('bash presentResult: a result that is not exactly one block → undefined (no single text to fence)', async () => {
    const ctx = await setup()
    const args = { command: 'x', description: 'x' }
    // Empty content (no block) and multi-block content both fall through.
    expect(ctx.tools.get('bash')!.presentResult!(args, { content: [], isError: false })).toBeUndefined()
    expect(ctx.tools.get('bash')!.presentResult!(args, {
      content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
      isError: false,
    })).toBeUndefined()
  })

  it('presentCall validates softly: malformed args (missing required description) return undefined, never throw', async () => {
    const ctx = await setup()
    // `defineTool` soft-validates replayed logged args before presentation. Invalid shapes return
    // undefined for generic UI rendering rather than throwing; `presentCall` accepts `unknown`.
    expect(ctx.tools.get('bash')?.presentCall?.({ command: 'ls' })).toBeUndefined()
  })
})

describe('the model-facing bash tool builds its request from named args only (no {...args} forward)', () => {
  const recordingDshHome = join(spillDir, 'dsh-home')

  /**
   * Records every {@link BashExecRequest} the consumer hands to `resolve()`, so a
   * test can assert what the model-facing tool DID and DID NOT forward. The `bash`
   * tool does not expose trusted-plugin fields (`stdoutMaxBytes`, `stdin`, or
   * `env`) as parameters, so it must build its request from named args only and
   * never spread unknown tool-call keys into it. This guard's job is to catch a
   * future refactor that blindly forwards `...args` — which would silently thread
   * model input into the post-scrub `env` merge or per-run capture budget — NOT
   * to defend a trust boundary
   * (the credential scrub in dsh-bash-local is the security control; see the
   * bash-stdin-env Agent Note). Foreground `run()` returns a canned result; `start()`
   * hands back an already-settled fake handle so the task registration completes.
   */
  class RecordingBashExecutor extends BashExecutor {
    readonly requests: BashExecRequest[] = []
    resolve(request: BashExecRequest): BashExecSpec {
      this.requests.push(request)
      return {
        command: request.command,
        workdir: request.workdir ?? process.cwd(),
        timeoutMs: request.timeoutMs ?? 0,
        stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
        ...request.signal ? { signal: request.signal } : {},
        ...request.stdin !== undefined ? { stdin: request.stdin } : {},
        ...request.env !== undefined ? { env: request.env } : {},
        ...request.dshEnv !== undefined ? { dshEnv: request.dshEnv } : {},
        sandboxPolicy: request.sandboxPolicy,
      }
    }
    run(): Promise<BashRunResult> {
      return Promise.resolve({
        exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 0,
        stdout: { text: 'ok', truncated: false }, stderr: { text: '', truncated: false },
      })
    }
    start(): BashProcess {
      return {
        status: 'completed',
        exitCode: 0,
        signal: null,
        done: Promise.resolve(),
        readOutput: () => ({ delta: '', lossy: false }),
        kill: () => false,
      }
    }
  }

  async function setupRecording(withJsonl = false) {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(AgentRegistry)
    if (withJsonl) {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionPersistenceJsonl, { root: join(spillDir, 'jsonl') })
    }
    await ctx.plugin(LocalTaskService)
    await ctx.plugin(ToolTasks)
    await ctx.plugin(BashEnvPlugin, { dshHome: recordingDshHome })
    await ctx.plugin(RecordingBashExecutor)
    await ctx.plugin(ToolBash)
    return { ctx, bash: ctx.bash as RecordingBashExecutor }
  }

  it('describes the managed harness environment namespace to the model', async () => {
    const { ctx } = await setupRecording()
    const description = ctx.tools.get('bash')?.description ?? ''
    expect(description).toContain('$DSH_*')
    expect(description).not.toContain('DSH_SESSION_JSONL')
  })

  it('injects the session id and JSONL target path into a foreground request', async () => {
    const { ctx, bash } = await setupRecording(true)
    const agent = registerFakeAgent(ctx, 'request-fg', () => undefined)
    const path = ctx.sessionPersistence.locate(agent.session.header)?.path

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('session-env-fg'),
      name: 'bash',
      arguments: { command: 'true', description: 'run command' },
      agent,
    })

    expect(bash.requests[0]?.dshEnv).toEqual({
      DSH_HOME: recordingDshHome,
      DSH_SESSION_ID: 'request-fg',
      DSH_SESSION_JSONL: path,
      DSH_SHELL: '1',
    })
  })

  it('injects the same trusted variables into a background request without forwarding model env', async () => {
    const { ctx, bash } = await setupRecording(true)
    const agent = registerFakeAgent(ctx, 'request-bg', () => undefined)
    const path = ctx.sessionPersistence.locate(agent.session.header)?.path

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('session-env-bg'),
      name: 'bash',
      arguments: {
        command: 'sleep 1',
        description: 'run command',
        run_in_background: true,
        env: { DSH_SESSION_ID: 'spoofed', DSH_SESSION_JSONL: '/tmp/spoofed' },
      },
      agent,
    })

    expect(bash.requests[0]?.env).toBeUndefined()
    expect(bash.requests[0]?.dshEnv).toEqual({
      DSH_HOME: recordingDshHome,
      DSH_SESSION_ID: 'request-bg',
      DSH_SESSION_JSONL: path,
      DSH_SHELL: '1',
    })
  })

  it('injects built-ins and the stable session id when no JSONL locator is available', async () => {
    const { ctx, bash } = await setupRecording()
    const agent = registerFakeAgent(ctx, 'request-id-only', () => undefined)
    const ambient = process.env.DSH_SESSION_ID

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('session-env-id-only'),
      name: 'bash',
      arguments: { command: 'true', description: 'run command' },
      agent,
    })

    expect(bash.requests[0]?.dshEnv).toEqual({
      DSH_HOME: recordingDshHome,
      DSH_SESSION_ID: 'request-id-only',
      DSH_SHELL: '1',
    })
    expect(process.env.DSH_SESSION_ID).toBe(ambient)
  })

  it('keeps parent and child agent session environments isolated', async () => {
    const { ctx, bash } = await setupRecording(true)
    const parent = registerFakeAgent(ctx, 'request-parent', () => undefined)
    const child = registerFakeAgent(ctx, 'request-child', () => undefined)

    for (const [callId, agent] of [['parent', parent], ['child', child]] as const) {
      await ctx.tools.execute({
        signal: testToolSignal,
        callId: CallId(`session-env-${callId}`),
        name: 'bash',
        arguments: { command: 'true', description: 'run command' },
        agent,
      })
    }

    expect(bash.requests.map(request => request.dshEnv)).toEqual([
      {
        DSH_HOME: recordingDshHome,
        DSH_SESSION_ID: 'request-parent',
        DSH_SESSION_JSONL: ctx.sessionPersistence.locate(parent.session.header)?.path,
        DSH_SHELL: '1',
      },
      {
        DSH_HOME: recordingDshHome,
        DSH_SESSION_ID: 'request-child',
        DSH_SESSION_JSONL: ctx.sessionPersistence.locate(child.session.header)?.path,
        DSH_SHELL: '1',
      },
    ])
    expect(bash.requests[0]?.dshEnv?.DSH_SESSION_JSONL).not.toBe(bash.requests[1]?.dshEnv?.DSH_SESSION_JSONL)
  })

  it('does not forward trusted-only fields even when the model includes them as extra arguments', async () => {
    const { ctx, bash } = await setupRecording()
    // Unknown `env` and `stdin` keys are ignored by the schema and named request construction.
    // This preserves the request shape; it is not a security boundary because shell syntax can
    // already set environment variables or feed stdin.
    await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('no-forward-1'),
      name: 'bash',
      arguments: {
        command: 'echo hi',
        description: 'echo',
        env: { SNEAKY_API_KEY: 'leak' },
        stdin: 'malicious payload',
        stdoutMaxBytes: 999_999,
      },
    })
    expect(bash.requests).toHaveLength(1)
    const request = bash.requests[0]!
    expect(request.command).toBe('echo hi')
    expect('env' in request).toBe(false)
    expect('stdin' in request).toBe(false)
    expect('stdoutMaxBytes' in request).toBe(false)
  })

  it('a background bash call likewise carries no trusted-only fields', async () => {
    const { ctx, bash } = await setupRecording()
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('no-forward-2'),
      name: 'bash',
      arguments: {
        command: 'sleep 1',
        description: 'sleep',
        run_in_background: true,
        env: { TOKEN: 'leak' },
        stdin: 'x',
        stdoutMaxBytes: 999_999,
      },
    })
    // The call really went down the background path (the recorder sees the real
    // request the consumer built, so the absent env/stdin below is a real
    // negative, not a recorder that drops everything).
    expect(text(result)).toBe('started background task bash-1')
    expect(bash.requests).toHaveLength(1)
    const request = bash.requests[0]!
    expect(request.command).toBe('sleep 1')
    expect('env' in request).toBe(false)
    expect('stdin' in request).toBe(false)
    expect('stdoutMaxBytes' in request).toBe(false)
  })
})

/** 记录保存请求的假 spill 后端（Service 形态，ctx.spillStore 可解析）。 */
class StubSpillStore extends SpillStore {
  saves: SaveTextSpill[] = []
  override async saveText(input: SaveTextSpill): Promise<SpillRef> {
    this.saves.push(input)
    return {
      locator: SpillLocator('/spill/bash.txt'),
      bytes: Buffer.byteLength(input.content, 'utf8'),
      retrievalHint: 'stub',
    }
  }
}

async function setupShaped(withSpill = false): Promise<{ ctx: Context; stub?: StubSpillStore }> {
  const ctx = await setup()
  if (withSpill) {
    await ctx.plugin(StubSpillStore)
    return { ctx, stub: ctx.spillStore as StubSpillStore }
  }
  return { ctx }
}

describe('bash tool 模型输出成形（成功折叠 / 失败精选 / 恢复路径）', () => {
  it('成功长输出折叠为尾部并带省略计数', async () => {
    const { ctx } = await setupShaped()
    const result = await call(ctx, 'bash', { command: 'seq 1 50', description: 'numbered output' })
    const out = text(result)
    expect(out.startsWith('[30 earlier lines omitted]\n')).toBe(true)
    expect(out.endsWith('50\n')).toBe(true)
    expect(out).not.toContain('\n5\n')
  })

  it('失败长输出保留错误行窗口与头尾锚（真实失败命令）', async () => {
    const { ctx } = await setupShaped()
    const command = 'for i in $(seq 1 60); do echo "row $i"; done; echo "FATAL: boom"; exit 1'
    const result = await call(ctx, 'bash', { command, description: 'fails loudly' })
    const out = text(result)
    expect(out).toContain('FATAL: boom')
    expect(out).toContain('lines omitted — error-relevant lines kept')
    // 尾锚 + exit 标记仍在正文末尾。
    expect(out.endsWith('[exit code: 1]')).toBe(true)
    expect(out).toContain('row 60')
    expect(out).not.toContain('row 30\n')
  })

  it('成形丢行时完整正文落盘，省略通知带恢复路径', async () => {
    const { ctx, stub } = await setupShaped(true)
    // spill 归属会话主：落盘路径依赖 owner（无 agent 的直调降级为无路径）。
    const agent = registerFakeAgent(ctx, 'session-spill-1')
    const result = await call(ctx, 'bash', { command: 'seq 1 50', description: 'spilled' }, agent)
    const out = text(result)
    expect(out.startsWith('[30 earlier lines omitted; full output: /spill/bash.txt]\n')).toBe(true)
    expect(stub?.saves).toHaveLength(1)
    expect(stub?.saves[0]?.suggestedName).toBe('bash.txt')
    expect(stub?.saves[0]?.content).toContain('1\n2\n3\n')
  })

  it('无 spill 后端时降级为不带路径的省略计数（不失败调用）', async () => {
    const { ctx } = await setupShaped()
    const result = await call(ctx, 'bash', { command: 'seq 1 50', description: 'no backend' })
    expect(result.isError).toBe(false)
    expect(text(result).startsWith('[30 earlier lines omitted]\n')).toBe(true)
  })

  it('短输出逐字节不变', async () => {
    const { ctx } = await setupShaped()
    const result = await call(ctx, 'bash', { command: 'echo hi', description: 'tiny' })
    expect(text(result)).toBe('hi\n')
  })
})

describe('bash tool 每命令输出过滤（真 git 仓库 e2e）', () => {
  /** 临时 git 仓:N 个提交、一个含大 hunk 的未提交改动。 */
  function makeTempRepo(commits: number): string {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-gitlog-'))
    const git = (cwd: string, ...args: string[]) => {
      try {
        execSync(`git -c user.email=t@t -c user.name=t ${args.join(' ')}`, { cwd, stdio: 'pipe' })
      } catch (error) {
        const stderr = error instanceof Error && 'stderr' in error ? String((error as { stderr: Buffer }).stderr) : ''
        throw new Error(`git ${args.join(' ')} failed: ${stderr}`)
      }
    }
    git(dir, 'init', '-q')
    for (let i = 1; i <= commits; i++) {
      writeFileSync(join(dir, `f${i}.txt`), `content ${i}\n`)
      git(dir, 'add', '.')
      git(dir, 'commit', '-q', '-m', `"commit number ${i}"`)
    }
    writeFileSync(join(dir, 'big.txt'), `${'line\n'.repeat(200)}changed\n`)
    git(dir, 'add', '.')
    return dir
  }

  it('git log 超 30 行 → 语义压缩(剥 Author/Date 保留计数),完整正文落盘', async () => {
    const { ctx, stub } = await setupShaped(true)
    const agent = registerFakeAgent(ctx, 'session-gitlog-1')
    const dir = makeTempRepo(25)
    const result = await call(ctx, 'bash', { command: `git -C ${dir} log`, description: 'long history' }, agent)
    const out = text(result)
    // 25 个 commit 的默认格式远超 30 行 → 过滤生效。
    expect(out).toContain('[git-log filter: kept 15 of 25 commits — oldest dropped]')
    // 保留最新 15 个(25..11),丢弃最旧 10 个(10..1)。
    expect(out).toContain('    commit number 25')
    expect(out).toContain('    commit number 11')
    expect(out).not.toContain('    commit number 10')
    expect(out).not.toContain('Author:')
    // 落盘谓词命中：完整未过滤正文已存。
    expect(stub?.saves.length).toBeGreaterThanOrEqual(1)
    expect(stub?.saves[0]?.content).toContain('Author:')
    expect(stub?.saves[0]?.content).toContain('commit number 25')
  })

  it('git log 少量提交不过滤', async () => {
    const { ctx } = await setupShaped()
    const dir = makeTempRepo(2)
    const result = await call(ctx, 'bash', { command: `git -C ${dir} log`, description: 'short history' })
    const out = text(result)
    expect(out).toContain('commit number 2')
    expect(out).not.toContain('git-log filter')
    // 少量提交仍在通用折叠阈值之上时也不折叠?2 个提交约 10 行 < 20,直接原样。
    expect(out).toContain('Author:')
  })

  it('git diff 大 hunk → 截断 + 文件计数', async () => {
    const { ctx } = await setupShaped()
    const dir = makeTempRepo(2)
    const result = await call(ctx, 'bash', { command: `git -C ${dir} diff --cached`, description: 'large staged diff' })
    const out = text(result)
    // 200+ 行的 staged diff 超过 40 行阈值 → 每 hunk 截 60 + 总量封顶。
    expect(out).toContain('diff --git')
    expect(out).toMatch(/# \+\d+ -\d+$/m)
    const lineCount = out.split('\n').length
    expect(lineCount).toBeLessThan(220)
  })
})

describe('bash tool 环境失败标准化（exit 诊断）', () => {
  it('command not found → 一行诊断 + exit 标记仍收尾', async () => {
    const { ctx } = await setupShaped()
    const result = await call(ctx, 'bash', { command: 'definitely_not_a_command_xyz', description: 'env failure' })
    const out = text(result)
    expect(out).toContain('[environment: exit 127 — command not found')
    expect(out.endsWith('[exit code: 127]')).toBe(true)
    // parseExitStatus 契约不破：pill 解析仍取到 127。
    const parsed = parseExitStatus(out)
    expect(parsed).toMatchObject({ exitCode: 127 })
  })
})
