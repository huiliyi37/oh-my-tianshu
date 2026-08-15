# Agent Note: Non-bracketed-paste terminals no longer submit pasted lines one by one

Status: implemented

English | [中文](2026-08-16-input-paste-line-burst-merge.zh.md)

## Problem

On terminals that do not support bracketed paste (DECSET 2004 — older Windows consoles, some SSH clients, tmux without passthrough), a multi-line paste arrives as raw bytes: each line's trailing CR (`\r`) is parsed as an Enter key, so every pasted line is submitted as its own message — "粘贴被换行分批发送". Bracketed-paste terminals wrap the paste in `\x1b[200~ … \x1b[201~` and take the `onPaste` path (whole segment, one insert), so the defect is invisible there. The physical CR is indistinguishable from a user's Enter, so the fix must use the surrounding data as evidence.

## Decision

`InputHandler` now tags a `return` key with `inline: true` when the same input buffer still holds bytes after it (`dispatchKeys`: `i + consumed < buf.length`). A user's Enter arrives alone at the end of a chunk; a pasted line's CR is followed by the next line's text in the same flush. `InputLine` treats an inline return as a line separator: it accumulates the current value (`_inlinePasteLines`) and clears the input line without submitting; the next ordinary return (buffer exhausted — i.e. the paste's final CR or the user's own Enter) merges all accumulated lines with `\n` into a single submit. The Vim-normal return path merges identically. Bracketed-paste flow is untouched (it never produces inline returns); a normal single Enter is unchanged (no accumulation pending → immediate single-line submit); rapid manual double-Enter stays two separate submits (each CR is alone in its chunk).

Applied to both repositories in lockstep: `tianshu-public` (`packages/tui/tui`) and the plugin repository `dsh-tui` (`src/`), which share the same source files without a common git ancestor — a generated patch was applied by semantics to each.

Known residual: a paste that the terminal splits across multiple flushes (e.g. >64KB, pipe-buffer boundaries) still submits per flush; bracketed-paste-capable terminals never hit this path.

## Alternatives considered

**Debounce submissions in a time window.** Rejected: merging requires the first line to be withheld, delaying every Enter; and lines already submitted cannot be retracted, so window-based merging still leaks the first line.

**Normalize all CR to newline insertion.** Rejected: breaks the Enter-submit semantics for ordinary input.

**Rely on bracketed paste only.** Rejected: it is already the fast path; the defect exists precisely where the terminal cannot provide it.

## Consequences

Multi-line paste on non-bracketed-paste terminals now lands as one message with `\n`-joined lines, matching the bracketed-paste behavior; the input line clears per line during the stream and shows the merged text only on submit. Tests cover the handler tag, the line-merge, the unchanged single-Enter path, and the app-level black-box case (three lines → one `followup` call). The plugin repository's working tree also carries the fix as unstaged changes on top of its in-progress `review/prs` merge.
