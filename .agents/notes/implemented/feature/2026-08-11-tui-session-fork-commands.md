# Agent Note: TUI session fork commands /fork /branch (A3)

Status: implemented

English | [中文](2026-08-11-tui-session-fork-commands.zh.md)

## Problem

Item A3 of the C1 benchmarking pass (`docs/dsh-tui-与claude的对比-c1.md`) names a gap between the session layer and the TUI. The fork capability already exists: `SessionStore.fork` in `packages/core/session/src/index.ts` (L1095) copies the event history into a new child session and records `parentSession` lineage plus `seedLength` in the metadata ([session-store fork API](2026-06-30-session-store-fork-api.md)). The TUI has no fork or branch command entry at all — only restore-session recovery at startup.

## Decision

`/fork` and `/branch` share one handler (`deps.forkSession` → `TuiApp.forkSession`): `ctx.sessions.fork(activeSessionId)` creates the child, then `switchSession(child.id)` switches to it through the existing agent-ensure path, which resumes when the child has no live agent. DSH has no background-session concept, so Claude Code's two distinct commands — `/fork` copies into a new background session, `/branch` branches off and continues — converge here into single fork-and-switch semantics; both names stay because they match users' mental models.

The command switches immediately, with no confirmation dialog, and there is no branch-tree UI. `/session list` already carries `parentSession` lineage through `SessionSummary` in `adapter/sessions.ts`, so parent-child relations are visible in the list.

## Verification

- `commands.spec.ts` carries three cases for this behavior — `/fork` calls `deps.forkSession` and echoes the new id, `/fork` with no session rethrows the error, `/branch` shares the same handler — written RED then taken GREEN; the file is 64/64.
- `app.spec.ts` carries two `forkSession` cases — `sessions.fork` receives the current session id minted by `newSession`, the app resumes into the child and returns the child id; a call with no active session throws — written RED then taken GREEN; the file is 61/61.
- The TUI suite is 1026/1027. The one failure is the term-width `isCjkLocale` case, a pre-existing environment failure under this machine's CJK locale on the same baseline as the A1 delivery, not introduced here.
- Types: a scratch project checking only the four changed files reports zero type errors from this change, and the three classes of errors `tsc` reports elsewhere were each traced to another origin — an uninitialized `renderBatcher` field in `app.ts` that HEAD does not have (an uncommitted change from a parallel session), and `makeCtx` overrides missing `tasks` in `commands.spec.ts` (a pre-existing type error at HEAD, whose three `tasks` tests already exist there).

## Files

- `packages/tui/tui/src/commands/registry.ts`: `BuiltinCommandDeps.forkSession`, the `/fork` and `/branch` commands, and `fork`/`branch` added to `BUILTIN_COMMAND_NAMES`
- `packages/tui/tui/src/ui/app.ts`: `TuiApp.forkSession` and the `createBuiltinCommands` call site
- `packages/tui/tui/tests/commands.spec.ts`: the three `/fork` and `/branch` cases plus `commandByName` deps
- `packages/tui/tui/tests/app.spec.ts`: the two `forkSession` cases plus a `fork` mock in `makeCtx`
- `docs/dsh-tui-与claude的对比-c1.md`: A3 marked done

## Alternatives considered

**Keep Claude Code's split semantics — `/fork` into a background session, `/branch` for branch-and-continue** — rejected. DSH has no background-session concept, so the two behaviors have nothing to distinguish them here; two commands over one fork-and-switch handler preserve the familiar names without inventing a background-session model to justify the split.

**Guard the switch with a confirmation dialog** — rejected. The C1 draft listed the dialog as a non-essential, and a fork is recoverable by switching back, so the command switches straight away; a dialog can be added later if accidental forks turn out to hurt.

**A branch-tree UI for the fork graph** — rejected. `/session list` already exposes `parentSession` lineage through `SessionSummary`, so parent-child relations are already readable; a tree view would be a second presentation of data the list carries.

## Consequences

- Two names over one handler buy the whole capability without a new UI surface, at the price of no confirmation step: `/fork` switches the active session immediately, and an accidental fork is undone only by switching back through `/session`.
- Lineage is readable in `/session list` rather than in a dedicated view, so a deep fork chain reads as a flat list of parent references instead of a tree.
- The behavior is pinned by unit tests only. There is no TUI-profile runtime environment here, so the end-to-end result under `dsh --profile tui` — the forked history in the transcript and the `parentSession` lineage in `/session list` — rests on that unit-level evidence alone.
- Persistence of the forked child rides on session-persistence flushing the seed events, which this change does not verify separately: resuming a forked session across restarts stays under the existing persistence contract.
