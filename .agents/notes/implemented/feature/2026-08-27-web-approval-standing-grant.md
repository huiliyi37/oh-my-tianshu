# Agent Note: Web approval standing grant — the [a] affordance the narrow union was waiting for

Status: implemented

English | [中文](2026-08-27-web-approval-standing-grant.zh.md)

Scope: `packages/host/apiproxy` (`api/approvals.ts`, `api/approvals.schema.ts`, `api-proxy.ts`), `packages/client/ui-conversation` (`contract/slots.ts`, `skeleton/ApprovalPanel.tsx`, `locales.ts`), `apps/web/tests/approval-composer.e2e.ts` + snapshot golden

## Problem

The web approval panel (composer takeover, `ApprovalPanel`) could answer `allowed-once` or `rejected` only — the exact narrow union [standing grants](2026-08-25-approval-standing-grants.md) left on the remote/Web channel "until it grows an always-allow affordance of its own". P2④ (Web UI parity) is that moment: the TUI card's `[a] 本会话总是允许` had no Web counterpart, so a Web user facing repeated escalations had to click Allow every time.

## Decision

The Web grows the affordance on the answer channel, mirroring the TUI controller's always-approve flag at the protocol bridge:

**Protocol.** `ApprovalResponsePayload.outcome` and its zod schema gain `'allowed-always'` (the client-answerable union is now `allowed-once | allowed-always | rejected`; cancelled/unavailable stay host-side). The host `ApprovalOutcome` union already carried the value since P1 — no service-side change.

**Standing grant lives in the api-proxy bridge, not in user-approval.** A `Set<SessionId>` beside the pending registry: `respond()` records the session when an answer carries `allowed-always`, and the approval answerer short-circuits a recorded session *before* any pending entry or `approval/requested` frame exists. Per-request audit is preserved — every short-circuited ask still logs its own `approval/asked` + `approval/decided` pair with `allowed-always` (audit semantics, not permission width; identical to the TUI controller's short-circuit). The grant is session-scoped and dies with the proxy; a different session still asks normally.

**Panel.** `PendingApproval.answer` accepts the extended union; the action row gains a third button — Reject · **Always allow this session** · Allow once — under the same one-shot latch (all three disable on click; failure re-arms). Locales add `approval.allowAlways` (en/zh).

## Alternatives considered

### Why not put the standing grant inside the user-approval service?

The TUI precedent keeps the flag in the controller (an answerer provider), not the service — the service stays a pure ask/audit seam and every consumer reuses it unchanged. The api-proxy bridge is the Web's controller equivalent: it already owns the pending registry and the answerer link, so the flag lands where the interactive channel lives without widening the service surface.

### Why extend the wire union instead of a separate unary method?

The answer already rides the echoed-rpcId client-response; a third outcome value is the smallest protocol delta and keeps the one-shot latch, receipt semantics, and the resolved-frame broadcast untouched. A separate "grant" method would need its own correlation, teardown, and replay story for no behavioral gain.

### Why not add [p] persistent rules and /permissions to the Web in the same change?

`approval-rules` persistence and a rule-listing command surface are host API territory (new unary methods + web command registration) — a separate seam, not an answer-channel extension. P2④ stage 1 keeps the standing grant; persistent rules stay the TUI's `/permissions` surface until the Web grows its own.

## Consequences

Bought: Web users settle a session's repeated escalations once — parity with the TUI card's `[a]` — with the grant audited as `allowed-always` per request.

Cost: the wire union widened (old clients that never send the value are unaffected; a host that receives it must support the union — host support landed in P1). The standing-grant set is proxy-lifetime (stale session ids are impossible to misfire on and bounded by sessions created), so no cross-restart persistence — deliberately session-scoped, like the TUI flag.

## Verification

Focused suites: `api-proxy-approval.spec.ts` (new P2④ case: allowed-always settles with the grant's outcome and a resolved broadcast; the next ask in the session resolves without a new requested frame; a different session still asks), `rpc-schemas.spec.ts` (schema accepts allowed-always, still rejects cancelled), `ui-conversation` tests (429 pass). Web e2e `approval-composer.e2e.ts` asserts three action buttons and its golden lists "Always allow this session" (replay lane runs in CI; the browser lane does not boot in the local sandbox).
