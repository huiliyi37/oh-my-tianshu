# Agent Note: doom-loop guard plugin

Status: implemented

English | [中文](2026-08-19-doom-loop-guard.zh.md)

## Problem

omts's guard family broke loops by one shape only: repeat-tool-guard counts runs of identical calls. opencode-tui ships richer detectors — oscillation (an alternating call pair), behavior-mirror (repetitive patterns), and strategy-shift (doom-loop exit suggestions) — and the [gap analysis](../../../../docs/opencode-tui-vs-omts-能力差距与吸收路线.md) classes them "worth absorbing" as a guard plugin: absorb the detectors, not the CVM they live in. Loops that alternate tools or re-run an unchanged failing test sail past an identical-call chain.

## Decision

[`packages/guard/doom-loop-guard`](../../../../packages/guard/doom-loop-guard/README.md) observes `tools/post-execute` and injects advisory reminders through the post-execute decision's `additionalContexts` (the repeat-tool-guard delivery shape: plugin-source `notice`, no new session event, model-visible ⟺ logged). Three detectors, scoped to shapes repeat-tool-guard does not cover:

- **Oscillation** — the last `2 × oscillationPairs` calls form exactly two tools alternating with identical per-tool canonical identity, and at least one call failed. A pure successful alternation stays quiet (a legitimate search-then-act rhythm).
- **Edit spiral** — consecutive `isError` calls of `str_replace_editor`/`edit` on the same path; a successful edit clears the marker.
- **Test churn** — consecutive runs of the same test command (`run_tests`, or `bash` containing `test`) whose normalized output hash is unchanged and failing. Hash normalization strips elapsed-time markers so identical failing runs hash identically.

Each detector dedupes per pattern until it breaks; a per-turn `reminderBudget` caps reminder volume while observation continues; per-agent state is a `WeakMap` reset on a user `agent/pre-step` message. Built-in `exclude` covers read-only discovery tools. All thresholds validate fail-loud at plugin load (integers >= 2, preview/budget >= 1). Wired into `dsh-base` beside repeat-tool-guard.

## Alternatives considered

**Port opencode-tui's `behavior-mirror` + `strategy-shift` modules wholesale.** Rejected: both are coupled to opencode-tui's trajectory store and CVM advisory bus; omts's post-execute window plus three pure detectors covers the same loop shapes with a fraction of the machinery, and repeat-tool-guard already owns the identical-call shape.

**Inject through `agent/pre-step` instead of post-execute additionalContexts.** Rejected: the post-execute fold is the proven repeat-tool-guard delivery path — the reminder rides the decision that observed the loop, arrives in the very next request, and a blocked call still gets the nudge.

**Make the detectors veto (`block`) past a threshold.** Rejected: blocking is a policy escalation evidence-gate/agent-router own; an advisory guard that silently changes into an enforcing one would violate its own contract.

**Fold the three detectors into repeat-tool-guard.** Rejected: identical-repeat detection and loop-pattern detection reset on different events (call identity vs pattern break), and separate packages keep each config surface honest.

## Consequences

- Loop shapes beyond identical repetition now draw reminders: alternating pairs, failing same-file edit spirals, and unchanged failing test runs.
- False-positive surface is bounded by the failure requirement on oscillation and by the built-in read-only exclude list; legitimate polling still draws nudges past thresholds (the pressure valves are config).
- Test-churn hashing is text-level: normalization strips only elapsed-time markers, so timestamp-jittering output may evade the detector.
- The guard family grows from reminders-only plus this advisory tier; `packages/guard/README.md` now lists both advisory guards.

## Testing

- `packages/guard/doom-loop-guard/tests/doom-loop-guard.spec.ts` — assembled agent loop against a scripted mock adapter: oscillation fires with a failing call and stays quiet all-success, edit spiral fires at three failed same-path edits, test churn fires at three identical failing runs, budget cap plus user-message reset, exclude transparency, and fail-loud config.

## Related

- [opencode-tui vs omts — capability gap and absorption roadmap](../../../../docs/opencode-tui-vs-omts-能力差距与吸收路线.md) — the analysis this implements.
- [repeat-tool-guard README](../../../../packages/guard/repeat-tool-guard/README.md) — the identical-call chain this guard deliberately does not duplicate.
- [tool-JSON-in-content repair plugin](2026-08-19-tool-json-repair.md) and [run_tests tools](2026-08-19-run-tests-tools.md) — the sibling absorptions in the same tier.
