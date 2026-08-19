import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { CallId } from '@huiliyi37/dsh-llm'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import ToolRegistry from '@huiliyi37/dsh-tools'
import AgentRegistry from '@huiliyi37/dsh-agent'
import type { Agent } from '@huiliyi37/dsh-agent'
import { SessionId } from '@huiliyi37/dsh-session'
import LocalTaskService from '@huiliyi37/dsh-tasks-local'
import { TaskId } from '@huiliyi37/dsh-tasks'
import * as ToolTasks from '@huiliyi37/dsh-tool-tasks'
import { LocalBashExecutor } from '@huiliyi37/dsh-bash-local'
import LocalSubprocessService from '@huiliyi37/dsh-subprocess-local'
import * as BashEnvPlugin from '@huiliyi37/dsh-bash-env'
import * as ToolRunTests from '@huiliyi37/dsh-tool-run-tests'
import type { Config } from '@huiliyi37/dsh-tool-run-tests'
import {
  detectFramework,
  parseTestSummary,
  relatedTestsFor,
  renderCommand,
} from '@huiliyi37/dsh-tool-run-tests/src/detect.ts'
import type { Probe } from '@huiliyi37/dsh-tool-run-tests/src/detect.ts'

/**
 * Behavior suite for the test-runner tools: pure detection/parsing/discovery,
 * plus real executor integration for the explicit-command, detected,
 * background, and related_tests paths, and fail-loud config validation.
 */

const testToolSignal = new AbortController().signal

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-tool-run-tests-spec-'))

/** In-memory probe for the pure detectors. */
function fakeProbe(files: Record<string, string>, dirs: Record<string, string[]> = {}): Probe {
  return {
    async readText(path) { return Object.hasOwn(files, path) ? files[path] : undefined },
    async readDir(path) { return dirs[path] ?? [] },
    async isFile(path) { return Object.hasOwn(files, path) },
  }
}

/** Foreground harness: no task runtime (backgrounding fails loud here). */
async function setup(config: Config = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalSubprocessService)
  ;(ctx.subprocess as LocalSubprocessService).internals = { spillDir }
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
  await ctx.plugin(ToolRunTests, config)
  return ctx
}

/** Full harness: the generic task runtime + its control surface. */
async function setupWithTasks(config: Config = {}) {
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
  await ctx.plugin(ToolRunTests, config)
  return ctx
}

