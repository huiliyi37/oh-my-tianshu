# Agent Note: TUI welcome page polish — friendly restorable-session rows

Status: implemented

English | [中文](2026-08-13-tui-welcome-page-polish.zh.md)

## Problem

The C4 B-layout startup page left session identity hard to scan: restorable rows used raw full ids, and `cwd` appeared only for live sessions, so a persisted row could read `○ <uuid> · 1 小时前 · fork: <uuid>`. Short display labels had to improve recognition without replacing the full id used for resume and switching.

## Decision

The friendly-session-row decision remains in `restore-session.ts`: `formatRestorableSessions` uses a title when available, relative age, cwd basename, a `#`-prefixed short id, and a short `fork #` parent id. Formatting never changes identity; the full session id still drives resume and switching.

The [capability-gated fox welcome](./2026-08-22-tui-fox-welcome.md) partially supersedes this note's first-screen composition. It replaces the former `formatBrandHeader`, `formatEnvCheckLine`, and `formatWelcomeMenu` symbols with the responsive hero and final welcome composer; those removed symbols are not current interfaces. The numbered startup list uses `formatRestorablePickerList` and preserves the friendly row projection.

## Verification

- `restore-session.spec.ts` pins title, age, cwd basename, short-id, fork-id, corruption, numbering, and row-cap behavior without changing the full id.
- `app.spec.ts` pins numbered welcome rows and routes the selected row by its full session id.
- Current hero, tip, responsive fallback, and settled first-screen composition are verified by the [fox welcome layers](./2026-08-22-tui-fox-welcome.md#verification).

## Files

- `packages/tui/tui/src/restore-session.ts`: friendly summary rows and numbered picker projection
- `packages/tui/tui/src/ui/app.ts`: title lookup, three-row startup projection, and full-id routing
- `packages/tui/tui/src/format/welcome.ts`: current first-screen composition, owned by the [fox welcome decision](./2026-08-22-tui-fox-welcome.md)

## Alternatives considered

**Hero box / ASCII-art brand welcome (concept A hero, B brand art)** — deferred by this decision because friendly session identity did not require a wide decorative frame. The later [fox welcome decision](./2026-08-22-tui-fox-welcome.md) adopts a capability-gated 92-column hero without restoring the removed header, environment line, or menu composer.

**Keep raw full session ids** — rejected: a full UUID is unreadable at a glance; 8-char `#` ids match git short-SHA convention, and the full id remains authoritative for `/session switch` (formatting is display-only).

**Show the full `cwd` path** — rejected: the top bar already carries the full path; the session row needs only the basename to disambiguate.

## Consequences

- Welcome rows use short ids for recognition; collisions are cosmetic because the full id still drives resume and switching.
- The current first-screen brand, metadata, row cap, tip, and settlement behavior belong to the [fox welcome decision](./2026-08-22-tui-fox-welcome.md); this note remains active for the friendly session-row rationale.
