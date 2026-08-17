# Agent Note: Task card — first-message semantic enhancement

Status: implemented

English | [中文](2026-08-18-task-card-first-message.zh.md)

## Problem

A fresh session's first user message is often short and unstructured ("帮我重构 xxx"), which degrades model semantics on the first turn: the goal is under-specified, constraints and acceptance are absent, and the model must either ask or guess. The zen phase's triage heuristics skip trivially short messages (≤80 chars, single-line, text-only) before the first request — so a short first message never even reaches the anchored face. Asking users to write longer, structured prompts is model-side discipline: unenforceable, invisible to the host when ignored.

## Decision

The task card is a built-in lifecycle enhancement owned by `packages/guard/task-card` (`@huiliyi37/dsh-task-card`, ctx key `taskCard`): the session's first user message is rewritten into a structured card — `# title`, `## 目标`, optional `## 约束` / `## 验收`, and the verbatim original under `—— 原始请求 ——` — before it reaches the model.

- **Rewrite seam: `agent/pre-step` waterfall.** It is the only seam whose return value is honored (`packages/core/agent-loop/src/agent.ts:206-214`), and agent-loop appends the rewritten `decision.messages` to the session log (`agent.ts:288-291`) — so `model-visible ⟺ logged` closes for free, with no extra event surface. The zen phase's timeout narration is the same pattern.
- **Generation ladder, never blocks the first step.** LLM (one bounded call, explicit route — the first message has no assistant message to derive a route from, so `mode: 'llm'` requires a provider/model pair, fail loud at load; short deadline default 5000 ms; zero retries) → semantic template (pure function, always succeeds: first-line title capped at 40 chars + the whole original as the goal) → untouched (messages that fail the trigger conditions pass through).
- **Trigger conditions (all must hold).** First message is a user message; top-level session (`header.parentSession` unset — subagent dispatch prompts are already anchored); text non-empty, no card marker yet, not over `maxInputChars`; the log holds no `user/message` yet (first-message-only — resume/fork never re-rewrite).
- **Verbatim original is a hard requirement.** The log holds only the rewritten message, so the `—— 原始请求 ——` section is what keeps the user's exact input reconstructable. The LLM contract forbids inventing constraints/acceptance the message does not support; `parseLlmCard` validates the shape at the model boundary (missing title/goal → template fallback).
- **Orthogonal to zen.** Triage decides at `agent/inbox/inserted` (before pre-step), the rewrite at `agent/pre-step` — they neither depend on nor disturb each other. A rewritten card is multi-line and long, so a carded first message is never triaged as trivial; but the rewrite does not *require* zen and zen does not *require* the card.
- **Fail loud on misconfiguration.** `resolveConfig` throws at plugin load on unknown keys, a bad mode, non-positive budgets, or `mode: 'llm'` without a provider/model pair.
- **Invariants.** `@huiliyi37/dsh-task-card/invariant` validates the owned relationship from the authoritative session log: a carded message keeps a non-empty verbatim original, keeps `source.kind === 'user'` (it is an enhancement of the user message, not a plugin insertion), and is the first user message of its session (which also makes a second carded message impossible).

## Alternatives considered

- **`inbox.replace` rewrite (zen-phase entry linkage).** A listener on `agent/inbox/inserted` (registered before zen) would rewrite asynchronously and `replace` the pending message, re-publishing inserted so zen's triage sees the carded text and short messages enter the zen phase. Rejected for the MVP: the driver can claim the message during the async generation (`replace` then returns false — `packages/core/agent/src/inbox.ts:127-135`), and the effect depends on listener registration order (fragile, would need bundle-order tests to lock). Recorded as a follow-up enhancement, not the shipped path.
- **TUI confirmation panel.** Generate the card in the client, let the user confirm before sending. Rejected: TUI-only (headless clients get nothing), the TUI layer should not call the LLM (architecture layering), and it changes the interaction flow with an extra step.
- **Prompt-only guidance.** Ask the model to restructure its own input — model-side discipline, unenforceable and host-invisible; the zen ablation already showed guidance alone cannot rescue a bad surface.

## Consequences

- Every fresh top-level session's first request carries a structured card instead of raw input; the model sees title/goal/constraints/acceptance plus the verbatim original.
- One extra bounded LLM call per new session in `mode: 'llm'` (default), zero in `mode: 'template'`; a failed call falls back to the template — never blocks the first step, never throws to the loop.
- No new durable events: the rewrite reuses `user/message`; consumers (transcript, resume/fork, session-title) need no changes.
- The TUI bundle ships the plugin in `mode: 'template'` by default (no bundle-level provider default exists; deployments opt into `llm` with their own provider/model).

## Testing

- `tests/generate.spec.ts` — parser contract (complete/partial/missing sections, noise), template derivation, rendering with verbatim original, idempotence marker (11 tests).
- `tests/task-card.spec.ts` — full-loop scripted-model integration: rewrite lands in the model request AND the log; second message untouched; over-long untouched; `enabled: false`; resume seed never re-rewritten; subagent never rewritten; llm mode consumes the card call then the main call; contract miss falls back to the template; missing provider/model fails loud at load (9 tests).
- `tests/invariant.spec.ts` — carded message invariants on live appends and late registration (8 tests).
- 28 tests total, green on macOS; zen suite (61 tests) re-run with no regression.

## Related

- [Zen phase engineering paradigm](2026-08-17-zen-phase-engineering-paradigm.md) — the anchored-face phase the task card composes with.
- [memory-consolidate extract-llm](../feature/2026-08-18-memory-consolidate.md) — the bounded-call + fallback + contract-parse pattern this package's llm path mirrors.
