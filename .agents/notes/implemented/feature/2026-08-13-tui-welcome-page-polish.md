# Agent Note: TUI welcome page polish — brand header / friendly session rows / resident env line

Status: implemented

English | [中文](2026-08-13-tui-welcome-page-polish.zh.md)

## Problem

After the C4 B-layout wave, the startup welcome page is still a bare text dump: no brand identity anchor above the top bar; restorable-session rows show raw full session ids (and `cwd` only for live sessions, so a persisted row reads `○ <uuid> · 1 小时前 · fork: <uuid>`); the environment-check line renders only when there are no restorable sessions; and the menu's right-aligned `keyHint` fills the terminal's last column, so autowrap terminals clip `ctrl+q` to `ctrl+`. A startup command echo (e.g. `/model`'s「模型已切换」) lands directly against the menu with no visual separation.

## Decision

All changes stay in the pure-function layer plus `app.ts` assembly (width-conserving, ascii-degradable, zero IO):

- **Brand header** (new `formatBrandHeader` in `format/welcome.ts`): renders `DSH` (bold `brandColor`) + a muted subtitle (default `DeepSeek Harness`) on one line; subtitle truncates to the remaining budget.
- **Friendly session rows** (`restore-session.ts` `formatRestorableSessions`): reorder to age-first and replace bare ids with `#`-prefixed 8-char short ids; `cwd` renders as its basename for both live and persisted rows; the fork source is a `fork #` short parent id. Full-id semantics are unchanged — `restore-session` only formats, the full id still drives `/session switch`.
- **Resident environment line** (new `formatEnvCheckLine` in `format/welcome.ts`): one muted line `API Key ✓/✗ · Git ✓/✗ · <cols>×<rows> · <background>`, rendered whether or not restorable sessions exist. Wording uses「API Key」not the footer's「API ✗」so the two do not collide in grep-level assertions.
- **Menu last-column reserve** (`formatWelcomeMenu`): content budget becomes `width - 1`, so the right-aligned `keyHint` never occupies the terminal's final column (avoids the autowrap extra-blank-line / last-char clip).
- **Startup recomposition** (`app.ts` `renderRestorableSessions`): brand header → top bar → blank → session list (or first-run welcome) → blank → env line → blank → menu → trailing blank. The env line's `background` reads `getActiveThemeBackground()` (the theme `attach` already resolved) instead of re-probing OSC 11.

## Verification

- `tests/welcome.spec.ts` +7: brand header (default/custom/truncation/width≤0) and env line (all-ok / missing-api-key-non-git / cols≤0).
- `tests/restore-session.spec.ts`: existing cases rewritten to the age-first short-id form; +1 long-UUID → 8-char `#` id.
- `tests/app.spec.ts`: restorable-session wiring asserts the `#` short id and that raw ids no longer appear; the IME `caretCol` wiring test is exercised in the same suite.
- TUI full **1457 passed / 2 todo** (80 files); one timing-sensitive fluency test flakes with a 5s timeout under full-suite load and passes in isolation (unrelated to this change). `tsc -b packages/tui/tui` 0 errors; oxlint 0 errors; `verify-export-jsdoc` clean for the changed files.

## Files

- `packages/tui/tui/src/format/welcome.ts`: `formatBrandHeader` + `FormatBrandHeaderInput`, `formatEnvCheckLine`, `formatWelcomeMenu` last-column reserve
- `packages/tui/tui/src/restore-session.ts`: age-first friendly rows with `#` short ids and cwd basename
- `packages/tui/tui/src/ui/app.ts`: `renderRestorableSessions` recomposition; `getActiveThemeBackground()` for the env line
- Tests: `welcome.spec.ts`, `restore-session.spec.ts`, `app.spec.ts`

## Alternatives considered

**Hero box / ASCII-art brand welcome (concept A hero, B brand art)** — rejected this round: the C4 decision record defers both past Wave 3 as optional decoration; the stacked layout already covers function, and the brand header supplies the identity anchor without a ≥90-column hero frame.

**Keep raw full session ids** — rejected: a full UUID is unreadable at a glance; 8-char `#` ids match git short-SHA convention, and the full id remains authoritative for `/session switch` (formatting is display-only).

**Show the full `cwd` path** — rejected: the top bar already carries the full path; the session row needs only the basename to disambiguate.

## Consequences

- Session rows on the welcome page now truncate ids to 8 chars; collisions are cosmetic only (the full id still drives resume/switch), consistent with the「show just one」cap already in place.
- The environment line is now always visible on first screen, so API-key / git / terminal state is readable even with restorable sessions present.
- Menu lines are at most `width - 1` columns; the trailing blank line separates startup command echoes from the welcome page visually.
