/**
 * Local PowerShell Service provider for the bash capability seam. Each command runs
 * as `pwsh -NoLogo -NoProfile -NonInteractive -Command <command>` in a managed
 * process spawned through `ctx.subprocess`; the executor owns command
 * defaulting, deadlines and cause classification, the model-friendly terminal
 * environment, and the model-facing stdout/stderr merge for background reads.
 *
 * The command string is passed as ONE argv element to `-Command`: PowerShell
 * itself parses the text, and no intermediate shell exists, so there is no
 * shell-quoting layer to escape (the `bash -c` string domain has no
 * equivalent here). Native Win32 paths (`C:\...`) pass through unchanged.
 *
 * @module @deepseek-ai/dsh-pwsh-local
 */

import { Context } from 'cordis'
import z from 'schemastery'
import { BashExecutor } from '@deepseek-ai/dsh-bash'
import type { BashExecRequest, BashExecSpec, BashProcess, BashProcessRead, BashRunResult, CollectedOutput } from '@deepseek-ai/dsh-bash'
import type { SubprocessCollect, SubprocessHandle, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { clampTimeout, deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { resolvePwshPath } from './resolve.ts'

/* jscpd:ignore-start -- deliberate call-for-call mirror of dsh-bash-local (Agent Note: pwsh-tool-and-executor). */
/**
 * Model-friendly environment overrides for PowerShell: disable colors and
 * pagers that would garble tool output. `TERM=dumb` is a POSIX concept and is
 * deliberately absent; `NO_COLOR` is honored by modern pwsh renderers.
 */
export const ENV_OVERRIDES = {
  NO_COLOR: '1',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
} as const

/**
 * UTF-8 output pinning prepended to every command. The subprocess collector
 * decodes output bytes as UTF-8, but Windows PowerShell 5.1 (the last-resort
 * executable fallback) writes the console/OEM code page by default, which
 * garbles non-ASCII output; pwsh 7 defaults to UTF-8 and is unaffected. The
 * statements ride on line 1 after `; ` separators so PowerShell error line
 * numbers stay accurate.
 */
export const ENCODING_PREAMBLE =
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); '

/** Default SIGTERM→SIGKILL grace period (the `graceMs` config). */
const DEFAULT_GRACE_MS = 3_000

/** Default per-stream spill cap (the `maxSpillBytes` config). */
const DEFAULT_MAX_SPILL_BYTES = 64 * 1024 * 1024

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Default working directory for commands (default: process.cwd()). */
  cwd?: string
  /** Default foreground timeout in milliseconds. */
  timeoutMs?: number
  /** Upper bound for per-call timeout overrides. */
  maxTimeoutMs?: number
  /** Per-stream in-memory output cap; overflow spills to a temp file. */
  maxOutputBytes?: number
  /** Per-stream spill-file cap; larger streams retain only their in-memory tail. */
  maxSpillBytes?: number
  /** Grace period for kill escalation and inherited pipes; at most `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
  /**
   * Explicit pwsh executable. When omitted, well-known Windows install
   * locations and PATH entries are probed in order (PowerShell 7 install,
   * PATH entries such as the Microsoft Store install, then Windows
   * PowerShell 5.1), falling back to a bare `pwsh` resolved through PATH.
   */
  pwshPath?: string
}

/** The shape after schemastery applied the defaults (cwd/pwshPath have none). */
type ResolvedConfig = Required<Omit<Config, 'cwd' | 'pwshPath'>> & Pick<Config, 'cwd' | 'pwshPath'>

// Resolution lives in its own dependency-free module so the repository's
// coverage-gate probe shares the exact definition the suites use.
export { candidatePwshPaths, resolvePwshPath } from './resolve.ts'

/** Project a settled collect-mode reader into the final CollectedOutput shape. */
function finalOutput(reader: SubprocessOutputReader): CollectedOutput {
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy,
    ...read.spillPath !== undefined ? { spillPath: read.spillPath } : {},
  }
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`pwsh-local: ${name} must be a positive finite number`)
  }
}

