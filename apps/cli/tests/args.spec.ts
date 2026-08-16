import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDshArgs } from '../src/args.ts'

const parse = (argv: string[]) => parseDshArgs(argv, '1.2.3')

/** Capture the process exit code while muting Commander's output. */
function exitCode(argv: string[]): number {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  try {
    parse(argv)
    throw new Error(`expected ${JSON.stringify(argv)} to exit`)
  } catch {
    return exit.mock.calls.at(-1)?.[0] as number
  } finally {
    vi.restoreAllMocks()
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('parseDshArgs', () => {
  it('routes profile boots, one-shot runs, and the web alias', () => {
    expect(parse(['--profile', 'tui'])).toEqual({ mode: 'profile', profile: 'tui', patches: [] })
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--patch', 'b.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml', 'b.yml'] })
    expect(parse(['run', 'run', 'the', 'tests']))
      .toEqual({ mode: 'run', profile: 'headless', patches: [], task: 'run the tests' })
    expect(parse(['run', '--profile', 'custom', '--patch', 'a.yml', '--patch', 'b.yml', 'run', 'the', 'tests']))
      .toEqual({ mode: 'run', profile: 'custom', patches: ['a.yml', 'b.yml'], task: 'run the tests' })
    expect(parse(['run', '--', '--profile', 'is', 'task', 'text']))
      .toEqual({ mode: 'run', profile: 'headless', patches: [], task: '--profile is task text' })
    expect(parse(['web'])).toEqual({ mode: 'web', dev: false, patches: [] })
    expect(parse(['web', '--patch', 'web.yml'])).toEqual({ mode: 'web', dev: false, patches: ['web.yml'] })
    expect(parse(['web', '--host', '0.0.0.0', '--port', '8080', '--dev', '--workspace-root', '/w']))
      .toEqual({ mode: 'web', host: '0.0.0.0', port: 8080, dev: true, workspaceRoot: '/w', patches: [] })
    expect(parse(['web', '--trusted-host', 'harness.internal:3080', 'lab.internal', '--trusted-host', '10.0.0.9']))
      .toEqual({ mode: 'web', dev: false, patches: [], trustedHosts: ['harness.internal:3080', 'lab.internal', '10.0.0.9'] })
  })

  it('routes the plugin pnpm forwarder', () => {
    expect(parse(['plugin', '--profile', 'tui', 'add', 'turtle-ui']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', 'turtle-ui'] })
    expect(parse(['plugin', '--profile', 'tui', 'remove', 'turtle-ui']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['remove', 'turtle-ui'] })
    expect(parse(['plugin', '--profile', 'tui', 'why', 'cordis']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['why', 'cordis'] })
    // Unknown pnpm flags forward verbatim.
    expect(parse(['plugin', '--profile', 'tui', 'add', '--save-dev', 'x']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', '--save-dev', 'x'] })
  })

  it('routes profile and web config dumps', () => {
    expect(parse(['--profile', 'web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: false, patches: [] })
    expect(parse(['--profile', 'web', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
    expect(parse(['--profile', 'tui', '--dump-config', '--patch', 'x.yml']))
      .toEqual({ mode: 'dump-config', profile: 'tui', defaultOnly: false, patches: ['x.yml'] })
    expect(parse(['web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: false, patches: [] })
    expect(parse(['web', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
  })

  it('routes the tui command as the tui profile alias', () => {
    expect(parse(['tui'])).toEqual({ mode: 'tui', patches: [], args: [] })
    expect(parse(['tui', '--patch', 'x.yml'])).toEqual({ mode: 'tui', patches: ['x.yml'], args: [] })
    expect(parse(['tui', '--patch', 'a.yml', '--patch', 'b.yml']))
      .toEqual({ mode: 'tui', patches: ['a.yml', 'b.yml'], args: [] })
    // port of dsh-tianshu-tui#21: inner args (--help/--version/initial prompt) are forwarded
    expect(parse(['tui', '--help'])).toEqual({ mode: 'tui', patches: [], args: ['--help'] })
    expect(parse(['tui', '修复这个', 'bug'])).toEqual({ mode: 'tui', patches: [], args: ['修复这个', 'bug'] })
  })

  it('rejects missing profile, removed flags, and contradictory inputs', () => {
    expect(exitCode([])).toBe(1)
    expect(exitCode(['profile'])).toBe(1) // a bare word is a task without --profile
    expect(exitCode(['--config', 'c.yml'])).toBe(1) // removed
    expect(exitCode(['-p', 'task'])).toBe(1) // removed
    expect(exitCode(['--profile', 'headless', 'task'])).toBe(1) // tasks belong to `run`
    expect(exitCode(['run'])).toBe(1)
    expect(exitCode(['run', ''])).toBe(1)
    expect(exitCode(['run', '--profile', '', 'task'])).toBe(1)
    expect(exitCode(['run', '--patch=', 'task'])).toBe(1)
    expect(exitCode(['--profile', 'headless', 'run', 'task'])).toBe(1)
    expect(exitCode(['--patch', 'parent.yml', 'run', 'task'])).toBe(1)
    expect(exitCode(['--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', '--patch='])).toBe(1)
    expect(exitCode(['--dump-config'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-default-config', '--patch', 'p.yml'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-config', 'task'])).toBe(1)
    expect(exitCode(['--bogus'])).toBe(1)
    expect(exitCode(['--profile', 'x', 'web'])).toBe(1)
    expect(exitCode(['web', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['web', '--dump-default-config', '--patch', 'w.yml'])).toBe(1)
    expect(exitCode(['web', '--patch='])).toBe(1)
    // Boot-free dumps derive no flag patches; silently dropping the flags
    // would print a tree that differs from the same invocation's boot.
    expect(exitCode(['web', '--dump-config', '--port', '8080'])).toBe(1)
    expect(exitCode(['web', '--dump-config', '--dev'])).toBe(1)
    // A non-numeric port fails at the flag, not deep in the webserver schema.
    expect(exitCode(['web', '--port', 'abc'])).toBe(1)
    expect(exitCode(['plugin', 'add', 'x'])).toBe(1) // --profile required
    expect(exitCode(['plugin', '--profile', 'tui'])).toBe(1) // nothing to forward
    expect(exitCode(['plugin', '--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', 'plugin', 'add', 'y'])).toBe(1)
  })

  it('exits 0 for help and version', () => {
    expect(exitCode(['--help'])).toBe(0)
    expect(exitCode(['run', '--help'])).toBe(0)
    expect(exitCode(['--version'])).toBe(0)
  })
})
