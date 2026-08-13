# Agent Note: Restore stdin state symmetrically after terminal-background detection

Status: implemented

English | [中文](2026-08-10-tui-theme-detect-stdin-restore.zh.md)

## Problem

On a real TTY, `dsh tui` rendered the idle status and prompt but accepted no keystrokes, not even Ctrl+C. The `TuiApp` constructor creates the `InputHandler`, which enables raw mode, resumes stdin, and subscribes to `data`; `attach()` then runs `detectTerminalBackground()` for the default `theme: 'auto'`, whose cleanup unconditionally called `stdin.pause()`. `pause()` is stream-level state: it stops `data` delivery to every listener, including the just-attached `InputHandler`, and nothing in the process ever resumed the stream. Raw mode stayed enabled, so the terminal did not echo either — the UI looked alive while every keystroke byte was dropped. The package's tests inject a non-TTY fake stdin that takes the env fallback before the pause path, so the defect shipped green.

## Decision

`detectTerminalBackground` restores the stream to its entry state on both the response and timeout paths: it captures `wasPaused = stdin.isPaused()` next to the existing `wasRaw` guard and calls `stdin.pause()` on the way out only when the stream was paused on entry. The module contract changes from "must be called before the TUI takes over stdin" to a restore guarantee that holds whether or not takeover already happened.

## Alternatives considered

**Enforce the call-before-takeover ordering** by constructing the `InputHandler` lazily after detection, or by detecting before `TuiApp` construction. Rejected: a larger restructuring to honor a contract the function documented but did not implement; the symmetric restore fixes the defect at the violating line and stays correct under either ordering.

**Re-resume stdin in `attach()` after detection.** Rejected: it papers over the destructive teardown at one call site while leaving `detectTerminalBackground` unsafe for every other present and future caller.

## Consequences

Theme detection no longer disturbs a flowing stdin; regression tests with a fake TTY stream pin the OSC 11 response, timeout, and paused-at-entry paths. Keystrokes typed during the up-to-500 ms detection window are still parsed before key routing is registered and are silently dropped — a pre-existing startup-window gap this change deliberately leaves alone.
