import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import { SessionId } from '@huiliyi37/dsh-session'
import type { Agent } from '@huiliyi37/dsh-agent'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@huiliyi37/dsh-bash-local'
import LocalSubprocessService from '@huiliyi37/dsh-subprocess-local'
import * as BashEnvPlugin from '@huiliyi37/dsh-bash-env'
import * as ToolRunTests from '@huiliyi37/dsh-tool-run-tests'
import * as EvidenceGate from '@huiliyi37/dsh-evidence-gate'
import type { EvidenceService } from '@huiliyi37/dsh-evidence-gate'
import { MockAdapter, toolCallResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Assembled-loop proof that a model-issued run_tests call flows through the
 * ordinary session event stream into evidence-gate's verification accounting
 * — the "zero new channel" promise of the run_tests absorption.
 */

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-run-tests-evidence-'))

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

describe('run_tests → evidence-gate accounting (assembled loop)', () => {
  it('counts a model-issued run_tests call as verification evidence', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvidenceGate)
    await ctx.plugin(LocalSubprocessService)
    ;(ctx.subprocess as LocalSubprocessService).internals = { spillDir }
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
    await ctx.plugin(ToolRunTests)
    await ctx.plugin(AgentLoop, { agents: [] })

    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复 loopfix', targets: ['src/loopfix.ts'] })

    const command = 'node -e "console.log(\'1 test failed\')"'
    ctx.llm.registerAdapter(['mock-provider'], new MockAdapter([
      toolCallResponse('c1', 'run_tests', { command }),
      textResponse('done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('run-tests-evidence'), { provider: 'mock-provider', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run the tests' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const events = [...agent.session.events]
    const call = events.find(event => event.type === 'tool/call')
    expect(call).toMatchObject({ data: { name: 'run_tests' } })
    expect(events.some(event => event.type === 'tool/result')).toBe(true)
    // The RED run is accounted as a failed verification attempt on the bugfix obligation.
    expect(evidence.verificationCount()).toBe(1)
    expect(evidence.unresolvedHigh()).toHaveLength(1)
  })
})
