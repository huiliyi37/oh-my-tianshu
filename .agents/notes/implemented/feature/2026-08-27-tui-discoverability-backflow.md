# Agent Note: TUI discoverability backflow and atomic commit choreography

Status: implemented

English | [中文](2026-08-27-tui-discoverability-backflow.zh.md)

Scope: `packages/tui/tui` (`command-palette.ts`, `commands/registry.ts`, `format/prompt-footer.ts`, `prefs.ts`, `ui/app.ts` commit paths)

## Problem

Five shipped TUI surfaces lagged the sibling plugin `dsh-tianshu-tui` (the official-host fork of this render core). Unknown commands dumped a 40-plus name table; the Ctrl+P palette browsed one flat list; the footer showed one fixed hint forever; input-area information density had no user control; and mid-stream commits cleared the live region synchronously but handed the redraw to the 16 ms write-batcher tail, so the input rail visibly vanished for a frame after every settled paragraph or reasoning block.

## Decision

The batch was backported from sibling commits (palette grouping `bdd5ced`, suggestions `030c672`, density + choreography `ed3fdc1`, carousel `5584aae`, choreography guards `c0653f4`), each as its own commit, with three deliberate divergences.

**Atomic commit choreography.** `TuiApp.atomicScrollbackWrite` wraps clear-live → write-scrollback → synchronous-redraw in `CSI ?2026h/l`. `commitToScrollback`, overlay-deferred flushes, both image raw-write paths, and reasoning-block commits all go through it; stream and reasoning commits no longer call `renderBatcher.schedule()`. Abort discards stream residue *before* committing `⏹ 已取消`, because the commit now redraws synchronously and residue in peek/pending would otherwise be painted into that frame. Regression guards scan all stdout bytes for CSI 2026 nesting depth: settled text and reasoning head rows must sit inside depth ≥ 1, the input rail must be redrawn before the window closes, and final depth must return to 0.

**Local preferences.** New `src/prefs.ts` persists `footerInfo` to `~/.dsh-tui/prefs.json` — deliberately the same file the official host plugin writes (same convention as the shared `~/.dsh-tui/themes` directory). Writes are merging: only keys this package models are overwritten; unknown keys survive verbatim so each tool can no longer erase the other's settings. `VITEST` seals reads/writes off unless an explicit path is injected (`TuiAppOptions.prefsPath`).

**Info density maps onto this repo's C4-B layout, not the sibling's two-line footer.** The sibling keeps metrics on a second footer line; this repo moved them into the input-frame top bar earlier. `/info` therefore cycles `full` (top bar identity + metrics segments plus footer hint row), `compact` (keeps model/effort identity, zen badge, API/git markers; drops metric segments), and `off` (no top bar, no footer — two rows back for content). The two-line layered footer primitives from the sibling were not ported.

**Discoverability tables are closed contracts.** `PALETTE_COMMAND_GROUPS` must cover every `BUILTIN_COMMAND_NAMES` entry (guard test); the palette renders stable group order (`会话/配置/认证/面板/技能/其他`) with unregistered commands under 其他. `/info` registers before `/density` because the slash-menu wrap contract test anchors `/density` as the last item. `FOOTER_TIPS` rotates idle hints every 10 s weighted 3/2/1; contextual states (approval pending, agent busy, newline mode) keep their fixed operational hints. Adding a builtin command means adding both a group row and (for discoverability) a tip row.

Unknown commands now answer with up-to-three suggestions (Levenshtein ≤ 2 and ≤ half input length, common-prefix ≥ 2 fallback) or a `/help` pointer instead of the full command dump.

Not backported, deliberately: env-driven welcome tips (the auto key dialog already owns unconfigured-key guidance here), the README i18n hash guard and `.ts`→`.js` import fix (sibling-build-specific), and the sibling's uncommitted onboarding WIP.

## Alternatives considered

### Why not port the two-line layered footer verbatim?

It would re-plumb where metrics live against a layout this repo already changed; `/info`'s value is the density switch, not the sibling's DOM.

### Why not write prefs as whole-file replacement like the sibling does?

Two binaries share one file on the same machine. Whole-file writes from this side would silently drop keys the official-host plugin models (`theme`, `preset`, `notifyOs`, …) whenever a user toggles `/info` there and here.

### Why not keep the density level session-local?

The sibling feature persists; a toggle that resets every launch would not honor "回流" semantics, and the shared-file risk is answered by the merge-write rule above.

### Why not fold these into the existing chrome-closed-loops note?

That note owns decision honesty ([p] persist, allowed-always, activity band, idle ticker). Discoverability, persistence durability, and the commit choreography are separate contracts a maintainer may revisit separately.

## Consequences

Bought: discoverability loops (grouped palette, rotating tips, suggestion-driven error recovery), a durable density preference, and a flicker root fix with mechanical regression guards.

Cost: two new mandatory tables grow with every builtin command; `~/.dsh-tui/prefs.json` becomes a cross-tool contract whose key set changes must consider both consumers; abort ordering is now load-bearing (commit implies immediate redraw), so reintroducing deferred redraws without revisiting `handleAbort` will repaint stale residue into the sync window.

## Verification

Focused suites: `command-palette.spec.ts` (group coverage guard, grouped render), `commands.spec.ts` (`suggestCommands` thresholds), `app.spec.ts` (suggestion echo, menu-wrap anchor, `/info` cycle incl. off-row suppression and disk write), `prefs.spec.ts` (merge-write preserves foreign keys, VITEST seal), `prompt-footer.spec.ts` (weighted rotation, contextual hints, width conservation), and `commit-choreography.spec.ts` (three CSI 2026 depth scans).
