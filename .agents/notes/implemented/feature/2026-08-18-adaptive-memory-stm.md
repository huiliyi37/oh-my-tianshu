# Agent Note: Intent-gated STM snapshot on the append-on-change channel

Status: implemented

English | [中文](2026-08-18-adaptive-memory-stm.zh.md)

## Problem

A memory digest in the system prompt rewrites the request prefix after every save. The [widened `MemoryService` seam](2026-08-18-memory-seam-prefix-stable-digest.md) and [sqlite provider](2026-08-18-memory-sqlite-structured-ltm.md) store ranked, versioned facts, but nothing yet selects a per-intent working set or injects it without touching the prefix. Default-on injection at the placeholder 0.82/0.55 thresholds would dump almost nothing on a tiny BM25 corpus, or too much once scores are calibrated, if it shipped as a product default.

## Decision

`@huiliyi37/dsh-adaptive-memory` is an opt-in plugin. It derives intent from the session log (first user message, or a later one with a goal verb; paths and error codes become entities), evaluates once per turn on the `system-prompt/assemble` waterfall, and injects a canonical STM snapshot through `ctx.systemPrompt.context()` (`memory:stm`, order 120). The gate re-renders only on intent-key change, a relevant topic-version change, a new entity, or `reviewIntervalTurns`; otherwise the cached bytes stay identical. Decisions are log-only session events (`memory/cache-hit`, `memory/cache-miss`, `memory/stm-selected`, `memory/reminder`).

When the mounted `memory` service exposes `topicVersions()`, retrieval uses scored `search` plus a conjunctive entity filter and a three-tier confidence gate (high → body, medium → index line, low → omit). Markdown has no scores, so it keeps list-plus-substring index lines. `topicBoosts` only lifts hits that already have a score. A `tools/result` observer may append a `memory:reminder` line for an uncovered path or error code, capped per turn and per intent. Missing `memory` fails loud at first evaluation; inverted thresholds or illegal boosts fail at load. No shipped composition mounts this plugin.

## Alternatives considered

**Merge `github/dev` wholesale, or mount adaptive-memory in shipped TUI.** Rejected: TUI stays on Markdown plus `/remember` and `/memory`; placeholder thresholds are not a product default, and sqlite cannot share the `memory` key with Markdown.

**Hang evaluation on `agent/pre-step`.** Rejected: the loop assembles the prompt before pre-step, so a refresh there never lands in the current snapshot.

**LLM intent detection, or default-on aggressive injection.** Rejected: extra model calls on every turn, and uncalibrated scores would either inject almost nothing or rewrite the tail constantly.

## Consequences

Hosts that opt in get an append-only STM tail that leaves the system-prompt prefix byte-stable. Markdown and sqlite remain interchangeable behind capability probes. On-demand raw-history questions use [`dsh-tool-memory-recall`](2026-08-18-tool-memory-recall.md), which does not consume the `memory` key. Coverage: `packages/memory/adaptive-memory/tests/*.spec.ts` (Markdown fallback, sqlite structured path, cache hit/miss reasons, reminder budget, fail-loud config, log-only invariants).
