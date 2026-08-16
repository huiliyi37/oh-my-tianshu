# Agent Note: /next-workflow — a fixed intent-pipeline with phase effort steering and a verification gate

Status: proposed

English | [中文](2026-08-17-next-workflow-intent-pipeline.zh.md)

## Problem

The harness ships every primitive of a strong engineering workflow — plan-mode with a hard read-only gate, subagent roles, per-request effort steering (`agent/request` waterfall), a workflow engine, hook waterfalls (`agent/pre-tool-commit`) — but composes none of them. A user who wants "understand → plan → critique → implement → verify → review" must prompt it by hand every time: plan discipline depends on model goodwill, verification is the honor system (the worker grades itself), critique happens in the same context that produced the plan (the author judging their own work), and effort stays uniform across phases even though planning benefits from deep reasoning while routine confirmation does not.

The research record is consistent on the shape of the fix (Anthropic's multi-agent research system and Claude Code best practices; spec-kit's artifact chain): phase artifacts live in files, critique/review run in fresh contexts that see the artifact and not the reasoning, verification is a deterministic gate rather than a self-report, and effort is allocated per phase — high for planning and review, default for execution. Cache discipline from the adaptive-memory contract applies unchanged: phase boundaries are the only legitimate points to switch effort (they align with cache breakpoints), and artifacts move between phases as files, never as re-stuffed context.

## Proposal

A new package `packages/workflow/next-workflow` (`@huiliyi37/dsh-next-workflow`) registering the host command `/next-workflow <objective>`. One invocation runs a fixed, harness-owned phase machine — the harness holds the plan, the model writes the content:

```
INTENT → PLAN → CRITIQUE → IMPLEMENT → VERIFY → REVIEW → DONE
```

- **INTENT** — normalize the objective into a SPEC artifact: goal, constraints, affected areas, acceptance checks. Written to `<workflowsRoot>/<run-id>/SPEC.md` (default root `dshHomePath('workflows')`).
- **PLAN** — a planning subagent (structured output) turns SPEC into `PLAN.md`: ordered steps, named files/interfaces, out-of-scope declarations.
- **CRITIQUE** — a fresh-context subagent reviews PLAN.md against SPEC.md only (it never sees the planner's reasoning), returning `{verdict, gaps[]}`; material gaps loop back to PLAN once (Config-bounded).
- **IMPLEMENT** — the orchestrator steers the current session's agent with the plan content, so implementation runs live in the user's workspace with the full tool surface and stays visible.
- **VERIFY** — a deterministic gate: run the configured `verifyCommand` (Config; e.g. the repo's test command) through the bash executor. Failure sends the output back to IMPLEMENT for one bounded retry (`maxVerifyRetries`, default 1); exhaustion ends the run as `failed-verification`, never silent success.
- **REVIEW** — a fresh-context subagent reviews the produced diff against SPEC.md acceptance checks, returning `{verdict, findings[]}` written to `REVIEW.md`; findings scope-limited to correctness and stated requirements (unbounded reviewers invent work).

Phase transitions, artifacts, and verdicts are logged as log-only session events (`next-workflow/phase`, `next-workflow/end`); artifacts on disk survive compaction. Phase effort steering rides the `agent/request` waterfall: while a run is active the plugin rewrites `reasoningEffort` per phase (Config map; default plan/critique/review `high`, others unset) and restores the prior header at run end — switches happen only at phase boundaries, the cache-legitimate points. The command follows the `command-memory` precedent: registered on `ctx.commands`, surfaced in both TUI and web automatically.

## Alternatives considered

**A model-written dynamic workflow via the existing `tool-workflow`.** Rejected for v1: workflow `phases` are display-only, `agent()` rejects `effort`, and the model holding the orchestration script is exactly the non-determinism this feature exists to remove. A fixed harness-owned machine mirrors tool-ralph's deployment-owned-script pattern with real phase semantics.

**Extend plan-mode.** Rejected: plan-mode is one phase (plan + approval), not a pipeline; it stays the interactive counterpart and is left untouched.

**Mount `guard/evidence-gate` as the verifier.** Deferred: it is unshipped and in-memory-only. v1's verify gate is a configured command through the bash executor — deterministic and deployment-owned; evidence-gate integration is a follow-up.

**Run IMPLEMENT in a fresh subagent.** Rejected for v1: the user loses live visibility and the workspace tool surface; steering the main session keeps implementation observable. A future `isolated: true` Config can route implementation to a subagent where the provider supports it.

## Acceptance criteria

- `/next-workflow <objective>` registered on `ctx.commands` and visible in the web command surface without client changes.
- Composition tests (keyless, scripted providers) cover: full phase sequence with artifact files written; critique gap loop bounded by Config; verify failure → bounded retry → `failed-verification` terminal; effort header rewritten per active phase and restored at run end; all orchestration events log-only.
- All budgets/thresholds/effort values are validated Config fields with schema defaults.
- Package README (both languages) with Model Experience (effort switching breaks the prefix cache at phase boundaries by design; artifacts move as files) and Known Limitations.
- No `agent-loop` changes; nothing mounted in shipped compositions beyond the new command package's own bundle row; the adaptive-memory contract note stays the authority for memory behavior.

## Risks

- **Subagent effort gap**: `AgentOptions` has no effort field and workflow `agent()` rejects it, so per-phase effort applies to the main session's requests; subagent phases get the default model route. If phase quality suffers, the seam needs an effort channel (follow-up).
- **Verify gate requires deployment config**: without `verifyCommand` the VERIFY phase must degrade honestly (report `unverified`, never claim success).
- **Scripted-provider fidelity**: composition tests simulate phases; the first real run may expose prompt-level issues (planner/critic personas) that only real models surface.
- **Critique loop economics**: each critique/review is a full extra context; bounded by Config, but a long SPEC makes phases expensive.
