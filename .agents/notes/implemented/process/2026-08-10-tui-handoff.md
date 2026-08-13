# Agent Note: DSH TUI handoff record

Status: implemented

English | [中文](2026-08-10-tui-handoff.zh.md)

## Problem

The TUI roadmap (`docs/dsh-tui-next-phase.md`) ended in a tail no single session closed: four unimplemented features (6.4 external editor, 6.5 vim mode, 9d fluency control, Phase 8 approval answerer), three modules implemented but never wired into `TuiApp` (5.3 glance-bar, 9a mention-parser, 9b restore-session), and a repo-wide coverage gate (`check:ci:coverage`, vitest perFile 100% over statements, branches, functions, and lines including `src/**`). The work therefore ran across several sessions, with a parallel session editing the same `app.ts`, so each session needed the previous one's verified state, its remaining debt, and the traps it had already paid for — otherwise a session re-derives conclusions that are already proven, or re-trips a trap that already cost hours.

The plan itself could not be taken on faith either: council review rejected the draft item list over six rounds because its claims about the codebase were factually wrong. What a session needs handed to it is not a task list but evidence — every conclusion with the command and result that established it, and every unverified claim marked as unverified.

## Decision

This file is that record: one place holding the verified state, the debt left open, and the traps, kept in the present tense as what is true of the TUI now. Conclusions carry their verification command and result; anything not executed here says so explicitly, so a later session can tell proven behavior from an assumption it inherited.

Execution follows the spec-first direction: the staged specs in `packages/tui/tui/tests/*.spec.ts` are the contract and the only authority, and implementation follows them. Where a staged spec contradicted shipped behavior, the spec was corrected rather than the shipped behavior bent to it.

Scope stays deliberately narrow at the session boundary. The repo-wide coverage gate remains named debt instead of being forced closed inside a feature session, and the `app.ts` coverage sites owned by the parallel C3 session land with that session's own PR.

## What shipped

The foundation landed in five commits:

| Commit | Content | Verification |
|---|---|---|
| `5abf6e2` | 15 pure-function and state-machine modules against the staged spec contract | tests green |
| `1ae0af3` | controller fixes (metrics-glance first push, overlay switching, stream-render `hasContent`) plus the `app.ts` Ctrl+P command-palette wiring | 555/555 |
| `3db5070` | src typecheck fixes (`exactOptionalPropertyTypes`, `LiveRegionLine`) | src 0 errors |
| `053b2bc`+`eef30e3` | `tests/` typecheck 131 → 0 (mock type intersections) | host tsc 0 errors |
| `09389a6` | honest status marks in the roadmap document | — |

At that point `pnpm vitest run packages/tui/tui/tests/` was 37 files and 555 tests green, and `npx tsc -p tsconfig.host.json` reported 0 errors — the root `tsconfig.json` is a solution file, so `tsconfig.host.json` is the real check entry — with staged lint at 0 errors. Those commits implement 18 modules under `src/`: mention-parser, restore-session, separator, spinner-status, tool-label, tool-elapsed, tool-status, activity-status, activity-store, activity-labels, collapsed-bash, summary-state, turn-summary (the top-level model version), format/turn-summary, format/glance-bar, format/welcome, command-palette, and engine/tool-group-controller.

The wrap-up session then closed the roadmap tail — the four unimplemented features and the three unwired modules:

| Item | Commit | Verification |
|---|---|---|
| 6.4 external editor | `92c2d06` | 567 → 588 tests green; `tsc -b` 0 |
| 6.5 vim mode | `2c82467` | 588 tests green; `tsc -b` 0 |
| 9d fluency (port) | `51feb85` | 586 tests green; `tsc -b` 0 |
| 9d fluency (wiring) | `835638e` | 588 tests green; `tsc -b` 0 |
| 5.3 glance-bar wiring | `9775e93` | 590 tests green; `tsc -b` 0 |
| 9a mention wiring | `fccbe4b` | 600 tests green; `tsc -b` 0 |
| 9b restore-session wiring | `af73fa2` | 602 tests green; `tsc -b` 0 |
| Phase 8 approval answerer | `2acc509`+`2e34b69` | 605 tests green; `tsc -b` 0 |

