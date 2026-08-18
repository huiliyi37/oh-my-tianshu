# Agent Note: Session-end consolidation behind a success gate

Status: implemented

English | [中文](2026-08-18-memory-consolidate.zh.md)

## Problem

Successful sessions leave reusable facts, corrections, and methods only in a closed event log. Failed sessions mix those signals with unresolved errors. The [sqlite provider](2026-08-18-memory-sqlite-structured-ltm.md) already exposes `markUncertain` and `retireStale`, but nothing calls them, and nothing writes structured experiences at task end. `session/flush` is a per-request durability checkpoint, not the end of a task.

## Decision

`@huiliyi37/dsh-memory-consolidate` listens on `session/disposed`. A success gate (`standard`: last turn; `strict`: whole session) requires at least one completed turn and no unresolved tool error or observable test failure in range. Passing sessions extract candidates; failing sessions write only `failure-pattern` experiences when `recordFailures` is true. The default extractor is heuristic and makes no model calls (explicit remember, user correction, error→resolution, decision, conservative procedure from method-encoding corrections). `extractor: 'llm'` makes one bounded structured call after dispose and falls back to the heuristic on any failure. Writes land in `global` with `source: 'auto'` and `sourceRefs`. Same-pass (subject, predicate) conflicts probe `markUncertain`; each pass may probe `retireStale`. Consolidation failures are log-only and never block teardown. Child sessions are skipped unless `consolidateChildSessions`. `llmProvider` / `llmModel` must be paired. No shipped composition mounts this plugin.

## Alternatives considered

**Hook `session/flush`.** Rejected: flush runs many times per request; dispose is the one terminal leave-store signal.

**Default `extractor: 'llm'`.** Rejected: every session end would pay a model call; the zero-extra-call default is the contract, and LLM failure already falls back.

**Mount in shipped TUI, or mix success facts into failed sessions.** Rejected: TUI stays on Markdown memory tools; failed-session facts would poison LTM.

## Consequences

Hosts that opt in get session-end writes into whatever `memory` provider they mounted, without changing the live request path. Sqlite conflict and retirement methods gain a caller; Markdown skips them via `typeof` probes. Coverage: `packages/memory/memory-consolidate/tests/*.spec.ts` (gate levels, heuristic rules, LLM parse/fallback, dispose wiring, `markUncertain` / `retireStale` probes, child-session skip).