/** A fake agent whose session cwd anchors detection and discovery. */
function registerFakeAgent(ctx: Context, sessionId: string, cwd: string): Agent {
  const scopeFiber = ctx.plugin(() => {})
  const id = SessionId(sessionId)
  const agent = {
    id,
    ctx: scopeFiber.ctx,
    inject: () => {},
    session: { id, header: { version: 0, id, createdAt: 0, cwd } },
  } as unknown as Agent
  ctx.agents.register(agent)
  return agent
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, agent?: Agent) {
  return ctx.tools.execute({ signal: testToolSignal, callId: CallId(`call-${++callCounter}`), name, arguments: args, ...agent ? { agent } : {} })
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('detectFramework', () => {
  it('prefers the runner dependency, then the test script, then pytest markers, then go.mod', async () => {
    const root = '/ws'
    expect((await detectFramework(fakeProbe({ [`${root}/package.json`]: JSON.stringify({ devDependencies: { vitest: '1' } }) }), root))?.id).toBe('vitest')
    expect((await detectFramework(fakeProbe({ [`${root}/package.json`]: JSON.stringify({ dependencies: { jest: '1' } }) }), root))?.id).toBe('jest')
    expect((await detectFramework(fakeProbe({ [`${root}/package.json`]: JSON.stringify({ devDependencies: { mocha: '1' } }) }), root))?.id).toBe('mocha')
    expect((await detectFramework(fakeProbe({ [`${root}/package.json`]: JSON.stringify({ scripts: { test: 'tsx x' } }) }), root))?.id).toBe('npm')
    expect((await detectFramework(fakeProbe({ [`${root}/pyproject.toml`]: '' }), root))?.id).toBe('pytest')
    expect((await detectFramework(fakeProbe({ [`${root}/conftest.py`]: '' }), root))?.id).toBe('pytest')
    expect((await detectFramework(fakeProbe({ [`${root}/go.mod`]: '' }), root))?.id).toBe('go')
    expect(await detectFramework(fakeProbe({}), root)).toBeUndefined()
  })
})

describe('renderCommand', () => {
  it('joins shell-quoted paths, special-cases npm and go, and lets overrides replace the base', () => {
    expect(renderCommand('vitest', ['src/a.test.ts'], {})).toBe('npx vitest run \'src/a.test.ts\'')
    expect(renderCommand('vitest', [], {})).toBe('npx vitest run')
    expect(renderCommand('npm', ['a.test.ts'], {})).toBe('npm test -- \'a.test.ts\'')
    expect(renderCommand('go', ['pkg/x/a_test.go'], {})).toBe('go test \'pkg/x\'')
    expect(renderCommand('pytest', ['t/'], { pytest: 'uv run pytest' })).toBe('uv run pytest \'t/\'')
    // A path with spaces or an embedded quote stays one argument.
    expect(renderCommand('vitest', ['my tests/a.test.ts'], {})).toBe('npx vitest run \'my tests/a.test.ts\'')
    expect(renderCommand('vitest', ["it's.test.ts"], {})).toBe('npx vitest run \'it\'\\\'\'s.test.ts\'')
    expect(() => renderCommand('nope', [], {})).toThrow(/unknown framework/)
  })
})

describe('parseTestSummary', () => {
  it('parses each framework summary and returns nulls for npm', () => {
    expect(parseTestSummary('vitest', 'Test Files  1 passed (1)\n     Tests  2 passed (2)')).toEqual({ passed: 2, failed: 0, total: 2 })
    // Real mixed-result vitest line: per-status counts, parenthesized grand total.
    expect(parseTestSummary('vitest', 'Test Files  1 failed (2)\n     Tests  3 failed | 4 passed (7)')).toEqual({ passed: 4, failed: 3, total: 7 })
    expect(parseTestSummary('vitest', 'Tests  1 failed (1)')).toEqual({ passed: 0, failed: 1, total: 1 })
    expect(parseTestSummary('vitest', 'Tests  2 passed | 1 skipped (3)')).toEqual({ passed: 2, failed: 0, total: 3 })
    expect(parseTestSummary('jest', 'Tests:       1 passed, 2 failed, 3 total')).toEqual({ passed: 1, failed: 2, total: 3 })
    expect(parseTestSummary('mocha', '  4 passing\n  1 failing')).toEqual({ passed: 4, failed: 1, total: 5 })
    expect(parseTestSummary('pytest', '5 passed, 2 failed in 0.12s')).toEqual({ passed: 5, failed: 2, total: 7 })
    expect(parseTestSummary('go', 'ok  example.com/p 0.1s\nFAIL example.com/q 0.2s')).toEqual({ passed: 1, failed: 1, total: 2 })
    expect(parseTestSummary('npm', 'whatever')).toEqual({ passed: null, failed: null, total: null })
  })
})

describe('relatedTestsFor', () => {
  it('finds co-located and test-directory candidates that exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-related-tests-'))
    const files: Record<string, string> = {
      [`${root}/src/foo/bar.ts`]: '',
      [`${root}/src/foo/bar.test.ts`]: '',
      [`${root}/src/foo/__tests__/bar-extra.test.ts`]: '',
      [`${root}/tests/src/foo/bar-suite.spec.ts`]: '',
      [`${root}/go/pkg/x.go`]: '',
      [`${root}/go/pkg/x_test.go`]: '',
    }
    const probe = fakeProbe(files, {
      [`${root}/src/foo/__tests__`]: ['bar-extra.test.ts', 'missing.test.ts'],
      [`${root}/src/foo/tests`]: [],
      [`${root}/src/foo/test`]: [],
      [`${root}/tests/src/foo`]: ['bar-suite.spec.ts', 'bar-suite-extra.test.ts'],
      [`${root}/test/src/foo`]: [],
      [`${root}/go/pkg`]: ['x.go', 'x_test.go'],
    })
    const found = await relatedTestsFor(probe, join(root, 'src/foo/bar.ts'), root)
    expect(found.map(entry => entry.path)).toContain('src/foo/bar.test.ts')
    expect(found.map(entry => entry.path)).toContain('src/foo/__tests__/bar-extra.test.ts')
    expect(found.map(entry => entry.path)).toContain('tests/src/foo/bar-suite.spec.ts')
    expect(found.every(entry => !entry.path.includes('missing'))).toBe(true)
    const goFound = await relatedTestsFor(probe, join(root, 'go/pkg/x.go'), root)
    expect(goFound.map(entry => entry.path)).toContain('go/pkg/x_test.go')
  })

  it('returns an empty list for an unknown target', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-related-tests-'))
    expect(await relatedTestsFor(fakeProbe({}), join(root, 'nope.ts'), root)).toEqual([])
  })
})