Final verification of that wave: `pnpm vitest run packages/tui/tui/tests/` is 40 files and 605 tests green, and `tsc -b tsconfig.host.json` reports 0 errors — a stricter signal than the earlier `-p` run, because `-b` rebuilds from `src` and includes the pre-existing glance-bar narrowing fix `e54c7e2`. The wave adds four modules: external-editor, fluency-policy, fluency-hook, and mention-expand.

How each tail item resolved:

- 6.4 external editor: Ctrl+O triggers it, `Config.editorKey` makes the key configurable, and the binding avoids the `ctrl_e`/`moveEnd` conflict already held at `input-line.ts` L728. The port source is `.rivet/tui-source/tui/external-editor.ts` (31 lines).
- 6.5 vim mode: `input-line.ts` already contains the vim state machine (`_vimMode`, roughly L1121-1262), so the item is wiring plus a `Config` switch, not a port.
- 9d fluency control: ported from `fluency-hook.ts` and `fluency-policy.ts`, cooperating with `blockWriter` throttling.
- Phase 8 approval answerer: `packages/interaction/user-approval/` already provides `ApprovalService`, the `'approval/request'` waterfall, and the four `OUTCOMES` values, so the TUI registers an answerer — and a waterfall listener must delegate through `next()`.

## Coverage campaign state

The coverage wave closed the sites this line of work owned, five in total, measured against real `app.spec.ts` coverage:

| Site | Commit | Notes |
|---|---|---|
| workspace changes in flight (5 src v8-ignore markers, 6 spec cases) | `e1429a8` | 61 files, 1195 green |
| workflow outcome default (recorded earlier as L904:31) | `8ac3054` | the line number had drifted: L904 is now `a.outcome ?? 'completed'`, and the error spread at L908 is already covered; the root cause is that a run with agents never reaches `toWorkflowRunView` (wf-running has no end, wf-done has no agent) |
| `credentials.describe` catch (recorded earlier as L935:45) | `8ac3054` | the call site was covered; what was missing is the `.catch(() => {})` arrow, since the mock always resolves — closed by a reject case |
| approval diff-null branch (L1604:9) | `8ac3054` | the original diff-null test used an unknown `callId`, so `toolCall` was undefined and the `if` was never entered — closed by a matching `callId` plus bash arguments, for which `formatPermissionDiff` returns null |
| streaming tail (L1626:7) | `8ac3054` | `getLiveTailLines` was always empty with nothing pending — closed by a text-delta case with no stable boundary (an idle of 180 ms flushes the block, plus a WriteBatcher frame, waiting 300 ms) |
| vim visual label (L1654) | `8ac3054` | covers v → VISUAL and, after ESC returns to normal, V → VISUAL LINE; visual state does not handle the V key, which enters line-wise only from normal state |

Final verification of that wave: `pnpm vitest run packages/tui/tui/tests/` is 61 files and 1199 tests green, and `app.spec.ts` coverage under `--coverage.include=.../src/ui/app.ts` leaves nothing in this line of work's scope. Overall the campaign moved the repository from 119 violations to roughly ten, across eight coverage commits: `59f655b` (evidence-gate 6 spec, TUI 14 src v8-ignore, 25 spec), `bf39460` (commands/registry to 100%, app C2 interaction fix, 5 v8-ignore markers), `9591392` (history-search caught up), `f65a423` (app 42 → 28), `05a9edb` (`/model` and `/skills`), `66c5e25` (non-Error throw paths), and `da37739` (approval diff-null plus a workflow attach fix). `app.spec.ts` carries 132 green tests against a baseline of 61.

The same wave cleared all 86 pre-existing type errors in the repository in five commits (`808fe54`, `7706b78`, `f83a47b`, `a95714f`, `b2712dc`): tui 33, workflow-workerthread 7, subagent 20, workflow 7, hooks-claude 8, and fs-snapshot 6 — the last including an fs-snapshot reference added to `tsconfig.host.json` to resolve TS6307. All of them are test-layer type annotations with zero behavior change (tui 1202, subagent 214, workflow/hooks/fs 114, and workerthread 104 vitest green).

What remains uncovered in `app.ts` is roughly 57 sites in the parallel C3 session's scope, which it covers through `mode-cycle.spec.ts`: L1106/1107 (`setPlanMode`), L1182-1216 (the `cycleMode`/`alwaysApprove` three-state cycle plus `shift_tab` key routing), and L1262-1325 (the new question-answer shape plus approval session filtering).

The two commands that produce a trustworthy coverage signal here:

