# Agent Note: Upstream v0.1.1-rc.1 follow-up ports — projection split, blank-default refresh, subagent header

Status: proposed

English | [中文](2026-08-21-upstream-rc1-followup-ports.zh.md)

## Problem

The [v0.1.1-rc.1 port](../../implemented/feature/2026-08-21-upstream-v0.1.1-rc.1-port.md) landed the credential/authorization chain, the vision model, and the runtime-fix and web-client waves, and deliberately deferred three items whose port is not mechanical. Each has real user value and a known local divergence; what each lacks is a decided adaptation plan.

1. **Session-projection state/view split.** Upstream (`4c421ec882`, `9127d7e8b7`, `327b86d2ea`, design note `2026-08-19-session-projection-state-and-client-views`) separates a merge-extensible `SessionProjectionStateMap` (host fold states, `stateSchema`-validated before a cached row seeds a fold) from the established `SessionProjectionMap` (client values, `wire.viewSchema`/`wire.view`), checkpoints every unit uniformly (the `persist` opt-in is gone), and adds `stateOf(session, key)` for host reads. The fork still runs the pre-split shape: one table serving both roles, `schema` validating only `view` output, and cached rows restored **without** state validation — a malformed cache row can seed a fold today.
2. **Permission blank-session default refresh.** ~~Upstream `35778ec2ff`~~ — **WITHDRAWN: upstream reverted the whole PR #2608 in rc.2** (`7ce85283b5`), removing the `origin` field, the blank-reuse refresh, and `reuseWorkspaceBlank` in one move. The fork keeps the already-ported (a) half (localized preset labels) as a deliberate local advantage — the revert only removed it upstream for bundling with (b), and the label localization carries no (b) dependency. Nothing further ports here unless upstream lands a redesigned (b).
3. **Subagent header switcher.** Upstream `de572dd910` + review fix `5f7ac9183e`: a new `conversation.session.header.lineage` slot lets a breadcrumb switcher (`SubagentHeaderLineage.tsx`, ~800 lines with the catalog dropdown) replace the plain session title for sibling/descendant navigation. Locally `ConversationSession.tsx:72-90` is the pre-change breadcrumb (title button only, no lineage slot), and `ui-subagent` carries only the catalog action and read-only composer.

## Proposal

### Item 1 — projection split: investigate first, then decide scope

This is the only item that changes a seam contract against a diverged consumer surface, so it runs as a timeboxed investigation whose output is a go/no-go with a concrete step list. Questions the investigation must answer from the local tree:

- **Which locally registered units are host-only?** Enumerate every `ProjectionDefinition` (subagent timing, subagent list identity, plan, todos, goal, session-stats, token-meter, permission, session-title) and mark whether any web client reads its value. The answer sizes the `wire` surface and finds any unit accidentally shipping internal state today.
- **How does the local cache restore path interact with `stateVersion`?** `session-projection-cache` currently trusts stored rows; the investigation maps where `stateSchema` validation would slot in and what the full-read fallback costs.
- **What reads projection state in the same process?** The TUI's `projectionCache` (todos/plan/goal/subagent) is a same-process consumer; the split must leave it on `stateOf`-equivalent reads without paying wire serialization.

If the answers show the consumer surface is close to upstream, port the three commits at their rc.1 end state: introduce `SessionProjectionStateMap` + `stateSchema`, move each unit's fold state there, gate snapshots on `SessionProjectionMap`, delete the local equivalent of `persist`, and adapt `session-projection-cache` restore to validate before seeding. If the divergence is structural, the fallback scope is the restore-validation half only (stateSchema + validate-before-seed), which buys the robustness fix without the contract change.

### Item 2 — blank-session default refresh: WITHDRAWN

Upstream reverted the entire PR #2608 in rc.2 (`7ce85283b5` + snapshot sync `32f3c09c26`): the `permission/preset` `origin` field, `refreshDefaultForReuse`, and `reuseWorkspaceBlank` are gone from the upstream tree. The fork keeps the (a) label localization already shipped in the rc.1 wave (it has no dependency on the reverted mechanism). If upstream relands a redesigned refresh, re-evaluate from that design rather than the rc.1 end state.

### Item 3 — subagent header switcher (port `de572dd910` + `5f7ac9183e`)

Two coordinated moves: `ui-conversation` gains the `conversation.session.header.lineage` slot and the `ConversationSession` breadcrumb learns to defer to it (local file is at the upstream pre-change shape, so the diff applies close to verbatim); `ui-subagent` imports `SubagentHeaderLineage.tsx` whole, adapting `@deepseek-ai`→`@huiliyi37` scopes, the local slot-catalog, and locale strings. The review-fix commit's trigger-ref guard and collapsed-when-invisible behavior land together, not as a follow-up.

### Order and dependencies

Item 3 → item 1 (item 2 is withdrawn). Item 3 adds a new surface with no contract change; item 1 runs last because its investigation may reschedule other work if it reveals shared projection consumers. Neither blocks the deferred llm-pi-ai login half (`auth.ts`/`login.ts`), which waits on the user's parallel pi-ai vision work settling first.

## Alternatives considered

**Port all three mechanically alongside the main wave.** Rejected at the time and unchanged: item 1 touches a seam contract, item 2 spans three packages with rename mapping, and item 3 is a new capability — each needed its own adaptation pass that the wave's batching could not give.

**Skip the projection split entirely.** Rejected: unvalidated cache restore is a real robustness hole, and host state reaching wire payloads is a correctness leak; even the no-go outcome of the investigation keeps the restore-validation fallback scope.

**Take upstream's intermediate blank-refresh design (`syncBlankSessionsToDefault`).** Rejected: upstream itself replaced it within the same release; the end state is strictly simpler.

## Acceptance criteria

- Item 1 (investigation): a written answer to the three questions plus a go/no-go; on go, every projection unit carries `stateSchema`, malformed cached rows are rejected before seeding (test proving a corrupted row falls back to log rebuild), snapshots contain only `SessionProjectionMap` keys, and the session-projection/-cache/subagent/plan/todo/goal suites stay green.
- Item 3: a session with subagent lineage renders the switcher in the header, sibling/descendant navigation works from the dropdown, and a plain session shows the unchanged breadcrumb; ui-conversation and ui-subagent client specs green, README pairs updated and re-recorded.
- Every landed item: `tsc -b` host+client clean, oxlint zero new diagnostics, translation-pairing re-recorded, and the implemented note filed in the same change.

## Risks

- **Item 1 may find the fork's consumer surface further from upstream than estimated** — the TUI reads projections host-side while the web client reads wire shapes; if both interleave through one table today, the split's blast radius grows. The investigation-first shape caps the loss at the timebox.
- **Wire compatibility**: narrowing snapshots to `SessionProjectionMap` changes what web clients receive; any client silently depending on a host-only key breaks at runtime, not compile time. The enumeration question exists precisely to find these.
- **Item 3 duplicates a TUI-owned surface**: the TUI already shows delegation trees its own way; the web switcher must not become a second source of lineage truth — it renders the existing delegation projection, nothing else.
- **Item 2's withdrawal is recorded, not silently dropped**: keeping the (a) label localization is a deliberate divergence — upstream's revert bundled (a) with (b), and a future upstream reland of the labels should be deduplicated against the local copy, not re-applied.
