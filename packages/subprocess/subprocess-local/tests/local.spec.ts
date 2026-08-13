import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { basename, dirname, relative, resolve } from 'node:path'
import { Context } from 'cordis'
import LocalSubprocessService from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { childEnv } from '../src/spawn.ts'

function spec(command: string, overrides: Partial<SubprocessSpawnSpec> = {}): SubprocessSpawnSpec {
  return {
    argv: ['bash', '-c', command],
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64_000, spill: { maxBytes: 64 * 1024 * 1024 } },
      stderr: { maxBytes: 64_000, spill: { maxBytes: 64 * 1024 * 1024 } },
    },
    graceMs: 200,
    ...overrides,
  }
}

describe('LocalSubprocessService', () => {
  it('resolves absolute and PATH executables and honors lookup cancellation', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessService)
    expect(await ctx.subprocess.resolveExecutable(process.execPath)).toBe(process.execPath)
    expect(await ctx.subprocess.resolveExecutable(basename(process.execPath), {
      PATH: dirname(process.execPath),
    })).toBe(process.execPath)
    expect(await ctx.subprocess.resolveExecutable(basename(process.execPath), {
      PATH: relative(process.cwd(), dirname(process.execPath)) || '.',
    })).toBe(process.execPath)
    await expect(ctx.subprocess.resolveExecutable('')).rejects.toThrow('must be non-empty')
    await expect(ctx.subprocess.resolveExecutable('./bin/tsserver'))
      .rejects.toThrow('is a relative path')
    await expect(ctx.subprocess.resolveExecutable('node_modules/.bin/server'))
      .rejects.toThrow('is a relative path')
    await expect(ctx.subprocess.resolveExecutable('dsh-command-that-does-not-exist', { PATH: '' }))
      .rejects.toThrow('was not found on PATH')
    await expect(ctx.subprocess.resolveExecutable('/dsh-absolute-command-that-does-not-exist'))
      .rejects.toThrow('is not an executable file')
    await expect(ctx.subprocess.resolveExecutable(process.cwd()))
      .rejects.toThrow('is not an executable file')
    await expect(ctx.subprocess.resolveExecutable(process.execPath, {}, AbortSignal.abort('stop')))
      .rejects.toBe('stop')
    await fiber.dispose()
  })

  it('builds Windows executable candidates with case-insensitive overrides', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessService)
    const service = ctx.subprocess as LocalSubprocessService
    const candidates = (service as unknown as {
      executableCandidates(command: string, env: NodeJS.ProcessEnv): string[]
    }).executableCandidates.bind(service)
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      expect(Object.keys(childEnv()).filter(key => key.toUpperCase() === 'PATH')).toHaveLength(1)
      const explicit = childEnv({ Path: '/bin', PathExt: '.EXE;.CMD' })
      expect(Object.keys(explicit).filter(key => key.toUpperCase() === 'PATH')).toEqual(['Path'])
      expect(Object.keys(explicit).filter(key => key.toUpperCase() === 'PATHEXT')).toEqual(['PathExt'])
      expect(candidates('tool', explicit)).toEqual(['/bin/tool.EXE', '/bin/tool.CMD'])
      expect(candidates('tool', { Path: '/ambient', PATH: '/explicit', PATHEXT: '.EXE' }))
        .toEqual(['/explicit/tool.EXE'])
      expect(candidates('tool.exe', {})).toEqual([resolve(process.cwd(), 'tool.exe')])
      expect(candidates('tool', { PATH: '/bin' })).toHaveLength(4)
      await expect(ctx.subprocess.resolveExecutable(String.raw`bin\server.exe`))
        .rejects.toThrow('is a relative path')
    } finally {
      platform.mockRestore()
      await fiber.dispose()
    }
  })

  it('validates terminal allocation inputs before allocating a PTY', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessService)
    const base: SubprocessTerminalSpawnSpec = {
      argv: ['bash'], cwd: process.cwd(), rows: 24, cols: 80, graceMs: 10,
    }
    await expect(ctx.subprocess.spawnTerminal({ ...base, argv: [] })).rejects.toThrow('must contain a program')
    await expect(ctx.subprocess.spawnTerminal({ ...base, argv: [''] })).rejects.toThrow('must contain a program')
    await expect(ctx.subprocess.spawnTerminal({ ...base, signal: AbortSignal.abort('stop') })).rejects.toBe('stop')
    await fiber.dispose()
  })

  it('terminates and joins an owned terminal during disposal', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessService)
    const terminate = vi.fn(async () => {})
    const terminal: SubprocessTerminalHandle = {
      pid: 1,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: async () => {},
      inspectForeground: async () => undefined,
      signalForeground: async () => 1,
      terminate,
    }
    const terminals = (ctx.subprocess as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals
    terminals.add(terminal)
    await fiber.dispose()
    expect(terminate).toHaveBeenCalledOnce()
    expect(terminals.size).toBe(0)
  })

  it('waits for every terminal cleanup and aggregates teardown failures', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessService)
    const service = ctx.subprocess
    const firstFailure = new Error('first cleanup failure')
    const secondFailure = new Error('second cleanup failure')
    const disposalErrors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
    const failedTerminal: SubprocessTerminalHandle = {
      pid: 1,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: async () => {},
      inspectForeground: async () => undefined,
      signalForeground: async () => 1,
      terminate: vi.fn(async () => { throw firstFailure }),
    }
    const secondFailedTerminal: SubprocessTerminalHandle = {
      ...failedTerminal,
      terminate: vi.fn(async () => { throw secondFailure }),
    }
    let finishCleanup!: () => void
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve
    })
    const drainingTerminal: SubprocessTerminalHandle = {
      ...failedTerminal,
      terminate: vi.fn(() => cleanup),
    }
    const terminals = (service as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals
    terminals.add(failedTerminal)
    terminals.add(secondFailedTerminal)
    terminals.add(drainingTerminal)

    let disposed = false
    const disposing = fiber.dispose().then(() => { disposed = true })
    await new Promise(resolve => setImmediate(resolve))
    expect(disposed).toBe(false)
    finishCleanup()
    await disposing
    expect(terminals.size).toBe(0)
    expect(disposalErrors).toHaveLength(1)
    expect(disposalErrors[0]).toMatchObject({
      errors: [firstFailure, secondFailure],
      message: 'local subprocess teardown failed',
    })
  })

  it('reports one cleanup failure without wrapping it', async () => {
    const ctx = new Context()
    const failure = new Error('single cleanup failure')
    const disposalErrors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
    const fiber = await ctx.plugin(LocalSubprocessService)
    const service = ctx.subprocess
    const terminal: SubprocessTerminalHandle = {
      pid: 1,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: async () => {},
      inspectForeground: async () => undefined,
      signalForeground: async () => 1,
      terminate: vi.fn(async () => { throw failure }),
    }
    const terminals = (service as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals
    terminals.add(terminal)

    await fiber.dispose()

    expect(disposalErrors).toEqual([failure])
  })

  it('releases a terminal after top-level exit reaches quiescence', async () => {
    let exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined
    const inspector = {
      foregroundPgid: () => undefined,
      isStdinWaiting: () => false,
      processTree: () => [],
      processSession: () => [],
      isAlive: () => false,
      signalGroup: () => {},
      signalProcess: () => {},
    }
    const terminal = {
      pid: 123,
      onData: () => ({ dispose: () => {} }),
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
        exitListener = listener
        return { dispose: () => {} }
      },
      write: () => {},
      kill: () => {},
    }
    vi.resetModules()
    vi.doMock('node-pty', () => ({ spawn: () => terminal }))
    vi.doMock('../src/process-inspector.ts', async importOriginal => ({
      ...await importOriginal<typeof import('../src/process-inspector.ts')>(),
      createProcessInspector: () => inspector,
    }))
    try {
      const { default: IsolatedLocalSubprocessService } = await import('../src/index.ts')
      const ctx = new Context()
      const fiber = await ctx.plugin(IsolatedLocalSubprocessService)
      const service = ctx.subprocess as InstanceType<typeof IsolatedLocalSubprocessService>
      const handle = await ctx.subprocess.spawnTerminal({
        argv: ['shell'], cwd: process.cwd(), rows: 24, cols: 80, graceMs: 1,
      })
      expect((service as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals.size).toBe(1)
      exitListener?.({ exitCode: 0 })
      await handle.done
      await new Promise(resolve => setImmediate(resolve))
      expect((service as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals.size).toBe(0)
      await fiber.dispose()
    } finally {
      vi.doUnmock('node-pty')
      vi.doUnmock('../src/process-inspector.ts')
      vi.resetModules()
    }
  })

  it('retains a terminal whose automatic cleanup fails', async () => {
    let exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined
    const terminal = {
      pid: 123,
      onData: () => ({ dispose: () => {} }),
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
        exitListener = listener
        return { dispose: () => {} }
      },
      write: () => {},
      kill: () => {},
    }
    vi.resetModules()
    vi.doMock('node-pty', () => ({ spawn: () => terminal }))
    try {
      const { default: IsolatedLocalSubprocessService } = await import('../src/index.ts')
      const ctx = new Context()
      const disposalErrors: unknown[] = []
      ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
      const fiber = await ctx.plugin(IsolatedLocalSubprocessService)
      const alive = new Set([124])
      ;(ctx.subprocess as InstanceType<typeof IsolatedLocalSubprocessService>).terminalInspector = {
        foregroundPgid: () => 123,
        isStdinWaiting: () => false,
        processTree: () => [{ pid: 123, started: 'shell' }, { pid: 124, started: 'child' }],
        processSession: () => [],
        isAlive: identity => alive.has(identity.pid),
        signalGroup: () => {},
        signalProcess: () => {},
      }
      const handle = await ctx.subprocess.spawnTerminal({
        argv: ['shell'], cwd: process.cwd(), rows: 24, cols: 80, graceMs: 1,
      })
      exitListener?.({ exitCode: 0 })
      await handle.done
      await new Promise(resolve => setTimeout(resolve, 10))
      expect((ctx.subprocess as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals.size).toBe(1)
      await fiber.dispose()
      expect(disposalErrors).toHaveLength(1)
    } finally {
      vi.doUnmock('node-pty')
      vi.resetModules()
    }
  })

  it('registers as ctx.subprocess and spawns managed handles', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessService)
    const handle = ctx.subprocess.spawn(spec('echo managed'))
    const result = await handle.done
    expect(result.exitCode).toBe(0)
    expect(handle.collected.stdout!.readFrom(0).text).toBe('managed\n')
    await fiber.dispose()
  })

  it('disposal kills still-running processes and awaits their exit', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessService)
    const handle = ctx.subprocess.spawn(spec('sleep 60'))
    await fiber.dispose()
    const outcome = await handle.done
    expect(outcome.signal).toBe('SIGTERM')
  })

  it('a settled process leaves the live set (disposal does not re-kill it)', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessService)
    const handle = ctx.subprocess.spawn(spec('true'))
    const outcome = await handle.done
    expect(outcome.exitCode).toBe(0)
    await fiber.dispose()
  })

  it('disposal tolerates a handle whose spawn already failed', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessService)
    const handle = ctx.subprocess.spawn(spec('true', { cwd: '/nonexistent-dir-dsh-subprocess-test' }))
    await expect(handle.done).rejects.toThrow()
    await fiber.dispose()
  })

  it('disposal contains a spawn-failure rejection that races teardown', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessService)
    // Dispose before the rejection continuation removes the handle from the
    // live set, so teardown itself must swallow the rejected done.
    const handle = ctx.subprocess.spawn(spec('true', { cwd: '/nonexistent-dir-dsh-subprocess-test' }))
    await fiber.dispose()
    await expect(handle.done).rejects.toThrow()
  })

  it('loading a second implementation throws (one processes service per context — cordis standard)', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessService)
    class SecondManager extends LocalSubprocessService {}
    await expect(ctx.plugin(SecondManager)).rejects.toThrow(/service "subprocess" has been registered/)
  })
})
