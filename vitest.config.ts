import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolvePwshPath } from './packages/bash/pwsh-local/src/resolve.ts'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'
import { COVERAGE_EXEMPT_ENV, coverageExemptHeavySuites } from './scripts/coverage-exempt.ts'

// Prints exact `path:line:col` records for every uncovered statement, branch
// path, and function when a file misses the per-file 100% gate — the built-in
// threshold ERRORs name only the file. Absolute path because istanbul-reports
// require()s custom reporters (which is also why the reporter is CJS).
const uncoveredLocationsReporter = fileURLToPath(new URL('./scripts/coverage-uncovered-locations.cjs', import.meta.url))

// Resolution facade shared by every plugin instance below: tsconfig.base.json
// has no include, which vite-tsconfig-paths treats as match-all, so its paths
// map applies to every test file. paths must win over package exports so built
// lib/ never loads a second module-singleton copy.
const pathsPlugin = (): ReturnType<typeof tsconfigPaths> => tsconfigPaths({ projects: ['./tsconfig.base.json'] })

const windowsUnsupportedPackages = process.platform === 'win32'
  ? [
      // Bash-requiring suites (a real POSIX shell is unavailable on Windows).
      // The pwsh-requiring suites (pwsh-local, tool-pwsh) deliberately stay
      // INCLUDED: PowerShell ships with Windows, so they run natively here.
      // Replacing the old 'packages/bash/*' glob with this explicit list also
      // newly INCLUDES packages/bash/bash (the Service Definition package) on Windows.
      'packages/bash/bash-local',
      'packages/bash/bash-sandbox',
      'packages/bash/tool-bash',
      'packages/hooks/*',
      'packages/subprocess/*',
      'packages/pty/pty-local',
      'packages/sandbox/sandbox-local',
      'packages/scaffold/create-sdk',
      'packages/scaffold/helper',
    ]
  : []

// These files retain 100% per-file coverage on POSIX, where their process-pipe and terminal timing
// tests are deterministic; Windows skips those cases and must not fail solely on their uncovered paths.
const windowsCoverageExclusions = process.platform === 'win32'
  ? [
      'packages/lsp/lsp-local/src/connection.ts',
      'packages/lsp/lsp-local/src/index.ts',
      'packages/lsp/lsp-local/src/instance.ts',
    ]
  : []

// Mirrors windowsCoverageExclusions: pwsh-local's run/start/lifecycle suites
// self-skip without a real pwsh (executor.spec.ts hasPwsh), leaving this file
// far below per-file 100% on pwsh-less hosts; the exemption keeps those hosts
// green while CI runners ship pwsh and still enforce the full bar. The probe
// runs the suites' own resolution (the dependency-free resolve.ts module),
// so the exemption is active exactly when the suites skip — a mismatched
// narrower probe could exempt the file on hosts whose suites actually run.
const pwshCoverageExclusions = spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0
  ? []
  : ['packages/bash/pwsh-local/src/index.ts']

const testIncludes = [
  'packages/*/*/tests/**/*.spec.{ts,tsx}',
  'apps/*/tests/**/*.spec.ts',
  'examples/*/tests/**/*.spec.ts',
  'scripts/**/*.spec.ts',
]

// The instrumented coverage gate sets this env; the exempt heavy suites then
// run beside it uninstrumented (membership contract in scripts/coverage-exempt.ts).
// A set-but-not-'1' value is a misconfiguration, not a silent no-op.
const coverageExemptRaw = process.env[COVERAGE_EXEMPT_ENV]
if (coverageExemptRaw !== undefined && coverageExemptRaw !== '' && coverageExemptRaw !== '1') {
  throw new Error(`vitest config: ${COVERAGE_EXEMPT_ENV} must be '1' or unset, got ${JSON.stringify(coverageExemptRaw)}.`)
}
const coverageExemptExcludes = coverageExemptRaw === '1'
  ? coverageExemptHeavySuites.map(suite => suite.exclude)
  : []

// These suites exercise process-global state, process APIs, or timing-sensitive process I/O
// that worker threads cannot isolate reliably under aggregate gate contention.
// Keep the narrow exception in forks while the rest of the inventory avoids per-file processes.
const processBoundTests = [
  'packages/subprocess/subprocess-local/tests/spawn.spec.ts',
  'packages/context/time-context/tests/time-context.spec.ts',
  'packages/llm/llm-pi-ai/tests/adapter.spec.ts',
  'packages/boot/app-boot/tests/app-boot.spec.ts',
  'packages/workflow/workflow-workerthread/tests/session.spec.ts',
]

