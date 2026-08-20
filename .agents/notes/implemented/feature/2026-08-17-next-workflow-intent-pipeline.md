# Agent Note: `/next-workflow` — a fixed intent pipeline, opt-in, not a zen replacement

Status: implemented

English | [中文](2026-08-17-next-workflow-intent-pipeline.zh.md)

## Problem

The harness already has plan-mode, subagent roles, per-request effort steering, a workflow engine, and hook waterfalls, but it does not compose them into "understand → plan → critique → implement → verify → review". A person who wants that loop must prompt it by hand. Critique happens in the same context that wrote the plan. Verification is a self-report. Effort stays uniform. [plan-mode](../../../../docs/subsystems/plan.md), [`tool-ralph`](../../../../packages/workflow/tool-ralph/README.md), and [zen](2026-08-17-tui-bundle-tianshu-capability-roster.md) are three other orchestration products; none of them is this pipeline.

## Decision

`@huiliyi37/dsh-next-workflow` registers `/next-workflow [candidates] <objective>` on `ctx.commands`. One run is a harness-owned machine: INTENT → PLAN → CRITIQUE → IMPLEMENT → VERIFY → REVIEW. When `planCandidates` is above 1, PLAN fans out and a SELECT judge (fresh context, never a planner) writes `SELECTION.md` and the winning `PLAN.md`. Default `planCandidates` is 1.

INTENT, PLAN, CRITIQUE, SELECT, and REVIEW are one-shot structured-output subagents. IMPLEMENT steers the invoking session. VERIFY runs `verifyCommand` through `ctx.bash`; unset reports `unverified` and continues. Exhausted retries settle `failed-verification`. Artifacts live under `$DSH_HOME/workflows/<run-id>/`. Phase transitions are log-only `next-workflow/phase` and `next-workflow/end`. An `agent/request` listener rewrites `reasoningEffort` from `phaseEfforts` at phase boundaries and restores the pre-run header afterwards.

The plugin injects only `commands` and probes the rest at handler time. Missing subagents, an incapable or parent-inheriting provider, or a configured gate without bash fails loud. One run per session.

No shipped composition mounts this plugin — not `dsh-base`, not TUI, not Web. IMPLEMENT uses the current session's tool face, so a zen-armed session would implement on the anchored set. Hosts that overlay this plugin do so after promotion or without zen. plan-mode and `tool-ralph` stay untouched.

## Alternatives considered

**Mount in `dsh-base` or the shipped TUI, as `github/dev` did.** Rejected: every profile would grow a six-phase runner whose VERIFY is `unverified` until a deployment sets `verifyCommand`. IMPLEMENT on a zen-armed TUI session is not a full-face implementer. This is not a zen substitute.

**A model-written dynamic workflow via `tool-workflow`.** Rejected: the model holding the orchestration script is the non-determinism this feature removes.

**Extend plan-mode, or run IMPLEMENT in a fresh subagent.** Rejected: plan-mode is one interactive plan-and-approval phase. A child implementer hides the live workspace. Steering the invoking session keeps implementation visible.

**Mount `guard/evidence-gate` as the verifier.** Deferred: v1's gate is a configured bash command.

## Consequences

Hosts that overlay the plugin get a reconstructable run (session log plus artifact files) and an honest verify disposition. Shipped TUI, Web, and headless stay unchanged. Coverage: `packages/workflow/next-workflow/tests/*.spec.ts` (happy path, critique loop, verify retry / `failed-verification`, capability probes, effort rewrite and restore, best-of-N select, Loader composition, real spawn integration, empty invariant companion).
