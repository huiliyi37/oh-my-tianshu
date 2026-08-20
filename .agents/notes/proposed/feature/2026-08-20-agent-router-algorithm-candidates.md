# Agent Note: agent-router 后续算法优化候选

Status: proposed

English | [中文](2026-08-20-agent-router-algorithm-candidates.zh.md)

## Problem

The closed loop is landed through Phase 4 (trigger → decision → seam dispatch → outcome → synthesis → adoption), all in shadow or record-only mode. Several algorithm refinements surveyed from the Tianshu codebase (`opencode-tui`, point-in-time references) are feasible later but deliberately not shipped now — each needs the shadow evidence the closed loop now produces before it is worth its machinery. This note is the register: candidates, their evidence gates, and the rejected-with-rationale list so a later session does not rediscover them.

## Proposal

Candidates (promote to implemented only when the evidence gate is met; each lands with its own Agent Note):

1. **auto-mode trigger switch.** Gate: shadow `router/decision` records over real TUI sessions show delegate decisions with no false positives for a sustained period. The switch is a one-line TUI config (`trigger.mode: 'auto'`) plus `provider`/`model`; product owns the call.
2. **Per-session shadow tally wiring for `resolvePromotionGate`.** The pure veto ladder (`promotion.ts`) exists; the tally (samples/falseGreenRate/scopeHealth/margin per session) is not yet accumulated or logged. Gate: a consumer needs the gate verdict.
3. **Budget enforcement (Phase 3 option b).** `router/route` carries `budget { maxTurns, deadlineMs }` (record-only). Enforcement needs a subagent-seam run-level budget capability (turn cap + deadline signal) — a separate seam project; history self-tuning (`historyBudgetFloor` from Tianshu `budget-shape.ts`) derives samples from the session log (subagent tool counts/durations), never a sidecar store.
4. **Failure-class severity weights.** Tianshu `vigor.ts:45-69` maps failure classes (semantic vs environmental vs expected-RED) to penalty weights; a DSH-native version would weight the prediction window per failure class. Gate: real error-rate data shows the flat window misfires.
5. **Model-tier escalation (flash → strong with hard floor).** Tianshu `model-tier-policy.ts:59-71` escalates the worker's model tier on repeated failures, capped by `escalationCap` with `hardFloor`. DSH's escalate currently changes the *profile* (verifier), not the model tier. Gate: verifier-dispatch adoption records show the profile change alone is insufficient.
6. **Verify-then-route rule.** The `verificationGap` signal (file mutation without fresh verification) could become a routing rule: gap + gate-level error rate → dispatch verifier. Gate: synthesis-section gap flags correlate with real defects.
7. **Adoption-driven profile tuning.** `router/adoption` verdicts are a per-profile success signal; a shadow-only promotion could bias profile choice (never a learnable gate — the deterministic rule table stays). Gate: enough adoption records to beat the veto ladder (`MIN_SAMPLES`, `MIN_MARGIN`).

Rejected (do not re-propose without new evidence):

- **LinUCB effort bandit / cross-session DB learning** (`opencode-tui/src/agent/linucb-bandit.ts`, `model-tier-gate.ts` historical-state builder): violates per-session isolation and "shadow before adaptivity"; needs 30+ pulls before it can matter.
- **vigor/sensorium/cognitive-season/EFE** (`opencode-tui/src/agent/vigor.ts` etc.): heavy CMV state, strategy modulation not routing.
- **Multi-seat council fan-out, quorum/veto/pillars, weighted text merge, autoExecute** (`council-convene.ts`, `aggregation.ts`): the main agent owns synthesis; voting-as-MoE is rejected.
- **Star-domain role table / registry / `.rivet` cards** (`star-domain-registry.ts`): product-flavor persona state; only the keyword matcher's hit/tie/no-match audit shape was borrowed.

## Alternatives considered

- **Ship the candidates now.** Rejected: each candidate's evidence gate exists because the closed loop just started producing shadow records — spending dispatch budget on unproven refinements before the loop's baseline is measured would invalidate the very evidence the refinements need.
- **Fold the register into the implemented port note.** Rejected: the port note records shipped reality; candidate futures there would mix spec-speak into an implemented record. A proposed note keeps the register rejectable independently.

## Acceptance criteria

- Every candidate above stays out of the shipped surface until its evidence gate is met and its own Agent Note lands.
- Any promotion keeps the deterministic rule table intact — adaptivity is always shadow-first and never a learnable gate.
- The register is the single home for candidate and rejection rationale; new candidates or reversals update this note (bilingual pair re-recorded).

## Risks

- Shipping any candidate before its evidence gate burns real-dispatch budget on unproven rules (the escalate hysteresis already guards the worst case; the gate ladder is the second line).
- The register can rot into an idea graveyard; the evidence gates keep each entry falsifiable — a candidate whose gate can never be met should be moved to rejected instead of lingering.
