import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Terminal, type IDisposable as XtermDisposable } from '@xterm/headless'
import * as nodePty from 'node-pty'
import type { IDisposable as PtyDisposable, IPty, IPtyForkOptions } from 'node-pty'
import { describe, expect, it } from 'vitest'
import {
  resolveExampleLaunch,
  resolveExampleMode,
  type ExampleMode,
} from '@huiliyi37/dsh-loader-smoke'

const COLUMNS = 100
const ROWS = 40
const CAPTURE_TIMEOUT_MS = 60_000
const GRACEFUL_EXIT_TIMEOUT_MS = 2_000
const CLEANUP_CTRL_Q_TIMEOUT_MS = 500
const FORCE_KILL_TIMEOUT_MS = 500
const SERVER_CLOSE_TIMEOUT_MS = 500
const QUIET_WINDOW_MS = 300
const FAKE_API_KEY = 'welcome-snapshot-placeholder-not-a-secret'
const TOP_BAR_MODEL = 'deepseek-official/deepseek-v4-flash'
const EXPECTED_TIP = 'Tip: Ctrl+. 随时调出完整键位表'
const ALT_SCREEN_ON = '\x1B[?1049h'
const ALT_SCREEN_OFF = '\x1B[?1049l'
const KEY_DIALOG_MARKERS = [
  'API Key',
  '选择供应商（配置 API 密钥）',
] as const
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
const SENSITIVE_ENV_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD|ENDPOINT|PROXY)/i

const driverPath = fileURLToPath(new URL('./fixtures/welcome-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const goldenPath = fileURLToPath(new URL('./snapshots/welcome/terminal.expected.txt', import.meta.url))

interface PtyExit {
  readonly exitCode: number
  readonly signal?: number
}

interface ParserTracker {
  write(data: string): void
  drain(): Promise<void>
}

interface WelcomeCapture {
  readonly mode: ExampleMode
  readonly snapshot: string
  readonly rawSurface: string
  readonly workspace: string
  readonly rawPty: string
  readonly tempRoots: readonly string[]
  readonly networkRequestsAfterQuiet: number
  readonly networkRequestsAfterExit: number
  readonly networkRequestsFinal: number
}

interface CaptureDependencies {
  readonly resolveLaunch?: typeof resolveExampleLaunch
  readonly onTempRootCreated?: (root: string) => void
  readonly spawnPty?: (command: string, args: string[], options: IPtyForkOptions) => IPty
  readonly removeRoot?: (root: string) => Promise<void>
}

interface RequestSentinel {
  readonly baseUrl: string
  requestCount(): number
  close(): Promise<void>
}

interface ExtractedWelcomeSurface {
  readonly rawSurface: string
  readonly snapshot: string
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now())
}

function deadlineError(stage: string, deadline: number): Error {
  return new Error(
    `capture deadline expired during ${stage}; remaining=${remainingMs(deadline)}ms`,
  )
}

async function delayBeforeDeadline(
  milliseconds: number,
  deadline: number,
  stage: string,
): Promise<void> {
  if (milliseconds <= 0) return
  if (milliseconds > remainingMs(deadline)) throw deadlineError(stage, deadline)
  await delay(milliseconds)
}

async function startRequestSentinel(): Promise<RequestSentinel> {
  let requests = 0
  const server = createServer((_request, response) => {
    requests += 1
    response.statusCode = 503
    response.end('welcome snapshot network sentinel')
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await closeServer(server)
    throw new Error('welcome snapshot network sentinel did not bind a TCP port')
  }
  let closePromise: Promise<void> | undefined
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestCount: () => requests,
    close: () => {
      closePromise ??= closeServer(server)
      return closePromise
    },
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      server.closeAllConnections()
      finish(new Error(
        `welcome snapshot network sentinel did not close within ${SERVER_CLOSE_TIMEOUT_MS}ms`,
      ))
    }, SERVER_CLOSE_TIMEOUT_MS)
    function finish(error?: Error): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error === undefined) resolve()
      else reject(error)
    }
    server.close((error) => { finish(error ?? undefined) })
    server.closeIdleConnections()
  })
}