- Single file: `npx vitest run packages/tui/tui/tests/app.spec.ts --coverage --coverage.include="packages/tui/tui/src/ui/app.ts" --coverage.reportOnFailure`
- Whole repository: `DSH_COVERAGE_EXEMPT_HEAVY=1 npx vitest run --coverage --coverage.reportOnFailure`

## Environment and toolchain constraints

- `tsc -b --force` hangs in this environment — three times consecutively, still reproducing after a kill, starting after two concurrent `tsc` runs deadlocked, which points at a corrupted `tsbuildinfo` cache. The substitute signal is `npx tsc --noEmit -p tsconfig.host.json`, which reports 0 errors for the target packages; that mode also reports 46 `-p`-only errors (session-persistence among them) that the `-b` reading does not, and the two must not be conflated. Confirming an `-b` exit 0 again means clearing `*.tsbuildinfo` first.
- Concurrent `tsc -b` runs deadlock on `tsbuildinfo` lock contention, so a repo-wide build must be serial.
- The aggregate `tsc -b` build rebuilds user-approval and emits its artifacts into `src/` (the rewrite-relative-import behavior), so a build is followed by cleaning `packages/interaction/user-approval/src/*.{js,d.ts,map}`. Building that package alone emits normally into `lib`/`types`; the residue is not introduced by this work.
- `pnpm run check:ci:coverage` goes falsely green on this machine: node 24.1.0 has no `import.meta.main`, so the run-gates CLI exits silently. CI runs a higher node version, and local verification uses the two commands above.
- A targeted tui coverage run reports 0% for every other package, which is a configuration false negative rather than a real gap; the true value needs a repo-wide test run.
- The `deliver_task` commit pipeline is unavailable in this environment — three failures whose reasons were swallowed — so commits go through `git add` plus `git commit`, with attribution verified afterwards.
- lefthook commit gates: `lint --fix` conflicts with unstaged changes, so `git add -A` comes first; the whitespace gate rejects trailing blank lines (`git diff --cached --check`); lint `max-len` is 140.
- `.zcode/`, the coverage-campaign probe directory, is in `.gitignore`.

## Traps this work paid for

- WriteBatcher merges frames on a 16 ms tick, so an integration test waits with `setTimeout` at 30 ms; `setImmediate` fires too early to observe the frame.
- The workflow and approval subscriptions register only in `attach()`, never in `newSession()`, so an event-driven test must attach. The workflow subscription registers at `app.ts` L853, and firing it needs the collected handler plus the real event shape `{ stopReason, error }`.
- Listener lifecycle (`89ace88`): every subagent and workflow subscription in `mountSession` must collect its disposer, because `ctx.on` always returns one and joining calls with `??` leaves the right-hand side unregistered — which is why `subagent/end` was never subscribed. `detachProjections` must also call the subagent and workflow disposers, which all leaked and accumulated on every mount. Asserting the disposer calls needs the mock `on: vi.fn(() => vi.fn(() => true))`.
- `/model` reaches the model through `ctx.agentDefaultModel` property access, while `/compact`, `/goal`, and `/tasks` go through `reflect.get`, the Cordis 4 injection proxy.
- `bootEventApp` assembles through `newSession`, and `streamFeed` registers in `mountSession`, so both attach and `newSession` work. Its `session.id` must be synced to `app.sessionId`: in real assembly the minted id runs through all three filters — transcript, statusline, and streamFeed.
- Tool card titles show a semantic verb (Run, Search) rather than the raw tool name, and Ctrl+. is keycode 0x1e (RS).
- An unreachable defensive branch takes `/* v8 ignore next -- <specific reason> */`, following 650-plus sites across the repository; reaching it by changing logic is not allowed.
- Three type-fix patterns cover the whole class of test-layer errors: event callback parameters stay unannotated, because overload contravariance rejects any single annotation, and narrow internally with `'runId' in info` or `typeof title === 'string'`; `Parameters<Events[K]>` for `ctx.emit` resolves to the event map's last overload, the fallback shape, so a test dispatching a real shape uses the loose assertion `(ctx.emit as (thisArg: unknown, name: string, ...args: unknown[]) => void)(...)`, a precise type rather than `as any`; and TS 5.4 narrows a let variable assigned inside a closure and called afterwards to `never`, so `if (x) x()` has no effect and the call goes through `(x as T | null)?.()`.
- Mock types are lost after `as unknown as Context`, so the mock is typed by intersection — `Context & { sessions: { list: ReturnType<typeof vi.fn> } }` — and the function's return type annotation changes with it.
- The write_file pointer trap: passing a `"[file written to …]"` display pointer repeatedly gets intercepted, so real complete content must be written; after an interception the system sometimes lands an intent-recovered file, which is why a write is followed by a `read_file` or `wc` check.
- Three staged specs contradicted shipped behavior and were corrected: tool-group-controller `'Bash'` → `'Run'` (consistent with the existing tool-card), the command-palette move test needs `entries` injected because state holds the visible entries, and turn-summary's narrow width 50 → 40 because the spec claimed roughly 58 columns where the real value is 44.

