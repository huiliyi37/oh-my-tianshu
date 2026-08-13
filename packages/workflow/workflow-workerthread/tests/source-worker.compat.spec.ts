/**
 * Keyless runtime smoke for the source-mode workflow worker. The Node
 * compatibility matrix runs this WHOLE file, so renaming or removing its test
 * cannot turn the runtime proof into a successful zero-match filter.
 */

import { expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import type { Agent } from '@huiliyi37/dsh-agent'
import SubagentService from '@huiliyi37/dsh-subagent'
import type { SubagentProvider } from '@huiliyi37/dsh-subagent'
import WorkerWorkflowEngine from '../src/index.ts'
import { SessionId } from '@huiliyi37/dsh-session'

// A fresh thread compiles the source runtime. Leave contention headroom on
// shared CI runners without weakening any engine-level timeout assertion.
vi.setConfig({ testTimeout: 30_000 })

it('runs the default config through the source worker', async () => {
  const ctx = new Context()
  const subagents = await ctx.plugin(SubagentService)
  const provider: SubagentProvider = {
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: () => { return Promise.reject(new Error('source-worker compat script must not start a child')) },
  }
  ctx.subagents.registerProvider(provider)
  const engine = await ctx.plugin(WorkerWorkflowEngine, {})
  const parent = { id: SessionId('workflow-compat-parent'), options: {} } as unknown as Agent
  try {
    const run = ctx.workflows.start({
      script: 'return 6 * 7',
      meta: { name: 'source-worker-compat', description: 'exercise the unbuilt worker entry' },
      parent,
    })
    try {
      await expect(run.result).resolves.toMatchObject({ value: 42, stopReason: 'completed', agentsStarted: 0 })
    } finally {
      await run.dispose()
    }
  } finally {
    await engine.dispose()
    await subagents.dispose()
  }
})
