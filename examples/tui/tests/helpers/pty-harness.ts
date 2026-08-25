/**
 * Reusable node-pty session harness for the keyless TUI smokes: spawns the
 * composition driver inside a 100×40 PTY, parses the byte stream with a
 * headless xterm terminal, and exposes marker-driven waiting plus key input.
 *
 * The harness isolates `HOME`, Harness roots, and the child environment the
 * same way `welcome.snapshot.ts` does: only an allow-listed set of variables
 * crosses the PTY boundary, ambient secrets never reach the child, and the
 * temporary root is removed after the process exits.
 *
 * @module examples/tui/tests/helpers/pty-harness
 */

import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Terminal } from '@xterm/headless'
import * as nodePty from 'node-pty'
import type { IPty } from 'node-pty'

/** Fixed capture geometry shared by every TUI PTY smoke. */
export const PTY_COLUMNS = 100
export const PTY_ROWS = 40

/** Overall deadline for one smoke scenario, from spawn to clean exit. */
export const SMOKE_TIMEOUT_MS = 120_000

/** Grace period for Ctrl+Q to end the child before cleanup escalates to kill. */
export const GRACEFUL_EXIT_TIMEOUT_MS = 5_000

const CLEANUP_CTRL_Q_TIMEOUT_MS = 500
const FORCE_KILL_TIMEOUT_MS = 500
const POLL_INTERVAL_MS = 20

/** Ambient variables inherited verbatim into the PTY child (never secrets). */
const INHERITED_CHILD_ENV = [
  'PATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'TMP',
  'TEMP',
] as const

/** Launch-plane variables the resolved launch env may contribute. */
const LAUNCH_CHILD_ENV = new Set([
  'HOME',
  'DSH_HOME',
  'DSH_AGENTS_HOME',
  'DSH_TELEMETRY_DISABLED',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'TERM',
  'COLORTERM',
  'FORCE_COLOR',
  'RIVET_AMBIGUOUS_WIDTH',
  'DSH_SNAPSHOT',
  'TSX_TSCONFIG_PATH',
])

/** PTY process outcome as reported by node-pty. */
export interface PtyExit {
  readonly exitCode: number
  readonly signal?: number
}

/** Tracks pending xterm parser writes so waiting can drain to a settled view. */
export interface ParserTracker {
  write(data: string): void
  drain(): Promise<void>
}

/** Isolated directories handed to one smoke scenario. */
export interface PtyIsolation {
  readonly home: string
  readonly workspace: string
  readonly dshHome: string
  readonly agentsHome: string
  readonly tempRoots: readonly string[]
  remove(): Promise<void>
}

/** Live PTY session handle: send keys, wait for markers, read the screen. */
export interface PtySession {
  readonly pty: IPty
  readonly terminal: Terminal
  readonly isolation: PtyIsolation
  /** Raw PTY output accumulated since spawn (diagnostics only; may hold secrets of the child, never ambient ones). */
  readonly rawOutput: () => string
  /** PTY outcome once exited, otherwise undefined. */
  readonly exit: () => PtyExit | undefined
  /** Write a key sequence to the child's stdin. */
  send(keys: string): void
  /** Lines of the active buffer (normal or alternate), top to bottom. */
  activeLines(): string[]
  /** Lines of the normal buffer regardless of the active buffer type. */
  normalLines(): string[]
  /** Active buffer type: `normal` or `alternate` (overlay open). */
  activeBufferType(): 'normal' | 'alternate'
  /** Resolve once every marker appears in the active buffer, or throw on deadline/exit. */
  waitForMarkers(markers: readonly string[], stage: string): Promise<void>
  /** Resolve once the active buffer no longer contains the marker, or throw on deadline/exit. */
  waitForMarkerGone(marker: string, stage: string): Promise<void>
  /** Resolve once the child exits; returns its outcome or throws on deadline. */
  waitForExit(timeoutMs: number): Promise<PtyExit>
  /** Tear the session down: graceful Ctrl+Q, then kill; safe to call twice. */
  stop(): Promise<void>
}

