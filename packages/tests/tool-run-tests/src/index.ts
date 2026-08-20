/**
 * Model-facing test-runner tools: `run_tests` executes the workspace's test
 * framework through the `ctx.bash` seam and reports machine-readable counts;
 * `related_tests` lists test files near one source path by filename
 * convention. Both are pure consumers of existing seams — no loop change, no
 * framework dependency. `run_tests` tool/result pairs flow through the
 * ordinary session event stream, where evidence-gate accounts them as
 * verification evidence exactly like a bash test command.
 * @module @huiliyi37/dsh-tool-run-tests
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { defineTool, TOOL_ABORTED } from '@huiliyi37/dsh-tools'
import type { GenericCallView, JsonValue, TerminalCallView, ToolExecution, ToolResult, ToolResultView } from '@huiliyi37/dsh-tools'
import { HarnessError } from '@huiliyi37/dsh-llm'
import type { BashProcess, BashRunResult } from '@huiliyi37/dsh-bash'
import type {} from '@huiliyi37/dsh-tasks'
import {
  DEFAULT_COMMANDS,
  detectFramework,
  nodeProbe,
  parseSummaryAuto,
  parseTestSummary,
  relatedTestsFor,
  renderCommand,
} from './detect.ts'
import type { RelatedTest, TestSummary } from './detect.ts'

// This package registers its own generic-task producer kind.
declare module '@huiliyi37/dsh-tasks' {
  interface TaskKindMap {
    'run-tests': 'run-tests'
  }
}

export const name = 'tool-run-tests'
export const inject = ['tools', 'bash']

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: a non-integer or
 * sub-1 `outputTailChars`, an unknown framework id, or an empty
 * `commandOverrides` value throws at plugin load, never a silent fall-back).
 */
export interface Config {
  /** Framework id → command base; replaces one DEFAULT_COMMANDS entry. */
  commandOverrides?: Record<string, string>
  /** Characters of combined output kept in the canonical value's `tail` (default `8000`). */
  outputTailChars?: number
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  enableRunInBackground?: boolean
}

export const Config: z<Config> = z.object({
  commandOverrides: z.dict(z.string()).default({}),
  outputTailChars: z.number().default(8000),
  enableRunInBackground: z.boolean().default(true),
})

/** Parsed run_tests args; execute validates constraints the DSL cannot express. */
interface RunTestsArgs {
  command?: string
  path?: string[]
  run_in_background?: boolean
}

/** Parsed related_tests args. */
interface RelatedTestsArgs {
  path: string
}

/** One completed foreground run: the canonical value's foreground branch. */
interface RunTestsForegroundValue {
  kind: 'foreground'
  command: string
  exitCode: number | null
  passed: number | null
  failed: number | null
  total: number | null
  tail: string
}

/** The canonical value's background branch: the task handle, no run facts yet. */
interface RunTestsBackgroundValue {
  kind: 'background'
  command: string
  taskId: string
}

type RunTestsValue = RunTestsForegroundValue | RunTestsBackgroundValue

/** The canonical related_tests value. */
interface RelatedTestsValue {
  tests: RelatedTest[]
}

const NULLABLE_INTEGER = { oneOf: [{ type: 'integer' }, { type: 'null' }] } as const

/**
 * Map a settled background bash process onto the generic task-outcome
 * vocabulary, mirroring tool-bash's mapping: `killed` stays `killed`, a
 * nonzero command exit is `completed` with the exit code as detail.
 * @param proc - the settled process handle.
 * @returns the `ctx.tasks` outcome.
 */
function processOutcome(proc: BashProcess): { status: 'completed' | 'killed'; detail: string } {
  if (proc.status === 'killed') {
    return { status: 'killed', detail: proc.signal !== null ? `signal: ${proc.signal}` : 'killed before exit' }
  }
  return { status: 'completed', detail: `exit code: ${proc.exitCode ?? 0}` }
}

/**
 * Combine stdout, stderr, and exit markers into one tail, bounded to the
 * configured cap. Summary parsing runs on the bounded tail — framework
 * summaries sit at the end of the output, so the cap keeps them.
 * @param result - the completed foreground bash run.
 * @param outputTailChars - the configured cap.
 * @returns the bounded combined tail.
 */