describe('run_tests integration', () => {
  it('runs an explicit command and parses the framework summary', async () => {
    const ctx = await setup()
    const command = 'node -e "console.log(\'Test Files  1 passed (1)\'); console.log(\'     Tests  2 passed (2)\')"'
    const result = await call(ctx, 'run_tests', { command })
    expect(result.value).toMatchObject({ kind: 'foreground', command, exitCode: 0, passed: 2, failed: 0, total: 2 })
    expect(resultText(result)).toContain('[exit code: 0] 2 passed, 0 failed, 2 total')
  })

  it('reports a failed suite without erroring the tool', async () => {
    const ctx = await setup()
    const command = 'node -e "console.log(\'Tests  1 failed (1)\'); process.exit(1)"'
    const result = await call(ctx, 'run_tests', { command })
    expect(result.value).toMatchObject({ kind: 'foreground', exitCode: 1, passed: 0, failed: 1, total: 1 })
    expect(result.content.some(block => block.type === 'text' && block.text.includes('[exit code: 1]'))).toBe(true)
  })

  it('detects the framework from the session workspace and appends the selected paths', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'dsh-run-tests-ws-'))
    writeFileSync(join(workdir, 'package.json'), JSON.stringify({ devDependencies: { vitest: '3' } }))
    const ctx = await setup()
    const agent = registerFakeAgent(ctx, 'ws-agent', workdir)
    const result = await call(ctx, 'run_tests', { path: ['src/a.test.ts'] }, agent)
    expect(result.value).toMatchObject({ kind: 'foreground', command: 'npx vitest run \'src/a.test.ts\'' })
  })

  it('fails loud when nothing identifies a framework and no command is given', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'dsh-run-tests-empty-'))
    const ctx = await setup()
    const agent = registerFakeAgent(ctx, 'empty-agent', workdir)
    const result = await call(ctx, 'run_tests', { path: ['x.test.ts'] }, agent)
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('cannot detect a test framework')
  })

  it('rejects an empty explicit command', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'run_tests', { command: '   ' })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('non-empty string')
  })

  it('runs a suite as a background task and settles the task outcome', async () => {
    const ctx = await setupWithTasks()
    const command = 'node -e "console.log(\'Tests  1 passed (1)\')"'
    const agent = registerFakeAgent(ctx, 'bg-agent', process.cwd())
    const result = await call(ctx, 'run_tests', { command, run_in_background: true }, agent)
    expect(result.value).toMatchObject({ kind: 'background', command })
    const taskId = (result.value as { taskId: string }).taskId
    expect(typeof taskId).toBe('string')
    // The producer's done settles the generic task record.
    await vi2WaitFor(async () => {
      const task = ctx.tasks.get(TaskId(taskId), agent)
      expect(task.status).toBe('completed')
    })
  })

  it('fails loud on invalid config at plugin load', async () => {
    async function loadExpectFail(config: Config, pattern: RegExp): Promise<void> {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRegistry)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(LocalSubprocessService)
      ;(ctx.subprocess as LocalSubprocessService).internals = { spillDir }
      await ctx.plugin(BashEnvPlugin)
      await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
      const failure = await ctx.plugin(ToolRunTests, config).then(() => null, (error: unknown) => error)
      expect(failure).not.toBeNull()
      expect(String(failure)).toMatch(pattern)
    }
    await loadExpectFail({ outputTailChars: 0 }, /outputTailChars/)
    await loadExpectFail({ commandOverrides: { nope: 'x' } }, /unknown framework/)
    await loadExpectFail({ commandOverrides: { vitest: '  ' } }, /empty commandOverrides/)
  })
})

describe('related_tests integration', () => {
  it('lists existing related test files from the session workspace', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'dsh-related-ws-'))
    mkdirSync(join(workdir, 'src'), { recursive: true })
    writeFileSync(join(workdir, 'src', 'app.ts'), 'x')
    writeFileSync(join(workdir, 'src', 'app.test.ts'), 'x')
    const ctx = await setup()
    const agent = registerFakeAgent(ctx, 'rel-agent', workdir)
    const result = await call(ctx, 'related_tests', { path: 'src/app.ts' }, agent)
    expect(result.value).toEqual({ tests: [{ path: 'src/app.test.ts', kind: 'co-located' }] })
    expect(resultText(result)).toContain('src/app.test.ts')
  })

  it('rejects an empty path', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'related_tests', { path: ' ' })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('non-empty string')
  })
})

/** Poll a predicate until it passes or the deadline elapses. */
async function vi2WaitFor(predicate: () => void | Promise<void>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      await predicate()
      return
    } catch (error) {
      last = error
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  throw last instanceof Error ? last : new Error('waitFor timed out')
}
