# Agent Note: Plan mode hard read-only guard and the persisted plan file

Status: implemented

English | [中文](2026-08-16-plan-mode-hard-readonly-and-plan-file.zh.md)

## Problem

Plan mode was a prompt-layer promise: the `plan:policy` section advised read-only behavior, but nothing stopped a distracted or injected model from calling `write`/`edit`/`git_commit` — the mode's entire value proposition rested on model compliance (the old test suite even asserted "guidance and enforcement are separate axes" with every call running untouched). And the presented plan lived only inside the review prompt and the tool-call arguments: after compaction the approved plan was unrecoverable, and resuming a session could not re-read it. The C7 orchestration comparison (docs/dsh-编排机制对标-claude-c7.md §3.1) names exactly this as the plan-mode gap against Claude Code, where plan is a permission mode with edits hard-blocked.

## Decision

Two additions in `packages/plan/plan-mode`, both reading the same logged `plan/mode` state:

**A monotonic registry guard** (`ctx.tools.guard`, registered by the plan-mode service) denies the mutation-tool families while `foldPlanMode` is active: `write`, `edit`, `str_replace_editor` (only its `create`/`str_replace`/`insert` commands, read off the call arguments), `git_commit`, and `terminal_open/send/signal/close`. The denial reason is model-facing and points at read-only exploration plus `exit_plan_mode`. `bash`/`pwsh` deliberately stay allowed — Claude Code's plan mode keeps read-only shell exploration, and this repository has no command-content static analysis by design (tool-bash/src/index.ts:6-7); the residual shell-write hole rides on the orthogonal sandbox axis, exactly like Claude Code's own sandbox residual. Deployments add names through the new `PlanModeConfig.blockedTools`. The guard reads the *committed* log only: a pending mid-turn entry must not break the running turn's legitimate writes, and an approved exit's own batch keeps the "from the next step" contract. Subagent sessions fold their own fresh logs, so the guard never leaks into children. The request tool catalog is untouched — the guard acts at execution, not assembly, so "the toolset is stable across mode switches" stays true.

**Plan file persistence**: every `exit_plan_mode` call — approved or keep-planning — writes the presented markdown to `$DSH_HOME/plans/<encoded-cwd>/<session-id>/<slug>.md` via plugin-private `node:fs` (the spill-local/fs-snapshot precedent: it never crosses the fs sandbox, so a read-only deployment cannot deadlock the review) and appends the log-only `plan/file {path, heading}` event. The approved result gains an optional `path` field rendered into the tool result text, so replay and resume recompute the same card from the logged result.

## Alternatives considered

- **Reuse `sandbox/mode` (switch the session to read-only)**: four concrete pits — pty-local vetoes mode switches while persistent terminals are open (pty-local/src/index.ts:44-52); the permission presets share the same event slot and would overwrite each other; the plan file itself could not be written under read-only cwd (chicken-and-egg); and sandbox-less compositions would get no protection at all. The guard is composition-independent.
- **`tools/pre-execute` waterfall instead of `guard()`**: the guard is synchronous and monotonic — no later listener can re-allow a denied write (core/tools/src/index.ts:953-959) — while a waterfall decision can be reshaped by downstream listeners. For a security-adjacent constraint the monotone shape is the point.
- **Colocating plan files with the JSONL session log** (`sessions/<proj>/<id>/`): couples plan-mode to one persistence backend's directory layout. The `plans/` root is backend-agnostic and clearer to browse.
- **Blocking bash/pwsh too**: breaks legitimate exploration (`ls`, `git log`, read-only inspection) that Claude Code's plan mode explicitly allows; the honest fix for the shell hole is a per-call sandbox downgrade, not a name-list ban.

## Consequences

- The old soft-contract tests were rewritten to the new contract: `integration.spec.ts` now asserts a pre-turn `set()` makes a mutation call guard-denied, and the unit suite covers command discrimination, config extension, mid-turn pending non-interference, and child-session isolation. 91/91 green in `packages/plan/plan-mode`.
- Model-visible surface changes: guard denial text (only when a blocked call is attempted in plan mode) and the approved exit's result text gaining `Plan file: <path>`. Recorded snapshots that replay logged results are unaffected.
- The residual hole is named honestly: under `workspace-write` sandbox, a bash command can still write inside the workspace — the same residual Claude Code carries. Closing it needs per-call sandbox downgrades, not this guard.
- `plan/file` is log-only: no model-surface change, replay-safe on fork/resume.
- New gates evidence: `plan/file` event and `blockedTools` config carry JSDoc and flow into `docs/persistence-catalog.md` / `docs/config-catalog.md` (zh counterparts synced).