function combinedTail(result: BashRunResult, outputTailChars: number): string {
  let body = result.stdout.text
  if (result.stderr.text.length > 0) {
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${result.stderr.text}`
  }
  if (result.timedOut) body += `\n[timed out after ${result.timeoutMs}ms]`
  if (result.signal !== null) body += `\n[killed by signal: ${result.signal}]`
  else if (result.exitCode !== 0) body += `\n[exit code: ${result.exitCode}]`
  const trimmed = body.trimEnd()
  return trimmed.length <= outputTailChars ? trimmed : trimmed.slice(-outputTailChars)
}

/** Model-facing summary text for one completed run. */
function summaryText(value: RunTestsForegroundValue): string {
  const counts = value.passed === null
    ? 'summary not recognized'
    : `${value.passed} passed, ${value.failed} failed, ${value.total} total`
  const head = value.exitCode === null
    ? `killed (no exit code); ${counts}`
    : `[exit code: ${value.exitCode}] ${counts}`
  const command = `command: ${value.command}`
  return value.tail.length === 0 ? `${head}\n${command}` : `${head}\n${command}\n\n${value.tail}`
}

/**
 * Install the two tools on `ctx.tools`.
 * @param ctx - plugin context carrying the tool registry and bash executor.
 * @param config - validated {@link Config}; `outputTailChars` is re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // Schema defaults mirrored as `??` fallbacks for direct apply calls (单一缺省来源).
  const outputTailChars = config.outputTailChars ?? 8000
  const overrides = config.commandOverrides ?? {}
  const backgroundEnabled = config.enableRunInBackground ?? true
  if (!Number.isInteger(outputTailChars) || outputTailChars < 1) {
    throw new Error(`tool-run-tests: invalid outputTailChars ${outputTailChars} — must be an integer >= 1`)
  }
  for (const [frameworkId, command] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULT_COMMANDS, frameworkId)) {
      throw new Error(`tool-run-tests: unknown framework "${frameworkId}" in commandOverrides`)
    }
    if (command.trim().length === 0) {
      throw new Error(`tool-run-tests: empty commandOverrides value for framework "${frameworkId}"`)
    }
  }

  /**
   * Resolve one run_tests call to its command line: an explicit `command`
   * wins; otherwise framework detection from workspace metadata supplies the
   * base and the selected paths ride along. Returns the framework id too —
   * the parser for the summary tail.
   */
  async function resolveCommand(args: RunTestsArgs, cwd: string): Promise<{ command: string; frameworkId: string }> {
    if (args.command !== undefined) return { command: args.command, frameworkId: 'npm' }
    const framework = await detectFramework(nodeProbe, cwd)
    if (framework === undefined) {
      throw new Error('run_tests: cannot detect a test framework in this workspace — pass `command`')
    }
    return { command: renderCommand(framework.id, args.path ?? [], overrides), frameworkId: framework.id }
  }

  ctx.tools.register(defineTool({
    name: 'run_tests',
    description: 'Run the project\'s tests and return machine-readable pass/fail counts. '
      + 'Prefer this over bash for test runs: the harness verification gate accounts the result. '
      + 'Provide `command` to run one exact command line, or `path` to select test files/directories '
      + 'and let the harness detect the framework (vitest/jest/mocha/npm/pytest/go) from workspace metadata. '
      + 'A non-zero exit is reported, not an error. Set `run_in_background: true` for long suites: '
      + 'the call returns a task id; read output with `task_output` and stop with `task_kill`.',
    parameters: {
      command: { type: 'string', description: 'Exact command line to run. Omit to use framework detection.' },
      path: {
        type: 'array',
        description: 'Test files or directories to run (relative to the workspace). Used with framework detection.',
        items: { type: 'string' },
      },
      run_in_background: { type: 'boolean', description: 'Run the suite as a background task and return a task id.' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'background' },
              command: { type: 'string', required: true },
              taskId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              command: { type: 'string', required: true },
              exitCode: { ...NULLABLE_INTEGER, required: true },
              passed: { ...NULLABLE_INTEGER, required: true },
              failed: { ...NULLABLE_INTEGER, required: true },
              total: { ...NULLABLE_INTEGER, required: true },
              tail: { type: 'string', required: true },
            },
          },
        ],
      },
      render: (_args, value: RunTestsValue) => [{
        type: 'text',
        text: value.kind === 'background'
          ? `started background task ${value.taskId}: ${value.command}`
          : summaryText(value),
      }],
      presentationMeta: (_args, value): JsonValue => value,
    },
    isConcurrencySafe: () => false,
    presentCall: (args: RunTestsArgs): TerminalCallView | GenericCallView => {
      if (args.run_in_background === true) {
        return { card: 'generic', title: 'Run tests in background', kind: 'execute', rawInput: { command: args.command, path: args.path } }
      }
      return { card: 'terminal', title: args.command ?? `Run tests: ${(args.path ?? []).join(' ')}` }
    },
    presentResult: (args: RunTestsArgs, result: ToolResult): ToolResultView | undefined => {
      const value = result.meta as RunTestsValue | undefined
      if (args.run_in_background === true) {
        return { card: 'generic', title: 'Tests started in background', content: [{ type: 'text', text: value?.kind === 'background' ? value.command : '' }] }
      }
      if (value === undefined || value.kind !== 'foreground') return undefined
      return { card: 'terminal', output: value.tail, ...value.exitCode === null ? {} : { exitCode: value.exitCode } }
    },
    async execute(args: RunTestsArgs, exec: ToolExecution): Promise<RunTestsValue> {
      if (args.command !== undefined && args.command.trim().length === 0) {
        throw new Error('invalid command: expected a non-empty string')
      }
      if (args.path !== undefined && args.path.some(path => path.trim().length === 0)) {
        throw new Error('invalid path: every entry must be a non-empty string')
      }
      // Framework detection and the run both anchor to the calling session's
      // cwd (the bash tool's own workdir contract), falling back to the
      // process cwd for a non-agent caller.
      const cwd = exec.agent?.session.header.cwd ?? process.cwd()
      const { command, frameworkId } = await resolveCommand(args, cwd)
      const request = { command, workdir: cwd }
      if (args.run_in_background === true) {
        if (!backgroundEnabled) {
          throw new Error('run_in_background is disabled for this deployment (enableRunInBackground: false)')
        }
        const tasks = ctx.get('tasks')
        if (tasks === undefined) {
          throw new Error('background tasks unavailable: load @huiliyi37/dsh-tasks and @huiliyi37/dsh-tool-tasks')
        }
        if (exec.signal.aborted) {
          const error = new HarnessError('tool call aborted', TOOL_ABORTED)
          error.name = 'AbortError'
          throw error
        }
        const id = tasks.start({
          kind: 'run-tests',
          label: command,
          ...exec.agent ? { owner: exec.agent } : {},
          run: () => {
            const proc = ctx.bash.start(ctx.bash.resolve(request))
            return {
              cancel: () => void proc.kill(),
              done: proc.done.then(() => processOutcome(proc)),
              readOutput: () => proc.readOutput().delta,
            }
          },
        })
        return { kind: 'background', command, taskId: id }
      }
      const result = await ctx.bash.run(ctx.bash.resolve({ ...request, signal: exec.signal }))
      if (result.aborted) {
        const error = new HarnessError('tool call aborted', TOOL_ABORTED)
        error.name = 'AbortError'
        throw error
      }
      const tail = combinedTail(result, outputTailChars)
      // An explicit command names no framework: try every known summary
      // parser; a detected framework pins its own parser.
      const summary: TestSummary = args.command !== undefined
        ? parseSummaryAuto(tail)
        : parseTestSummary(frameworkId, tail)
      return {
        kind: 'foreground',
        command,
        exitCode: result.exitCode,
        passed: summary.passed,
        failed: summary.failed,
        total: summary.total,
        tail,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'related_tests',
    description: 'List test files related to one source path, by filename convention: '
      + 'co-located `<name>.(test|spec).<ext>` and `_test` variants, and entries in '
      + '`__tests__`/`tests`/`test` directories or the root test mirror. Bounded and '
      + 'heuristic — it never parses code.',
    parameters: {
      path: { type: 'string', required: true, description: 'Source file or directory to find tests for.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tests: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: ['co-located', 'test-dir'] },
              },
            },
          },
        },
      },
      render: (_args, value: RelatedTestsValue) => [{
        type: 'text',
        text: value.tests.length === 0
          ? 'No related test files found.'
          : `Related tests:\n${value.tests.map(test => `- ${test.path}`).join('\n')}`,
      }],
      presentationMeta: (_args, value): JsonValue => value,
    },
    isConcurrencySafe: () => true,
    presentCall: (args: RelatedTestsArgs): GenericCallView => ({
      card: 'generic',
      title: `Find tests for ${args.path}`,
      kind: 'search',
      locations: [{ path: args.path }],
    }),
    presentResult: (_args: RelatedTestsArgs, result: ToolResult): ToolResultView | undefined => {
      const value = result.meta as RelatedTestsValue | undefined
      if (value === undefined) return undefined
      return {
        card: 'generic',
        title: value.tests.length === 0 ? 'No related tests' : `${value.tests.length} related test${value.tests.length === 1 ? '' : 's'}`,
      }
    },
    async execute(args: RelatedTestsArgs, exec: ToolExecution): Promise<RelatedTestsValue> {
      if (args.path.trim().length === 0) throw new Error('invalid path: expected a non-empty string')
      const cwd = exec.agent?.session.header.cwd ?? process.cwd()
      return { tests: await relatedTestsFor(nodeProbe, args.path, cwd) }
    },
  }))
}