## Key file map

- Roadmap: `docs/dsh-tui-next-phase.md`, carrying the status marks
- Contract: `packages/tui/tui/tests/*.spec.ts`, the staged RED baseline and only authority
- Port sources: `.rivet/tui-source/tui/`, which is not version-controlled (`.gitignore:42`) and invisible to glob, so it is verified with `ls` before work starts
- Coverage gate: `vitest.config.ts` (perFile 100%) plus the `ci-coverage` entry in `scripts/run-gates.ts`
- Type entry: `tsconfig.host.json`; the root `tsconfig.json` is a solution file
- Approval: `packages/interaction/user-approval/src/index.ts`
- Command palette: `src/command-palette.ts` plus `src/engine/overlay-engine.ts`, wired through `handleKey` in `app.ts`

## Alternatives considered

**Executing the council's draft item list as written** — rejected after six rounds of counter-evidence against its factual claims: vim is already built into `input-line.ts`, so there is nothing to port; the approval seam is `resolveAsk` in core/tools, not repeat-tool-guard; the user-approval package already exists, so no new package is needed; the session event stream has no token-usage field, so nothing may claim one; and the mention-parser port source injects a `<mentions>` block, where the decision took user-side summary semantics instead ([TUI @mention expansion semantics](../feature/2026-08-10-tui-mention-semantics.md)).

**Closing the repo-wide coverage gate inside this work** — rejected, and it stays named debt. perFile 100% including `src/**` is a repository-scale campaign, and a targeted tui run reports 0% for other packages, so the gate's true value needs a repo-wide test run that a feature session cannot honestly produce.

**Taking `pnpm run check:ci:coverage` as the local coverage signal** — rejected on this machine, because it exits silently and reads as green. The single-file `--coverage.include` run plus the `DSH_COVERAGE_EXEMPT_HEAVY=1` whole-repository run are the signals that actually fail when coverage is missing.

**Keeping `tsc -b --force` as the type signal** — rejected in this environment, where it hangs. `npx tsc --noEmit -p tsconfig.host.json` substitutes for it at the cost of a different error set, which is why the 46 `-p`-only errors are recorded rather than fixed.

**Changing logic to reach unreachable defensive branches** — rejected. Coverage never buys a behavior change; the repository's precedent is a `/* v8 ignore next -- <reason> */` marker with its reason stated, at 650-plus sites.

**Committing through the `deliver_task` pipeline** — rejected: it is unavailable in this environment and its three failures swallowed their reasons, so `git add` plus `git commit` with verified attribution is what produces the commits recorded here.

**Covering the parallel session's C3 sites here** — rejected. Those roughly 57 `app.ts` sites belong to the C3 feature PR and its `mode-cycle.spec.ts`; covering them from this side would duplicate that work and collide in the same file.

## Consequences

- The roadmap tail is closed and pinned by tests: 605 green at the wrap-up, 61 files and 1199 tests green after the coverage wave, and 0 type errors at the `tsconfig.host.json` entry. The price is that the type signal comes from two commands with different error sets, so every future reading has to say which one produced it.
- Keeping the coverage gate as named debt bought a complete feature tail in one session; what stays open is the repo-wide perFile gate and roughly 57 `app.ts` sites owned by the parallel C3 PR.
- The spec-first direction bought a contract that outlives any single session — `tests/*.spec.ts` as the only authority — at the cost of three staged specs that had to be corrected against shipped behavior, and of a test suite that grew faster than the features it covers.
- The aggregate `tsc -b` build leaves artifacts inside `packages/interaction/user-approval/src/`, so every repo-wide build here ends with a cleanup step rather than a clean tree.
- Recording every trap makes this file long, and that length is the point: each entry is session time already spent that a later session does not spend again.
