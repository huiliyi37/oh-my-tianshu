/**
 * Model-facing Consumer of the `ctx.bash` capability seam. Background calls
 * register process handles with `ctx.tasks`; their work uses task cancellation
 * rather than the tool-call signal after an id is returned.
 *
 * TODO(permissions): deployment policy belongs in `tools/pre-execute` and
 * sandboxing executors; see docs/architecture.md § Extending The Harness.
 * @module @huiliyi37/dsh-tool-bash
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { defineTool, TOOL_ABORTED } from '@huiliyi37/dsh-tools'
import type { GenericCallView, TerminalCallView, ToolExecution, ToolResult, ToolResultView } from '@huiliyi37/dsh-tools'
import { HarnessError } from '@huiliyi37/dsh-llm'
import type { Agent } from '@huiliyi37/dsh-agent'
import type {} from '@huiliyi37/dsh-system-prompt'
import type {} from '@huiliyi37/dsh-tasks'
import type {} from '@huiliyi37/dsh-user-approval'
import type {} from '@huiliyi37/dsh-bash-env'
import type { SandboxExecutionPolicy, SandboxMode } from '@huiliyi37/dsh-sandbox'
import { ESCALATION_TARGETS, approveEscalation, canonicalPath, validateEscalationArgs } from '@huiliyi37/dsh-sandbox'
import type { SandboxPolicyService } from '@huiliyi37/dsh-sandbox-policy'
import { DSH_ENV_PREFIX } from '@huiliyi37/dsh-bash'
import type { BashRunResult } from '@huiliyi37/dsh-bash'
import type { SaveTextSpill, SpillRef } from '@huiliyi37/dsh-spill'
import { composeResultBody, outputShapingDropsLines, type OutputShaping } from './model-output.ts'
import { processOutcome } from './background.ts'
import { parseExitStatus, renderProcessRead, renderResult } from './render.ts'

export const name = 'tool-bash'
export const inject = ['tools', 'bash', 'systemPrompt', 'bashEnv']

/** Default tail lines kept when folding a successful run's verbose output. */
const DEFAULT_SUCCESS_TAIL_LINES = 20
/** Default threshold above which a failed run's output gets error-aware selection. */
const DEFAULT_ERROR_THRESHOLD_LINES = 40
/** Default total line budget for error-aware selection. */
const DEFAULT_ERROR_BUDGET_LINES = 60

/** Configuration for the bash tool. */
export interface Config {
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  enableRunInBackground?: boolean
  /** Fold a successful run's output above the tail threshold to its last N lines (0 disables; default 20). */
  outputSuccessTailLines?: number
  /** A failed run's output above this many lines keeps error-relevant lines instead of the whole body (0 disables; default 40). */
  outputErrorThresholdLines?: number
  /** Total line budget for the failed-run error-aware selection (default 60). */
  outputErrorBudgetLines?: number
}

/** Runtime configuration schema for the bash tool plugin. */
export const Config: z<Config> = z.object({
  enableRunInBackground: z.boolean().default(true),
  outputSuccessTailLines: z.number().default(DEFAULT_SUCCESS_TAIL_LINES),
  outputErrorThresholdLines: z.number().default(DEFAULT_ERROR_THRESHOLD_LINES),
  outputErrorBudgetLines: z.number().default(DEFAULT_ERROR_BUDGET_LINES),
})

/** Resolve and validate the shaping knobs once at load (misconfiguration fails loud here, not per call). */
function resolveShapingConfig(config: Config): Pick<OutputShaping, 'successTailLines' | 'errorThresholdLines' | 'errorBudgetLines'> {
  const successTailLines = config.outputSuccessTailLines ?? DEFAULT_SUCCESS_TAIL_LINES
  const errorThresholdLines = config.outputErrorThresholdLines ?? DEFAULT_ERROR_THRESHOLD_LINES
  const errorBudgetLines = config.outputErrorBudgetLines ?? DEFAULT_ERROR_BUDGET_LINES
  const fields: Array<[string, number]> = [
    ['outputSuccessTailLines', successTailLines],
    ['outputErrorThresholdLines', errorThresholdLines],
    ['outputErrorBudgetLines', errorBudgetLines],
  ]
  for (const [name, value] of fields) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`tool-bash: ${name} must be a non-negative integer (got ${JSON.stringify(value)})`)
    }
  }
  return { successTailLines, errorThresholdLines, errorBudgetLines }
}

/** Parsed tool args; execute validates value constraints absent from ParameterSchemaSpec. */
interface BashToolArgs {
  command: string
  description: string
  timeoutMs?: number
  workdir?: string
  run_in_background?: boolean
  sandbox_permissions?: string
  justification?: string
}

