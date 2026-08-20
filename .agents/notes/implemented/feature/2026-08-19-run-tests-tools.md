# Agent Note: run_tests and related_tests tools

Status: implemented

English | [中文](2026-08-19-run-tests-tools.zh.md)

## Problem

omts's only test-runner surface was `bash` with hand-written commands: no framework detection, no machine-readable pass/fail counts, and no dedicated discovery for "which tests cover this file". opencode-tui ships `run_tests` (result parsing + failure classification) and `related_tests` as daily-use kernel tools. They belong here because they build on seams omts already owns and feed the evidence gate with zero new channels.

## Decision

[`packages/tests/tool-run-tests`](../../../../packages/tests/tool-run-tests/README.md) (new `tests/` group) registers two tools on `ctx.tools`:

- **`run_tests`** executes through the `ctx.bash` seam. An explicit `command` wins; otherwise framework detection reads workspace metadata only (package.json runner dependency → `test` script → pytest markers → `go.mod`) and composes `DEFAULT_COMMANDS` plus the selected `path` entries. The canonical value is a `foreground`/`background` union: the foreground branch carries the resolved `command`, `exitCode`, nullable `passed`/`failed`/`total` (parsed from framework summary lines; null when unrecognized — the exit code still reports the outcome), and the bounded `tail`. `run_in_background` registers a `run-tests` producer with `ctx.tasks` (the package declares its `TaskKindMap` entry by declaration merging) and returns the task id.
- **`related_tests`** lists existing test files near one source path by filename convention (`<stem>.(test|spec).<ext>`, `_test` variants, `__tests__`/`tests`/`test` directories beside the file, and the root `tests`/`test` mirror), deduplicated and capped at 20. A target that resolves outside the session cwd fails loud; discovery never walks off the workspace.

Framework detection and execution anchor to the calling session's cwd. Misconfiguration fails loud at load (`outputTailChars` integer >= 1; `commandOverrides` keys must be known framework ids with non-empty values). UI render intent is decided up front: `run_tests` is a `terminal` card (background branch generic), `related_tests` is `generic` with the target as a follow-along location.

**evidence-gate interplay — zero new channels.** `run_tests` tool/call and tool/result events ride the ordinary session stream. An explicit `command` flows through the existing command-accounting path untouched; a path-only call synthesizes a `run_tests <paths…>` record; a bare call (no `command`, no `path`) synthesizes `run_tests`. `run_tests` joins `TEST_COMMAND_RE`, so `classifyVerification` recognizes every run. No session event type, no service, no loop change.

## Alternatives considered

**Port opencode-tui's `run_tests` + failure classifier wholesale.** Rejected: its parser is coupled to opencode-tui's tool registry and trajectory layer; omts's evidence-gate already owns verification classification, so the tool only needs to execute and report, not to judge.

**Execute through `dsh-code-runtime` instead of the bash seam.** Rejected: test runs are shell commands in the workspace, exactly the bash seam's contract; code-runtime is for model-written programs, and reusing it would add a second execution identity for the same work.

**Reuse `ctx.bashEnv`/sandbox escalation like tool-bash.** Rejected: test commands need no escalation surface and no managed environment; the plain bash request (command + workdir) keeps the tool's contract minimal. Escalation stays available to the model through `bash` itself.

**Let evidence-gate inspect the rendered tool/result text to recover the resolved command.** Rejected: the canonical value carries the command; synthesizing the record at `tool/call` time from `path` keeps the classifier's input explicit and avoids parsing rendered prose.

## Consequences

- Two new model-facing tools join the daily surface; their schemas flow into system-prompt assembly automatically like every registered tool.
- Framework detection is metadata-driven and heuristic: lockfile-only workspaces fall through to `npm test` or no detection (a call without `command` then fails loud instead of guessing).
- Background runs return the task id, not counts — the suite's output is read through `task_output`; evidence-gate does not account a background run until its result is read, because accounting reads `tool/result` events only.
- The `tests/` group joins `tsconfig.base.json` path wildcards and the host aggregate; the base bundle wires `tool-run-tests` after `tool-bash`. Root `tsdown.config.ts` must not use tsdown's default `**/test?(s)/**` workspace exclude, or the package is silently omitted from `lib/` and publint fails.

## Testing

- `packages/tests/tool-run-tests/tests/tool-run-tests.spec.ts` — pure detectors (framework order, command templating incl. npm/go special cases, summary parsers per framework, discovery conventions, workspace-containment of `related_tests`) and real-executor integration (explicit command, detected framework from the session workspace, failed suite, background task settlement, related_tests, fail-loud config, escaped-path rejection).
- `packages/tests/tool-run-tests/tests/evidence-accounting.spec.ts` — assembled agent loop: a model-issued `run_tests` call executes through the real bash executor and evidence-gate's `verificationCount()` accounts it from the session stream.
- `packages/guard/evidence-gate/tests/integration.spec.ts` — explicit-command accounting, path-only synthesized-record accounting, bare-call (`{}`) accounting, and the `related_tests` negative (no accounting).

## Related

- [tool-JSON-in-content repair plugin](2026-08-19-tool-json-repair.md) — the sibling absorption in the same tier.
- [background-task runtime](../architecture/2026-06-20-generic-long-running-tool-runtime.md) — the `ctx.tasks` producer contract the background branch reuses.
