# Agent Note: Web rewind — session.rewind over the proxy and the trajectory control (P2④ stage 2)

Status: implemented

English | [中文](2026-08-27-web-rewind.zh.md)

Scope: `packages/host/apiproxy` (`api/sessions.ts`, `api/sessions.schema.ts`, `api/rpc.ts`, `api/rpc-map.ts`, `api/index.ts`, `fetch/handler.ts`, `fetch/client.ts`, `api-proxy.ts`), `packages/bundle/web-app/cordis.patch.yml`, `packages/client/connection` (fixture), `packages/client/ui-trajectory` (`RewindControl.tsx` + css new, `index.ts`, `TrajectoryToolbar.tsx`, `TrajectoryView.tsx`)

## Problem

The TUI's `/rewind` (two-phase checkpoint → convo/code/both rollback) had no Web counterpart: the client runtime already recognized `rewind` context origins and the trajectory view rendered rewind-delimited branches, but nothing could *initiate* one — no host API, no UI.

## Decision

The Web mirror lands as one unary plus one toolbar control, reusing the TUI's host primitives verbatim.

**Protocol.** `session.rewind` unary: `{ sessionId, atSeq, mode: 'convo' | 'code' | 'both' }` → `{ filesChanged, filesSkipped?, truncatedTo? }`. New closed-union error code `rewind-file-history-unavailable` (fs-snapshot not assembled). The map row propagates through the compiler-locked route table, the client value-schema table, `IApiClient`, and the fixture/test fakes — the seam's three roles stay complete.

**Host.** The proxy implementation mirrors `TuiApp.executeRewind`: `convo` truncates persisted-first-then-in-memory (the TUI's desync-proof ordering), `code` collects post-boundary write-tool callIds (`write`/`edit`/`str_replace_editor` — the same predicate fs-snapshot snapshots) and restores through `fsSnapshot.histories`' `rewindToBoundary`, `both` does both. Subagent-owned sessions reject like `session.cancel`; unattached sessions answer `session-not-found`. `filesSkipped` is reported explicitly (0 when the session has no snapshot record).

**Bundle.** The web host composition mounts `dsh-fs-snapshot` (the same host row the TUI composition carries) so code/both works in shipped Web deployments; the e2e scaffold picks the row up through the shared base/web patch stack.

**UI.** `RewindControl` rides the trajectory toolbar's new `trailing` slot: pick a user-message checkpoint (derived from the view's event nodes, snippet-folded), choose the scope (defaults to `both`), execute through the plugin-injected `rewind` face (the inject closure owns the connection handle, the same `ctx.get('connection')` pattern the runtime entry uses), and read restore counts or the host's error text. One-shot busy latch covers the execute button.

## Alternatives considered

### Why a unary and not a slash command?

Rewind carries a payload (checkpoint seq, scope) and a structured result the client must render; commands are admission-only (`command/run` outcomes ride logged events). The unary keeps the request/response correlation and the closed error vocabulary.

### Why derive checkpoints from the view's nodes instead of a host list method?

The client already holds the session events (the trajectory view renders them); a host-side checkpoint listing would re-serve data the client has, and the boundary semantics (user/message seq) are already the runtime's vocabulary. A future persistence-only checkpoint list (cold sessions) can add a method without changing this control.

### Why put the control on the trajectory tab rather than the conversation view?

The trajectory view is where rewind's consequences are already visible (branch boundaries), and the toolbar is its existing chrome; the conversation view keeps composer-centric controls.

## Consequences

Bought: the Web can roll back a live session end to end — truncation, file restore, or both — with the same audit and restore semantics as the TUI.

Cost: one more session-domain unary widens every compiler-locked table (route/schema/client/fakes — enforced by the map key); the web host composition now snapshots every write-tool execution (memory bounded per session, mirrors the TUI host); rewind remains live-session-only (cold sessions answer `session-not-found`), matching the TUI's active-session contract.

## Verification

Focused suites: `api-proxy-rewind.spec.ts` (convo order/persistence-first, code restores exactly the post-boundary write calls, both, ghost session, missing fs-snapshot, empty restore), `RewindControl.spec.tsx` (selection, scope, execution args, result/error text, busy latch, empty state), plus the existing trajectory/connection/runtime suites. The web e2e lane is the CI surface for the assembled composition (browser boot is unavailable in the local sandbox).
