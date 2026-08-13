# Agent Note: History search overlay (C2 item 2)

Status: implemented

English | [中文](2026-08-11-tui-history-search-overlay.zh.md)

## Problem

The TUI relies on the terminal's native scrollback to find history, so conversation content cannot be searched inside the session at all: the parsing layer exists, but no container or key routing reaches it.

## Decision

Ctrl+F opens a full-screen overlay that searches the session's own conversation text synchronously on the main thread.

1. **The overlay** is alt-screen and reuses the OverlayController/OverlayEngine register/activate/deactivate pattern: printable characters go into the query (live search), Backspace deletes, n/N cycles through matches, p/P goes to the previous one, Esc/Ctrl+C closes. Ctrl+F is not intercepted while the palette is open, so the palette wins.
2. **smart-case**: a query containing uppercase → exact match; otherwise case-insensitive (grok's one-line rule).
3. **Data source**: `transcript.view.messages` (the adapter/transcript event projection). The adapter TranscriptMessage is `{seq/time/kind/turn/text/event}`, not the same type as the scrollback-transcript one (`rawContent/lines`), so the overlay consumes the `text` field through the minimal structure `SearchableMessage { text }` and does not depend on the scrollback version.
4. **Rendering**: a search bar (`/ <query>▌  N/M` current/total) + a message area (starting from the current match, each line truncated to the width, matching lines prefixed with a success-colored ▸) + bottom hints. An empty query shows 「输入搜索词（n/N 跳转，Esc 退出）」 (enter a search term; n/N to jump, Esc to exit).

## Verification facts

- `tests/history-search-overlay.spec.ts` 9 cases (smart-case sensitive/insensitive, goNext/goPrev cycling, backspace recomputation, an empty query, goNext no-op with no matches, rendered count/hints/match content) RED→GREEN, 9/9.
- `tests/app.spec.ts` 2 integration cases (Ctrl+F opens and renders the search hint + Esc closes; characters enter the query + the n jump is a no-op) RED→GREEN.
- Overlay rendering is asynchronous through renderBatcher.schedule (16 ms frame merging), so a test awaits the flush before asserting.
- Related specs 140/142 (the 2 failures are pre-existing at HEAD from parallel-session commit 59f655b: statusline wiring, tool-card rendering); a scratch type check of just these changes reports 0 errors, and the pre-existing app.spec errors belong to the parallel session.

## Files

- `packages/tui/tui/src/format/history-search-overlay.ts` (new): HistorySearchOverlay
- `packages/tui/tui/src/ui/app.ts`: registers the 'search' overlay + Ctrl+F key routing + key handling while the overlay is open (type/backspace/n/N/p/P/Esc)
- `packages/tui/tui/tests/history-search-overlay.spec.ts` (new): 9 cases
- `packages/tui/tui/tests/app.spec.ts`: 2 Ctrl+F integration cases
- `docs/dsh-tui-与grok的功能对比-c2.md`: item 2 marked ✅

## Alternatives considered

**A background search thread — grok's SearchDaemon plus query coalescing** — rejected. That index serves grok's multi-agent, million-line workloads; a DSH single session is small enough that synchronous main-thread search suffices, so no Worker is introduced.

**Consuming the scrollback-transcript message type** — rejected. Research found the adapter projection's TranscriptMessage carries `text`, while the scrollback-transcript type carries `rawContent/lines`; the overlay takes the minimal `SearchableMessage { text }` from the adapter projection rather than coupling to the scrollback shape.

**Regex queries** — rejected for this cut. The C2 document limits the overlay to smart-case substring matching, which is the behavior users expect from a one-line rule.

## Consequences

- Conversation text is searchable inside the session with n/N jumps, and the price is a snapshot: the message set is taken when the overlay opens, so messages that arrive during the search stay out of the results until it is reopened, and a live view would subscribe to changes on top of setMessages.
- Matching is substring smart-case only, so a pattern search has nothing here.
- Search stays on the main thread, which costs the overlay no Worker, no thread, and no new dependency.
- Evidence stops at the package tests: Ctrl+F with a keyword, n/N jumping between matches, and Esc returning to the main screen in the assembled `dsh --profile tui` are unverified.
- With this item the C2 batch is closed: items 1/2/4 implemented, item 3 confirmed by research to be covered by the existing tool-card truncation, item 5 confirmed by the user as not wanted.
