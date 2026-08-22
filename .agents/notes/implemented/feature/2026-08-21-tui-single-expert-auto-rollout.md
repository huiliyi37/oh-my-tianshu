# Agent Note: Single-Expert Auto Rollout — Shadow Ledger, Shared Budget, Bounded Findings

Status: implemented

English | [中文](2026-08-21-tui-single-expert-auto-rollout.zh.md)

## Problem

The agent-router's shadow mode recorded only delegate decisions — the qualified-turn denominator was unreconstructable, so no promotion case could ever be made from logs. Promotion gates fabricated a reward `margin` with zero real dispatches. Dispatch had no budget enforcement (the seam's budget was record-only), no single-flight lock, and a never-firing `new AbortController().signal` as its cancel channel. Children answered in free-form text, so parent-visible findings were unbounded and unverifiable against the log.

## Decision

Five surfaces, all behind validated config:

1. **Full decision ledger** (`router/decision`) — every non-zen qualified turn-end records a discriminated `self | delegate` payload carrying a branded `decisionId` (`rtdec-<seq>`, seq predicted at append) and the full `RouterMetrics` snapshot. A fixed observation window (`evaluation.windowToolResults`, post-decision parent tool results) closes into one `router/evaluation` per decision — `recovered | persisted | inconclusive`, thresholds from `evaluation.*` config. Each evaluation is followed by a `router/gate` record: `resolveShadowReadinessGate` (samples / false-green / scope health over `readiness.*`) in shadow, plus `resolveCanaryHealthGate` (real dispatches, adopt/reject coverage, budget-exhausted share, benefit proxy over `canary.*`) under auto. Gates only record verdicts and veto reasons; mode switches stay human, via config.
2. **Seam-enforced run budgets** — `SubagentStartRequest.runBudget { maxSteps, timeoutMs }` + `SubagentCapabilities.runBudget`; providers that cannot honor it declare `false` and the service rejects budgeted starts (`UNSUPPORTED_CAPABILITY`). The in-process driver enforces steps via a child-scoped `agent/pre-step` counter and wall clock via a composed signal; both settle `budget-exhausted` — distinct from a parent's `aborted`.
3. **Canary dispatch gate** — `trigger.mode: 'auto'` requires explicit `auto.{maxConcurrent, maxTotal, cooldownTurns, maxSteps, timeoutMs}` at assembly (fail loud at apply: caps are assembly values, never plugin defaults). Per-session state enforces single-flight, total cap, and qualified-turn cooldown; parent dispose aborts in-flight controllers.
4. **Bounded structured findings** — dispatch requests a closed discriminant `outputSchema` (`FINDING_SCHEMA_BY_PROFILE`: scout findings; verify findings + `supported | unsupported | inconclusive`). A completed capture passes `boundFinding` once at the parent boundary — control chars folded, single line, hard caps (`FINDING_*_MAX`) — and persists verbatim on `router/outcome.finding`. Errors, cancellations, budget terminals, and malformed captures never fabricate one. `renderSynthesisSection` quotes persisted values literally; the row-suffix phrase stays the cli-mock adopt-marker contract anchor.
5. **Read-only roles** — agent-definitions ships a built-in `verify` role beside `explore`; dispatch resolves `code_scout → explore`, `verifier → verify` by cwd when the definitions service is present, intersects the role tool set with the `profileTools` ceiling, and transfers persona + `read-only` sandbox. Unknown roles or empty intersections fail loud.

## Scope guards

- TUI remains `mode: shadow` (`cordis.patch.yml` untouched). The plan's promotion gate needs ≥30 real shadow decisions collected from real sessions; none exist yet, so Phase 5 (auto canary) intentionally did not ship.
- Web, production headless, and ACP stay unmounted; examples/headless-agent carries the auto-path proof (`DSH_ROUTER_AUTO=1` e2e: exactly one route/outcome/dispatched decision, sanitized verify finding).

## Consequences

- Any session log now reconstructs the qualified-turn denominator, self/delegate ratio, metric inputs, evaluations, and veto reasons — the shadow-readiness evidence a human reviewer needs.
- Budget overrun is distinguishable from parent cancellation; consecutive turn-ends cannot double-dispatch; scout/verify children cannot write the workspace.
- Verification: agent-router unit/integration (133), subagent family incl. new run-budget spec (729+), keyless auto e2e, refreshed agent-router-synthesis golden.

## Alternatives considered

- **Keeping margin in the readiness gate** — rejected: fabricating a benefit number without real dispatches is exactly the false confidence the gate exists to prevent.
- **Plugin-default canary caps** — rejected: "safe defaults" invite shipping auto without a deliberate assembly decision; requiring them fails loud instead.
- **Schema-level length bounds** — impossible in the seam's schema subset; enforced at the parent boundary instead, where truncation is also the persistence precondition.