/** Options for {@link startPtySession}. */
export interface PtySessionOptions {
  /** Absolute driver path (src and lib planes resolve it themselves). */
  readonly driverPath: string
  /** Absolute composition config path. */
  readonly configPath: string
  /** Absolute tsconfig for source-mode path mapping. */
  readonly tsconfigPath: string
  /** Launch resolution like `resolveExampleLaunch` output (command/args/env). */
  readonly launch: { readonly command: string; readonly args: readonly string[]; readonly env: NodeJS.ProcessEnv }
  /** Called with the resolved launch and isolation before spawn (extra env keys merge over the launch env). */
  readonly onSpawn?: (spawn: PtySpawn) => void
}

/** Inputs handed to {@link PtySessionOptions.onSpawn}. */
export interface PtySpawn {
  readonly isolation: PtyIsolation
  readonly launchEnv: NodeJS.ProcessEnv
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function formatExit(exit: PtyExit | undefined): string {
  if (exit === undefined) return 'running'
  return `code=${exit.exitCode}, signal=${String(exit.signal ?? 0)}`
}

/** Build the minimal child environment: inherited ambient vars + allow-listed launch vars. */
export function buildChildEnvironment(launchEnv: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of INHERITED_CHILD_ENV) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  for (const [name, value] of Object.entries(launchEnv)) {
    if (LAUNCH_CHILD_ENV.has(name) && value !== undefined) env[name] = value
  }
  return env
}

/** Create the isolated HOME/workspace/Harness roots under a fresh temp dir. */
export async function createIsolation(): Promise<PtyIsolation> {
  const createdRoot = await mkdtemp(join('/tmp', 'tui-smoke-'))
  const tempRoot = await realpath(createdRoot)
  const tempRoots = createdRoot === tempRoot ? [tempRoot] : [createdRoot, tempRoot]
  const home = join(tempRoot, 'home')
  const workspace = join(home, 'w')
  const dshHome = join(tempRoot, 'd')
  const agentsHome = join(tempRoot, 'a')
  await Promise.all([
    mkdir(workspace, { recursive: true, mode: 0o700 }),
    mkdir(dshHome, { recursive: true, mode: 0o700 }),
    mkdir(agentsHome, { recursive: true, mode: 0o700 }),
  ])
  return {
    home,
    workspace,
    dshHome,
    agentsHome,
    tempRoots,
    remove: () => rm(createdRoot, { recursive: true, force: true }),
  }
}

/** Attach a drain-tracking parser wrapper to a headless terminal. */
export function createParserTracker(terminal: Terminal): ParserTracker {
  let pending = 0
  const waiters: Array<() => void> = []
  return {
    write: (data) => {
      pending += 1
      terminal.write(data, () => {
        pending -= 1
        if (pending !== 0) return
        for (const resolve of waiters.splice(0)) resolve()
      })
    },
    drain: async () => {
      if (pending > 0) {
        await new Promise<void>(resolve => waiters.push(resolve))
      }
      await Promise.resolve()
    },
  }
}

/** The slice of xterm's buffer API the harness reads (avoids importing non-exported types). */
interface TerminalBuffer {
  readonly length: number
  getLine(index: number): { translateToString(trimRight: boolean): string } | undefined
}

function bufferLines(buffer: TerminalBuffer): string[] {
  return Array.from({ length: buffer.length }, (_, index) =>
    buffer.getLine(index)?.translateToString(true) ?? '')
}

/**
 * Spawn the driver inside a 100×40 PTY with isolated state and return the
 * session handle. The caller drives the flow and must call `stop()`.
 *
 * @param options - driver/config paths, launch resolution, and env isolation.
 * @returns the live session; cleanup is the caller's responsibility.
 */
