# Agent Note: Semantic-index refresh left prompt assembly and froze the TUI submit path

Status: implemented

English | [中文](2026-08-16-semantic-index-async-refresh.zh.md)

## Problem

Submitting a message in the TUI blanked the input box and everything else in the live region for seconds before the spinner appeared. A probe driving the real `tui` profile composition (TUI render row disabled, everything else mounted) measured `agent.followup()` returning synchronously after **1242–5107ms**; disabling only `tool-semantic-search` dropped the block to **18.5ms**. The mechanism: `handleSubmit` wipes the live region through `live.clearForCommit()` before driving the agent and repaints only after `followup()` returns, while `followup()`'s synchronous prefix (`turn()` → `preStep()` → `systemPrompt.assemble()`) runs every dynamic-context provider inline. The `semantic:index` provider called `index.isStale()` and, when stale, `index.incrementalUpdate()` — a full synchronous workspace walk plus a rehash of every indexed file (this repository: 10,440 source files seen, 500 indexed, snapshot ~2.4MB), on the caller's stack, with the 30s verdict TTL re-triggering the block throughout a conversation. The same synchronous pipeline also ran inside the `semantic_search` tool's `execute()`, freezing the UI mid-turn.

## Decision

Two layers, root fix first.

Root fix in `dsh-semantic-index`: every filesystem walk and snapshot write moved to `node:fs/promises` (`rebuild`, staleness scan, `incrementalUpdate`, `persistMeta`, `persistVectors`), and the mutation API collapsed into one public **single-flight** entry, `refresh(): Promise<RefreshOutcome>` (`{ stale, reindexed, removed, fallbackRebuild }`) — concurrent callers share the in-flight pass instead of racing duplicate scans; `isStale`/`incrementalUpdate`/`persistMeta` became private; constructor-time snapshot loads stay synchronous (one bounded read each, before any async caller can race). In `dsh-tool-semantic-search`, `renderIndexSummary` now renders in-memory state only (no staleness check — the summary may lag disk until the next refresh), `execute()` awaits `index.refresh()`, and plugin apply fires a background warm-up `refresh()` so the first summary approaches the old freshness without blocking anything.

Defensive layer in the TUI (`packages/tui/tui/src/ui/app.ts`): `handleSubmit` and `handleSteer` now paint a synchronous frame (`flushLiveRender()`) after committing the user bubble and **before** calling `followup`/`steer`, so any future synchronous block in the driver prefix can freeze the UI but can never blank the input box. The invariant: `commitToScrollback` clears the chrome; only a painted frame or a completed drive may follow.

Measured after the fix on the same composition: `followup()` sync return **43.0 / 6.8 / 2.7ms** across three submits (first includes tool-schema assembly warm-up), with `tool-semantic-search` still mounted.

## Alternatives considered

**Keep the assembly-time refresh but cache harder.** Rejected: any TTL window still re-blocked the loop mid-conversation, and the block duration scaled with workspace size — the provider shape itself was the defect.

**Move index work to a worker thread.** Rejected for now: the cost is IO wait, not CPU (a CPU profile of the block showed ~zero JS time), so `fs/promises` removes the event-loop block with no thread lifecycle, serialization, or teardown surface; chunking/BM25 over ≤500 files stays main-thread and bounded.

**Refresh the summary on filesystem watchers.** Rejected: adds watcher lifecycle and churn for a block whose only consumer is a diff-injected ~1KB context line; mount warm-up plus per-execution refresh is enough freshness for that surface.

**TUI-only fix (paint before driving, no index change).** Rejected as the sole change: it restores the input box but leaves the event loop frozen — no spinner animation, no keystrokes, delayed first token — for the full scan duration.

## Consequences

Prompt assembly no longer touches the filesystem through this plugin, and `semantic_search` scans proceed without blocking the event loop (first-search wall time on a cold workspace remains, documented in the package README). The `semantic:index` summary can lag disk between refreshes; the runtime-context content-diff still injects only on real change, and prefix-cache byte stability is unaffected (summary text remains a pure function of index state). The public index API is now `refresh()`/`rebuild()` plus the read surface — callers cannot reach a blocking scan. Tests cover the async-IO contract (a macrotask scheduled before `refresh()` runs before it settles), single-flight sharing, the edit/add/delete/fallback outcomes previously asserted through `isStale`, the summary's no-IO render (deleting every workspace file does not change it), and the TUI ordering regression (chrome painted before `followup` fires). The TUI frame-before-drive flush also hardens every other pre-step listener against future synchronous work.
