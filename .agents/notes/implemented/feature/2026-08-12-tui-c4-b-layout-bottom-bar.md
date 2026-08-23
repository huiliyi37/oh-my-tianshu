# Agent Note: TUI C4 concept B layout wave — input bottom edge line / welcome session cap / footer merge

Status: implemented

English | [中文](2026-08-12-tui-c4-b-layout-bottom-bar.zh.md)

## Problem

The TUI bottom area and welcome page diverged from the concept draft: the startup list lacked a cap, so a large session count could fill the first screen, and the input line had no lower edge to distinguish the composer. The selected concept B layout called for a concise startup list and a bottom-edge line without a full enclosing frame.

## Decision

Three pure-function-layer choices per layout B (zero IO, width-conserving, ascii-degradable):

- **Input chrome edge, partially superseded**: this wave chose a mode-colored bottom-edge line under the input without a full enclosing frame (B「bottom edge rounded box only」). That edge symbol is gone; current input chrome is owned by `formatInputFrame` and the [Oh My Tianshu rebrand](./2026-08-15-oh-my-tianshu-rebrand.md) composer top-border status bar (`formatTopStatusBar` + mode-reactive `promptBorderColor`).
- **Welcome session list cap, partially superseded** (`restore-session.ts`): `formatRestorableSessions` retains its backward-compatible `maxRows` option and fold hint. The current startup area projects up to three numbered rows through `formatRestorablePickerList`; the [session-resume decision](./2026-08-20-session-resume-visibility.md) owns digit routing, and the [fox welcome decision](./2026-08-22-tui-fox-welcome.md) owns the final composition and cap.
- **Footer right-merge capability, partially superseded** (`format/prompt-footer.ts`): `formatPromptFooter` still exposes optional `rightSegments` as a pure-function merge (right-align into the same line; drop trailing right segments when they do not fit). The app does not pass `rightSegments`. Live metrics and API status sit in the rebrand's `formatTopStatusBar` on the composer top border; the footer renders mode badge and key hints only.

## Verification

- `restore-session.spec.ts` pins limited, over-total, unlimited, and numbered-picker row behavior.
- `prompt-footer.spec.ts` pins mode/hint layout and optional `rightSegments` merge when callers supply it.
- `app.spec.ts` pins the mode/hint footer and the current three-row numbered welcome projection.
- Composer top-border metrics and input-frame chrome are covered by the [rebrand verification](./2026-08-15-oh-my-tianshu-rebrand.md#testing).

## Files

- `packages/tui/tui/src/format/prompt-footer.ts`: mode/hint footer with optional unused-by-app `rightSegments` merge
- `packages/tui/tui/src/restore-session.ts`: `RestorableOptions.maxRows` + fold hint line
- `packages/tui/tui/src/ui/app.ts`: welcome projects at most three numbered rows; live footer gets mode/hints only (no `rightSegments`)
- `docs/dsh-tui-视觉概念稿-c4.md`: decision record section 8
- Tests: `restore-session.spec.ts`, `prompt-footer.spec.ts`, `app.spec.ts`

## Alternatives considered

**Full-width divider line above the input line (concept C main-screen shape)** — rejected: the user explicitly said「no enclosing frame lines」, choosing B's bottom-edge rounded line only. Current composer chrome ownership is the [rebrand](./2026-08-15-oh-my-tianshu-rebrand.md).

**Welcome session list defaulting to 5 + digit-key selection (concept C session picker)** — rejected in this layout wave because the requested first-screen cap was one. The later [session-resume decision](./2026-08-20-session-resume-visibility.md) adds digit routing, and the [fox welcome decision](./2026-08-22-tui-fox-welcome.md) settles on at most three visible rows rather than five.

**Metrics merged into the footer unconditionally** — rejected here because B wanted a narrow-screen stacked fallback. That layout is obsolete: metrics live in the rebrand top-border status bar, and the footer no longer carries them.

## Consequences

- `formatRestorableSessions` keeps an optional `maxRows` parameter; default unlimited behavior is unchanged for callers that omit it.
- Optional `rightSegments` remains a pure-function capability on `formatPromptFooter` but is not part of the live assembly contract.
- Startup hero, row cap, and settlement belong to the [fox welcome](./2026-08-22-tui-fox-welcome.md); digit routing belongs to [session-resume visibility](./2026-08-20-session-resume-visibility.md); input chrome and metrics placement belong to the [rebrand](./2026-08-15-oh-my-tianshu-rebrand.md). This note remains the rationale for the B-layout choices that still shape those later owners.
