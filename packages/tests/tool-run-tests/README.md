# @huiliyi37/dsh-tool-run-tests

English | [中文](README.zh.md)

A model-facing test-runner surface, not an execution policy: `run_tests` executes the workspace's detected test framework through the `ctx.bash` seam and returns machine-readable pass/fail counts; `related_tests` lists test files near one source path by filename convention. Both tools emit only the ordinary `tool/call`/`tool/result` session events, so evidence-gate accounts a `run_tests` run as verification evidence with no new channel — an explicit `command` flows through the existing command-accounting path, a path-only call synthesizes a `run_tests <paths…>` record, and a bare call synthesizes `run_tests`.

## Config

```yaml
- id: tool-run-tests
  name: '@huiliyi37/dsh-tool-run-tests'
  config:
    commandOverrides: {}   # framework id → command base; replaces one DEFAULT_COMMANDS entry
    outputTailChars: 8000  # default; characters of combined output kept in `tail`
    enableRunInBackground: true  # default; false also rejects run_in_background calls
```

`outputTailChars` fails loud at plugin load: anything but an integer >= 1 throws, never a silent fall-back. Every `commandOverrides` key must be a known framework id (`vitest | jest | mocha | npm | pytest | go`) and every value non-empty; both violations throw at load.

## Tools

### run_tests

- **Explicit `command`** wins. The runner is unknown, so the summary parser tries every known framework summary and keeps the first non-null one.
- **Framework detection** reads workspace metadata only — package.json runner dependency, then its `test` script, then pytest markers (`pyproject.toml` / `pytest.ini` / `conftest.py`), then `go.mod` — and composes `DEFAULT_COMMANDS` plus the selected `path` entries (`npm test` passes paths after `--`; `go test` takes package directories). Detection and execution anchor to the calling session's cwd; a non-agent caller falls back to the process cwd.
- **Non-zero exits are reported, not errors.** The canonical value is a `foreground`/`background` union; the foreground branch carries `command`, `exitCode`, nullable `passed`/`failed`/`total` (null = summary not recognized), and the bounded `tail` (stdout + marked stderr + exit markers).
- **`run_in_background: true`** registers a `run-tests` producer with `ctx.tasks` (the package declares its `TaskKindMap` entry) and returns `{ kind: 'background', taskId }`; read output with `task_output`, stop with `task_kill`. It fails loud when the tasks runtime is absent or disabled.
- **UI render intent**: `terminal` (command as the card title; output tail and exit pill at completion); the background branch renders a generic acknowledgment card.

### related_tests

- **Heuristic, never parses code.** For a file: co-located `<stem>.(test|spec).<ext>` and `_test` variants, `__tests__`/`tests`/`test` directories beside the file, and the root `tests`/`test` mirror of the relative directory. For a directory: test files directly inside it. Only existing files are returned, deduplicated and capped at 20. A path that resolves outside the session cwd fails loud.
- **UI render intent**: `generic` with the target as a follow-along location at call time.

## Model Experience

### What the model sees

Two new tools with their schemas and descriptions. `run_tests` tells the model to prefer it over bash because the verification gate accounts the result; `related_tests` offers a bounded filename-convention listing.

### Token effect

A `run_tests` result is the bounded `tail` (capped at `outputTailChars`) plus one summary line — no unbounded command output enters context. `related_tests` returns at most 20 paths.

### KV Cache effect

Append-only tool results; no request-shaping behavior exists.

## Known Limitations and Deferred Work

- **Heuristic discovery and parsing only** — `related_tests` follows filename conventions and misses convention-free test layouts; summary parsing recognizes vitest/jest/mocha/pytest/go summary lines and returns null counts otherwise (the exit code still reports the outcome).
- **Detection reads metadata files, not lockfiles** — a workspace whose runner lives only in `pnpm-lock.yaml` with no package.json dependency entry falls through to `npm test` or no detection.
- **No test-framework imports** — the tool never parses or executes framework code; `npx <runner>` commands require the runner to be reachable in the deployment environment.
- **Background runs report no pass/fail counts** — the tool returns the task id; the suite's own output is read through `task_output`.
- **The evidence-gate synthesized record is `run_tests` or `run_tests <paths…>`** — a bare call (no `command`, no `path`) and a path-only call both classify as a test run; neither carries the resolved framework command. A path-only call whose framework cannot be detected fails before execution, so no unclassified run is ever executed.
- **Discovery stays inside the session cwd** — `related_tests` rejects a target that resolves outside the workspace; it still probes through process-local `fs` rather than `ctx.fs`, so symlink-follow off the root remains a residual hole.
