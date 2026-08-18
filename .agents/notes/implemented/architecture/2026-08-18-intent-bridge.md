# Agent Note: Intent bridge — alignment model before the main session

Status: implemented

English | [中文](2026-08-18-intent-bridge.zh.md)

## Problem

A fresh session's first message is often short and ambiguous ("帮我重构 xxx"). The execution model must both understand the request and execute it — expensive (flash-grade tokens), weak (short messages skip zen's triage and never anchor), and interrupted by the clarification turns the ambiguity forces. task-card (single-shot rewrite) cannot clarify; it structures what is given.

## Decision

The intent bridge (`packages/guard/intent-bridge`, `@huiliyi37/dsh-intent-bridge`, ctx key `intentBridge`) splits the roles: a low-cost ALIGNMENT model (minimax MiniMax-M3, already in pi-ai's catalog) runs a multi-round intent-alignment conversation with the user in a dedicated alignment session; when the intent is clear it calls `finalize_alignment`, and the bridge hands a structured task card (the task-card contract) to a FRESH main session. The main session never inherits the alignment context — only the card — so it is a clean top-level session: task-card stays idempotent (no rewrite), zen's triage does not skip the multi-line card, and the main model anchors in the zen phase before unlocking the full face.

- **Alignment session.** `createAlignedSession()` creates a top-level agent routed to `alignProvider`/`alignModel`, seeded with a completed `zen/phase` pair (`{zen, arm}` → `{full, timeout}`) so zen's resume branch (history present) never arms it (`packages/guard/zen/src/index.ts:441-447`); the bridge registers `finalize_alignment` agent-scoped (agent-scoped tools bypass restrict's allow list — zen's `zen_anchor` is the same pattern) and installs `tools.restrict({ allow: [] })` so no global tool is visible. A `session/title { '意图对齐' }` event titles the tab. The `intent:policy` prompt section renders the alignment contract only while an alignment session is live.
- **Multi-round clarification is ordinary turns.** The alignment model asks (text, no tool call) → turn ends → the user answers via `followup` → next turn. No hang-until-answer machinery.
- **Handoff.** `finalize_alignment` validates at the boundary (`parseFinalizeArgs`: non-empty title/goal, ≤4 constraints/acceptance, malformed calls rejected back to the model), renders the card with the verbatim original under the marker (`renderTaskCard(card, original)` from task-card), creates the main session (routed to `execProvider`/`execModel`), feeds it the card as its first user message, records a log-only `intent-bridge/handoff` on the main session, and emits the `intent-bridge/handoff` dispatch event (TUI listens and `switchSession`s).
- **Failure paths never block the task.** Alignment rounds exhausted (`alignMaxRounds`, default 5) → force-finalize a template card and reject the step; the alignment agent errors → the verbatim original flows to the main session (task-card's single-shot rewrite is the fallback).
- **TUI wiring.** `newSession()` creates the alignment session when the bridge is mounted (unchanged behavior otherwise); the handoff listener auto-switches to the main session. The bundle ships both routes (`minimax/MiniMax-M3` + `deepseek-official/deepseek-v4-flash`).
- **Invariants.** `@huiliyi37/dsh-intent-bridge/invariant` validates from the authoritative session log: at most one handoff record per session with a known reason, and a carded first user message after a handoff keeps a non-empty verbatim original.

## Alternatives considered

- **Model switch inside the main session** — rejected: inherits the full context (violates the requirement), and no route-switching mechanism exists mid-session.
- **`ask_user_question` hang-tool clarification** — rejected: forces structured question tooling + a suspension link, loses conversation context; ordinary turns are simpler and already proven (btw-controller's single-round sample).
- **Prompt-only guidance on the main model** — rejected: model-side discipline, unenforceable; the zen ablation already showed guidance cannot rescue a bad surface.

## Consequences

- Every fresh TUI session starts with a visible alignment tab; the user's clarification happens there, and the main session is created only when the intent is clear.
- The main session is a clean session: first message = task card (verbatim original kept), zen arms, anchoring proceeds.
- One extra alignment model call per new session; cost is bounded by `alignMaxRounds` and short clarification turns.
- `task-card` and `zen` are unchanged (only their contracts are reused).

## Testing

- `tests/align.spec.ts` — alignment contract text + finalize argument validation table (15 tests).
- `tests/intent-bridge.spec.ts` — full-loop scripted-model integration: multi-round alignment → finalize → main session task card → zen arm; rounds exhaustion force-finalizes a template card; malformed finalize rejected with no main session; disabled fails loud; per-call `cwd`/`exec` override honored (5 tests).
- `tests/invariant.spec.ts` — handoff record invariants on live appends and late registration (8 tests).
- Keyless snapshot (`examples/headless-agent/tests/intent-bridge.snapshot.ts`, real Loader + replay adapter with both provider routes): alignment in one round → task card in the main session's persisted log → handoff recorded → zen armed; alignment session seeded full and titled.
- 28 package tests + snapshot green on macOS; zen (61), task-card (28), and TUI app (260) suites re-run without regression.

## Execution record

- `b4af3a63` — core package (align contract, finalize tool, pre-step wiring, invariants, 27 tests).
- `08d0dbcf`/`9f35bf22` — TUI newSession alignment branch + handoff auto-switch + bundle wiring; tsconfig references.
- `c3d50ead` — keyless snapshot; `d8c3f42d` — docs/index sync.
- Follow-up (`意图链后续优化`): `createAlignedSession` accepts caller-owned `cwd` (session lands in the real project directory instead of `_no-cwd/`) and `exec` override (the main session follows the TUI's `/model` selection; config remains the headless default).

## Retrospective (reusable patterns)

- **Seed a completed lifecycle to skip it** — seeding `zen/phase {arm} → {full}` makes zen's resume branch treat the session as already promoted: no zen arm, zero zen changes.
- **Agent-scoped tools bypass `restrict` allow lists** — zen's `zen_anchor` pattern; the alignment agent's single tool needs no face entry.
- **Multi-round clarification is ordinary turns** — ask (text) → turn ends → user answers via `followup`; no hang machinery.
- **Wait with `agent.whenIdle()`, not a status listener** — a listener registered after the agent already idled misses the event and hangs the test; `whenIdle` resolves immediately at quiescence.
- **Bare plugin rows require the resolver manifest** — every `cordis.patch.yml`/snapshot row must be declared in the owning package's dependencies (`verify-cordis-config` enforces; bitten twice).
- **Snapshot faces must reference registered tools** — a zen `face` naming an unregistered tool fails loud at main-session arm, not at config load.
- **Contract constants must be exported from the package entry** — `ORIGINAL_MARKER` lived in `generate.ts` without a re-export; consumers got `undefined` silently.

## Related

- [Zen phase engineering paradigm](2026-08-17-zen-phase-engineering-paradigm.md) — the anchored-face phase the main session enters.
- [Task card first-message](2026-08-18-task-card-first-message.md) — the card contract and single-shot rewrite the bridge reuses.
- [MiniMax-M3 provider support](../../../docs/config-catalog.md) — pi-ai's built-in `minimax` provider (catalog since v0.78.1).
