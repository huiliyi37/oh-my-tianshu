# Agent Note: TUI C4 concept draft Wave 1+2 — welcome actions / top bar / status line / three-line footer

Status: implemented

English | [中文](2026-08-12-tui-c4-concepts-w12.zh.md)

## Problem

The concept draft (`docs/dsh-tui-视觉概念稿-c4.md`) proposes three concept options (A astrolabe / B deep dive / C workbench) for the user-visible surface. The decision has to separate direct welcome actions, top-bar context, turn status, and bottom metrics instead of combining unrelated information in one row.

## Decision

Wave 1 + Wave 2 establish these responsibilities:

- **Welcome actions, partially superseded**: `handleKey` retains direct `ctrl_n` (new session), `ctrl_s` (nearest recoverable other session), and `ctrl_q` (exit) routing, with `ctrl_s` / `ctrl_q` decoding in `input-handler.ts`. The [capability-gated fox welcome](./2026-08-22-tui-fox-welcome.md) replaces the former `formatWelcomeMenu` visual entry and owns the current hero, restore hint, tip, and settlement behavior.
- **Startup top bar, partially superseded**: `formatTopBar` (📁 cwd → model → (branch), dropping trailing segments when overwide, ascii mode maps 📁→`~`) still formats the startup welcome context line; branch comes from `gitBranch()` (execSync rev-parse, once at attach, silent). It is not persistent live chrome. Live identity and metrics live in the [Oh My Tianshu rebrand](./2026-08-15-oh-my-tianshu-rebrand.md) composer top-border status bar (`formatTopStatusBar`). Shortcut hints stay a footer duty.
- **Status line**: `formatTurnStatus` (running braille spinner frame loop / waiting pulsing ◆, null takes no slot, ascii degrades to `*`/`-`) replaces the glance status line's plain text — `LiveSnapshot.glanceStatus` type widens to `string | null`, and `renderGlancePanel` filters null.
- **Footer mode/hints, partially superseded**: `formatPromptFooter` (mode segment normal + [plan]/[plan…]/[auto] badge + shortcut hints, narrow width drops trailing segments but always keeps mode) still renders below the input line. Metrics no longer sit under the input or in the glance panel; the rebrand places them on the composer top border, so the live footer is mode and key hints only.

Architecture constraints honored: visuals remain format/ pure functions (narrow input → ANSI line, zero IO); app.ts only assembles; no new dependencies for these formatters.

## Verification

- Direct welcome keys remain covered in `app.spec.ts` and `input-handler.spec.ts`; current first-screen formatter coverage belongs to the [fox welcome verification](./2026-08-22-tui-fox-welcome.md#verification).
- `top-bar.spec.ts` pins startup context segments, drop order, ascii, width conservation, and truncation.
- `turn-status.spec.ts` pins null/empty omission, frame loop, idle glyph, ascii degradation, and width conservation.
- `prompt-footer.spec.ts` pins mode/hint layout, precedence, and narrow-width segment drop.
- `live-panels.spec.ts` and `app.spec.ts` pin glance-panel metrics removal and footer mode/hint assembly.
- Composer top-border metrics belong to the [rebrand verification](./2026-08-15-oh-my-tianshu-rebrand.md#testing).

## Files

- `packages/tui/tui/src/format/top-bar.ts`: `formatTopBar` (startup welcome context line)
- `packages/tui/tui/src/format/turn-status.ts`: `formatTurnStatus`
- `packages/tui/tui/src/format/prompt-footer.ts`: `formatPromptFooter` (mode/hints; optional `rightSegments` unused by app)
- `packages/tui/tui/src/ui/app.ts`: ctrl_n/s/q key routing, `gitBranch`, startup `formatTopBar`, turnStatus assembly, mode/hint footer below the input
- `packages/tui/tui/src/engine/input-handler.ts`: KeyName gains `ctrl_s`/`ctrl_q`, CTRL_CODES gains 0x11/0x13
- `packages/tui/tui/src/render/live-panels.ts`: renderGlancePanel drops the metrics segment, glanceStatus nullable filtering
- `packages/tui/tui/src/render/live-snapshot.ts`: glanceStatus type `string | null`
- Tests: `input-handler.spec.ts`, `top-bar.spec.ts`, `turn-status.spec.ts`, `prompt-footer.spec.ts`, `live-panels.spec.ts`, `app.spec.ts`

## Alternatives considered

**Top bar keeps the shortcut hints (original T6 semantics)** — rejected. Concept draft A's top bar only contains branch+cwd; shortcut hints belong to the bottom shortcuts line; the T6 test at 100 columns exposed the mixed-information problem by dropping the model segment when overwide. Live metrics later moved again to the [rebrand](./2026-08-15-oh-my-tianshu-rebrand.md) top-border status bar; startup context remains `formatTopBar`.

**Interactive welcome menu (grok-style selected highlight + Enter to execute)** — rejected. Direct ctrl+n/s/q routing does not need selection state, and the current fox welcome reserves its visible action hint for numbered restore rows rather than adding another startup overlay lifecycle.

**alwaysApprove badge reads `this.alwaysApprove`** — a type-error correction. The field actually lives on `ApprovalController` (`this.approval.alwaysApprove`), and the footer badge is sourced from the same place.

## Consequences

- Metrics left the glance panel and no longer form a persistent bottom metrics row; live placement is the rebrand composer top border, while the footer stays mode/hints.
- The nullable `glanceStatus` is a render-layer type widening; `renderGlancePanel`'s caller (renderLive only) filters null in sync.
- The current 92×24 capability-gated hero and its real Loader + PTY snapshot belong to the [fox welcome decision](./2026-08-22-tui-fox-welcome.md). This note remains the rationale for direct welcome keys, startup `formatTopBar`, `formatTurnStatus`, and the mode/hint footer contract.
