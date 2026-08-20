/**
 * Pure test-runner intelligence for the run_tests tool: framework detection
 * from workspace metadata, command templating, summary parsing, and
 * related-test discovery. No framework is imported — metadata files plus
 * output text drive every decision, so unrecognized shapes stay `null`
 * instead of guessing.
 * @module @huiliyi37/dsh-tool-run-tests/detect
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** One recognized test framework and its default command. */
export interface TestFramework {
  /** Stable framework id (config `commandOverrides` keys onto this). */
  id: FrameworkId
  /** The command line that runs the tests, without target paths. */
  command: string
}

/** The recognized framework ids (config `commandOverrides` keys onto these). */
export type FrameworkId = 'vitest' | 'jest' | 'mocha' | 'npm' | 'pytest' | 'go'

/** The DEFAULT_COMMANDS bases; config `commandOverrides` replaces one entry. */
export const DEFAULT_COMMANDS: Record<FrameworkId, string> = {
  vitest: 'npx vitest run',
  jest: 'npx jest',
  mocha: 'npx mocha',
  npm: 'npm test',
  pytest: 'python -m pytest',
  go: 'go test',
}

/** Filesystem access restricted to the metadata probes the detectors need. */
export interface Probe {
  /** File text, or undefined when the path is absent or unreadable. */
  readText(path: string): Promise<string | undefined>
  /** Directory entries, or an empty list when the path is not a directory. */
  readDir(path: string): Promise<string[]>
  /** Whether the path is a regular file. */
  isFile(path: string): Promise<boolean>
}

/** Node-backed probe over the real workspace. */
export const nodeProbe: Probe = {
  async readText(path) {
    try {
      return await readFile(path, 'utf8')
    } catch {
      // Missing or unreadable path: the probe treats absence as undefined.
      return undefined
    }
  },
  async readDir(path) {
    try {
      return await readdir(path)
    } catch {
      // Missing or non-directory path: discovery treats that as no entries.
      return []
    }
  },
  async isFile(path) {
    try {
      return (await stat(path)).isFile()
    } catch {
      // Missing or unstatable path: not a regular file for discovery.
      return false
    }
  },
}

/** Parsed pass/fail counts from one test-run output tail. */
export interface TestSummary {
  /** Tests that passed; null when the framework summary was not recognized. */
  passed: number | null
  /** Tests that failed; null when the framework summary was not recognized. */
  failed: number | null
  /** Total tests; null when the framework summary was not recognized. */
  total: number | null
}

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$|_test\.(py|go)$/

/**
 * Detect the workspace's test framework from metadata files only. Check
 * order: package.json runner dependency, package.json test script, pytest
 * markers, go.mod. Returns undefined when nothing identifies a framework —
 * the caller then requires an explicit `command`.
 * @param probe - the filesystem probe.
 * @param cwd - the workspace root to inspect.
 * @returns the detected framework, or undefined.
 */
export async function detectFramework(probe: Probe, cwd: string): Promise<TestFramework | undefined> {
  const packageJsonText = await probe.readText(join(cwd, 'package.json'))
  if (packageJsonText !== undefined) {
    let packageJson: {
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
      scripts?: Record<string, unknown>
    }
    try {
      packageJson = JSON.parse(packageJsonText) as typeof packageJson
    } catch {
      // Unparseable package.json: skip dependency/script detection, keep going.
      packageJson = {}
    }
    const deps: Record<string, unknown> = { ...packageJson.dependencies, ...packageJson.devDependencies }
    for (const id of ['vitest', 'jest', 'mocha'] as const) {
      if (typeof deps[id] === 'string') return { id, command: DEFAULT_COMMANDS[id] }
    }
    if (typeof packageJson.scripts?.test === 'string') {
      return { id: 'npm', command: DEFAULT_COMMANDS['npm'] }
    }
  }
  if (await probe.isFile(join(cwd, 'pyproject.toml'))
    || await probe.isFile(join(cwd, 'pytest.ini'))
    || await probe.isFile(join(cwd, 'conftest.py'))) {
    return { id: 'pytest', command: DEFAULT_COMMANDS['pytest'] }
  }
  if (await probe.isFile(join(cwd, 'go.mod'))) {
    return { id: 'go', command: DEFAULT_COMMANDS['go'] }
  }
  return undefined
}

function shellQuote(path: string): string {
  return `'${path.replaceAll("'", '\'\\\'\'')}'`
}

