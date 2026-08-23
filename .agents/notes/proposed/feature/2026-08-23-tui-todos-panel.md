# Agent Note: TUI live todos panel

Status: proposed

English | [中文](2026-08-23-tui-todos-panel.zh.md)

## Problem

`todo_write` records the model's plan, and the data is already projected from the session log through the [`todos` projection key](../../../../packages/todo/tool-todo/README.md). What the user lacks is an at-a-glance view: today the list surfaces only on demand, inside the `/status` panel's task section and the `/tasks` pane, both of which the user must open deliberately. Claude Code pairs its TodoWrite tool with a standing todo panel that stays visible while work happens. The real increment here is a compact standing card with a `/todos` toggle, not a first-ever todos view.

## Proposal

A pure TUI change in [`packages/tui/tui`](../../../../packages/tui/tui/README.md) renders the `todos` session projection as a compact live card in the activity band and registers a `/todos` command to toggle it. No harness change, no new package, no new event vocabulary. The TUI already subscribes to the projection and caches its value (`app.ts` `taskItems`), so the card adds a renderer and a toggle, not a data pipeline.

### Data source and turn boundaries

The projection's fold semantics are: `todo/write` replaces the list whole-value; `turn/start` resets the fold to `null`; `turn/end` keeps the finished checklist visible. The card therefore cannot treat `null` as "hide": the controller caches the latest non-null snapshot, and a turn-boundary reset leaves the card showing the previous turn's list with a stale marker until the next `todo/write` replaces it. `null` hides the card only before the first write of the session, and an explicit empty write renders the all-done state.

### Render surface

A new pure render module `src/format/todos-panel.ts` follows the tool-render intent convention: a function of panel arguments returning row text, with no model interaction. The controller draws a one-line card at the top of the activity band: pending and done counts, the current in-progress item, the stale marker, and collapse/expand states, height-capped like the existing live cards.

### Surface division

`/status` keeps its on-demand full panel and its deliberate `null`-as-placeholder merge for the task section; `/tasks` keeps owning background-task execution. The new card is the only surface that distinguishes `null` (never written) from an empty list (all done), and it owns the standing, toggleable presentation. No other surface changes.

### Command surface

`/todos` (bare) toggles the card's visibility and is registered in the TUI built-in slash command registry, so it appears in `/help` and the command palette (Ctrl+P). It is not a keyboard binding and therefore has no `KEYMAP_ENTRIES` entry, which is a keyboard-shortcut-only table.

## Alternatives considered

### Why not extend `/status` instead?

The status panel is on-demand and full-width; a standing card must be small, always-visible, and cheap to scan. Merging both needs would either bloat the status panel or hide the card behind a panel the user must open.

### Why not a harness-level todo panel service?

The projection already exists and the card is presentation; a service would duplicate the fold the log already provides and widen the harness for one adapter.

### Why not fold it into `/tasks`?

`/tasks` owns background task execution; todos are the model's plan state. Merging the two domains would confuse both surfaces.

### Why not a new package?

The change touches only TUI rendering and its tests; a package would carry no independent capability and would fail the current-owner requirement.

## Acceptance criteria

- Unit tests cover the render function's states (hidden, pending, in-progress, all-done, stale, capped overflow) and the controller's caching across a `todo/write` → `turn/start` → `todo/write` projection sequence.
- A keyless snapshot drives a `todo_write` tool call and asserts the card lines before and after the write, including the stale marker after a turn reset.
- The bundle-patch spec asserts the `/todos` registration in the slash registry and its `/help` listing; no `KEYMAP_ENTRIES` change is made.
- The `/status` task section keeps its current `null`-as-placeholder behavior, proven by its existing tests staying green.
- No new durable events and no packages; the README and this note move to `implemented/` with the landing commit.

## Risks

- The cached list can belong to a previous turn after a turn-boundary reset; the stale marker makes that honest, and an explicit empty write still clears to all-done.
- `null` versus empty is a semantic the card must keep distinct while `/status` merges them; a shared renderer would re-introduce the merge, so the card keeps its own render path.
- Toggling is per-session UI state, not durable; a reopened session starts hidden.
- The card shares the activity band's height budget; the cap and collapse states bound the cost, and a long list shows counts plus the current item instead of all rows.

## Implementation deltas (2026-08-23)

Implemented in the working tree in `packages/tui/tui`, with these corrections:

- The premise overstated the gap: `/status` and `/tasks` already render the todos projection. The shipped delta is a compact summary card (`counts + current item`) plus a `/todos` toggle, not a first view.
- The projection resets to null at every `turn/start`; the panel renders from a retained snapshot that absorbs only non-null values, so a visible list stays sticky across turn boundaries instead of flickering away.
- `/todos` lives in the slash registry, `/help`, and the command palette — the keymap panel lists keyboard shortcuts only, so the original acceptance criterion pointed at the wrong surface.
- null vs `[]` stay distinct in the new renderer (idle vs all-done), unlike `/status`'s deliberate merge.
- A PTY keyless snapshot is deferred; panel lines are asserted through the real render pipeline in app.spec.