function validateBashArgs(args: BashToolArgs): void {
  if (args.command.trim().length === 0) {
    throw new Error('invalid command: expected a non-empty string')
  }
  if (args.description.trim().length === 0) throw new Error('invalid description: expected a non-empty string')
  if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(args.timeoutMs)}`)
  }
  // The escalation pairing (sandbox_permissions ⇔ justification, non-empty) is
  // the shared rule both enforcing families validate identically.
  validateEscalationArgs(args.sandbox_permissions, args.justification)
}

function bashDescription(backgroundEnabled: boolean, escalationModes: readonly SandboxMode[]): string {
  const background = backgroundEnabled
    ? 'Set `run_in_background: true` for long-running commands: the call returns a task id immediately; read its output with `task_output` and stop it with `task_kill`.'
    : 'Background execution is not available; long-running commands must finish within the timeout.'
  const base = 'Execute a bash command (`bash -c`) and return its stdout/stderr. '
    + 'Each call runs in a fresh shell: no state (cwd, variables, functions) persists between calls — '
    + 'pass `workdir` instead of using `cd`. Non-zero exits are reported as `[exit code: N]`. '
    + `Current harness environment facts are exposed through managed \`$${DSH_ENV_PREFIX}*\` variables; inspect them when needed. `
    + 'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug in the command; do not retry another way. '
    + 'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. '
    + 'A long SUCCESSFUL output is folded to its tail lines; a long FAILED output keeps the error-relevant lines with an omission count — '
    + 'never re-run a command just to see dropped output; read the reported full-output path instead. '
    + background
  if (escalationModes.length === 0) return base
  return base + ' Attempting a command the sandbox may deny is safe and expected: run it and read the '
    + 'marker rather than assuming the denial. When a command is denied and a wider mode would let it '
    + 'succeed, escalate immediately in the same turn — the one sanctioned exception to a denial: retry '
    + 'the exact same command once with `sandbox_permissions` (the narrowest wider mode that suffices) '
    + 'plus a one-sentence `justification`. Do not detour through chat to ask permission first — the '
    + 'approval prompt raised by that retry is how the user consents. If the session states approval '
    + 'prompts are disabled, there is no exception: a denial is final — do not set `sandbox_permissions`. '
    + 'Never escalate speculatively: ground the request in a real denial — normally the one this command '
    + 'just hit; escalating up front is fine only when this session already denied the same access. '
    + 'A rejected escalation is final for that command — stop and explain, never work around '
    + 'it — but it does not forbid attempting or escalating other commands later.'
}

/**
 * Present foreground calls as terminals and background starts as generic cards.
 * The command remains the title on both paths; foreground cwd is passed through
 * for the bridge to resolve, while background descriptions remain card content.
 */
type BashCallArgs = { command: string; description: string; workdir?: string; run_in_background?: boolean }

function presentBashCall(args: BashCallArgs): GenericCallView | TerminalCallView {
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
}

/**
 * Present completed foreground output as a terminal; background acknowledgements
 * and execution errors use generic fenced output without an exit-status pill.
 */
function presentBashResult(args: unknown, result: ToolResult): ToolResultView | undefined {
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
}

/**
 * Resolve an explicit workdir first, making a relative one session-workspace-relative;
 * otherwise use the filesystem identity of the session cwd and leave executor
 * defaulting as the fallback. A resolved sandbox-policy root wins so workdir
 * and confinement use the exact same per-call identity.
 */
function resolveWorkdir(
  modelWorkdir: string | undefined,
  exec: { agent?: Agent },
  policyWorkspaceRoot?: string,
): string | undefined {
  const headerCwd = exec.agent?.session.header.cwd
  const sessionCwd = policyWorkspaceRoot ?? (headerCwd === undefined ? undefined : canonicalPath(headerCwd))
  if (modelWorkdir === undefined) return sessionCwd
  if (sessionCwd !== undefined && !isAbsolute(modelWorkdir)) {
    return resolvePath(sessionCwd, modelWorkdir)
  }
  return modelWorkdir
}

/** Detach the executor DTO from readonly Service Definition types into plain JSON data. */
function canonicalBashResult(result: BashRunResult) {
  const output = (stream: BashRunResult['stdout']) => ({
    text: stream.text,
    truncated: stream.truncated,
    ...stream.spillPath !== undefined ? { spillPath: stream.spillPath } : {},
  })
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    timeoutMs: result.timeoutMs,
    stdout: output(result.stdout),
    stderr: output(result.stderr),
    ...result.sandbox !== undefined ? {
      sandbox: {
        mode: result.sandbox.mode,
        denied: result.sandbox.denied,
        ...result.sandbox.enforcement !== undefined ? { enforcement: result.sandbox.enforcement } : {},
        ...result.sandbox.runnerFailed !== undefined ? { runnerFailed: result.sandbox.runnerFailed } : {},
      },
    } : {},
  }
}

