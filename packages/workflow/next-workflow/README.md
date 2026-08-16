# @huiliyi37/dsh-next-workflow

English | [中文](README.zh.md)

The human-facing `/next-workflow <objective>` command runs a fixed, harness-owned phase machine — INTENT → PLAN → CRITIQUE → IMPLEMENT → VERIFY → REVIEW. The harness holds the orchestration; models write the content. The plugin registers on [`ctx.commands`](../../interaction/commands/README.md), so every composed command adapter (TUI, web) discovers and executes it without client changes. The [intent-pipeline Agent Note](../../../.agents/notes/proposed/feature/2026-08-17-next-workflow-intent-pipeline.md) owns the design rationale.

## Pipeline

- **INTENT** — a structured-output subagent over [`ctx.subagents`](../../subagent/subagent/README.md) normalizes the objective into `SPEC.md` (goal, constraints, affected areas, acceptance checks, plus the verbatim objective). A structured-output subagent was chosen over deterministic templating: a verbatim objective dump adds no normalization value.
- **PLAN** — a planner subagent turns the SPEC into `PLAN.md`: ordered steps naming files and interfaces, plus explicit out-of-scope declarations.
- **CRITIQUE** — a fresh-context critic sees only SPEC.md and PLAN.md, never the planner's reasoning, and returns `{ verdict, gaps[] }`. Material gaps loop back to PLAN, bounded by `maxCritiqueRounds` (default 1).
- **IMPLEMENT** — the orchestrator steers the invoking session's own agent with the spec and plan inline, so implementation runs live in the user's workspace with the full tool surface.
- **VERIFY** — a deterministic gate: the configured `verifyCommand` runs through the [`ctx.bash`](../../bash/bash/README.md) request/spec split in the session's workspace. Failure steers one bounded retry (`maxVerifyRetries`, default 1) with the bounded gate output; exhaustion ends the run as `failed-verification` — an error result, never silent success. Without `verifyCommand`, VERIFY reports `unverified` and the run continues to REVIEW honestly.
- **REVIEW** — a fresh-context reviewer sees SPEC.md and the workspace diff (via `ctx.git`, falling back to `git diff HEAD` through bash, then to an explicit unavailable marker) and returns `{ verdict, findings[] }`, written to `REVIEW.md`. The reviewer persona scopes findings to correctness and the stated requirements, so the reviewer cannot invent work.

Artifacts live at `<workflowsRoot>/<run-id>/{SPEC,PLAN,REVIEW}.md` (default root `$DSH_HOME/workflows`) and survive compaction. Every phase transition and artifact path is a log-only session event (`next-workflow/phase`, `next-workflow/end`), so the run is reconstructable from the session log plus the artifact files. Artifact writes are load-bearing: a write failure fails the run loud.

While a run is active, an `agent/request` waterfall listener on the invoking agent rewrites `reasoningEffort` per phase from the `phaseEfforts` map (default: plan/critique/review `high`; unmapped phases inherit). Switches happen only at phase boundaries, and the pre-run header effort is restored on the first request after the run.

## Command contract

| Input | Result |
|---|---|
| `/next-workflow <objective>` | Runs the pipeline; success summarizes phases, verdicts, and artifact paths. Verify exhaustion settles as an error naming `failed-verification`. |
| `/next-workflow` (empty input) | `Usage: /next-workflow <objective>` — nothing starts. |
| Missing capabilities | An unavailable error naming the missing seam: no subagents service, unregistered or incapable provider (needs structured output, personas, fresh context), or a configured `verifyCommand` without a bash executor. |
| A second run while one is active on the session | An `already running` error; one run per session at a time. |

## Composition

The plugin injects only `commands`; the subagent provider, bash executor, and git service are probed at handler time, so the shipped base row stays neutral:

```yaml
- id: commands
  name: '@huiliyi37/dsh-commands'
- id: next-workflow
  name: '@huiliyi37/dsh-next-workflow'
```

## Config

| Key | Default | Meaning |
|---|---|---|
| `provider` | `spawn` | One-shot structured-output subagent provider for every phase. |
| `workflowsRoot` | `$DSH_HOME/workflows` | Artifact root; one `<run-id>` directory per run. |
| `verifyCommand` | unset | Deterministic VERIFY gate command; unset reports `unverified`. |
| `verifyTimeoutMs` | `120000` | Timeout for one gate run. |
| `maxCritiqueRounds` | `1` | Maximum critique-driven PLAN revisions. |
| `maxVerifyRetries` | `1` | Maximum verify-failure retries steered back into IMPLEMENT. |
| `phaseEfforts` | `{ plan: high, critique: high, review: high }` | Per-phase reasoning effort for the main session's requests; unknown phase keys fail at load. |
| `maxArtifactChars` | `32768` | Maximum characters of one phase artifact. |
| `maxVerifyOutputChars` | `8192` | Maximum characters of gate output steered back on failure. |
| `maxDiffChars` | `32768` | Maximum characters of the diff offered to the reviewer. |

All values are normalized and validated when the plugin applies, including direct `apply()` calls outside Loader schema normalization.

## Model Experience

### The `/next-workflow` run

#### What the model sees

Phase subagents see their static persona and a prompt carrying only the artifacts for their phase — the critic sees SPEC + PLAN, the reviewer sees SPEC + diff — plus the structured-output contract. The invoking session's model sees the IMPLEMENT steer (a logged user-role message with SPEC and PLAN inline) and, on gate failure, one retry steer with the bounded gate output. The human sees the command result summary. Everything model-visible is reconstructable from the session log and the artifact files.

#### Token effect

Every phase is a fresh subagent context; the main session pays only for the implementation turns. `maxArtifactChars` bounds each artifact, `maxDiffChars` bounds the review diff, and `maxVerifyOutputChars` bounds steered gate output.

#### KV Cache effect

Effort switches break the request prefix cache at phase boundaries by design — phase boundaries are the cache-legitimate switch points, and the pre-run effort is restored after the run. Artifacts move between phases as files, never as re-stuffed context. Subagent personas are byte-stable static strings, so repeated runs reuse each role's prefix.

## Known Limitations and Deferred Work

- **Subagent effort gap** — `AgentOptions` has no effort channel, so `phaseEfforts` applies only to the invoking session's requests; plan/critique/review subagents keep the default model route. An effort channel on the subagent seam is a follow-up.
- **Scripted-persona fidelity** — composition tests simulate the phase subagents; real-model runs may surface prompt-level issues in the planner/critic/reviewer personas that only real models expose.
- **The verify gate requires deployment config** — without `verifyCommand` the run reports `unverified` rather than verifying; mounting `guard/evidence-gate` as the verifier is deferred.
- **Implementation is not isolated** — IMPLEMENT steers the invoking session for live visibility and the full tool surface; a Config-routed isolated implementation subagent is deferred.
- **Critique loop economics** — each critique and review is a full extra context; bounded by Config, but a long SPEC makes phases expensive.
