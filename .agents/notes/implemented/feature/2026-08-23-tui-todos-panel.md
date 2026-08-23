# Agent Note: TUI live todos panel

Status: implemented

English | [中文](2026-08-23-tui-todos-panel.zh.md)

## Problem

`todo_write` records the model's plan, and the data is already projected from the session log through the [`todos` projection key](../../../../packages/todo/tool-todo/README.md). What the user lacked was an at-a-glance view: the list surfaced only on demand, inside the `/status` panel's task section and the `/tasks` pane, both of which the user must open deliberately. Claude Code pairs its TodoWrite tool with a standing todo panel that stays visible while work happens. The real increment was a compact standing card with a `/todos` toggle, not a first-ever todos view.

## Decision

A pure TUI change in [`packages/tui/tui`](../../../../packages/tui/tui/README.md) renders the `todos` session projection as a compact live card and registers a `/todos` command to toggle it. No harness change, no new package, no new event vocabulary. The TUI already subscribed to the projection (`app.ts` `taskItems`); the card adds a renderer and a toggle, not a data pipeline.

### Data source and turn boundaries

The projection's fold semantics are: `todo/write` replaces the list whole-value; `turn/start` resets the fold to `null`; `turn/end` keeps the finished checklist visible. The panel therefore never treats `null` as "hide": the controller keeps a retained snapshot (`todosRetained`) that absorbs only non-null projection values, so a visible list stays sticky across turn boundaries instead of flickering away at every `turn/start`. `null` renders only before the session's first write (an idle placeholder line); an explicit empty write renders the all-done line. The two empty semantics stay distinct, unlike `/status`'s deliberate null-as-placeholder merge.

### Render surface

The pure render module `src/format/todos-panel.ts` follows the render-intent convention: `projectTodosPanel(todos, opts)` is a function of arguments returning row text, with no model interaction. Collapsed, the card is one line — title, three-state counts (`✓`/`⏳`/`□`), and the current in-progress item; `all` expands a row-capped detail list (default six rows including the summary, overflow folded into a `└ …(+N)` tail). The panel renders between the glance bar and the tasks pane, gated by visibility inside `renderTodosPanel`.

### Surface division

`/status` keeps its on-demand full panel and its deliberate null-as-placeholder merge for the task section; `/tasks` keeps owning background-task execution. The card is the only surface that distinguishes `null` (never written) from an empty list (all done), and it owns the standing, toggleable presentation. No other surface changed.

### Command surface

`/todos` (bare) toggles visibility; `/todos all` expands or collapses the detail list and shows the panel; any other argument echoes usage. The command is registered in the TUI built-in slash registry (`BUILTIN_COMMAND_NAMES`), so it appears in `/help` and the command palette. The keymap panel lists keyboard shortcuts only, so there is no `KEYMAP_ENTRIES` entry. Visibility and expansion are per-session UI state, reset by `/clear` and session switches.

## Alternatives considered

### Why not extend `/status` instead?

The status panel is on-demand and full-width; a standing card must be small, always-visible, and cheap to scan. Merging both needs would either bloat the status panel or hide the card behind a panel the user must open.

### Why not a harness-level todo panel service?

The projection already exists and the card is presentation; a service would duplicate the fold the log already provides and widen the harness for one adapter.

### Why not fold it into `/tasks`?

`/tasks` owns background task execution; todos are the model's plan state. Merging the two domains would confuse both surfaces.

### Why not a new package?

The change touches only TUI rendering and its tests; a package would carry no independent capability and would fail the current-owner requirement.

## Consequences

- Panel behavior is pinned through the real render pipeline: format-module unit tests (idle, all-done, summary, capped overflow), live-panels contract tests for the new snapshot fields, and `app.spec` integration tests for the sticky semantics, `/clear` reset, and usage echo. A PTY keyless snapshot is deliberately deferred; the fox-welcome snapshot driver under `examples/tui/tests` is the harness to reuse when one is wanted.
- The retained list can belong to a previous turn after a `turn/start` reset; stickiness is the honest presentation of a fold that clears at turn start, and an explicit empty write still clears to all-done.
- `null` versus empty is a semantic only this surface keeps; a shared renderer would re-introduce the `/status` merge, so the card keeps its own render path.
- Toggling is per-session UI state, not durable; a reopened session starts hidden.
- The card shares the activity band's height budget; the cap and collapse states bound the cost, and a long list shows counts plus the current item instead of all rows.