/**
 * Local PowerShell executor over `ctx.subprocess`. Bounded output, spill
 * files, and process-tree termination are the subprocess service's mechanics;
 * this executor supplies their configured budgets per spawn.
 */
export class PwshLocalExecutor extends BashExecutor {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    cwd: z.string(),
    timeoutMs: z.number().default(120_000),
    maxTimeoutMs: z.number().default(600_000),
    maxOutputBytes: z.number().default(64_000),
    maxSpillBytes: z.number().default(DEFAULT_MAX_SPILL_BYTES),
    graceMs: z.number().default(DEFAULT_GRACE_MS),
    pwshPath: z.string(),
  })

  /** Validated config (schemastery applied the defaults before construction). */
  readonly config: ResolvedConfig

  /** The pwsh executable resolved once at construction. */
  readonly pwshPath: string

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // Schemastery fills these fields before construction; the type does not encode that step.
    this.config = config as ResolvedConfig
    assertPositiveFinite('timeoutMs', this.config.timeoutMs)
    assertPositiveFinite('maxTimeoutMs', this.config.maxTimeoutMs)
    assertPositiveFinite('maxOutputBytes', this.config.maxOutputBytes)
    assertPositiveFinite('maxSpillBytes', this.config.maxSpillBytes)
    assertPositiveFinite('graceMs', this.config.graceMs)
    if (this.config.graceMs > MAX_TIMER_DELAY_MS) {
      throw new Error(`pwsh-local: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
    }
    this.pwshPath = resolvePwshPath(this.config.pwshPath)
  }

  /**
   * Resolve a request into a fully-specified spec: fill `workdir` from
   * `config.cwd` (else `process.cwd()`), and `timeoutMs` from
   * `config.timeoutMs`, capped at `config.maxTimeoutMs`.
   */
  resolve(request: BashExecRequest): BashExecSpec {
    const timeoutMs = clampTimeout(
      request.timeoutMs,
      this.config.timeoutMs,
      this.config.maxTimeoutMs,
      'pwsh-local: request.timeoutMs',
    )
    const stdoutMaxBytes = request.stdoutMaxBytes ?? this.config.maxOutputBytes
    assertPositiveFinite('request.stdoutMaxBytes', stdoutMaxBytes)
    return {
      command: request.command,
      workdir: request.workdir ?? this.config.cwd ?? process.cwd(),
      timeoutMs,
      stdoutMaxBytes,
      ...request.signal ? { signal: request.signal } : {},
      ...request.stdin !== undefined ? { stdin: request.stdin } : {},
      ...request.env !== undefined ? { env: request.env } : {},
      ...request.dshEnv !== undefined ? { dshEnv: request.dshEnv } : {},
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  /** Map one resolved bash spec onto a fully-specified subprocess spawn. */
  private spawnSpec(spec: BashExecSpec, stdoutMaxBytes: number, signal: AbortSignal | undefined): SubprocessSpawnSpec {
    const collect = (maxBytes: number): SubprocessCollect =>
      ({ maxBytes, spill: { maxBytes: this.config.maxSpillBytes } })
    return {
      argv: [this.pwshPath, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `${ENCODING_PREAMBLE}${spec.command}`],
      cwd: spec.workdir,
      stdio: {
        stdin: spec.stdin !== undefined ? { data: spec.stdin } : 'ignore',
        stdout: collect(stdoutMaxBytes),
        stderr: collect(this.config.maxOutputBytes),
      },
      graceMs: this.config.graceMs,
      signal,
      env: { ...ENV_OVERRIDES, ...spec.env, ...spec.dshEnv },
    }
  }

  /** The collect-mode readers the executor itself requested (present by construction). */
  private static collected(handle: SubprocessHandle): { stdout: SubprocessOutputReader; stderr: SubprocessOutputReader } {
    const { stdout, stderr } = handle.collected
    /* v8 ignore start -- collect dispositions expose both readers by the seam contract; defensive. */
    if (stdout === undefined || stderr === undefined) {
      throw new Error('pwsh-local: subprocess implementation dropped a requested collect stream')
    }
    /* v8 ignore stop */
    return { stdout, stderr }
  }

  async run(spec: BashExecSpec): Promise<BashRunResult> {
    // One deadline combines timeout and upstream cancellation; disposal clears its timer.
    using d = deadline(spec.signal, spec.timeoutMs, 'BASH_TIMEOUT')
    const handle = this.ctx.subprocess.spawn(this.spawnSpec(spec, spec.stdoutMaxBytes, d.signal))
    const outcome = await handle.done
    const collected = PwshLocalExecutor.collected(handle)
    // Only this executor's timeout reason counts as timedOut; outer deadlines count as aborts.
    const timedOut = timeoutOf(d.signal, 'BASH_TIMEOUT') !== undefined
    const aborted = d.signal.aborted && !timedOut
    return {
      ...outcome,
      timedOut,
      aborted,
      timeoutMs: spec.timeoutMs,
      stdout: finalOutput(collected.stdout),
      stderr: finalOutput(collected.stderr),
    }
  }

  start(spec: BashExecSpec): BashProcess {
    // Background runs ignore timeoutMs; callers stop them through kill() or spec.signal.
    const running = this.ctx.subprocess.spawn(this.spawnSpec(spec, this.config.maxOutputBytes, spec.signal))
    const collected = PwshLocalExecutor.collected(running)

    // A spawn failure produces no process output, so the subprocess service has nothing
    // to buffer; the note is delivered exactly once through the read path.
    let spawnFailureNote: string | undefined
    const consumeSpawnFailure = (): string => {
      const note = spawnFailureNote ?? ''
      spawnFailureNote = undefined
      return note
    }

    let stdoutOffset = 0
    let stderrOffset = 0
    const proc: BashProcess = {
      status: 'running',
      exitCode: null,
      signal: null,
      done: running.done.then((outcome) => {
        // Any signal termination is killed, including a command signaling itself.
        if (proc.status === 'running') {
          proc.status = spec.signal?.aborted === true || outcome.signal !== null ? 'killed' : 'completed'
        }
        proc.exitCode = outcome.exitCode
        proc.signal = outcome.signal
        this.onProcessDone(proc, collected.stderr.readFrom(0).text)
      }, (error: unknown) => {
        // Background spawn failures settle as killed and surface through the read path.
        proc.status = 'killed'
        spawnFailureNote = `spawn failed: ${String(error)}`
        this.onProcessDone(proc, spawnFailureNote)
      }),
      readOutput: (): BashProcessRead => {
        const out = collected.stdout.readFrom(stdoutOffset)
        const err = collected.stderr.readFrom(stderrOffset)
        stdoutOffset = out.nextOffset
        stderrOffset = err.nextOffset

        // A failed spawn never produced process output, so the note and real
        // stderr text are mutually exclusive.
        const errText = err.text.length > 0 ? err.text : consumeSpawnFailure()
        // Single newline between sections: stdout chunks usually end with one
        // already; add it only when missing.
        const separator = out.text.length > 0 && !out.text.endsWith('\n') ? '\n' : ''
        const delta = out.text
          + (errText.length > 0 ? `${separator}[stderr]\n${errText}` : '')
        return {
          delta,
          lossy: out.lossy || err.lossy,
          ...out.spillPath !== undefined ? { stdoutSpillPath: out.spillPath } : {},
          ...err.spillPath !== undefined ? { stderrSpillPath: err.spillPath } : {},
        }
      },
      kill: (): boolean => {
        if (proc.status !== 'running') { return false }
        proc.status = 'killed'
        running.terminate()
        return true
      },
    }
    return proc
  }

  /**
   * Settlement hook for subclasses that attach execution facts to a process.
   * The base implementation is intentionally empty. Mirrored from
   * `dsh-bash-local` (whose sandboxing subclass consumes the same hook); it is
   * the protected extension point for a future pwsh-confining subclass and has no consumer
   * in this package yet.
   * @param _proc - the settled process handle.
   * @param _stderr - the process's retained stderr tail used by subclasses for settlement classification.
   */
  protected onProcessDone(_proc: BashProcess, _stderr: string): void {}
}
/* jscpd:ignore-end */

export default PwshLocalExecutor
