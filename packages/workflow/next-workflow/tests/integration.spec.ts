/**
 * next-workflow over the real agent loop, command registry, and spawn subagent
 * stack: one keyless scripted model drives INTENT/PLAN/CRITIQUE/REVIEW children
 * and the parent's IMPLEMENT turns, proving the phase machine, artifact writes,
 * per-phase effort rewrite, and post-run header restoration end to end.
 * @module @huiliyi37/dsh-next-workflow/tests/integration
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import { BashExecutor } from '@huiliyi37/dsh-bash'
import type { BashExecRequest, BashExecSpec, BashProcess, BashRunResult } from '@huiliyi37/dsh-bash'
import CommandService from '@huiliyi37/dsh-commands'
import { createUserMessage, ReasoningEffortId } from '@huiliyi37/dsh-llm'
import { SessionId } from '@huiliyi37/dsh-session'
import SubagentService from '@huiliyi37/dsh-subagent'
import { STRUCTURED_OUTPUT_TOOL } from '@huiliyi37/dsh-subagent-inprocess'
import * as spawn from '@huiliyi37/dsh-subagent-spawn'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as nextWorkflow from '../src/index.ts'

type MockScript = ConstructorParameters<typeof MockAdapter>[0]

const INTENT = { goal: 'Add tests for foo.', constraints: [], areas: ['src/foo.ts'], acceptance: ['foo tests pass'] }
const PLAN = { plan: '# Plan\n\n1. Write foo tests.' }
const APPROVE_CRITIQUE = { verdict: 'approve', gaps: [] }
const APPROVE_REVIEW = { verdict: 'approve', findings: [] }

function bashResult(exitCode: number, stdout = '', stderr = ''): BashRunResult {
  return {
    exitCode,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    stdout: { text: stdout, truncated: false },
    stderr: { text: stderr, truncated: false },
  }
}

/** Scripted foreground bash executor: each configured command maps to one canned result. */
function stubBash(results: Record<string, BashRunResult>): new (ctx: Context) => BashExecutor {
  return class StubBash extends BashExecutor {
    override resolve(request: BashExecRequest): BashExecSpec {
      return {
        command: request.command,
        workdir: request.workdir ?? '/tmp',
        timeoutMs: request.timeoutMs ?? 1000,
        stdoutMaxBytes: request.stdoutMaxBytes ?? 65_536,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        sandboxPolicy: undefined,
      }
    }

    override run(spec: BashExecSpec): Promise<BashRunResult> {
      const result = results[spec.command]
      if (result === undefined) return Promise.resolve(bashResult(0))
      return Promise.resolve(result)
    }

    override start(): BashProcess {
      throw new Error('StubBash runs foreground commands only')
    }
  }
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Mount the shipped command execution stack around one keyless model script. */
async function mountNextWorkflow(script: MockScript, config: nextWorkflow.Config, bash: Record<string, BashRunResult>) {
  const workflowsRoot = await mkdtemp(join(tmpdir(), 'dsh-next-workflow-it-'))
  roots.push(workflowsRoot)
  const ctx = new Context()
  // The mock route declares a `high` effort so the implement-phase rewrite passes adapter validation.
  const adapter = new MockAdapter(script, { efforts: [{ id: ReasoningEffortId('high'), name: 'high' }] })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(CommandService)
  await ctx.plugin(SubagentService)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(stubBash(bash))
  await ctx.plugin(nextWorkflow, Object.assign({}, config, { workflowsRoot }))
  ctx.llm.registerAdapter(['mock'], adapter)
  const parentHandle = await ctx.agents.create({
    sessionId: SessionId('nw-parent'),
    meta: { cwd: '/tmp/nw-shared-workspace' },
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  return { ctx, adapter, parentHandle, parent: parentHandle.agent, workflowsRoot }
}

describe('dsh-next-workflow over the real spawn stack', () => {
  it('runs the full pipeline, rewrites effort at the phase boundary, and restores it after the run', async () => {
    const { ctx, adapter, parent, parentHandle, workflowsRoot } = await mountNextWorkflow([
      toolCallResponse('intent', STRUCTURED_OUTPUT_TOOL, INTENT),
      toolCallResponse('plan', STRUCTURED_OUTPUT_TOOL, PLAN),
      toolCallResponse('critique', STRUCTURED_OUTPUT_TOOL, APPROVE_CRITIQUE),
      textResponse('implemented'),
      toolCallResponse('review', STRUCTURED_OUTPUT_TOOL, APPROVE_REVIEW),
      textResponse('post-run reply'),
    ], { verifyCommand: 'check', phaseEfforts: { implement: 'high', review: 'high' } }, {
      check: bashResult(0),
      'git diff HEAD': bashResult(0, 'DIFF_BODY'),
    })
    const execution = await ctx.commands.execute(
      parent,
      '/next-workflow add tests for foo',
      new AbortController().signal,
    )
    if (execution === undefined) throw new Error('/next-workflow did not resolve')
    expect(execution.result.kind).toBe('success')
    expect(execution.result.kind === 'success' ? execution.result.text ?? '' : '')
      .toContain('completed (verify: verified)')

    // Five model calls: intent, planner, critic, the parent's implement turn, reviewer.
    expect(adapter.requests).toHaveLength(5)
    // The implement-phase request carries the mapped effort. Subagent phases keep
    // the default route even when their phase is mapped (review: 'high' above):
    // the waterfall listener is scoped to the invoking agent — the documented
    // subagent effort gap.
    expect(adapter.requests[3]?.reasoningEffort).toBe('high')
    expect(adapter.requests[0]?.reasoningEffort).toBeUndefined()
    expect(adapter.requests[4]?.reasoningEffort).toBeUndefined()

    // The IMPLEMENT steer is a logged user-role message with the artifacts inline.
    const implementMessage = parent.session.events.find(event => event.type === 'user/message')
    expect(implementMessage !== undefined && JSON.stringify(implementMessage.data)).toContain('IMPLEMENT phase')

    // Artifacts landed under the configured root.
    const end = parent.session.events.find(event => event.type === 'next-workflow/end')
    const runId = (end?.data as { runId: string }).runId
    const spec = await readFile(join(workflowsRoot, runId, 'SPEC.md'), 'utf8')
    expect(spec).toContain('Add tests for foo.')
    const review = await readFile(join(workflowsRoot, runId, 'REVIEW.md'), 'utf8')
    expect(review).toContain('Verdict: approve')
    expect(end?.data).toMatchObject({ outcome: 'completed', detail: 'verified' })

    // The first post-run request restores the pre-run header (no injected effort).
    parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'How did that go?' }],
      source: { kind: 'user' },
    }))
    await parent.whenIdle()
    expect(adapter.requests).toHaveLength(6)
    expect(adapter.requests[5]?.reasoningEffort).toBeUndefined()

    await parentHandle.dispose()
  })

  it('steers one bounded verify retry and settles failed-verification on exhaustion', async () => {
    const { ctx, adapter, parent, parentHandle } = await mountNextWorkflow([
      toolCallResponse('intent', STRUCTURED_OUTPUT_TOOL, INTENT),
      toolCallResponse('plan', STRUCTURED_OUTPUT_TOOL, PLAN),
      toolCallResponse('critique', STRUCTURED_OUTPUT_TOOL, APPROVE_CRITIQUE),
      textResponse('implemented'),
      textResponse('fixed'),
    ], { verifyCommand: 'check' }, {
      check: bashResult(1, '', 'GATE_FAIL'),
    })

    const execution = await ctx.commands.execute(
      parent,
      '/next-workflow add tests for foo',
      new AbortController().signal,
    )
    if (execution === undefined) throw new Error('/next-workflow did not resolve')
    expect(execution.result.kind).toBe('error')
    expect(execution.result.kind === 'error' ? execution.result.text : '').toContain('failed-verification')

    // Intent, planner, critic, implement turn, retry turn; the reviewer never runs.
    expect(adapter.requests).toHaveLength(5)
    const steers = parent.session.events
      .filter(event => event.type === 'user/message')
      .map(event => JSON.stringify(event.data))
    expect(steers).toHaveLength(2)
    expect(steers[1]).toContain('GATE_FAIL')
    const end = parent.session.events.find(event => event.type === 'next-workflow/end')
    expect(end?.data).toMatchObject({ outcome: 'failed-verification' })

    await parentHandle.dispose()
  })
})
