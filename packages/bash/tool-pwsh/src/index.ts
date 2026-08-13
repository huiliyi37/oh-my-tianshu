/**
 * Model-facing PowerShell Consumer of the `ctx.bash` capability seam. Intended for
 * Windows compositions where a PowerShell executor (e.g.
 * `@deepseek-ai/dsh-pwsh-local`) backs `ctx.bash`; the tool contract is
 * PowerShell-dialect: native `C:\...` paths and `$env:NAME` variables.
 *
 * Behavior mirrors `dsh-tool-bash` call-for-call minus the sandbox surface:
 * foreground and `run_in_background` execution (background handles register
 * with the generic `ctx.tasks` runtime), the managed `DSH_*` environment
 * through the shared `bash-env` registry, and the bash marker/truncation
 * rendering story. UI presentation mirrors the bash tool's too: a completed
 * foreground call is a terminal card with the parsed exit-status pill, using
 * the shared exit-status parse from `@deepseek-ai/dsh-bash`.
 *
 * @module @deepseek-ai/dsh-tool-pwsh
 */

import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { Context } from 'cordis'
import z from 'schemastery'
import { defineTool, TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, TerminalCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tasks'
import type {} from '@deepseek-ai/dsh-bash-env'
import type { BashRunResult } from '@deepseek-ai/dsh-bash'
import { parseExitStatus } from '@deepseek-ai/dsh-bash'
import { processOutcome } from './background.ts'
import { renderPwshProcessRead, renderPwshResult } from './render.ts'

declare module '@deepseek-ai/dsh-tasks' {
  interface TaskKindMap {
    pwsh: 'pwsh'
  }
}

export const name = 'tool-pwsh'
export const inject = ['tools', 'bash', 'systemPrompt', 'bashEnv']

/** Configuration for the pwsh tool. */
export interface Config {
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  enableRunInBackground?: boolean
}

/** Runtime configuration schema for the pwsh tool plugin. */
export const Config: z<Config> = z.object({
  enableRunInBackground: z.boolean().default(true),
})

/** Parsed tool args; execute validates value constraints absent from ParameterSchemaSpec. */
interface PwshToolArgs {
  command: string
  description: string
  timeoutMs?: number
  workdir?: string
  run_in_background?: boolean
}

/** The canonical foreground result of one pwsh call (the `output.schema` value shape). */
interface PwshForegroundResult {
  kind: 'foreground'
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  aborted: boolean
  timeoutMs: number
  stdout: { text: string; truncated: boolean; spillPath?: string }
  stderr: { text: string; truncated: boolean; spillPath?: string }
}

/* jscpd:ignore-start -- minimal mirror of dsh-tool-bash's validation and execute plumbing (Agent Note). */
function validatePwshArgs(args: PwshToolArgs): void {
  if (args.command.trim().length === 0) {
    throw new Error('invalid command: expected a non-empty string')
  }
  if (args.description.trim().length === 0) {
    throw new Error('invalid description: expected a non-empty string')
  }
  if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(args.timeoutMs)}`)
  }
}
/* jscpd:ignore-end */

function pwshDescription(backgroundEnabled: boolean): string {
  const background = backgroundEnabled
    ? 'Set `run_in_background: true` for long-running commands: the call returns a task id immediately; read its output with `task_output` and stop it with `task_kill`.'
    : 'Background execution is not available; long-running commands must finish within the timeout.'
  return 'Execute a PowerShell command (`pwsh -Command`) and return its stdout/stderr. '
    + 'Each call runs in a fresh pwsh process: no state (cwd, variables, functions) persists between calls — '
    + 'pass `workdir` instead of using `cd`. Paths use native Windows form (`C:\\...`); read environment '
    + 'variables with `$env:NAME`. Non-zero exits are reported as `[exit code: N]`. '
    + 'Current harness environment facts are exposed through managed `$env:DSH_*` variables; inspect them when needed. '
    + 'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. '
    + 'On Windows a force-killed command settles as `[exit code: 1]` without a signal marker — treat it as an interruption, not a command failure. '
    + background
}

/**
 * Resolve an explicit workdir first, making a relative one session-workspace-relative;
 * otherwise use the session header cwd and leave executor defaulting as the fallback.
 */
function resolveWorkdir(modelWorkdir: string | undefined, exec: { agent?: Agent }): string | undefined {
  const headerCwd = exec.agent?.session.header.cwd
  if (modelWorkdir === undefined) return headerCwd
  if (headerCwd !== undefined && !isAbsolute(modelWorkdir)) {
    return resolvePath(headerCwd, modelWorkdir)
  }
  return modelWorkdir
}

/** Detach the executor DTO from readonly Service Definition types into plain JSON data. */
function canonicalPwshResult(result: BashRunResult): PwshForegroundResult {
  const output = (stream: BashRunResult['stdout']) => ({
    text: stream.text,
    truncated: stream.truncated,
    ...stream.spillPath !== undefined ? { spillPath: stream.spillPath } : {},
  })
  return {
    kind: 'foreground',
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    timeoutMs: result.timeoutMs,
    /* jscpd:ignore-start -- the canonical projection and background-handle shape mirror dsh-tool-bash's by design (Agent Note). */
    stdout: output(result.stdout),
    stderr: output(result.stderr),
  }
}

/** Canonical background-handle properties shared by the pwsh output union. */
const BACKGROUND_OUTPUT_PROPERTIES = {
  kind: { type: 'string', required: true, const: 'background' },
  taskId: { type: 'string', required: true },
} as const
/* jscpd:ignore-end */

export function apply(ctx: Context, config: Config = {}): void {
  const backgroundEnabled = config.enableRunInBackground ?? true

  ctx.systemPrompt.section({
    name: 'tool:pwsh',
    order: 105,
    text: 'Non-zero exits are reported as `[exit code: N]` markers; investigate failures before moving on. '
      + 'On Windows a killed process settles as `[exit code: 1]` without a signal marker; treat a bare exit 1 after an interruption as a termination, not a command failure.',
  })

  ctx.tools.register(defineTool({
    name: 'pwsh',
    description: pwshDescription(backgroundEnabled),
    parameters: {
      command: { type: 'string', required: true, description: 'The PowerShell command to execute.' },
      description: {
        type: 'string',
        required: true,
        description: 'Clear, concise description of what this command does in active voice, '
          + '5-10 words (shown in the UI). Examples: "ls" → "List files in current directory"; '
          + '"git status" → "Show working tree status"; "Get-Process" → "List running processes".',
      },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.' },
      workdir: { type: 'string', description: 'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.' },
      ...backgroundEnabled ? {
        run_in_background: { type: 'boolean' as const, description: 'Run in the background and return a task id immediately (collect with task_output, stop with task_kill). No timeout applies.' },
      } : {},
    },
    output: {
      // The foreground result wire shape mirrors dsh-tool-bash's by contract —
      // consumers of one must accept the other (see the pwsh-tool-and-executor
      // Agent Note).
      /* jscpd:ignore-start -- deliberate result-schema symmetry with dsh-tool-bash. */
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: BACKGROUND_OUTPUT_PROPERTIES,
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
              signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              timedOut: { type: 'boolean', required: true },
              aborted: { type: 'boolean', required: true },
              timeoutMs: { type: 'number', required: true },
              stdout: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: {
                  text: { type: 'string', required: true },
                  truncated: { type: 'boolean', required: true },
                  spillPath: { type: 'string' },
                },
              },
              stderr: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: {
                  text: { type: 'string', required: true },
                  truncated: { type: 'boolean', required: true },
                  spillPath: { type: 'string' },
                },
              },
            },
          },
        ],
      },
      /* jscpd:ignore-end */
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'background'
          ? `started background task ${value.taskId}`
          : renderPwshResult(value),
      }],
    },
    /* jscpd:ignore-start -- the execute path mirrors dsh-tool-bash's by design (see the pwsh-tool-and-executor Agent Note). */
    async execute(args: PwshToolArgs, exec) {
      validatePwshArgs(args)
      const workdir = resolveWorkdir(args.workdir, exec)
      const request = {
        command: args.command,
        ...workdir !== undefined ? { workdir } : {},
        ...args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {},
        dshEnv: ctx.bashEnv.collect(exec),
      }
      if (args.run_in_background === true) {
        // Undeclared keys are allowed, so schema omission also needs enforcement.
        if (!backgroundEnabled) {
          throw new Error('run_in_background is disabled for this deployment (enableRunInBackground: false)')
        }
        const tasks = ctx.get('tasks')
        if (tasks === undefined) {
          throw new Error('background tasks unavailable: load @deepseek-ai/dsh-tasks and @deepseek-ai/dsh-tool-tasks')
        }
        // The caller owns cancellation until ctx.tasks commits detached ownership.
        /* v8 ignore start -- the bash twin's branch is exercised by its sandbox-approval mid-call abort;
           pwsh has no approval surface, and the tool registry's pre-dispatch abort check intercepts
           already-aborted signals first, so this mirror-only guard has no reachable trigger. */
        if (exec.signal.aborted) {
          const error = new HarnessError('tool call aborted', TOOL_ABORTED)
          error.name = 'AbortError'
          throw error
        }
        /* v8 ignore end */
        // Task preflight finishes before the starter can spawn a process.
        const id = tasks.start({
          kind: 'pwsh',
          label: args.command,
          ...exec.agent ? { owner: exec.agent } : {},
          run: () => {
            const proc = ctx.bash.start(ctx.bash.resolve(request))
            return {
              cancel: () => void proc.kill(),
              done: proc.done.then(() => processOutcome(proc)),
              readOutput: () => { return renderPwshProcessRead(proc.readOutput()) },
            }
          },
        })
        return { kind: 'background' as const, taskId: id }
      }
      const result = await ctx.bash.run(ctx.bash.resolve({
        ...request,
        signal: exec.signal,
      }))
      if (result.aborted) {
        const error = new HarnessError('tool call aborted', TOOL_ABORTED)
        error.name = 'AbortError'
        throw error
      }
      return canonicalPwshResult(result)
    },
    /* jscpd:ignore-end */
    /* jscpd:ignore-start -- the background call card mirrors presentBashCall's by design (Agent Note). */
    presentCall: (args: PwshToolArgs): TerminalCallView | GenericCallView => {
      // Background acknowledgements carry no terminal exit status; the generic
      // card mirrors the bash tool's background presentation.
      if (args.run_in_background === true) {
        return {
          card: 'generic',
          title: args.command,
          kind: 'execute',
          rawInput: args.command,
          content: [{ type: 'text', text: args.description }],
        }
      }
      return {
        card: 'terminal',
        title: args.command,
        description: args.description,
        ...args.workdir !== undefined ? { cwd: args.workdir } : {},
      }
    },
    /* jscpd:ignore-end */
    /* jscpd:ignore-start -- the completed-result presentation mirrors presentBashResult's by design (Agent Note). */
    presentResult: (args: unknown, result: ToolResult): ToolResultView | undefined => {
      const block = result.content.length === 1 ? result.content[0] : undefined
      if (block === undefined || block.type !== 'text') return undefined
      const raw = block.text
      const isBackground = typeof args === 'object' && args !== null && (args as { run_in_background?: unknown }).run_in_background === true
      // Background acknowledgements and errors have no terminal exit status.
      if (isBackground || result.isError) {
        return { card: 'generic', content: [{ type: 'text', text: `\`\`\`console\n${raw.replace(/\n+$/, '')}\n\`\`\`` }] }
      }
      // The exit marker becomes the card's exit pill, so it leaves the output body.
      const { body, ...exit } = parseExitStatus(raw)
      return { card: 'terminal', output: body, ...exit }
    },
    /* jscpd:ignore-end */
  }))
}
