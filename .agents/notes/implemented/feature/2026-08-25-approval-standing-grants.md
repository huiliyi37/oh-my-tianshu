# Agent Note: Standing approval grants — allowed-always end to end

Status: implemented

English | [中文](2026-08-25-approval-standing-grants.zh.md)

Scope: `packages/interaction/user-approval` (outcome union), `packages/interaction/approval-rules` (mapping + facet), `packages/core/tools`, `packages/sandbox/sandbox`, `packages/host/apiproxy` (consumers), `packages/tui/tui` (card/controller/app), `examples/tui` (smoke scenario)

## Problem

The approval seam granted exactly one-shot decisions: every allow was `allowed-once`, so the audit trail could not distinguish "the user allowed this once" from "a standing grant allowed this" — and the TUI card had no path to *create* a standing grant: `a` set a session-local always-flag (invisible in the audit vocabulary), and a persistent allow rule could only be written by hand via `/permissions add`.

## Design

`ApprovalOutcome` gains `allowed-always`: a grant for the current call whose provenance is a standing grant. It authorizes identically to `allowed-once` at every consumer (tools registry pre-execute, sandbox escalation) — the split is audit semantics (`approval/decided`), not per-call permission width. The capability seam moved complete across all roles: Service Definition (user-approval union + OUTCOMES + invariant), providers (approval-rules answerer, TUI controller), and consumers (tools, escalation, apiproxy `approval/resolved` wire union). The ACP and remote-decide unions stay narrow (they answer once/reject only); a rule-settled request never reaches them.

approval-rules now maps an allow-rule hit to `allowed-always` (a matching rule is a standing grant by construction — the same rule settles every future matching request), and exposes a same-process facet `approvalRules.persistAllow`: `persistAllowRule(req)` derives the exact-match rule (request tool + normalized argument string as the full-string pattern), appends it to the project layer, and returns the layer-stamped rule. Requests without resolvable call arguments fail loud — an unrestricted wildcard is not something a single keypress should grant; `/permissions add` remains the deliberate path for tool-wide rules.

The TUI card adds `[p] 永久允许`: persist first, then settle `allowed-always` only on success (a failed write leaves the card pending for y/n/a). `a` re-labeled 本会话总是允许 and now settles `allowed-always` too, matching what actually happened; the controller's always-approve short-circuit likewise returns `allowed-always`. The hint row wraps at segment boundaries on narrow rails (`wrapApprovalHintRows`) so `[esc] 取消` is never truncated. The apiproxy decide API and client slot unions intentionally remain `allowed-once`/`rejected`: they are human-answer channels, and a standing grant is not a human's one-shot answer.

## Proof

Unit: approval-rules answerer mapping + facet (derive/append/short-circuit-next-identical), user-approval passthrough + audit, tools/escalation consumers, TUI card wrap/controller value, app p-key (facet present → persist+settle; absent → warn and card stays pending for y). Assembled: the interactive smoke's third PTY scenario drives card → `p` → tool runs → `/permissions` lists the persisted rule → the identical second call completes with no card and exits 0 — the standing-grant loop proven through the real Loader composition.

## Non-goals

Revocation UX, rule edit from the card, and widening `p`'s pattern beyond exact match (glob authoring stays with `/permissions add`) are deferred; the remote/Web decide surface keeps its narrow union until it grows an always-allow affordance of its own.
