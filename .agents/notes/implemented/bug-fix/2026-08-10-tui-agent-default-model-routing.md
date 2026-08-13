# Agent Note: Route TUI agents through the default-model selection

Status: implemented

English | [中文](2026-08-10-tui-agent-default-model-routing.zh.md)

## Problem

Every TUI turn failed with `agent … has no provider/model`. `TuiApp` created agents with only a `sessionId` — no `AgentOptions.provider/model` and no `agent/request` waterfall participant — while the headless front door routes through the `agentDefaultModel` service plus `installModelSelection`. The `tui` profile composition already mounted `@huiliyi37/dsh-agent-default-model` over `dsh-base`; the runner simply never consumed it.

## Decision

The TUI mirrors the headless wiring. The runner's inject list gains `agentDefaultModel`. `newSession` passes `agentOptions: { provider, model }` from `currentSelection()` and installs model selection in `setup`, coupling prompt assembly and request routing. `switchSession`'s resume path prefers the session's persisted request-header route — a session keeps its model across restarts — and falls back to the current default selection only when no header was ever logged, which also repairs sessions persisted while routing was absent.

## Alternatives considered

**Apply the current default on resume, ignoring the persisted header.** Rejected: resuming an old session would silently continue it on a different model, contradicting the route the session log already recorded for its turns.

**Pass `agentOptions` without `installModelSelection`.** Rejected: it diverges from the other front doors' request-shaping path and drops the assembly-time provider/model variables the selection hook supplies.

## Consequences

`@huiliyi37/dsh-tui` declares a peer and dev dependency on `@huiliyi37/dsh-agent-default-model` plus a tsconfig project reference. Sessions created during the unrouted window need no manual cleanup: resuming one logs a fresh `initial` request header from the default route on its next turn.
