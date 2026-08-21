# Agent Note: agent-router Turn-End Trigger Skips the Zen Phase and Leaves the Publish Window

Status: implemented

English | [中文](2026-08-21-agent-router-trigger-zen-skip-and-window.zh.md)

## Problem

The turn-end trigger ran unconditionally: at every `turn/end`, the `session/event` observer called `runTrigger`, which — in shadow mode, before its first `await` — appended `router/decision` synchronously. That append happened while `Session.append` was still inside the `turn/end` publish window (`entry.appending === true`, observers invoked synchronously in the same window), so the reentry guard threw, the error propagated to the top level, and the process exited: the shipped TUI (`trigger: { mode: 'shadow', onTurnEnd: true }`) crashed deterministically whenever the router's metrics produced a delegate decision, restarting into session resume each time. The same observer path also fired during a session's opening turns, where the zen phase's restricted read-only face makes tool outcomes noise rather than a routable signal — recording delegate decisions there (or dispatching, under `auto`) misreads anchoring probes as struggle.

The reentry survived tests because the integration harness drives the observer with a fake session whose `append` is a bare array push — the real `Session.append` publish window was never exercised.

## Decision

Two gates on the turn-end trigger, both in the `session/event` observer:

1. **Zen-phase skip** — the trigger reads `foldZenPhase(owner.events)` and returns while the folded phase is `'zen'`. A log with no `zen/phase` events folds to `'full'` (never armed), so assemblies without zen are unaffected; subagent sessions were already excluded by the `parentSession` check. The router therefore starts participating at the first turn end after promotion — by anchor predicate, timeout, or triage.
2. **Microtask deferral** — `void queueMicrotask(() => …runTrigger(owner))` moves the whole trigger (including shadow's synchronous record append) out of the `turn/end` publish window; the decision still lands immediately after the event it answers.

Prediction accumulation (`tool/result` → `recordPrediction`) is unchanged: zen-phase probes still feed the window, and the tipping-point reset already models recovery — the gate is on acting, not on observing.

## Alternatives considered

- **Weakening the reentry guard** (allow nested appends). Rejected: "one event fully published before the next" is the log-ordering contract session observers rely on; the trigger was the violator.
- **A turn-count warm-up** (skip the first N turns). Rejected: a magic constant where a logged, folded fact (`zen/phase`) states the exact condition; a session that anchors for five turns and one that promotes on its first probe want different warm-ups.
- **Catching the reentry error in the observer.** Rejected: it would silently drop every shadow decision — the crash was the guard doing its job loudly.

## Consequences

- The shipped TUI no longer crashes at delegate-worthy turn ends; shadow decisions record reliably, which is the point of shadow validation.
- Zen-phase sessions produce no `router/decision` records and dispatch nothing under `auto`; observability of the opening turns is deliberately traded away (the metrics themselves still accumulate).
- `@huiliyi37/dsh-zen` becomes a peer of `@huiliyi37/dsh-agent-router` for `foldZenPhase` (a pure function over logged events — no runtime plugin coupling).
- Tests pin all three behaviors: zen-phase suppression (auto asserts no dispatch), post-promotion resumption, and the publish-window exit (`emit` returns with zero records; the decision lands only after the microtask).
