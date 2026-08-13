# Agent Note: Record last activity in the session index

Status: proposed

English | [中文](2026-07-29-durable-last-activity-index.zh.md)

## Problem

A cold (persisted, unattached) session has no stored answer to "when was this last worked in". `dsh-host-apiproxy`'s `summarizeCold()` therefore approximates it with the log file's mtime where one exists — `locate()` resolves a per-session artifact for JSONL and `undefined` for SQLite, whose cold sessions fall back to `createdAt` — and the web client sorts its session tree by the resulting `updatedAt`. The two backends are wrong in opposite directions: JSONL reads too new, SQLite too old.

mtime answers a different question: when the artifact was last written. Every durable write refreshes it, including writes that are not activity — a truncate-repair of a torn tail, the synthetic closers that balance an interrupted turn, and the [`session/end-seed` boundary](../../implemented/architecture/2026-07-30-session-end-seed-log-boundary.md) a seeded session appends. (A `flush` with nothing pending is not among them: the coordinator returns without reaching the backend.) The visible consequence is stable and wrong in one direction: a session touched without being worked in promotes itself above sessions the user actually worked in afterwards, and each touch re-promotes it. `dsh-host-apiproxy` keeps `session.history` inspection-only, but any Agent-bound ordinary-session control resumes through `agentFor()` and is enough to promote the cold artifact.

The attached projection has a real fix — `lastActivityTime()` skips boundaries — but it needs the event log, and the cold path deliberately does not read one. Reading the log to compute `updatedAt` would defeat the header-only listing that keeps `list()` scaling with session count rather than log size.

The [boundary change](../../implemented/architecture/2026-07-30-session-end-seed-log-boundary.md) raised the frequency of this defect, because a pickup now writes where nothing was written before; `dsh-host-apiproxy`'s README records it under Known Limitations. It did not introduce the approximation, and removing the approximation is a durable-format decision, which is why it is scoped here rather than there.

## Proposal

Store last-activity time where a listing already reads — the session index — so `summarizeCold()` can serve it without opening the log. The coordinator computes the value, because it sees every append and already owns per-id state; backends persist it. That makes it a new `PersistenceBackend` contract element rather than backend-local bookkeeping, and keeps one definition of "activity" shared with the in-log `lastActivityTime()`.

The two shipped backends have opposite constraints, and the proposal is deliberately asymmetric about them:

- **SQLite** gets a column on `sessions`, written in the same transaction as `appendBatch`, at the cost of a monotonic `SCHEMA_VERSION` bump.
- **JSONL cannot host a mutable header field.** The header is line 1, written once during materialization, and the log is opened for append forever after; `jsonl.spec.ts` pins that committed bytes are never rewritten. A per-append header field would violate an asserted durability invariant, not merely complicate the writer. A per-session sidecar file is the shape to compare against leaving JSONL approximate.

Three questions must be answered before implementation, and none of them is settled here:

**Which events count as activity?** `lastActivityTime()` answers this for the log by excluding `session/end-seed`. A stored field encodes the rule at write time, where the writer sees one batch rather than the whole log. The two must not drift, or the attached and cold surfaces will disagree about the same session.

**How do pre-field logs behave?** Existing artifacts have no value. Falling back to mtime keeps them at today's accuracy; falling back to `createdAt` is honest but reorders every existing session in the picker and the tree.

**Is a sidecar acceptable for JSONL?** It reintroduces a second file per session that can disagree with the log, which the single-artifact design avoided.

## Alternatives considered

**Read the log on the cold path.** Correct by construction and needs no format change, but it defeats the header-only listing: `list()` would scale with total log size, and the web session tree fans out over every session in the store. This is the option the mtime approximation exists to avoid.

**Keep mtime and exclude boundary writes from it.** Rejected as impossible rather than undesirable: mtime is the filesystem's, not the backend's. Nothing short of restoring the timestamp after every boundary write would preserve it, and that races any concurrent reader and lies about the artifact.

**Write the boundary only when repair occurred.** Would reduce the frequency, and the [boundary note](../../implemented/architecture/2026-07-30-session-end-seed-log-boundary.md) already rejected it: the predicate must hold for an orderly restart too. Trading a correctness invariant for timestamp accuracy is the wrong direction.

**Derive activity from a projection cache.** `session-projection-cache` already folds tails past a watermark, so a last-activity unit would ride existing machinery. Rejected as the primary shape because the cache is an optional composition entry; a listing served only when a cache plugin is mounted makes ordering depend on composition.

## Acceptance criteria

- `SessionSummary.updatedAt` for a cold session equals the same value the attached projection reports for that session, verified by resuming, quitting without a turn, and asserting the order is unchanged across both paths.
- A resumed-then-abandoned session does not sort above a session worked in afterwards, in the web session tree and the TUI resume picker, pinned by an assembled snapshot rather than unit tests alone.
- The activity rule has one definition: a test proves the stored field and `lastActivityTime()` agree over a log containing boundaries, closers, and a plain turn.
- Pre-field artifacts load and list without error under the chosen fallback, with the fallback's ordering consequence asserted.
- SQLite's `SCHEMA_VERSION` bump rejects the old on-disk version per the repo's no-migration stance.

## Risks

**Two definitions of activity drift.** The stored field is computed per batch, the projection over a whole log. A new event type classified one way at write time and the other at read time yields a session whose cold and attached orderings disagree — a bug that only appears after a restart, which is where it is hardest to notice.

**A JSONL sidecar can disagree with its log.** A crash between the log append and the sidecar write leaves a stale value with no torn-tail marker to repair it. Every consumer would need to treat the sidecar as a hint, which is close to what mtime already is.

**The fallback reorders existing sessions.** Whichever fallback is chosen, users with existing logs see their picker and tree reorder once on upgrade. `createdAt` makes that reordering large.

**Cost may exceed the defect.** The defect is a misordering of abandoned sessions. If the honest answer for JSONL is "keep the approximation", this note's outcome may be documenting that decision rather than implementing a field — and that is an acceptable outcome.

## Related

- [The end-seed log boundary](../../implemented/architecture/2026-07-30-session-end-seed-log-boundary.md) — one of the non-activity writes mtime counts; `dsh-session` owns `lastActivityTime()`, the in-log projection a stored field must agree with.
- [Session persistence](../../implemented/architecture/2026-06-14-session-persistence.md) — the append-only and never-rewrite invariants that rule out a mutable JSONL header field.
- [Shared persistence write coordinator](../../implemented/architecture/2026-06-18-shared-persistence-write-coordinator.md) — the append path a stored field would hook into.
