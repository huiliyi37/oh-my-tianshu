# Agent Note: Web session references and the inline-reference composer

Status: implemented

English | [中文](2026-08-20-web-session-reference-inline-composer.zh.md)

## Problem

The Web composer had a slash/reference trigger pipeline and an occurrence table, but its `@` source was inert subagent-label text and every reference occupied a single `U+FFFC` placeholder. The placeholder broke display fidelity (labels truncated to the chip width), remounts restored an unparseable glyph, and no structured session reference could survive the trip from pick to model. Web needed structured cross-session snapshots in the composer without scanning the Host filesystem in the browser or binding session identity to a display label.

## Decision

A session pick is a structured composer reference. Its visible form is the complete `@label` display text kept in the transparent textarea — a chat-bubble glyph and business-color session title without a capsule — while its clipboard and model form is the canonical `@[label](dsh-session:…)` mention produced by the Host. The aligned backdrop colors the range and swaps its leading marker for the domain glyph, so native text metrics own width, wrapping, selection, and caret placement. The occurrence range retains reference identity (`offset` + `length`) for serialization; Backspace or Delete at its boundary removes it whole, and an edit inside it turns the remaining characters into ordinary text. The input machine keeps ordinary draft text and atomic references until the default sink reports Host acceptance: the draft clears only on a settled success, and a serialization or transport failure returns the same draft to editing (text typed during flight wins). Its session-store mirror persists each occurrence's canonical clipboard projection, so remounting without the occurrence table retains a parseable reference instead of a display-only label. Every sink call carries the attempt's `AbortSignal`, so shell disposal aborts Host-side preparation.

Ordinary `session.prompt` delivery carries the canonical mention unchanged; `ISession.prompt` accepts the attempt signal. The session-reference service parses accepted direct user messages at an outer `agent/pre-step` listener (downstream listeners decide first; only an `enter` decision is processed), captures every source, replaces the canonical mention with readable text while preserving the direct message id, and inserts the frozen snapshot immediately after that message. Queue edits and queue-to-steer relocation need no reference-specific handling because parsing occurs after the final inbox claim. A malformed mention, failed source read, cancellation, or budget failure ends that turn before its messages enter model-visible history.

The chat renders the durable direct-message-then-recall order and associates exact session labels only from the immediately following sourced recall, which preserves multi-word titles and keeps consecutive references independent (`ReferenceLabelProjector` in the Chat snapshot builder; `referenceLabels` on user/steering Chat node data). The recalled-context row uses the same chat glyph while other context keeps the document glyph, and the user bubble shows a compact `引用会话 · …` summary line under it. `MessageItem` decorates recognized mentions as icon-and-text references, treats unquoted `@path` tokens including extensionless basenames as files, leaves sentence punctuation outside the reference range, and keeps snapshot JSON behind the collapsed recall row. The slash menu supports `showGroupTitle: false` (suppress a raw group title through pending and ready states) and candidate `section` rows, and a pick may return `{text, continue: true}` so a directory-shaped splice keeps completion open and re-tracks at the caret.

## Reference transaction

```text
pick session reference → atomic occurrence over inline display text
     → serialize draft → ordinary session.prompt enqueue
     → agent/pre-step parses mentions → capture sources → readable prompt + context
```

Session preparation is all-or-nothing for one accepted model step. A queued message captures each source when the message is claimed, so queue edits and queue-to-steer relocation use the same path without gateway coordination.

## Alternatives considered

**Single-character `U+FFFC` placeholder with a backdrop chip.** Rejected because the placeholder cannot show multi-word labels without truncation, restores as an unparseable glyph after a remount, and fights native selection and wrapping. The inline display text keeps every native text behavior; the occurrence table alone carries identity.

**Represent sessions as plain `@label` text.** Rejected because labels are neither stable nor unique and cannot identify the source snapshot. Canonical Host-produced mentions preserve opaque session identity while keeping a readable display.

**Clear the composer before prompt admission settles.** Rejected because a transport or admission failure would lose the only editable copy of the request and visually claim acceptance that never occurred.

**Attach context through generic `SendOptions`/delivery.** Rejected because generic delivery would own a domain transaction through admission, steering, cancellation, and observation; the domain-specific `agent/pre-step` listener and the existing next-step inbox preserve the required pairing without enlarging every direct prompt.

**Host-side Remote discovery faces for browser consumers.** Deferred: the rc8 Remote method and the `ui-reference`/file-reference packages are not composed in this repository, so no browser candidate source exists yet; the composer's `quoted` hit flag and the menu's section rows are in place for it. Track this as the remaining gap, not as a route through the API Proxy — the reference flow adds no proxy route, dependency, or error code.

## Verification

Package tests pin the occurrence shift/deletion/edit-inside semantics, boundary Backspace/Delete, partial-selection copy/cut expansion, transactional clear and failure retention (including the interleaved-edit case), canonical draft persistence across remount, codec failure blocking the send, disposal aborting the sink signal, source-title suppression through pending and ready states, section rows that do not alter option indexes, continuing text outcomes, adjacent session-label projection (multi-word, consecutive), extensionless-file and sentence-punctuation rendering, pre-step preparation order (direct message, then its sourced context), downstream rejection pass-through, and malformed-mention turn termination. The narrow-viewport plan-chip e2e (`apps/web/tests/plan-control-row.e2e.ts`) and its golden are ported but not yet executed locally (no bundled Chromium).

## Consequences

Web composer references are faithful inline text with durable identity, and session recall arrives as a structured snapshot paired to the message that cited it. Host services remain the authority for session access. Reference preparation failures occur after prompt acceptance and end the agent turn. Session references retain the bounded snapshot cost and trust framing owned by `dsh-session-reference`. File discovery (`@file`) has no producer in this repository yet: the trigger pipeline's `quoted` flag, section rows, and folder glyph are ready, but no source registers them.
