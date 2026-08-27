# Agent Note: Web role-pin settings row — the last P2④ tail closed

Status: implemented

English | [中文](2026-08-27-web-role-pins.zh.md)

Scope: `packages/client/ui-model` (`role-pins.ts` new, `RoleModelsRow.tsx` + css new, `index.ts`, `locales.ts`, `package.json`)

## Problem

The TUI's `/model vision|secondary|subagent` role picker had no Web counterpart, although the capability was already reachable: `model-roles` is mounted in the base bundle and its settings namespace rides the existing `settings.describe`/`settings.update` seam. What was missing was the UI contribution — recorded as the remaining tail when P2④ stage 3 closed.

## Decision

One General-settings row (`settings.general.item` id `model-roles`) in `ui-model` — the package that already owns the model surface — closes the tail:

**Controller over the namespace, not a new seam.** `RolePinsController` mirrors the permission-settings controller: `settings.describe` finds the `model-roles` view, pins are parsed from the resolved value (`vision`/`secondary`/`subagent` each `{ provider, model }`), writes go through `settings.mutate` with `set`/`unset` ops per role and `expectedRevision` optimistic concurrency. The picker's options come from the **global** catalog (`llm.models`) — root-scoped, unlike the per-session directory the composer seat uses — and a catalog failure degrades to an empty picker without failing the pins read.

**One Menu per role.** The row header summarizes the three pins (catalog display names, follow-default for absent); expanded, each role gets a Menu listing follow-default plus the global catalog (group labels + model rows). Selecting a model pins the route; follow-default clears it. One-shot saving state disables the pickers; a missing namespace hides the row (same unavailable contract as the permission row).

**Registration discipline.** The third `ctx.inject(['slots', 'connection'])` entry in ui-model registers the row and the `settings/changed` + `connection/reset` invalidation refresh (the permission row's lifecycle). `@huiliyi37/dsh-model-roles` joins peerDependencies (`^0.3.0`, the TUI's range) with the workspace devDependency; the catalog types route through `dsh-client-connection/client` (the existing re-export channel, no new dependency).

## Alternatives considered

### Why not a session-scoped row using the per-session directory?

Role pins are settings — global preferences that outlive any session — and the settings section is root-scoped by the slot contract. The global catalog is the correct option source; per-session directory entries would leak session state into a preference editor.

### Why flat menus instead of a provider-then-model two-step?

Three roles × two dropdowns is six controls for a secondary preference; a single Menu per role (follow-default + labeled groups) keeps the row height and interaction cost minimal while the group labels preserve the provider context the two-step would give.

### Why ui-model and not a new package or ui-models?

ui-model owns the model-selection surface (composer seat + /model popup) and already depends on everything the row needs (primitives, slots, connection); ui-models is the provider-directory editor. A new package would add a plugin + bundle row for three rows of UI.

## Consequences

Bought: the Web edits all three role pins in the General settings, and the TUI picker and the Web row converge on the same namespace (a pin set on either surface is what the other shows).

Cost: one more settings consumer (the invalidation refresh + controller lifecycle is the established pattern, not new machinery); the summary shows raw model ids when a pinned route is absent from the global catalog — the honest fallback, matching the TUI's route display.

## Verification

Focused suites: `role-pins.spec.ts` (view parsing, catalog degradation, set/unset shapes with revision, error surfacing, role order), `role-models-row.spec.tsx` (header summary, expansion, catalog pick, follow-default clear, unavailable null), plus the existing ui-model suite (27). The assembled-settings e2e lane remains CI surface (browser boot unavailable in the local sandbox).