/** Canonical background-handle properties shared by the bash output union. */
const BACKGROUND_OUTPUT_PROPERTIES = {
  kind: { type: 'string', required: true, const: 'background' },
  taskId: { type: 'string', required: true },
} as const

export function apply(ctx: Context, config: Config = {}): void {
  const backgroundEnabled = config.enableRunInBackground ?? true
  const shapingConfig = resolveShapingConfig(config)
  const defaultMode = ctx.bash.sandboxMode
  const escalationModes: readonly SandboxMode[] = defaultMode === undefined ? [] : ESCALATION_TARGETS
  const sandboxPolicy: SandboxPolicyService | undefined = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (defaultMode !== undefined && sandboxPolicy === undefined) {
    throw new Error('tool-bash: the mounted bash executor confines but ctx.sandboxPolicy is missing')
  }
  /** Resolve the complete standing policy for this call when a confining executor is mounted. */
  const resolveSandboxPolicy = (exec: ToolExecution): SandboxExecutionPolicy | undefined =>
    sandboxPolicy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })

  /**
   * Resolve a sandbox-escalation request through `ctx.approval` BEFORE
   * anything executes, delegating the shared fail-closed sequence (strict
   * widening, channel resolution, outcome mapping) to
   * {@link approveEscalation}. This tool contributes only the composition
   * guard (the fields are unadvertised without a sandboxing executor, yet
   * schema validation checks advertised keys only, so an unadvertised
   * `sandbox_permissions` still reaches execute) and the approval ingredients
   * The shared policy resolver is required whenever the executor advertises
   * confinement, so a split composition fails at tool-plugin load.
   */
  const approveBashEscalation = (
    mode: string,
    justification: string,
    exec: ToolExecution,
    standingPolicy: SandboxExecutionPolicy | undefined,
  ): Promise<SandboxMode> => {
    if (escalationModes.length === 0) {
      throw new Error('sandbox_permissions is not available in this composition (no sandboxing executor to escalate)')
    }
    const effectiveMode = (standingPolicy as SandboxExecutionPolicy).mode
    return approveEscalation(
      { requestedMode: mode, justification, effectiveMode, subject: 'command' },
      {
        approver: ctx.get('approval'),
        agent: exec.agent,
        callId: exec.callId,
        toolName: 'bash',
        signal: exec.signal,
      },
    )
  }

  // Cross-call guidance belongs in the prompt rather than one-call schema prose.
  ctx.systemPrompt.section({
    name: 'tool:bash',
    order: 105,
    text: 'Check the [exit code: N] marker on every bash result; investigate failures before moving on.',
  })

  /**
   * Save the full output body to the session's spill store before shaping
   * omits lines, so the omission notice can name a durable recovery path.
   * Best-effort by design: no spill backend, no session owner, or a save
   * failure all return undefined and the notice degrades to an honest count.
   * @param exec - the tool execution owning the call (session + call id).
   * @param body - the composed full output body.
   * @returns the spill locator, or undefined when no durable copy was made.
   */
  const spillFullOutput = async (exec: ToolExecution, body: string): Promise<string | undefined> => {
    const sessionId = exec.agent?.session.header.id
    if (sessionId === undefined) return undefined
    const spillStore = ctx.get('spillStore')
    if (spillStore === undefined) return undefined
    const save: SaveTextSpill = {
      owner: { sessionId },
      source: { toolName: 'bash', callId: exec.callId, label: 'output' },
      suggestedName: 'bash.txt',
      content: body,
    }
    try {
      const ref: SpillRef = await spillStore.saveText(save)
      return String(ref.locator)
    } catch (error: unknown) {
      // 只吞落盘失败：省略通知降级为不带路径，调用保持成功（正文仍在结果里成形输出）。
      ctx.logger.warn(`tool-bash: spilling full output failed; the omission notice will carry no path: ${String(error)}`)
      return undefined
    }
  }

  ctx.tools.register(defineTool({
    name: 'bash',
    description: bashDescription(backgroundEnabled, escalationModes),
    parameters: {
      command: { type: 'string', required: true, description: 'The bash command to execute.' },
      description: {
        type: 'string',
        required: true,
        description: 'Clear, concise description of what this command does in active voice, '
          + '5-10 words (shown in the UI). Examples: "ls" → "List files in current directory"; '
          + '"git status" → "Show working tree status"; "npm install" → "Install package dependencies".',
      },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.' },
      workdir: { type: 'string', description: 'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.' },
      ...backgroundEnabled ? {
        run_in_background: { type: 'boolean' as const, description: 'Run in the background and return a task id immediately (collect with task_output, stop with task_kill). No timeout applies.' },
      } : {},
      ...escalationModes.length > 0 ? {
        sandbox_permissions: {
          type: 'string' as const,
          enum: [...escalationModes],
          description: 'The wider sandbox mode this command needs. Only valid as a one-shot retry of a command the sandbox just denied; requires justification and user approval.',
        },
        justification: {
          type: 'string' as const,
          description: 'Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access.',
        },
      } : {},
    },
    output: {
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
              outputSpillPath: {
                type: 'string',
                description: 'Durable path of the full combined output, present when model-facing shaping omitted lines.',
              },
              sandbox: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  mode: { type: 'string', required: true },
                  denied: { type: 'boolean', required: true },
                  enforcement: { type: 'string' },
                  runnerFailed: { type: 'boolean' },
                },
              },
            },
          },
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'background'
          ? `started background task ${value.taskId}`
          : renderResult(value as { kind: 'foreground' } & BashRunResult, escalationModes, {
            // 失败事实由 renderResult 从 result 本身并入；这里只传配置与恢复路径。
            failed: false,
            ...shapingConfig,
            ...(value as { outputSpillPath?: string }).outputSpillPath !== undefined
              ? { spillPath: (value as { outputSpillPath?: string }).outputSpillPath }
              : {},
          }),
      }],
    },
    async execute(args: BashToolArgs, exec) {
      validateBashArgs(args)
      // Description is display metadata; workdir defaults to the caller's session.
      const standingPolicy = resolveSandboxPolicy(exec)
      const approvedMode = args.sandbox_permissions !== undefined && args.justification !== undefined
        ? await approveBashEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy)
        : undefined
      const policy = approvedMode === undefined
        ? standingPolicy
        : { ...(standingPolicy as SandboxExecutionPolicy), mode: approvedMode }
      const workdir = resolveWorkdir(args.workdir, exec, standingPolicy?.workspaceRoot)
      const dshEnv = ctx.bashEnv.collect(exec)
      const request = {
        command: args.command,
        ...workdir !== undefined ? { workdir } : {},
        ...args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {},
        dshEnv,
        ...policy !== undefined ? { sandboxPolicy: policy } : {},
      }
      if (args.run_in_background === true) {
        // Undeclared keys are allowed, so schema omission also needs enforcement.
        if (!backgroundEnabled) {
          throw new Error('run_in_background is disabled for this deployment (enableRunInBackground: false)')
        }
        const tasks = ctx.get('tasks')
        if (tasks === undefined) {
          throw new Error('background tasks unavailable: load @huiliyi37/dsh-tasks and @huiliyi37/dsh-tool-tasks')
        }
        // The caller owns cancellation until ctx.tasks commits detached ownership.
        if (exec.signal.aborted) {
          const error = new HarnessError('tool call aborted', TOOL_ABORTED)
          error.name = 'AbortError'
          throw error
        }
        // Task preflight finishes before the starter can spawn a process.
        const id = tasks.start({
          kind: 'bash',
          label: args.command,
          ...exec.agent ? { owner: exec.agent } : {},
          run: () => {
            const proc = ctx.bash.start(ctx.bash.resolve(request))
            return {
              cancel: () => void proc.kill(),
              done: proc.done.then(() => processOutcome(proc)),
              readOutput: () => renderProcessRead(proc.readOutput(), proc.sandbox, escalationModes),
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
      // 成形会丢行时先把完整正文落盘（best-effort）：省略通知才有恢复路径，
      // 重跑命令有副作用、不可作为恢复手段。无 spill 服务/无会话主/落盘失败
      // 都降级为不带路径的诚实省略计数——绝不因此让调用失败。
      const body = composeResultBody(result)
      const failed = result.exitCode !== 0 || result.signal !== null || result.timedOut
      const outputSpillPath = outputShapingDropsLines(body, { failed, ...shapingConfig })
        ? await spillFullOutput(exec, body)
        : undefined
      return {
        kind: 'foreground' as const,
        ...canonicalBashResult(result),
        ...outputSpillPath !== undefined ? { outputSpillPath } : {},
      }
    },
    presentCall: presentBashCall,
    presentResult: presentBashResult,
  }))
}
