# Agent Note: Interactive /config Panel

Status: implemented

English | [中文](2026-08-22-tui-config-panel-interactive.zh.md)

## Problem

`/config` was a read-only live-area projection: four flat sections dumping raw settings namespaces, pin states, permission options, and one hardcoded `DEEPSEEK_API_KEY` badge, with no navigation and no edits — the TUI's only surfaces for changing anything were individual slash commands. The competitor's `/config` (opencode-tui) demonstrated the expected shape: a two-column framed overlay where categories organize fields and Enter edits them.

## Decision

`/config` is now an interactive two-column framed overlay (`ConfigPanelController` in `config-panel.ts` — state machine plus renderer behind the OverlayRenderer contract, services injected by the assembler). Four categories: 模型 (default model, reasoning effort, three role pins), 权限 (preset), 凭据 (per-provider key status from the `/key` wizard's directory and reference resolution), 概览 (read-only resolved settings namespaces with redaction marks). Enter dispatches per-field actions back to the assembler, which opens the same editors the commands use — the `/model` picker, role pickers, an effort picker (options from `resolveModelInfo` efforts), a permission-preset picker (the `/permission` write path on the live session), or the provider's `/key` dialog.

Two deliberate divergences from the competitor. **No draft/dirty/save machinery**: every write surface here hot-applies (role pins, default-model selection, permission apply, credential set), so Enter means edit-and-done and a status line replaces save choreography — the competitor needs drafts because its config is a file. **Reopen choreography over overlay stacking**: the overlay engine switches rather than stacks, so an edit deactivates the panel, the editor runs, and its close path (picker commit/Esc, key-dialog close) calls `finishConfigReturn()` to rebuild data and reopen at the same field (`refresh` locates cursors by category/field key). The old live-area projection path (`configPanelVisible`/`configProjection` snapshot fields, `renderConfigPanel`, the `/clear` special case) was removed with the behavior change.

## Alternatives considered

- **Porting the competitor's draft/dirty-block save model wholesale.** Rejected: it solves a problem this harness does not have (file-based config needing atomic multi-field writes); hot seams make immediate effect both simpler and more truthful.
- **Editing fields in place (inline editors per field type).** Rejected for v1: the pickers already exist and are battle-tested; inline editing would duplicate them inside the panel for marginal gain.
- **Keeping the read-only panel and adding a separate /settings editor command.** Rejected: two surfaces for one concern; the panel itself was the right surface.
- **An overlay stack (return-to-previous).** Rejected: the engine's single-active-overlay switch is a load-bearing simplicity (every overlay assumes exclusive focus); the reopen choreography preserves the UX without changing that contract.

## Consequences

- `/config` edits take effect immediately; the panel shows current state on every reopen (data rebuilt from the seams each time).
- The credentials category inherits the key wizard's directory/ref resolution, making the panel and `/key` mutually reinforcing entry points.
- Read-only degradation is uniform: missing services drop categories (模型 always present with `—` values), and fields without a write path render dimmed with a 只读 status on Enter.
- Width math is display-width-exact (CJK 2-cell) with per-column budgets and centered window scrolling on both columns; the footer truncates under budget (a real overflow the tests caught).
- The effort picker reads `resolveModelInfo` per open; providers without reasoning metadata fall back to the fixed `off/high/max` offer.
