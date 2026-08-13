# Agent Note: TUI C4 concept B layout wave — input bottom edge line / welcome session cap / footer merge

Status: implemented

English | [中文](2026-08-12-tui-c4-b-layout-bottom-bar.zh.md)

## Problem

The TUI bottom area and welcome page diverge from the concept draft: ① the welcome page prints every restorable session (`formatRestorableSessions` has no cap), so a large session count fills the first screen; ② the input line is bare text with no line or frame below it, unlike the claude-code-style input box. User selection: **concept B「Deep dive」(claude-code layout), no enclosing frame lines, do B's style first**; the welcome page rarely re-enters old sessions — "show just one".

## Decision

Three pure-function-layer changes per layout B (zero IO, width-conserving, ascii-degradable):

- **Input bottom edge rounded line** (new `format/input-divider.ts`): `formatInputDivider` emits `└` + `─`×fill (ascii degrades to `+`/`-`), colored by mode — normal `secondary` / plan (active/pending) `warning` / auto (alwaysApprove) `error`, sharing the footer badge vocabulary. Rendered below the input line in `renderLive` (B「bottom edge rounded box only」: whitespace above/below the input area, no enclosing frame).
- **Welcome session list cap** (`restore-session.ts`): `formatRestorableSessions` gains a `maxRows` option (absent/≤0 means unlimited, backward compatible); when exceeded only the first maxRows rows render plus a fold hint「… 还有 N 个会话」. `app.ts` passes `maxRows: 1` on startup.
- **Footer single-line merge** (`format/prompt-footer.ts`): `formatPromptFooter` gains optional `rightSegments` (token/model/API status etc.). Wide terminals (≥ `FOOTER_RIGHT_MERGE_MIN_WIDTH` = 80 columns, B's narrow-screen vertical-stack threshold) right-align them into the same line, dropping right segments back-to-front when they do not fit; narrow terminals keep the standalone metrics line (B「two stacked rows on narrow terminals」). `app.ts` feeds `glanceBarSegments(...)` output plus an `API ✓/✗` segment (read `DEEPSEEK_API_KEY` once at construction) as right segments; the metrics line is no longer rendered separately when merged.

## Verification

- New `tests/input-divider.spec.ts` 8 cases: shape/ascii/three mode colors/width≤0 empty array/width conservation.
- `tests/restore-session.spec.ts` +3: maxRows=1 fold hint, maxRows over total no fold, maxRows≤0 unlimited.
- `tests/prompt-footer.spec.ts` +5: wide-screen right-aligned merge, right segments dropped back-to-front, narrow no merge, empty right same as default, extreme-narrow mode-only degradation.
- `tests/app.spec.ts` +2 wiring: wide (100 cols) output contains `└─+` and `API ✗` (merge path); narrow (70 cols) has the bottom line and no API segment (standalone-row path).
- TUI full **1354 passed / 2 todo** (76 files); `tsc --noEmit` 0 errors; oxlint 0 errors; `verify-export-jsdoc` passes; the three changed files are 100% covered (prompt-footer's unreachable branch carries a `v8 ignore` note per repo convention).

## Files

- `src/format/input-divider.ts` (new; later superseded by `packages/tui/tui/src/format/input-frame.ts`): `formatInputDivider` + `FormatInputDividerInput`
- `packages/tui/tui/src/format/prompt-footer.ts`: `FOOTER_RIGHT_MERGE_MIN_WIDTH` + `rightSegments` merge (`mergeRightSegments` private helper)
- `packages/tui/tui/src/restore-session.ts`: `RestorableOptions.maxRows` + fold hint line
- `packages/tui/tui/src/ui/app.ts`: welcome passes `maxRows: 1`; renderLive renders the bottom line, wires footer right segments (`glanceBarSegments` + `apiKeyReady` field), standalone metrics line on narrow terminals
- `packages/tui/tui/SOURCE-MAP.md`: registers `src/format/input-divider.ts` (new)
- `docs/dsh-tui-视觉概念稿-c4.md`: decision record section 8
- Tests: `input-divider.spec.ts` (new), `restore-session.spec.ts`, `prompt-footer.spec.ts`, `app.spec.ts`

## Alternatives considered

**Full-width divider line above the input line (concept C main-screen shape)** — rejected: the user explicitly said「no enclosing frame lines」, choosing B's bottom-edge rounded line only; the message-area/input-area separator above is deferred until real-terminal acceptance.

**Welcome session list defaulting to 5 + digit-key selection (concept C session picker)** — rejected (this round): the user said「show just one」; digit-key routing and resume interaction are deferred to a later wave.

**Metrics merged into the footer unconditionally** — rejected: B mandates two stacked rows below 80 columns; the standalone metrics line stays as the narrow-screen fallback.

## Consequences

- On wide terminals (≥80 columns) metrics no longer occupy a standalone row; token/cache/model segments move to the footer's right side and drop with width — model-layer info (cache hit rate) is invisible when very narrow, an intended B-layout information degradation.
- `formatRestorableSessions` gains an optional parameter; default behavior is unchanged (existing callers unaffected).
- Multiline input (Wave 3), ghost-text suggestions, the ASCII-art welcome page, and session digit-key selection remain for a later batch (per the C4 decision record).