/**
 * Compose the final command line: the framework base (config override wins)
 * plus the selected paths, shell-quoted, in framework order. `npm test` passes
 * paths after `--`; `go test` takes package directories, so file paths
 * collapse to their directory.
 * @param frameworkId - the detected framework id.
 * @param paths - the selected target paths, workspace-relative.
 * @param overrides - config `commandOverrides` (validated non-empty values).
 * @returns the command line to execute.
 */
export function renderCommand(frameworkId: string, paths: readonly string[], overrides: Readonly<Record<string, string>>): string {
  const base = overrides[frameworkId] ?? (DEFAULT_COMMANDS as Record<string, string>)[frameworkId]
  if (base === undefined) throw new Error(`run_tests: unknown framework ${frameworkId}`)
  if (paths.length === 0) return base
  const quoted = paths.map(shellQuote)
  if (frameworkId === 'npm') return `${base} -- ${quoted.join(' ')}`
  if (frameworkId === 'go') return `${base} ${paths.map(path => dirname(path) === '.' ? '.' : dirname(path)).map(shellQuote).join(' ')}`
  return `${base} ${quoted.join(' ')}`
}

const SUMMARY_PARSERS: ReadonlyArray<{ id: string; parse: (tail: string) => TestSummary }> = [
  {
    id: 'vitest',
    parse(tail) {
      // Real vitest summary shape: "Tests  3 failed | 4 passed (7)" — the
      // parenthesized number is the grand total; a single-status run drops the
      // other segment ("Tests  4 passed (4)"). Skipped/todo segments exist but
      // fold into neither count; the paren total keeps them.
      const match = /^[ \t]*Tests[ \t]+((?:\d+[ \t]+(?:failed|passed|skipped|todo)[ \t]*\|?[ \t]*)+)\((\d+)\)/m.exec(tail)
      if (match === null) return { passed: null, failed: null, total: null }
      const segments = match[1] ?? ''
      const total = Number(match[2])
      let passed = 0
      let failed = 0
      for (const segment of segments.split('|')) {
        const counted = /(\d+)\s+(failed|passed)/.exec(segment)
        if (counted === null) continue
        if (counted[2] === 'passed') passed = Number(counted[1])
        else failed = Number(counted[1])
      }
      return { passed, failed, total }
    },
  },
  {
    id: 'jest',
    parse(tail) {
      const match = /Tests:\s+(\d+)\s+passed,\s+(\d+)\s+failed,\s+(\d+)\s+total/.exec(tail)
      if (match === null) return { passed: null, failed: null, total: null }
      return { passed: Number(match[1]), failed: Number(match[2]), total: Number(match[3]) }
    },
  },
  {
    id: 'mocha',
    parse(tail) {
      const passing = /(\d+)\s+passing/.exec(tail)
      const failing = /(\d+)\s+failing/.exec(tail)
      if (passing === null && failing === null) return { passed: null, failed: null, total: null }
      const passed = passing === null ? 0 : Number(passing[1])
      const failed = failing === null ? 0 : Number(failing[1])
      return { passed, failed, total: passed + failed }
    },
  },
  {
    id: 'pytest',
    parse(tail) {
      const passed = /(\d+)\s+passed/.exec(tail)
      const failed = /(\d+)\s+failed/.exec(tail)
      if (passed === null && failed === null) return { passed: null, failed: null, total: null }
      const passedCount = passed === null ? 0 : Number(passed[1])
      const failedCount = failed === null ? 0 : Number(failed[1])
      return { passed: passedCount, failed: failedCount, total: passedCount + failedCount }
    },
  },
  {
    id: 'go',
    parse(tail) {
      const ok = (tail.match(/^ok\s/mg) ?? []).length
      const fail = (tail.match(/^FAIL\s/mg) ?? []).length
      if (ok === 0 && fail === 0) return { passed: null, failed: null, total: null }
      return { passed: ok, failed: fail, total: ok + fail }
    },
  },
]

/**
 * Parse one output tail's framework summary lines. The framework id selects
 * the parser; `npm` (an unknown runner) returns null counts — the exit code
 * still reports the outcome.
 * @param frameworkId - the detected framework id (or `npm`).
 * @param tail - the combined output tail.
 * @returns the parsed counts, or null fields when unrecognized.
 */
export function parseTestSummary(frameworkId: string, tail: string): TestSummary {
  const parser = SUMMARY_PARSERS.find(entry => entry.id === frameworkId)
  if (parser === undefined) return { passed: null, failed: null, total: null }
  return parser.parse(tail)
}

