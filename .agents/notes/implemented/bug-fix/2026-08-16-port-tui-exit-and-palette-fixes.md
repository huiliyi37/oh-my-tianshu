# Agent Note: Port TUI exit-lifecycle and command-palette fixes from the dsh-tui sibling repository

Status: implemented

English | [中文](2026-08-16-port-tui-exit-and-palette-fixes.zh.md)

## Problem

The TUI shared two defects already fixed in the sibling repository `dsh-tui` (`huiliyi37/dsh-tianshu-tui`, fetched as `dshtui/*` refs): live frames hide the hardware cursor and `dispose()` never showed it again, and user exit (`Ctrl+Q`) left stdin paused without exiting the host, so the shell could not take the TTY back; and `Esc`/`Ctrl+C` in the command palette was swallowed by the three existing branches (only `Enter` closed it, refilling the `/command` into the input line) while the palette footer advertised "Esc 关闭". Both repositories share 109 of 117 TUI source files but have no common git ancestor, so the fixes could not be cherry-picked or merged; each side evolved independently.

## Decision

Port both fixes by semantics into `packages/tui/tui` (`@huiliyi37/dsh-tui`), adapting names to this repository's `@huiliyi37` scope and structure.

User exit (`Ctrl+Q` / `/exit` / `SIGINT`) now disposes and then exits the host: `index.ts` gained `requestHostExit()`, which prefers the host's `appExit` capability via `runtimeCtx.reflect.get('appExit', false)` and falls back to `process.exit(0)`, and `teardown(quit)` distinguishes user-initiated quits from plugin-unload cleanup, which only disposes and leaves process lifetime to the host. `TuiApp.dispose()` now deactivates a still-active overlay (leaving the alternate screen) and writes `ANSI.SHOW_CURSOR` after `live.clear()`, so the TTY returns to the shell with the hardware cursor visible. A new `/exit` slash command routes through the same `onExit` path via the `requestExit` `BuiltinCommandDeps` slot.

The command palette handles `escape` and `ctrl_c` before the `return` branch: both close the palette without committing or refilling the input line, matching the search/memory overlays and the footer hint.

This repository has no `USAGE_TEXT` help block (its keymap lives in the `Ctrl+.` panel), so that portion of the upstream fix was not applicable.

## Alternatives considered

**Cherry-pick the two upstream commits.** Rejected because the repositories share no merge base; the diffs would conflict wholesale against this repository's rebranded and restructured files, and the upstream patches reference `@deepseek-ai` imports.

**Merge or fetch `dshtui/main` into this repository.** Rejected because the two histories are unrelated; a merge would entangle this repository with the sibling's 96-commit divergent history instead of carrying two focused fixes.

**Only fix the palette and defer the exit lifecycle.** Rejected because the exit defect is the more damaging one (a shell that cannot take its TTY back), and `/exit` without host exit would still strand the shell.

**Write `/exit` as a standalone command instead of a `requestExit` dep.** Rejected because routing through `onExit` keeps one exit path (`Ctrl+Q`, `/exit`, and empty-input `Ctrl+C` all reach the same dispose-then-exit sequence), matching the sibling fix.

## Consequences

User-triggered exits now terminate the host process after flush, while plugin unload remains dispose-only — the harness owns process lifetime on teardown. The cursor is restored on every dispose path, including attach failure. `/exit` joins `BUILTIN_COMMAND_NAMES`, making `/ex` ambiguous with `/export` (resolution returns null, no guessing). Tests cover `Ctrl+Q`, `/exit`, `Esc`/`Ctrl+C` palette close, `appExit(0)` preference, `process.exit(0)` fallback, and the plugin-unload path not exiting; `process.exit` is spied so tests never kill the runner. `term-caps.ts` and the `app.ts` `tailLines` line remain with pre-existing lint findings unrelated to this change.