function buildChildEnvironment(launchEnv: NodeJS.ProcessEnv): Record<string, string> {
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

function createParserTracker(terminal: Terminal): ParserTracker {
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

function normalBufferLines(terminal: Terminal): string[] {
  const buffer = terminal.buffer.normal
  return Array.from({ length: buffer.length }, (_, index) =>
    buffer.getLine(index)?.translateToString(true) ?? '')
}

function hasSettledSurface(terminal: Terminal): boolean {
  if (terminal.buffer.active.type !== 'normal') return false
  const lines = normalBufferLines(terminal)
  return lines.some(line => line.includes('Tip:'))
    && lines.some(line => line.includes('< Harness >'))
    && lines.some(line => line.includes('❯'))
}

async function waitForSettledSurface(
  terminal: Terminal,
  parser: ParserTracker,
  exit: () => PtyExit | undefined,
  deadline: number,
): Promise<void> {
  while (Date.now() < deadline) {
    await parser.drain()
    if (remainingMs(deadline) === 0) throw deadlineError('settled welcome', deadline)
    if (hasSettledSurface(terminal)) return
    const outcome = exit()
    if (outcome !== undefined) {
      throw new Error(`PTY exited before the settled welcome appeared: ${formatExit(outcome)}`)
    }
    await delayBeforeDeadline(20, deadline, 'settled welcome')
  }
  throw deadlineError('settled welcome', deadline)
}

async function waitForQuietWindow(
  parser: ParserTracker,
  lastDataAt: () => number,
  exit: () => PtyExit | undefined,
  deadline: number,
): Promise<void> {
  while (Date.now() < deadline) {
    await parser.drain()
    if (remainingMs(deadline) === 0) throw deadlineError('welcome quiet window', deadline)
    const outcome = exit()
    if (outcome !== undefined) {
      throw new Error(`PTY exited before the welcome quiet window: ${formatExit(outcome)}`)
    }
    const remaining = QUIET_WINDOW_MS - (Date.now() - lastDataAt())
    if (remaining <= 0) return
    await delayBeforeDeadline(Math.min(remaining, 50), deadline, 'welcome quiet window')
  }
  throw deadlineError('welcome quiet window', deadline)
}

function activeBufferLines(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active
  return Array.from({ length: buffer.length }, (_, index) =>
    buffer.getLine(index)?.translateToString(true) ?? '')
}

function assertCaptureState(terminal: Terminal, rawPty: string): void {
  if (terminal.buffer.active.type !== 'normal') {
    throw new Error(
      `settled welcome capture requires the normal buffer; active=${terminal.buffer.active.type}`,
    )
  }
  if (rawPty.includes(ALT_SCREEN_ON)) {
    throw new Error('alternate screen appeared during settled welcome capture')
  }
  if (rawPty.split('Tip:').length !== 2) {
    throw new Error('settled welcome must write its Tip row exactly once')
  }
  const active = activeBufferLines(terminal).join('\n')
  for (const marker of KEY_DIALOG_MARKERS) {
    if (active.includes(marker) || rawPty.includes(marker)) {
      throw new Error(`key dialog appeared before welcome capture: ${marker}`)
    }
  }
}

function extractWelcomeSurface(
  terminal: Terminal,
  workspace: string,
  tempRoots: readonly string[],
): ExtractedWelcomeSurface {
  const buffer = terminal.buffer.normal
  const lines = normalBufferLines(terminal)
  const topBarIndex = lines.findIndex(line =>
    line.includes(workspace) && line.includes(TOP_BAR_MODEL))
  if (topBarIndex < 0) {
    throw new Error('committed startup top bar was not found in the normal buffer')
  }
  const leadingBlankIndex = topBarIndex + 1
  if (lines[leadingBlankIndex]?.trim() !== '') {
    throw new Error('welcome did not begin with its single committed leading blank row')
  }
  const heroStart = leadingBlankIndex + 1
  const tipIndices = lines.flatMap((line, index) =>
    index >= heroStart && line.includes('Tip:') ? [index] : [])
  if (tipIndices.length !== 1) {
    throw new Error(`settled welcome requires exactly one Tip row; found=${tipIndices.length}`)
  }
  const [tipIndex] = tipIndices
  if (tipIndex === undefined) throw new Error('settled welcome Tip row was not found')
  for (let index = heroStart; index <= tipIndex; index += 1) {
    if (buffer.getLine(index)?.isWrapped === true) {
      throw new Error(`settled welcome row ${index} unexpectedly wrapped`)
    }
  }
  const rawSurface = `${lines
    .slice(heroStart, tipIndex + 1)
    .map(line => line.trimEnd())
    .join('\n')}\n`
  const cwdField = `cwd ${workspace}`
  if (rawSurface.split(cwdField).length !== 2 || rawSurface.split(workspace).length !== 2) {
    throw new Error(
      'settled welcome must contain the real workspace exactly once in its cwd field',
    )
  }
  const snapshot = rawSurface.replace(cwdField, 'cwd ~/workspace')
  for (const root of tempRoots) {
    if (snapshot.includes(root)) {
      throw new Error(`settled welcome leaked temporary root outside its cwd field: ${root}`)
    }
  }
  return { rawSurface, snapshot }
}

function formatExit(exit: PtyExit | undefined): string {
  if (exit === undefined) return 'running'
  return `code=${exit.exitCode}, signal=${String(exit.signal ?? 0)}`
}

function formatFailure(
  error: unknown,
  mode: ExampleMode,
  exit: PtyExit | undefined,
  rawPty: string,
): Error {
  const message = redactDiagnostics(
    error instanceof Error ? error.stack ?? error.message : String(error),
  )
  const recent = redactDiagnostics(rawPty.slice(-8_000))
  return new Error(
    `${message}\nmode=${mode}\nexit=${formatExit(exit)}\nrecent raw PTY output=${JSON.stringify(recent)}`,
  )
}

function redactDiagnostics(value: string): string {
  let redacted = value.replaceAll(FAKE_API_KEY, '<redacted-fake-api-key>')
  const secrets = Object.entries(process.env)
    .filter(([name, candidate]) => (
      SENSITIVE_ENV_NAME.test(name) && candidate !== undefined && candidate.length >= 4
    ))
    .map(([, candidate]) => candidate as string)
    .sort((left, right) => right.length - left.length)
  for (const secret of secrets) redacted = redacted.replaceAll(secret, '<redacted-ambient-secret>')
  return redacted
}

function formatCleanupFailure(label: string, error: unknown): Error {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  return new Error(`${label}: ${redactDiagnostics(detail)}`)
}

async function waitForExit(
  exit: () => PtyExit | undefined,
  timeoutMs: number,
): Promise<PtyExit | undefined> {
  const deadline = Date.now() + timeoutMs
  while (exit() === undefined && Date.now() < deadline) await delay(20)
  return exit()
}

async function stopPty(pty: IPty, exit: () => PtyExit | undefined): Promise<void> {
  if (exit() !== undefined) return
  try {
    pty.write('\x11')
  } catch {
    // A concurrently exiting PTY no longer accepts the graceful Ctrl+Q.
  }
  if (await waitForExit(exit, CLEANUP_CTRL_Q_TIMEOUT_MS) !== undefined) return
  try {
    pty.kill()
  } catch {
    // The process may have exited between the outcome check and SIGHUP.
  }
  if (await waitForExit(exit, FORCE_KILL_TIMEOUT_MS) !== undefined) return
  try {
    pty.kill('SIGKILL')
  } catch {
    // A concurrently exiting PTY no longer has a process group to kill.
  }
  if (await waitForExit(exit, FORCE_KILL_TIMEOUT_MS) === undefined) {
    throw new Error(`PTY pid ${pty.pid} survived cleanup`)
  }
}

async function captureWelcome(
  mode: ExampleMode,
  dependencies: CaptureDependencies = {},
): Promise<WelcomeCapture> {
  const startedAt = Date.now()
  const captureDeadline = startedAt + CAPTURE_TIMEOUT_MS
  const createdRoot = await mkdtemp(join('/tmp', 'dtw-'))
  let sentinel: RequestSentinel | undefined
  let terminal: Terminal | undefined
  let parser: ParserTracker | undefined
  let pty: IPty | undefined
  let ptyData: PtyDisposable | undefined
  let ptyExit: PtyDisposable | undefined
  let terminalData: XtermDisposable | undefined
  let outcome: PtyExit | undefined
  let rawPty = ''
  let tempRoots: readonly string[] = [createdRoot]
  let primaryError: unknown
  let successfulCapture: Omit<WelcomeCapture, 'networkRequestsFinal'> | undefined
  const cleanupErrors: Error[] = []

  const cleanup = async (label: string, operation: () => void | Promise<void>): Promise<void> => {
    try {
      await operation()
    } catch (error: unknown) {
      cleanupErrors.push(formatCleanupFailure(label, error))
    }
  }

  try {
    dependencies.onTempRootCreated?.(createdRoot)
    sentinel = await startRequestSentinel()
    const tempRoot = await realpath(createdRoot)
    tempRoots = createdRoot === tempRoot ? [tempRoot] : [createdRoot, tempRoot]
    const home = join(tempRoot, 'home')
    // 100×40 mid-band details are 36 columns; a `workspace` leaf truncates.
    const workspace = join(home, 'w')
    const dshHome = join(tempRoot, 'd')
    const agentsHome = join(tempRoot, 'a')
    await Promise.all([
      mkdir(workspace, { recursive: true, mode: 0o700 }),
      mkdir(dshHome, { recursive: true, mode: 0o700 }),
      mkdir(agentsHome, { recursive: true, mode: 0o700 }),
    ])

    const launch = (dependencies.resolveLaunch ?? resolveExampleLaunch)({
      srcBin: driverPath,
      libBin: driverPath,
      configArgs: [configPath],
      mode,
      tsconfigPath,
      env: {
        HOME: home,
        DSH_HOME: dshHome,
        DSH_AGENTS_HOME: agentsHome,
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: FAKE_API_KEY,
        DEEPSEEK_BASE_URL: sentinel.baseUrl,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3',
        RIVET_AMBIGUOUS_WIDTH: 'narrow',
        DSH_SNAPSHOT: '',
      },
    })
    if (remainingMs(captureDeadline) === 0) {
      throw deadlineError('capture setup', captureDeadline)
    }
    terminal = new Terminal({
      allowProposedApi: true,
      cols: COLUMNS,
      rows: ROWS,
      scrollback: 2_000,
      theme: { background: '#000000', foreground: '#ffffff' },
    })
    parser = createParserTracker(terminal)
    let lastDataAt = Date.now()
    const spawnPty = dependencies.spawnPty
      ?? ((command: string, args: string[], options: IPtyForkOptions) =>
        nodePty.spawn(command, args, options))
    pty = spawnPty(launch.command, launch.args, {
      name: 'xterm-256color',
      cols: COLUMNS,
      rows: ROWS,
      cwd: workspace,
      env: buildChildEnvironment(launch.env),
    })
    ptyExit = pty.onExit((next) => { outcome = next })
    terminalData = terminal.onData((data) => {
      if (outcome === undefined) pty?.write(data)
    })
    ptyData = pty.onData((data) => {
      rawPty += data
      lastDataAt = Date.now()
      parser?.write(data)
    })

    await waitForSettledSurface(
      terminal,
      parser,
      () => outcome,
      captureDeadline,
    )
    await waitForQuietWindow(
      parser,
      () => lastDataAt,
      () => outcome,
      captureDeadline,
    )
    await parser.drain()
    if (remainingMs(captureDeadline) === 0) {
      throw deadlineError('capture finalization', captureDeadline)
    }
    const networkRequestsAfterQuiet = sentinel.requestCount()
    if (networkRequestsAfterQuiet !== 0) {
      throw new Error(
        `model network sentinel received ${networkRequestsAfterQuiet} request(s) before capture`,
      )
    }
    pty.write('\x11')
    const cleanExit = await waitForExit(() => outcome, GRACEFUL_EXIT_TIMEOUT_MS)
    if (cleanExit === undefined) {
      throw new Error(`Ctrl+Q did not exit the PTY within ${GRACEFUL_EXIT_TIMEOUT_MS}ms`)
    }
    if (cleanExit.exitCode !== 0 || (cleanExit.signal ?? 0) !== 0) {
      throw new Error(`Ctrl+Q produced a non-clean PTY exit: ${formatExit(cleanExit)}`)
    }
    await parser.drain()
    assertCaptureState(terminal, rawPty)
    const surface = extractWelcomeSurface(terminal, workspace, tempRoots)
    const networkRequestsAfterExit = sentinel.requestCount()
    if (networkRequestsAfterExit !== 0) {
      throw new Error(
        `model network sentinel received ${networkRequestsAfterExit} request(s) before exit`,
      )
    }
    successfulCapture = {
      mode,
      snapshot: surface.snapshot,
      rawSurface: surface.rawSurface,
      workspace,
      rawPty,
      tempRoots,
      networkRequestsAfterQuiet,
      networkRequestsAfterExit,
    }
  } catch (error: unknown) {
    primaryError = error
  }

  await cleanup('terminal response listener cleanup failed', () => {
    terminalData?.dispose()
  })
  await cleanup('PTY data listener cleanup failed', () => {
    ptyData?.dispose()
  })
  await cleanup('PTY process cleanup failed', async () => {
    if (pty !== undefined) await stopPty(pty, () => outcome)
  })
  await cleanup('PTY exit listener cleanup failed', () => {
    ptyExit?.dispose()
  })
  await cleanup('terminal parser cleanup failed', async () => {
    await parser?.drain()
  })
  await cleanup('terminal cleanup failed', () => {
    terminal?.dispose()
  })
  await cleanup('network sentinel cleanup failed', async () => {
    await sentinel?.close()
  })
  const networkRequestsFinal = sentinel?.requestCount() ?? 0
  if (networkRequestsFinal !== 0) {
    const networkError = new Error(
      `model network sentinel received ${networkRequestsFinal} final request(s)`,
    )
    if (primaryError === undefined) primaryError = networkError
    else cleanupErrors.push(networkError)
  }
  await cleanup('temporary root cleanup failed', async () => {
    const removeRoot = dependencies.removeRoot
      ?? ((root: string) => rm(root, { recursive: true, force: true }))
    await removeRoot(createdRoot)
  })

  if (primaryError !== undefined) {
    const formattedPrimary = formatFailure(primaryError, mode, outcome, rawPty)
    if (cleanupErrors.length === 0) throw formattedPrimary
    const cleanupSummary = cleanupErrors.map(error => error.message).join('\n')
    throw new AggregateError(
      [formattedPrimary, ...cleanupErrors],
      `${formattedPrimary.message}\ncleanup failures:\n${cleanupSummary}`,
    )
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `welcome capture cleanup failed:\n${cleanupErrors.map(error => error.message).join('\n')}`,
    )
  }
  if (successfulCapture === undefined) {
    throw new Error('welcome capture completed without a result')
  }
  return {
    ...successfulCapture,
    networkRequestsFinal,
  }
}

async function matchGolden(payload: string): Promise<void> {
  if (process.env.DSH_SNAPSHOT === 'refresh') {
    await mkdir(dirname(goldenPath), { recursive: true })
    await writeFile(goldenPath, payload, 'utf8')
    return
  }
  expect(payload).toBe(await readFile(goldenPath, 'utf8'))
}

describe.skipIf(process.platform === 'win32')('examples/tui settled welcome', () => {
  it('rejects a transient alternate screen even when capture ends on the normal buffer', () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: COLUMNS, rows: ROWS })
    try {
      expect(() => {
        assertCaptureState(terminal, `${ALT_SCREEN_ON}${ALT_SCREEN_OFF}transient overlay`)
      }).toThrow('alternate screen appeared')
    } finally {
      terminal.dispose()
    }
  })

  it('rejects a raw PTY stream that writes the settled Tip more than once', () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: COLUMNS, rows: ROWS })
    try {
      expect(() => {
        assertCaptureState(terminal, `${EXPECTED_TIP}\n${EXPECTED_TIP}`)
      }).toThrow('write its Tip row exactly once')
    } finally {
      terminal.dispose()
    }
  })

  it('removes its temp root when launch resolution fails before PTY attach', async () => {
    const failure = new Error('injected launch failure')
    let createdRoot: string | undefined
    try {
      await expect(captureWelcome('src', {
        onTempRootCreated: (root) => { createdRoot = root },
        resolveLaunch: () => { throw failure },
      })).rejects.toThrow(failure.message)
      if (createdRoot === undefined) throw new Error('capture did not report its temp root')
      await expect(access(createdRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      if (createdRoot !== undefined) {
        await rm(createdRoot, { recursive: true, force: true })
      }
    }
  })

  it('preserves a primary setup failure when root cleanup also fails', async () => {
    const primary = new Error('injected primary setup failure')
    const cleanup = new Error('injected root cleanup failure')
    let createdRoot: string | undefined
    let thrown: unknown
    try {
      await captureWelcome('src', {
        onTempRootCreated: (root) => { createdRoot = root },
        resolveLaunch: () => { throw primary },
        removeRoot: async () => { throw cleanup },
      })
    } catch (error: unknown) {
      thrown = error
    } finally {
      if (createdRoot !== undefined) {
        await rm(createdRoot, { recursive: true, force: true })
      }
    }

    expect(thrown).toBeInstanceOf(AggregateError)
    expect(String(thrown)).toContain(primary.message)
    expect(String(thrown)).toContain(cleanup.message)
  })

  it('does not inherit ambient secrets into the PTY or failure diagnostics', async () => {
    const secretName = 'WELCOME_TEST_SECRET_TOKEN'
    const secretValue = 'ambient-secret-must-not-cross-pty'
    const previous = process.env[secretName]
    let childEnv: IPtyForkOptions['env']
    let thrown: unknown
    process.env[secretName] = secretValue
    try {
      await captureWelcome('src', {
        spawnPty: (_command, _args, options) => {
          childEnv = options.env
          throw new Error(`injected spawn failure exposed ${secretValue}`)
        },
      })
    } catch (error: unknown) {
      thrown = error
    } finally {
      if (previous === undefined) delete process.env.WELCOME_TEST_SECRET_TOKEN
      else process.env[secretName] = previous
    }

    expect(childEnv).toBeDefined()
    expect(childEnv).not.toHaveProperty(secretName)
    expect(String(thrown)).not.toContain(secretValue)
    expect(String(thrown)).toContain('<redacted')
  })

  it('snapshots the real Loader composition through a 100×40 PTY', async () => {
    const capture = await captureWelcome(resolveExampleMode())
    expect(capture.mode).toBe(process.env.DSH_EXAMPLE_MODE || 'src')
    expect(capture.networkRequestsAfterQuiet).toBe(0)
    expect(capture.networkRequestsAfterExit).toBe(0)
    expect(capture.networkRequestsFinal).toBe(0)
    expect(capture.rawSurface).toBeDefined()
    expect(capture.workspace).toBeDefined()
    expect(capture.rawSurface?.split(capture.workspace ?? '').length).toBe(2)
    expect(capture.rawSurface).toContain(`cwd ${capture.workspace}`)
    expect(capture.snapshot).toMatch(/[▀▄]/)
    expect(capture.snapshot).not.toMatch(/[\u2800-\u28FF]/)
    expect(capture.snapshot.match(/Oh My Tianshu/g)).toEqual(['Oh My Tianshu'])
    expect(capture.snapshot).not.toContain('███ █ █  █ █ █ █')
    expect(capture.snapshot).toContain('< Harness >')
    expect(capture.snapshot).toContain('Model deepseek-v4-flash · Effort max')
    expect(capture.snapshot).toContain('cwd ~/workspace')
    expect(capture.snapshot).toMatch(/\bv\d+\.\d+\.\d+\b/)
    expect(capture.snapshot).toContain(EXPECTED_TIP)
    expect(capture.snapshot).not.toContain('\x1b')
    expect(capture.snapshot).not.toContain(FAKE_API_KEY)
    expect(capture.rawPty).not.toContain(FAKE_API_KEY)
    expect(capture.snapshot).not.toContain('API Key')
    expect(capture.snapshot).not.toContain('恢复会话')
    expect(capture.snapshot).not.toContain(TOP_BAR_MODEL)
    expect(capture.snapshot).not.toContain('❯')
    for (const root of capture.tempRoots) {
      expect(capture.snapshot).not.toContain(root)
      await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' })
    }
    expect(capture.snapshot.endsWith('\n')).toBe(true)
    expect(capture.snapshot.endsWith('\n\n')).toBe(false)
    await matchGolden(capture.snapshot)
  }, 80_000)
})