/**
 * Parse a tail whose runner is unknown (an explicit `command`): try every
 * known parser in order and keep the first non-null summary. Unrecognized
 * output stays null counts — the exit code still reports the outcome.
 * @param tail - the combined output tail.
 * @returns the first parsable summary, or null fields.
 */
export function parseSummaryAuto(tail: string): TestSummary {
  for (const parser of SUMMARY_PARSERS) {
    const summary = parser.parse(tail)
    if (summary.passed !== null) return summary
  }
  return { passed: null, failed: null, total: null }
}

/** One discovered related test file. */
export interface RelatedTest {
  /** Workspace-relative path. */
  path: string
  /** Discovery source: beside the file, or inside a test directory. */
  kind: 'co-located' | 'test-dir'
}

const DISCOVERY_CAP = 20

/**
 * Whether `target` resolves strictly inside `cwd` (the session workspace).
 * `cwd` itself counts as inside; `..` segments and absolute paths that leave
 * the root do not. A file named `..foo` under the root stays inside.
 * @param cwd - the workspace root.
 * @param target - an absolute or cwd-relative path.
 * @returns true when the resolved path is `cwd` or a descendant.
 */
export function isInsideCwd(cwd: string, target: string): boolean {
  const root = resolve(cwd)
  const absolute = resolve(root, target)
  const rel = relative(root, absolute)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/**
 * Discover test files related to one source path, by pure filename
 * convention. A file probes co-located `<stem>.(test|spec).<ext>` variants
 * and `__tests__`/`tests`/root-mirror directories; a directory collects test
 * files inside it. Only existing files are returned, deduplicated and capped.
 * A target that resolves outside `cwd` throws — discovery never walks off the
 * session workspace.
 * @param probe - the filesystem probe.
 * @param target - the source path, absolute or workspace-relative.
 * @param cwd - the workspace root.
 * @returns the discovered test paths in deterministic order.
 */
export async function relatedTestsFor(probe: Probe, target: string, cwd: string): Promise<RelatedTest[]> {
  if (!isInsideCwd(cwd, target)) {
    throw new Error('related_tests: path escapes the workspace')
  }
  const absolute = resolve(cwd, target)
  const rel = relative(cwd, absolute)
  const found = new Map<string, RelatedTest>()
  const add = async (path: string, kind: RelatedTest['kind']): Promise<void> => {
    if (found.size >= DISCOVERY_CAP || found.has(path)) return
    if (!isInsideCwd(cwd, path)) return
    if (!await probe.isFile(resolve(cwd, path))) return
    found.set(path, { path, kind })
  }

  if (await probe.isFile(absolute)) {
    const dir = dirname(absolute)
    const name = basename(absolute)
    const ext = extname(name)
    const stem = name.slice(0, name.length - ext.length)
    const base = join(dir, stem)
    for (const candidate of [`${base}.test${ext}`, `${base}.spec${ext}`, `${base}_test${ext}`, `${base}_test.go`]) {
      await add(relative(cwd, candidate), 'co-located')
    }
    const relativeDir = dirname(rel)
    for (const testDir of ['__tests__', 'tests', 'test']) {
      const entries = await probe.readDir(join(dir, testDir))
      for (const entry of entries) {
        if (entry.includes(stem) && TEST_FILE_RE.test(entry)) {
          await add(relative(cwd, join(dir, testDir, entry)), 'test-dir')
        }
      }
      // src/foo/bar.ts → <root>/tests|test/foo/bar*
      const mirror = join(cwd, testDir, relativeDir === '.' ? '' : relativeDir)
      const mirrorEntries = await probe.readDir(mirror)
      for (const entry of mirrorEntries) {
        if (entry.startsWith(stem) && TEST_FILE_RE.test(entry)) {
          await add(relative(cwd, join(mirror, entry)), 'test-dir')
        }
      }
    }
  } else {
    const entries = await probe.readDir(absolute)
    for (const entry of entries) {
      if (TEST_FILE_RE.test(entry)) await add(join(rel, entry), 'test-dir')
    }
  }
  return [...found.values()]
}

/**
 * Whether a path looks like a test file under the shared discovery convention.
 * @param path - the file path to check.
 * @returns true when the basename matches the test-file pattern.
 */
export function isTestFileName(path: string): boolean {
  return TEST_FILE_RE.test(basename(path))
}
