# Agent Note: Web parity tail — corrupt-session annotation and spark aliases (P2④ stage 3)

Status: implemented

English | [中文](2026-08-27-web-parity-tail.zh.md)

Scope: `packages/host/apiproxy` (`api/sessions.ts`, `api/sessions.schema.ts`, `api-proxy.ts`), `packages/client/runtime` (`sessions/service.ts`, `sessions/lineage.ts`, `sessions/manager.ts`), `packages/client/ui-workspace` (`tree.ts`, `rows/Rows.tsx` + css, `locales.ts`), `packages/client/ui-model` (`index.ts`, `locales.ts`), plus fixture/test fakes

## Problem

Two P2④ edges remained after the approval and rewind stages. (1) The TUI's `/session list` annotates corrupted persisted artifacts as `不可恢复` (header `version < 0`, the persistence layer's corruption placeholder); the Web session list carried no version, so a corrupted row looked like an ordinary session and failed only at open. (2) The TUI's `/model` offers one-click `spark-flash`/`spark-pro` aliases; the Web model popup listed only directory rows, so the shortcut had no counterpart.

## Decision

**Corrupt annotation rides the existing list wire, end to end.** `SessionSummary` gains `version` (header passthrough; the runtime's client-side summary and `SessionListEntry` thread it unchanged). `ui-workspace` derives `SessionNode.corrupt = version < 0` in both the browse and search node paths and renders a muted `不可恢复` / `Unrecoverable` badge with a dimmed title. No filtering anywhere: a corrupt row stays listed and annotated — the TUI's visibility contract, never silent skipping. The wire addition is compiler-enforced across every summary-construction site (fixture, test fakes, synthetic subagent rows), which is exactly the discipline the closed summary shape is for.

**Aliases are popup rows over fixed routes, not directory entries.** `optionsOf` (the `/model` command popup's option builder) prepends two alias rows — `alias/spark-flash`, `alias/spark-pro` — resolved by `selectionOf` to the fixed `deepseek-spark` routes, mirroring the TUI's `SPARK_ALIASES` table. Aliases deliberately carry no `reasoningEffort` (they have no directory reasoning metadata) and appear ahead of the directory so they survive a slow or failed catalog load; the host still validates the route on select.

## Alternatives considered

### Why thread `version` instead of a dedicated `corrupt` wire bit?

The version is the source fact (the TUI derives corruption from the same header field); adding a derived bit would mint a second truth that can drift. `version < 0` is the corruption contract in this repository, and the client fold keeps exactly one derivation.

### Why alias rows in the popup only, not the composer seat?

The TUI's aliases live in the `/model` command surface; the Web's command surface is the popup, while the composer seat renders the full directory. Keeping aliases popup-only preserves that mapping and avoids duplicating shortcuts into the seat's grouped listing.

### Why not the role-pin settings section in this stage?

Role pins were already reachable on the Web when this stage landed (`model-roles` mounted, its settings namespace riding the existing seam) — only the dedicated section contribution was missing. That row has since landed as the [Web role-pin settings row](2026-08-27-web-role-pins.md); the TUI's `/model vision|secondary|subagent` picker and the Web row now converge on the same namespace.

## Consequences

Bought: corrupted Web sessions are visibly annotated instead of failing at open; the spark one-click routes exist on both surfaces.

Cost: the wire summary widened again (every consumer of the closed summary shape pays the compiler tax); `optionsOf` now always lists two alias rows even for hosts without a spark route — an intentional parity choice (the host rejects an invalid route on select, same as the TUI).

## Verification

Focused suites: `ui-workspace` tree/rows/browser (new corrupt-derivation case, badge + dimmed-title assertion, updated search-result goldens), `ui-model` browser-plugin (alias rows, active marking, alias selection resolving to the fixed route), plus the runtime/connection/apiproxy suites for the summary-shape propagation.
