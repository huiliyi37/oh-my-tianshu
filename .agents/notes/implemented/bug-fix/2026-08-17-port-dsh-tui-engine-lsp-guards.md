# Agent Note: Port dsh-tui engine, LSP-Windows, windowsHide-guards, and flaky-test fixes

Status: implemented

English | [中文](2026-08-17-port-dsh-tui-engine-lsp-guards.zh.md)

## Problem

The sibling repository `dsh-tui` (`/Users/banxia/app/deepseek-tui/dsh-tui`, the TUI plugin for official dsh) landed five fix-oriented commits after this repository's last port round (`a112c85e`). Their user-visible defects all reproduce here because the shared TUI sources are near-identical: multi-line ↑↓ navigation computed the column in code units, so moving across lines landed the cursor inside surrogate pairs/ZWJ emoji clusters (broken cursor, inserts splitting emoji); the resize chain let `sips` guess the output format from the output path extension; on Windows, LSP servers installed as `.cmd` (npx/npm) fail to spawn with EINVAL and a server that dies before its initialize reply leaves `ensure()` hung forever (rpc.request has no timeout); a dozen short-lived subprocess call sites lacked `windowsHide: true`, flashing conhost windows on Windows; and two load-sensitive flaky tests (fluency stale advancing 200s of fake timers synchronously through ~1700 full renders, two onPaste tests sleeping fixed 40/60ms) failed under full-suite concurrency.

## Decision

Port the fix subsets by semantics into `packages/tui/tui` (source `ba45980`, `e33052c` LSP part, `9eef2f5` windowsHide subset, `86cea46`), skipping sibling-infra-only parts (their CI matrix, lib-bundle freshness gate, dev entry script, RSS budget, line-count ratchet, self-update cache — this repository has its own gates and no self-update) and the `c74c0a8` preferences feature (a feature, not a fix; ported scope is fixes only).

Engine (`ba45980`): `getLineCol`/`posFromLineCol` switch columns to grapheme counts through the existing `graphemeBoundaries` helper (4 regression tests); `OverlayRenderer` gains an optional `caret` hook — the caret write moves out of the empty-diff short-circuit, a DECSCUSR steady bar suppresses native cursor blink during input-style overlays, and exit restores the user's default cursor shape (4 tests); `ClipboardReader` gains an optional `readText` so the text fallback path is test-sealed against real `pbpaste` (3 tests); `resizeCandidates` passes `-s format png` explicitly, aligned with the `toPngCandidates` chain (integration assertion).

LSP (`e33052c`): `defaultLspSpawn` on win32 dispatches through `ComSpec` (`cmd.exe /d /c`) with argv arrays, `shell` stays false (DEP0190), plus `windowsHide`; `manager.initialize` races the initialize request against a process-death promise (`error`/`close` reject it), so an early-dying server settles initialize into the catch path with `ready=false` instead of hanging `ensure()` forever; new `tests/lsp-multi-manager.spec.ts` (7 tests).

windowsHide sweep (`9eef2f5` subset): every `child_process` call site in `packages/tui/tui/src` now passes `windowsHide: true` (app.ts git ×3, clipboard ×5, image-tool, external-editor ×2, server-registry which/where; restart/statusline/file-completer already had it). A new `tests/architecture-guards.spec.ts` enforces the invariants as red-green tests with a self-check block (planted violations must be caught): no `process.stdout.write` in src (single write layer through the injected WriteStream; stderr diagnostics stay allowed), every subprocess call carries `windowsHide` (scanner includes `execSync`, going beyond the sibling's regex), and `format/`/`render/` stay free of IO imports. The sibling's line-count ratchet was not ported — its baselines are that repository's C4-splitting history, not this one's.

Flaky tests (`86cea46`): the fluency stale test now jumps time with `setSystemTime(+200s)` and advances one second with `advanceTimersByTimeAsync` (the stale verdict reads `Date.now() - lastEventAt` at render time, not ticker count); the two onPaste image tests replace fixed sleeps with `vi.waitFor` conditional polling.

## Alternatives considered

**Cherry-pick the sibling commits.** Rejected — the repositories share no merge base; diffs conflict wholesale against the rebranded/restructured trees, and most commits mix portable fixes with sibling-only infrastructure.

**Port `c74c0a8` (prefs persistence) in the same round.** Deferred — it is a feature (prefs file layer, theme/panel persistence, input-history file, three extractions), not a fix; porting it deserves its own round with this repository's bundle-config wiring.

**Skip the guard spec, sweep the call sites only.** Rejected — the repo convention wires mechanically checkable invariants into an executed gate; without the guard the next spawn site regresses silently.

## Consequences

Multi-line editing no longer splits emoji across ↑↓ navigation; input-style overlays can render a boundary-accurate hardware cursor without inheriting terminal blink (no current overlay uses the caret hook yet — the capability lands with the engine contract); clipboard-text tests no longer depend on host clipboard state; PNG resize no longer depends on output-path extensions; Windows users get working LSP spawn and no flashing conhost windows; the TUI suite is stable under full-suite concurrency. `SOURCE-MAP.md` entries updated for the seven touched provenance rows. All affected suites pass (input-line/overlay/clipboard/image-attach 52, LSP 43, guards 6, app.spec fluency/onPaste groups), and the repo-wide oxlint stays clean on changed files.
