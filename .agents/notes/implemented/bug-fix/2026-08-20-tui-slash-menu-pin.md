# Agent Note: Slash menu rows join the live-region high-water so the input rail stays pinned

Status: implemented

English | [中文](2026-08-20-tui-slash-menu-pin.zh.md)

## Problem

The slash command menu renders inside the chrome segment of the TUI live region (`renderLive` in `packages/tui/tui/src/ui/app.ts`), directly above the input rail. Its row count changes with every keystroke that filters the match list (up to `SLASH_MENU_MAX_ROWS` plus the overflow row), and the fixed-viewport high-water padding only tracked the dynamic segment before `chromeStart`. Each menu growth or shrink therefore shifted the rail's screen row — the input box visibly bounced while typing `/…` and jumped back when the menu closed.

## Decision

The menu (or the one-line no-match hint) is collected into a local `slashLines` array whose display-row total `slashRows` joins the high-water accounting instead of moving the rail. `renderLive` passes `dynamicRows + slashRows` as the tracked rows and `ceiling + slashRows` as the ceiling to `nextDynamicBudget`, and `padDynamicRegion` receives `budget - slashRows`. Because `ceiling` already subtracts `chromeRows` (which includes `slashRows`), the adjusted ceiling is independent of menu height: opening, filtering, closing, or reopening the menu only changes how many pad lines sit above the menu, never the rail row. The `skipPad` welcome exemption now additionally requires `slashRows === 0` and a zero high-water mark, so the untouched welcome frame stays unpadded while the first menu open starts the padding that absorbs every later change. `nextDynamicBudget` and `padDynamicRegion` in `packages/tui/tui/src/engine/live-engine.ts` are unchanged; only the call site changed.

## Alternatives considered

**Move the menu into the dynamic segment.** Rejected: over-budget clipping drops the oldest dynamic rows from the top, so a small terminal would cut the menu itself; chrome membership is precisely the never-clipped guarantee the menu needs.

**Pad idle chrome to the full ceiling so the rail sits at the bottom from the first frame.** Rejected: that is the blank-band welcome layout the [chrome-pin Agent Note](2026-08-15-tui-chrome-pin-ghost.md) already rejected, and the reported pain was the bouncing, not the resting position.

**Reserve a fixed menu-height slot at all times.** Rejected: a permanent empty band above the rail whenever completion is inactive trades the defect for wasted viewport.

## Consequences

The first menu open settles the rail downward once — the menu needs real rows and the high-water mark starts at zero — and every subsequent filter, close, or reopen leaves the rail exactly where it was; rows vacated by the menu become pad lines. `dynamicRowsHighWater` now tracks dynamic plus slash rows, with the existing session-switch and `newSession` resets unchanged. Tiny terminals are unchanged: the budget clamps to zero, so nothing is padded or clipped and the menu still renders whole in chrome. Other variable-height chrome rows (question/approval cards, the vim mode label, the image summary, the Ctrl+C hint) still shift the rail; the same accounting can absorb them later if they become a reported problem.

## Testing

- `packages/tui/tui/tests/app.spec.ts` — the pinning case opens the menu, filters to one match, and closes it, asserting the rail row in the frame passed to `LiveEngine.render` never changes; it fails on the pre-fix accounting and passes after.

## Related

- [Chrome pin and ghost-rail fix](2026-08-15-tui-chrome-pin-ghost.md) — owns the fixed-viewport high-water contract this note extends.
