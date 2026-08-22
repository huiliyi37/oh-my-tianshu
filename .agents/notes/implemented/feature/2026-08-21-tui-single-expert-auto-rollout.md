# Agent Note: Single-Expert Auto Rollout — Shadow Ledger, Shared Budget, Bounded Findings

Status: implemented

English | [中文](2026-08-21-tui-single-expert-auto-rollout.zh.md)

## Problem

The agent-router's shadow mode recorded only delegate decisions — the qualified-turn denominator was unreconstructable, so no promotion case could ever be made from logs. Promotion gates fabricated a reward `margin` with zero real dispatches. Dispatch had no budget enforcement (the seam's budget was record-only), no single-flight lock, and a never-firing `new AbortController().signal` as its cancel channel. Children answered in free-form text, so parent-visible findings were unbounded and unverifiable against the log.

## Decision

Five surfaces, all behind validated config:

1. **Full decision ledger** (`router/decision`) — every non-zen qualified turn-end records a discriminated `self | delegate` payload carrying a branded opaque `decisionId` and the full `RouterMetrics` snapshot. A fixed observation window (`evaluation.windowToolResults`, post-decision parent tool results that do not cross a later decision — attribution boundary, no double-counted results) closes into one `router/evaluation` per decision — `recovered | persisted | inconclusive`, thresholds from `evaluation.*` config; the projection collects all existing evaluation pairings before opening windows, so a later decision cannot re-enqueue an already evaluated one. At `agent/disposed`, the router aborts and awaits that session's admitted triggers before closing its final open window. Each evaluation is followed by a `router/gate`: shadow readiness requires `readiness.minSamples` and at least one evaluated delegate, while canary health requires both actual and evaluated dispatches to reach `canary.minDispatches` before declaration coverage, budget share, and benefit are considered. Gates record verdicts and veto reasons; mode switches stay human.
2. **Seam-enforced run budgets** — `SubagentStartRequest.runBudget { maxSteps, timeoutMs }` + `SubagentCapabilities.runBudget`; providers that cannot honor it declare `false` and the service rejects budgeted starts (`UNSUPPORTED_CAPABILITY`). The Service Definition rejects non-positive, unsafe, or timer-clamping values before provider startup. The in-process driver enforces steps via a child-scoped `agent/pre-step` counter and wall clock via a composed signal; either bound classifies an otherwise aborted/missing terminal as `budget-exhausted`, while a durable non-aborted child terminal such as `blocked` remains authoritative. Agent-router auto always supplies the budget; tool-subagent and next-workflow expose optional deployment config and fail at provider capability preflight when it is set.
3. **Canary dispatch gate** — `trigger.mode: 'auto'` with dispatch enabled requires explicit non-empty `provider`/`model` and `auto.{maxConcurrent, maxTotal, cooldownTurns, maxSteps, timeoutMs}` at assembly. Admission reserves cap/cooldown capacity before provider startup. Accepted auto routes carry the decision identity; quota recovery projects the union of routes and decisions, so a crash between acceptance and decision append cannot reset capacity. Only live controllers and pre-route reservations remain process-local. Plugin disposal stops admission, aborts active controllers, awaits active triggers, and then releases effect-scoped tool and prompt registrations.
4. **Bounded structured findings** — dispatch requests a closed discriminant `outputSchema` (`FINDING_SCHEMA_BY_PROFILE`: scout findings; verify findings + `supported | unsupported | inconclusive`). A completed capture passes `boundFinding` once at the parent boundary — control chars folded, single line, hard caps (`FINDING_*_MAX`) — and persists verbatim on `router/outcome.finding`. Errors, cancellations, budget terminals, and malformed captures never fabricate one. Synthesis enters the prompt as a single-pass variable value, so persisted literal `{{...}}` text is not interpreted as another prompt reference; the row-suffix phrase stays the cli-mock adopt-marker contract anchor.
5. **Read-only roles** — agent-definitions ships a built-in `verify` role beside `explore`; dispatch resolves `code_scout → explore`, `verifier → verify` by cwd when the definitions service is present and intersects the role tool set with the `profileTools` ceiling. Persona comes from the role, but the router itself always sets `sandboxMode: 'read-only'`, and the in-process seam pairs that request-owned ceiling with approval policy `never`, so absent or weaker role metadata cannot widen either profile. Unknown roles or empty intersections fail loud.

## Scope guards

- TUI remains `mode: shadow` (`cordis.patch.yml` untouched). The plan's promotion gate needs ≥30 real shadow decisions collected from real sessions; none exist yet, so Phase 5 (auto canary) intentionally did not ship.
- Web, production headless, and ACP stay unmounted; examples/headless-agent carries the auto-path proof (`DSH_ROUTER_AUTO=1` e2e: exactly one route/outcome/dispatched decision, sanitized verify finding).

## Consequences

- Any session log now reconstructs the qualified-turn denominator, self/delegate ratio, metric inputs, evaluations, and veto reasons — the shadow-readiness evidence a human reviewer needs.
- Budget overrun is distinguishable from parent cancellation; consecutive turn-ends cannot double-dispatch; scout/verify children cannot write the workspace.
- Verification spans focused agent-router and subagent budget suites, the keyless auto e2e, and the agent-router-synthesis golden; command inventory remains in repository scripts rather than this decision record.

## Alternatives considered

- **Keeping margin in the readiness gate** — rejected: fabricating a benefit number without real dispatches is exactly the false confidence the gate exists to prevent.
- **Plugin-default canary caps** — rejected: "safe defaults" invite shipping auto without a deliberate assembly decision; requiring them fails loud instead.
- **Schema-level length bounds** — impossible in the seam's schema subset; enforced at the parent boundary instead, where truncation is also the persistence precondition.
