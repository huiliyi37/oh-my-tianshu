import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { BashExecutor } from '@deepseek-ai/dsh-bash'
import type { BashExecRequest, BashExecSpec, BashProcess, BashProcessRead, BashRunResult } from '@deepseek-ai/dsh-bash'

/**
 * Minimal concrete executor: canned foreground results, a hand-built process
 * handle. The seam is TASK-FREE (start returns a {@link BashProcess} handle;
 * task semantics live in `ctx.tasks`), so this stub is all an implementation
 * owes the abstract class.
 */
class StubExecutor extends BashExecutor {
  resolve(request: BashExecRequest): BashExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? '/stub',
      timeoutMs: request.timeoutMs ?? 1000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      ...!request.signal ? {} : { signal: request.signal },
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  async run(spec: BashExecSpec): Promise<BashRunResult> {
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: 'ok', truncated: false },
      stderr: { text: '', truncated: false },
    }
  }

  start(): BashProcess {
    const proc: BashProcess = {
      status: 'running',
      exitCode: null,
      signal: null,
      done: Promise.resolve(),
      readOutput: (): BashProcessRead => ({ delta: '', lossy: false }),
      kill: (): boolean => {
        if (proc.status !== 'running') return false
        proc.status = 'killed'
        return true
      },
    }
    return proc
  }
}

describe('BashExecutor service seam', () => {
  it('a concrete subclass registers as ctx.bash and serves the abstract API', async () => {
    const ctx = new Context()
    await ctx.plugin(StubExecutor)
    const spec = ctx.bash.resolve({ command: 'echo hi' })
    expect(spec).toEqual({ command: 'echo hi', workdir: '/stub', timeoutMs: 1000, stdoutMaxBytes: 64_000, sandboxPolicy: undefined })

    const result = await ctx.bash.run(spec)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.text).toBe('ok')

    const proc = ctx.bash.start(spec)
    expect(proc.status).toBe('running')
    expect(proc.readOutput()).toEqual({ delta: '', lossy: false })
    expect(proc.kill()).toBe(true)
    expect(proc.kill()).toBe(false) // already settled → no-op
    await proc.done
  })

  it('reports no default sandbox mode from the task-free base seam', async () => {
    const ctx = new Context()
    await ctx.plugin(StubExecutor)
    expect(ctx.bash.sandboxMode).toBeUndefined()
  })

  it('loading a second implementation throws (one bash service per context — cordis standard)', async () => {
    const ctx = new Context()
    await ctx.plugin(StubExecutor)
    class SecondExecutor extends StubExecutor {}
    await expect(ctx.plugin(SecondExecutor)).rejects.toThrow(/service "bash" has been registered/)
  })
})
