# Agent Note: Spilling the durable copy of Code Mode sub-dispatch results

Status: implemented

English | [中文](2026-07-26-code-dispatch-log-spill.zh.md)

> Scope: the fourth PR of the Code Mode UI stack — bounding the `tool/code-dispatch` event's content with the existing spill machinery. The [host foundation note](2026-07-26-code-dispatch-ui-foundation.md) accepted the unbounded log deliberately and named this PR as the payoff point; the [live-parallel note](2026-07-26-code-mode-live-parallel-dispatch.md) settled the event pair this shaping hooks into.

## Problem

Since the full-content dispatch logging landed, a `run_code` program that reads a large file wrote the complete rendered text into the session log — uncapped and outside spill policy, while native results were bounded to `maxInlineBytes` before logging. The asymmetry was backwards: sub-calls (built for bulk data work) were precisely the calls most likely to carry huge results, and the JSONL grew by megabytes per such turn.

## Decision

**A log-shaping waterfall on the registry, and the spill policy as its first listener.**

- **Extension point**: `tools/code-dispatch-log` — a scope-filtered waterfall the bridge runs (via the registry's PRIVATE `shapeDispatchLog` invoker, handed to the bridge as a capability closure in `RunCodeBridgeOptions` — the waterfall is the public contract, the invoker never widens the service surface; contained: a throwing listener falls back to the unshaped content, with total error formatting so a hostile thrown value cannot escape the containment) over each settled sub-dispatch before appending `tool/code-dispatch`. The payload (`CodeDispatchLog`) carries the outer execution, the hoisted `agent` routing key, the sub-call identity, and the default content — the RENDERED result projection a native `tool/result` would carry (the program itself received the structured `value`). Only the durable copy is shapeable; the model sees neither. Shaping runs OFF the program path as tracked side work, but bounded: past `maxParallelSubCalls` pending log tasks the ordered commit lane holds, so a slow spill backend backpressures the run instead of accumulating unbounded pending I/O; run settlement still drains every task inside the open turn.
- **Policy**: `dsh-spill-policy` registers a second arm on the new extension point sharing the exact replacement pipeline of its model-facing arm (same `maxInlineBytes` cap, same preview + locator + within-cap invariant, same best-effort fallbacks), with the artifact labeled `dispatch` under the sub-call id. UIs and replay read the full text through the spill artifact exactly as they do for spilled native results, so the native-parity rendering story survives bounding.
- **One deliberate asymmetry**: the model-facing arm skips `read` (the `read → spill → read again` loop); the dispatch-log arm bounds `read` sub-calls too — a log copy is not model context, so the loop cannot happen, and `read` is precisely the tool that produces huge logs.

## Alternatives considered

**Bound inside the bridge with a plain cap (no spill).** Rejected: truncation without a locator loses data replay/UIs may need, and re-introduces the "truncated summary" degraded render path the stack removed.

**Spill inside the bridge directly (call `ctx.spillStore` from code-mode.ts).** Rejected: the registry would grow a hard dependency on the spill capability; the waterfall keeps the policy where every other spill decision lives, composable and disable-able (omitted `maxInlineBytes` still means a true no-op).

**Reuse `tools/post-execute` for nested calls instead of a new event.** Rejected: post-execute shapes the PROGRAM-facing result (nested calls deliberately skip it so programs get complete data); the durable copy needs its own decision point after the program has its value.

## Consequences

The session log is bounded again for Code Mode turns — the README's Known Limitations entry about uncapped dispatch logging is resolved and now points here. Old logs with oversized dispatch content still replay (the event shape is unchanged; only future appends shrink). The web UI renders spilled sub-call output as the preview + locator text through the identical native path, no special casing.
