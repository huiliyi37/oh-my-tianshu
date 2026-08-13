import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

const installer = fileURLToPath(new URL('../../../scripts/install.sh', import.meta.url))
const fixtures: string[] = []

const PTY_DRIVER = String.raw`
import errno, json, os, pty, select, signal, sys, time
script, cwd, env_json, actions_json = sys.argv[1:]
env = os.environ.copy()
env.update(json.loads(env_json))
actions = json.loads(actions_json)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe("sh", ["sh", script], env)

output = bytearray()
action_index = 0
deadline = time.monotonic() + 15
status = None
while time.monotonic() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        output.extend(chunk)
    while action_index < len(actions) and actions[action_index]["waitFor"].encode() in output:
        os.write(fd, actions[action_index]["send"].encode())
        action_index += 1
    waited, candidate = os.waitpid(pid, os.WNOHANG)
    if waited == pid:
        status = candidate
        break

if status is None:
    os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(output)
if action_index != len(actions):
    sys.stderr.write(f"completed {action_index}/{len(actions)} PTY actions\n")
    sys.exit(124)
sys.exit(os.waitstatus_to_exitcode(status))
`

interface Action {
  readonly waitFor: string
  readonly send: string
}

interface Fixture {
  readonly binDirectory: string
  readonly launchLog: string
  readonly pnpmLog: string
  readonly root: string
  readonly script: string
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(async (fixture) => { await rm(fixture, { force: true, recursive: true }) }))
})

function executable(path: string, content: string): void {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-install-'))
  fixtures.push(root)
  const checkoutDirectory = join(root, 'checkout')
  const scriptsDirectory = join(checkoutDirectory, 'scripts')
  const sourceBinDirectory = join(checkoutDirectory, 'bin')
  const fakeBinDirectory = join(root, 'fake-bin')
  const binDirectory = join(root, 'path-bin')
  for (const directory of [scriptsDirectory, sourceBinDirectory, fakeBinDirectory, binDirectory, join(root, 'home/.dsh')]) {
    mkdirSync(directory, { recursive: true })
  }
  const script = join(scriptsDirectory, 'install.sh')
  copyFileSync(installer, script)
  const launchLog = join(root, 'launch.log')
  const pnpmLog = join(root, 'pnpm.log')
  executable(join(sourceBinDirectory, 'dsh'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >"$DSH_TEST_LAUNCH_LOG"\n')
  executable(join(fakeBinDirectory, 'pnpm'), `#!/bin/sh
if [ "\${1:-}" = --version ]; then printf '11.7.0\\n'; exit 0; fi
printf '%s\\n' "$*" >>"$DSH_TEST_PNPM_LOG"
`)
  await execa('git', ['init', '-q'], { cwd: checkoutDirectory })
  await execa('git', ['add', 'bin/dsh', 'scripts/install.sh'], { cwd: checkoutDirectory })
  await execa('git', [
    '-c', 'user.name=dsh-test',
    '-c', 'user.email=dsh-test@example.invalid',
    'commit', '-qm', 'fixture',
  ], { cwd: checkoutDirectory })
  writeFileSync(join(root, 'home/.dsh/.env'), 'DEEPSEEK_API_KEY=test\n')
  return { binDirectory, launchLog, pnpmLog, root, script }
}

async function runInstaller(fixture: Fixture, actions: readonly Action[]): Promise<string> {
  const result = await execa('python3', [
    '-c',
    PTY_DRIVER,
    fixture.script,
    fixture.root,
    JSON.stringify({
      DSH_BIN_DIR: fixture.binDirectory,
      DSH_HOME: join(fixture.root, 'home/.dsh'),
      DSH_TEST_LAUNCH_LOG: fixture.launchLog,
      DSH_TEST_PNPM_LOG: fixture.pnpmLog,
      HOME: join(fixture.root, 'home'),
      PATH: `${join(fixture.root, 'fake-bin')}:${fixture.binDirectory}:${process.env.PATH ?? ''}`,
    }),
    JSON.stringify(actions),
  ], { reject: false, stripFinalNewline: false, timeout: 20_000 })
  expect(result.exitCode, result.stderr).toBe(0)
  return result.stdout
}

describe.runIf(process.platform !== 'win32')('one-line installer launch', { timeout: 25_000 }, () => {
  it('builds and launches the Web UI', async () => {
    const fixture = await createFixture()

    const output = await runInstaller(fixture, [
      { waitFor: 'Replace it?', send: '\n' },
    ])

    expect(output).toContain('launching Web UI')
    expect(readFileSync(fixture.pnpmLog, 'utf8')).toBe('install\nrun build\n')
    expect(readFileSync(fixture.launchLog, 'utf8')).toBe('web\n')
  })
})
