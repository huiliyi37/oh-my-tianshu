# Agent Note: On-demand raw-history recall through a read-only reader subagent

Status: implemented

English | [中文](2026-08-18-tool-memory-recall.zh.md)

## Problem

The [intent-gated STM snapshot](2026-08-18-adaptive-memory-stm.md) injects a bounded working set without rewriting the request prefix. `memory_search` finds stored entries. Neither answers "what happened in a prior session" without dumping transcripts into the current request. Returning raw session-query hits to the parent would mix another session's tool traces into this one and leave the token cost unbounded.

## Decision

`@huiliyi37/dsh-tool-memory-recall` registers `memory_deep_recall`. The model passes a self-contained question. The tool starts an in-process reader through `ctx.subagents.start` (`provider` default `spawn`) with a static persona, a fixed `outputSchema`, a read-only `toolFilter` (default `session_search` / `session_event_search` / `session_event_read`), and `maxDepth` 1 so the reader sits at depth 1 and never delegates. Only the budget-clamped distillation `{ answer, evidence: [{ sessionId, eventSeqs, quote }], uncertainties, confidence }` returns as the tool result. Raw transcript bytes never enter the parent session.

Capabilities are probed at execute: a missing `sessionQuery` service, missing reader tools, a missing `subagents` service or named provider, or a provider without `toolFilter` / `outputSchema` / `persona` / `depthLimit` fails loud as a model-visible error. The tool schema and the order-131 guidance section are static strings. Return budgets are Config fields: `maxAnswerChars` 2000, `maxEvidence` 5, `maxQuoteChars` 240. Event seq `0` is kept.

The shipped TUI bundle mounts this plugin after `tool-session-query`. The zen anchored `face` and `FACE_EXTRAS` do not include `memory_deep_recall`; it appears on the full face after promotion. `dsh-base` does not mount it. The plugin does not consume the `memory` key.

## Alternatives considered

**Mount in `dsh-base`, on the zen `face`, or in `FACE_EXTRAS`.** Rejected: base stays the upstream-parity spine; the zen first-face is a measured alt-0 set; extras that fire on "previous session" already append `session_search`. Deep recall pays an extra model call (the reader) and stays off the anchored face.

**Return raw session-query hits to the parent, or search inline in the parent agent.** Rejected: the parent would still see unbounded transcript bytes. Isolation requires a child session and a distillation boundary.

**Fold STM, consolidation, or sqlite embeddings into this change.** Rejected: those stay opt-in consumers or store knobs; this tool only reads session-query.

## Consequences

Shipped TUI sessions can ask about prior transcripts without mixing raw history into the parent prefix. Missing session-query or subagent capabilities surface as tool errors, never silent empty answers. Coverage: `packages/memory/tool-memory-recall/tests/*.spec.ts` (happy path, fail-loud probes, budget clamp, seq 0 kept, reader dispose, HMR unregister, empty invariant companion).
