# Agent Note: TUI C4 concept draft Wave 1+2 — welcome menu entry / top bar / status line / three-line footer

Status: implemented

English | [中文](2026-08-12-tui-c4-concepts-w12.zh.md)

## Problem

The concept draft (`docs/dsh-tui-视觉概念稿-c4.md`) proposes three concept options (A astrolabe / B deep dive / C workbench) for the user-visible surface; user selection: **① welcome page uses a menu entry (A); ② multi-line input defers to the next batch; ③ the metrics line stays resident at the bottom (C's three-line footer)**. The existing C1/C2/C3 comparison documents only cover functional gaps, not the visual form of the welcome page and footer; today's welcome page is a 4-line mini box plus an environment-check line, the footer has only the input line with no mode/shortcut-hint line, and the metrics line sits in the top glance panel.

## Decision

Implement Wave 1 + Wave 2 along the concept draft's recommended path (excluding Wave 3 multi-line input):

- **Welcome page menu entry**: `formatWelcomeMenu` (label left BOLD + keyHint right-aligned secondary, width-conserving, disabled items muted) rendered uniformly in `renderRestorableSessions`; `handleKey` adds ctrl_n (newSession, P3 keepHandle retains the old session) / ctrl_s (switch to the nearest non-current session) / ctrl_q (onExit). The ctrl_s/ctrl_q key names and their 0x13/0x11 parsing are added to `input-handler.ts` (these two keys were previously absent from KeyName).
- **Top bar**: `formatTopBar` (📁 cwd → model → (branch), dropping trailing segments when overwide, ascii mode maps 📁→`~`) replaces the former inline context bar; the branch is read via `gitBranch()` (execSync rev-parse, once at attach, silent). Shortcut hints move out of the top bar — in concept draft A they belong to the bottom shortcuts line (footer) duty.
- **Status line**: `formatTurnStatus` (running braille spinner frame loop / waiting pulsing ◆, null takes no slot, ascii degrades to `*`/`-`) replaces the glance status line's plain text — `LiveSnapshot.glanceStatus` type widens to `string | null`, and `renderGlancePanel` filters null.
- **Three-line footer**: `formatPromptFooter` (mode segment normal + [plan]/[plan…]/[auto] badge + shortcut hints, narrow width drops trailing segments but always keeps mode) renders below the input line; the metrics line moves out of the glance panel and renders resident below the input line (`formatGlanceBar` output, wrapped by the composer taking `line.text` — the first wiring mistakenly wrapped the whole LiveRegionLine object in `{ text }`, causing a runtime `l.text.includes` error; fixed to take `.text`).

Architecture constraints honored: all new visuals are format/ pure functions (narrow input → ANSI line, zero IO); app.ts only assembles; no new dependencies; SOURCE-MAP.md gains three new file entries.

## Verification

- `welcome.spec.ts` 23/23 (6 new cases: right-alignment/width conservation/disabled degradation/overlong label drops keyHint/empty items).
- `top-bar.spec.ts` 6/6 (cwd+model without shortcut hints, branch segment, no branch, narrow-width drop order branch before model, ascii, width conservation, truncation ellipsis).
- `turn-status.spec.ts` 8/8 (null/empty takes no slot, frame loop, tick wraparound, idle ◆, ascii degradation, width conservation).
- `prompt-footer.spec.ts` 6/6 (default/plan/planPending precedence/auto/width conservation/narrow-width segment drop).
- `live-panels.spec.ts` metrics case updated to "moved out of the glance panel".
- `app.spec.ts` T6 context bar case updated (shortcut hints moved out of the top bar); 145 → 146 cases all green.
- TUI full run: **1326 passed / 2 todo (75 files)**; `tsc --noEmit -p packages/tui/tui/tsconfig.json` 0 errors.
- Post-commit review (auto, L1) queued in the background.

## Files

- `packages/tui/tui/src/format/welcome.ts`: `formatWelcomeMenu` + `WelcomeMenuItem`/`FormatWelcomeMenuInput`
- `packages/tui/tui/src/format/top-bar.ts` (new): `formatTopBar`
- `packages/tui/tui/src/format/turn-status.ts` (new): `formatTurnStatus`
- `packages/tui/tui/src/format/prompt-footer.ts` (new): `formatPromptFooter`
- `packages/tui/tui/src/ui/app.ts`: menu rendering, ctrl_n/s/q key routing, gitBranch, top bar assembly, turnStatus assembly, footer+metrics rendering below the input line
- `packages/tui/tui/src/engine/input-handler.ts`: KeyName gains `ctrl_s`/`ctrl_q`, CTRL_CODES gains 0x11/0x13
- `packages/tui/tui/src/render/live-panels.ts`: renderGlancePanel drops the metrics segment, glanceStatus nullable filtering
- `packages/tui/tui/src/render/live-snapshot.ts`: glanceStatus type `string | null`
- `packages/tui/tui/SOURCE-MAP.md`: three new file entries
- Tests: `welcome.spec.ts`, `top-bar.spec.ts` (new), `turn-status.spec.ts` (new), `prompt-footer.spec.ts` (new), `live-panels.spec.ts`, `app.spec.ts`

## Alternatives considered

**Top bar keeps the shortcut hints (original T6 semantics)** — rejected. Concept draft A's top bar only contains branch+cwd; shortcut hints belong to the bottom shortcuts line; the T6 test at 100 columns exposed the mixed-information problem by dropping the model segment when overwide; after splitting by the concept draft (model in the top bar, shortcuts in the footer) each segment's duty is clear.

**Interactive welcome menu (grok-style selected highlight + Enter to execute)** — rejected. dsh's key routing is more direct (ctrl+n/s/q dispatch straight through); menu lines serve as a visible entry hint only; the theme has no bg_highlight slot, so selected highlighting would require changing the theme contract.

**alwaysApprove badge reads `this.alwaysApprove`** — a type-error correction. The field actually lives on `ApprovalController` (`this.approval.alwaysApprove`), and the footer badge is sourced from the same place.

## Consequences

- The three-line footer (input line → footer → metrics) changes the live zone's bottom form; metrics no longer appear in the top glance panel (avoids duplication).
- The nullable `glanceStatus` is a render-layer type widening; `renderGlancePanel`'s caller (renderLive only) filters null in sync.
- Multi-line input (Wave 3) and the welcome-page hero layout (wide ≥90-column terminal exclusive) stay for the next batch per user decision.
- Render verification is environment-limited: no interactive TTY, visual assertions rest on pure-function specs; real-terminal acceptance awaits a TTY environment (same baseline as the C1/C2 series).