export async function startPtySession(options: PtySessionOptions): Promise<PtySession> {
  const startedAt = Date.now()
  const deadline = startedAt + SMOKE_TIMEOUT_MS
  const isolation = await createIsolation()
  const launchEnv: NodeJS.ProcessEnv = {
    ...options.launch.env,
    HOME: isolation.home,
    DSH_HOME: isolation.dshHome,
    DSH_AGENTS_HOME: isolation.agentsHome,
    DSH_TELEMETRY_DISABLED: '1',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3',
    RIVET_AMBIGUOUS_WIDTH: 'narrow',
    DSH_SNAPSHOT: '',
  }
  options.onSpawn?.({ isolation, launchEnv })

  const terminal = new Terminal({
    allowProposedApi: true,
    cols: PTY_COLUMNS,
    rows: PTY_ROWS,
    scrollback: 2_000,
  })
  const parser = createParserTracker(terminal)
  let rawPty = ''
  let outcome: PtyExit | undefined
  let stopped = false

  const pty = nodePty.spawn(options.launch.command, [...options.launch.args], {
    name: 'xterm-256color',
    cols: PTY_COLUMNS,
    rows: PTY_ROWS,
    cwd: isolation.workspace,
    env: buildChildEnvironment(launchEnv),
  })
  const ptyExit = pty.onExit((next) => { outcome = next })
  const terminalData = terminal.onData((data) => {
    if (outcome === undefined) pty.write(data)
  })
  const ptyData = pty.onData((data) => {
    rawPty += data
    parser.write(data)
  })

  const remainingMs = (): number => Math.max(0, deadline - Date.now())
  const deadlineError = (stage: string): Error =>
    new Error(`smoke deadline expired during ${stage}; remaining=${remainingMs()}ms`)

  async function pollUntil(
    stage: string,
    settled: () => boolean,
  ): Promise<void> {
    while (Date.now() < deadline) {
      await parser.drain()
      if (settled()) return
      if (remainingMs() === 0) throw deadlineError(stage)
      if (outcome !== undefined) {
        throw new Error(`PTY exited before ${stage} completed: ${formatExit(outcome)}`)
      }
      await delay(POLL_INTERVAL_MS)
    }
    throw deadlineError(stage)
  }

  const session: PtySession = {
    pty,
    terminal,
    isolation,
    rawOutput: () => rawPty,
    exit: () => outcome,
    send: (keys) => { pty.write(keys) },
    activeLines: () => bufferLines(terminal.buffer.active),
    normalLines: () => bufferLines(terminal.buffer.normal),
    activeBufferType: () => terminal.buffer.active.type,
    waitForMarkers: (markers, stage) => pollUntil(stage, () => {
      const active = terminal.buffer.active
      const lines = bufferLines(active).join('\n')
      return markers.every(marker => lines.includes(marker))
    }),
    waitForMarkerGone: (marker, stage) => pollUntil(stage, () => {
      const lines = bufferLines(terminal.buffer.active).join('\n')
      return !lines.includes(marker)
    }),
    waitForExit: async (timeoutMs: number) => {
      const exitDeadline = Date.now() + timeoutMs
      while (outcome === undefined && Date.now() < exitDeadline) await delay(POLL_INTERVAL_MS)
      if (outcome === undefined) {
        throw new Error(`PTY pid ${pty.pid} did not exit within ${timeoutMs}ms`)
      }
      return outcome
    },
    stop: async () => {
      if (stopped) return
      stopped = true
      try {
        if (outcome === undefined) {
          try { pty.write('\x11') } catch { /* concurrently exiting PTY no longer accepts Ctrl+Q */ }
          if (await waitForExitSilently(pty, () => outcome, CLEANUP_CTRL_Q_TIMEOUT_MS) !== undefined) {
            /* graceful */
          } else {
            try { pty.kill() } catch { /* process may have exited between check and SIGHUP */ }
            await waitForExitSilently(pty, () => outcome, FORCE_KILL_TIMEOUT_MS)
          }
        }
      } finally {
        ptyData.dispose()
        ptyExit.dispose()
        terminalData.dispose()
        terminal.dispose()
        await isolation.remove()
      }
    },
  }
  return session
}

async function waitForExitSilently(
  pty: IPty,
  exit: () => PtyExit | undefined,
  timeoutMs: number,
): Promise<PtyExit | undefined> {
  const deadline = Date.now() + timeoutMs
  while (exit() === undefined && Date.now() < deadline) await delay(POLL_INTERVAL_MS)
  if (exit() !== undefined) return exit()
  try { pty.kill('SIGKILL') } catch { /* no surviving process group */ }
  const killDeadline = Date.now() + FORCE_KILL_TIMEOUT_MS
  while (exit() === undefined && Date.now() < killDeadline) await delay(POLL_INTERVAL_MS)
  return exit()
}

/** Format a failure with the recent raw PTY tail for diagnosis. */
export function formatPtyFailure(
  error: unknown,
  rawPty: string,
  exit: PtyExit | undefined,
): Error {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  return new Error(
    `${message}\nexit=${formatExit(exit)}\nrecent raw PTY output=${JSON.stringify(rawPty.slice(-8_000))}`,
  )
}
