# Agent Note: zen_anchor 阶段后调用改为空操作成功，并让禅阶段指引列出可用工具面

Status: implemented

English | [中文](2026-08-20-zen-anchor-noop-and-callable-face.zh.md)

## Problem

Two zen-phase failure modes surfaced from a real session transcript in which the model, on the anchored face, called `zen_anchor`, `bash`, `glob`, and `grep` and received a chain of confusing errors:

1. **Anchor-on-the-final-budget-step contradiction.** The step-budget promotion fires on the budget's final step (the `agent/pre-step` listener runs before that step's request), so a model that probes for three steps and anchors on the fourth — the natural pacing — calls `zen_anchor` with the phase already logged `'full'`. The tool threw "zen_anchor is only available during the zen phase; the full toolset is already unlocked", which contradicts everything the model sees: a still-zen `request/header` face, the `zen:policy` section, and a narration saying the unlock lands on the *next* step. The model flails instead of proceeding.
2. **The guidance never names the callable set.** The `zen:policy` section said "the toolset is reduced" without enumerating it, and the guard's denial said "probe a landmark with the reduced toolset" without naming anything. A model with strong tool priors (glob/grep/read) reaches for tools the face removed, gets locked, and has no actionable alternative.

## Decision

- `zen_anchor` becomes idempotent across the phase boundary: when the folded phase is already `'full'` (anchor, step-budget timeout, or triage), the call resolves as a benign success (`{ unlocked: true }`) instead of an error — mirroring `/plan off`'s idempotent wording, so the model proceeds instead of reading back a contradiction. The evidence gate and argument validation still apply while the phase is genuinely zen.
- The `zen:policy` section appends a `Zen-phase callable tools:` line naming the exact per-agent face plus `zen_anchor` — derived from the same install map the guard uses — so the model never has to guess what is callable.
- The guard's denial message names the callable set (`Callable now: …`) so a locked-tool error carries the actionable alternative.

## Alternatives considered

**Shift the step-budget promotion one step later so the final budget step stays fully zen.** Rejected: that changes the documented budget accounting and the "full face visible from the following assembly" contract, and the no-op anchor covers the failure with one small, stable rule instead.

**Keep the error but reword it.** Rejected: an error result still costs the model a step and reads as a contradiction; the transcript shows the model flailing after the error, not recovering from it.

## Consequences

A model that anchors on the final budget step (or after triage or an earlier anchor) gets a benign success and proceeds; the phase log still records at most one promotion. The zen section and guard messages each grow by one line, reflected in the README token accounting. `zen_anchor` remains registered on the promoted face (stable catalog), and subagent and alignment sessions are unaffected (never armed, or seeded past zen).

## Testing

- `packages/guard/zen/tests/integration.spec.ts` — new cases: the final-budget-step anchor resolves as a no-op success without re-logging a promotion; a post-triage anchor resolves as a success on the full face; the zen section names exactly `probe, zen_anchor`; the non-face denial names the callable face.

## Related

- [zen-phase engineering paradigm](../../architecture/2026-08-17-zen-phase-engineering-paradigm.md) — owns the phase design; this note records the failure-mode fix on top of it.