export default defineConfig({
  plugins: [pathsPlugin(), standardDecoratorPlugin()],
  test: {
    setupFiles: ['./scripts/test-invariants.ts'],
    // .tsx: client component specs (jsdom via per-file @vitest-environment pragma).
    include: testIncludes,
    exclude: windowsUnsupportedPackages.map(path => `${path}/tests/**/*.spec.ts`),
    // One coverage invocation aggregates both projects. Regular suites fork on
    // POSIX for Node stability and use threads on Windows; process-bound suites
    // always fork.
    projects: [
      {
        plugins: [pathsPlugin(), standardDecoratorPlugin()],
        test: {
          name: 'thread-safe',
          execArgv: vitestExecArgv,
          // Node 24 has aborted in its CJS lexer (v8::ToLocalChecked Empty
          // MaybeLocal in cjs_lexer::Parse) from worker threads on macOS
          // arm64 and later on Linux. A fork contains that external runtime
          // failure to the test process; Windows keeps the thread pool, where
          // the abort has not reproduced and process spawn is costlier.
          pool: process.platform === 'win32' ? 'threads' : 'forks',
          setupFiles: ['./scripts/test-invariants.ts'],
          include: testIncludes,
          exclude: [
            ...windowsUnsupportedPackages.map(path => `${path}/tests/**/*.spec.ts`),
            ...processBoundTests,
            ...coverageExemptExcludes,
          ],
        },
      },
      {
        plugins: [pathsPlugin(), standardDecoratorPlugin()],
        test: {
          name: 'process-bound',
          execArgv: vitestExecArgv,
          pool: 'forks',
          setupFiles: ['./scripts/test-invariants.ts'],
          include: processBoundTests,
          exclude: [
            ...windowsUnsupportedPackages.map(path => `${path}/tests/**/*.spec.ts`),
            ...coverageExemptExcludes,
          ],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Coverage measures OUR runtime source. Types-only files carry no
      // executable code; vendor/ and examples/ are out of scope (examples are
      // exercised by the demo smoke test instead).
      // .tsx: client components are gated like everything else (jsdom lane).
      include: ['packages/*/*/src/**/*.{ts,tsx}'],
      // Types-only files have no runtime coverage. Importing self-executing bins/workers would boot
      // them inside the unit process, so real subprocess/Worker tests cover their thin entry glue.
      exclude: [
        'packages/*/*/src/types.ts',
        'packages/*/*/src/bin.ts',
        'packages/*/*/src/worker.ts',
        // A killed executable lint-contract test can leave a non-product source probe behind.
        'packages/*/*/src/oxlint-contract-*.ts',
        // GUI step-1 skeleton (PR #500): client/web UI files whose remaining
        // branches need a browser-grade harness the jsdom lane doesn't cover
        // yet. TODO(gui): cover and remove as the client test lane matures.
        'packages/client/ui-trajectory/src/*',
        // Trajectory's compact Markdown projection retains deferred branch coverage.
        'packages/client/ui-primitives/src/markdown/plain-text.ts',
        'packages/client/ui-question/src/client/QuestionComposer.tsx',
        'packages/client/ui-primitives/src/Menu.tsx',
        'packages/client/ui-primitives/src/RiskConfirmation.tsx',
        'packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx',
        'packages/client/ui-workspace/src/client/WorkspacePicker.tsx',
        'packages/client/web-react/src/*',
        'packages/client/runtime/src/*',
        'packages/client/ui-conversation/src/*',
        'packages/client/ui-primitives/src/DisclosureRow.tsx',
        'packages/client/ui-tool/src/*',
        'packages/client/ui-slots/src/*',
        'packages/client/ui-layout/src/*',
        'packages/client/web/src/*',
        'packages/host/webserver/src/*',
        'packages/client/modules/src/client/system.ts',
        'packages/client/hmr/src/client/index.ts',
        // Web config-tree boot round: the new host-side web-transport halves
        // whose remaining branches need real-composition/process harnesses.
        // TODO(gui): cover and remove with the client test lane above.
        'packages/client/modules/src/index.ts',
        'packages/client/modules/src/invariant.ts',
        'packages/client/modules/src/client/index.ts',
        'packages/client/modules/src/client/manifest.ts',
        'packages/client/hmr/src/index.ts',
        'packages/client/hmr/src/invariant.ts',
        'packages/client/connection/src/index.ts',
        'packages/client/connection/src/http-bridge.ts',
        // This assembly imports generated Host-for-Client code that exists
        // only in lib; the post-build built-bin smoke executes both entries.
        'packages/api/remotes/src/index.ts',
        'packages/api/remotes/src/client/index.ts',
        // Slash/command/input round: per-file gaps deferred with the same
        // client-lane debt. TODO(gui): cover and remove with the lane above.
        'packages/client/connection/src/client/fixture.ts',
        'packages/client/ui-command/src/index.ts',
        'packages/client/ui-skill/src/index.ts',
        'packages/client/ui-slash/src/index.ts',
        'packages/client/ui-subagent/src/index.ts',
        'packages/client/ui-command/src/client/popup.ts',
        'packages/client/ui-command/src/client/directory.ts',
        'packages/client/ui-command/src/client/service.ts',
        'packages/client/ui-command/src/client/PopupSelectView.tsx',
        'packages/client/ui-model/src/index.ts',
        'packages/client/ui-permission/src/index.ts',
        'packages/client/ui-model/src/client/ModelSelect.tsx',
        'packages/client/ui-model/src/client/directory.ts',
        'packages/client/ui-model/src/client/index.ts',
        'packages/client/ui-model/src/client/service.ts',
        'packages/client/ui-slash/src/client/controller.ts',
        'packages/client/ui-slash/src/client/service.ts',
        'packages/client/ui-slash/src/core/menu.ts',
        'packages/client/ui-slash/src/core/detect.ts',
        'packages/client/ui-sidebar/src/client/index.ts',
        'packages/client/ui-skill/src/client/index.ts',
        'packages/client/ui-workspace/src/client/index.ts',
        'packages/client/test-runtime/src/translate.ts',
        'packages/client/ui-primitives/src/JsonTree.tsx',
        // Typert generator: correctness is pinned by its fixture suites and
        // the byte-for-byte catalog reproduction test; per-file coverage
        // would put whole-workspace compiler analysis under v8
        // instrumentation — the coverage lane's longest tail.
        'packages/typert/generator/src/*.ts',
        'packages/host/apiproxy/src/index.ts',
        'packages/host/apiproxy/src/invariant.ts',
        'packages/host/apiproxy/src/api-proxy.ts',
        // Projection/command round: executor lifecycle branches and the
        // registry's drive tails need the same maturing lanes. TODO(gui):
        // cover and remove with the client test lane above.
        'packages/interaction/commands/src/index.ts',
        'packages/interaction/commands/src/invariant.ts',
        'packages/session/session-projection/src/index.ts',
        // dsh-tui render-core: terminal I/O boundary files whose correctness
        // needs a real pty / raw-mode / signal / image-tool harness that the
        // deterministic unit lane cannot provide. TODO(tui): cover with the
        // integration lane as it matures, then remove these entries.
        'packages/tui/tui/src/engine/input-line.ts',
        'packages/tui/tui/src/engine/input-handler.ts',
        'packages/tui/tui/src/engine/live-engine.ts',
        'packages/tui/tui/src/engine/overlay-engine.ts',
        'packages/tui/tui/src/engine/resize-handler.ts',
        'packages/tui/tui/src/engine/term-image.ts',
        'packages/tui/tui/src/engine/image-tool.ts',
        'packages/tui/tui/src/engine/image-attach.ts',
        'packages/tui/tui/src/engine/stream-renderer.ts',
        'packages/tui/tui/src/engine/perf-monitor.ts',
        'packages/tui/tui/src/engine/write-batcher.ts',
        'packages/tui/tui/src/engine/commit-engine.ts',
        // subprocess / event-bus boundaries: statusline spawns a user script;
        // the adapter layer subscribes to cordis agent/session services.
        'packages/tui/tui/src/statusline.ts',
        'packages/tui/tui/src/adapter/send.ts',
        'packages/tui/tui/src/adapter/sessions.ts',
        'packages/tui/tui/src/adapter/live.ts',
        // bundle entry re-exports every engine module; importing it here would
        // pull the whole render core into the unit process.
        'packages/tui/tui/src/index.ts',
        // types-only seam: TuiPort carries no executable code (mirrors the
        // packages/*/*/src/types.ts exclusion above).
        'packages/tui/tui/src/port.ts',
        // custom-theme file IO + large pure formatters (markdown/latex) are
        // deferred: their branch surface needs dedicated fixture suites.
        // TODO(tui): cover theme.ts/theme-custom.ts/markdown/latex and remove.
        'packages/tui/tui/src/theme-custom.ts',
        'packages/tui/tui/src/format/markdown.ts',
        'packages/tui/tui/src/pi/latex-block.ts',
        'packages/tui/tui/src/pi/latex-to-unicode.ts',
        ...windowsUnsupportedPackages.map(path => `${path}/src/**/*.ts`),
        ...windowsCoverageExclusions,
        ...pwshCoverageExclusions,
      ],
      // 100% or it doesn't merge (docs/testing.md: excessive tests are welcome).
      // Per-file so a well-covered big file can't subsidize a bare one.
      // Every v8 ignore comment must carry a reason — see the quality-gates Agent Note
      // (.agents/notes/implemented/process/2026-06-11-quality-gates.md).
      thresholds: {
        perFile: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      reporter: process.env.CI
        ? ['text', uncoveredLocationsReporter]
        : ['text', 'html', uncoveredLocationsReporter],
    },
  },
})
