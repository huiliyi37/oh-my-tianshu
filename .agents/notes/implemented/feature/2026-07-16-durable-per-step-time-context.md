# Agent Note: Durable per-step time context

Status: implemented

English | [中文](2026-07-16-durable-per-step-time-context.zh.md)

## Problem

A request-only clock can tell the model the current time, but replacing that value in the system prompt removes the evidence behind earlier time-sensitive reasoning. Multi-step turns need requests to retain the readings that shaped preceding steps. The request must remain reconstructable after restart, and automatic compaction must account for the same timing context the model receives.

A process-local refresh cache makes displayed time depend on state that cannot survive resume or be reconstructed from the durable session. Durable interval scheduling can reduce append frequency without introducing that hidden state.

## Decision

`@deepseek-ai/dsh-time-context` is an opt-in function plugin in `packages/context/time-context/`. The `context/` group holds bounded request-context enrichments that define neither a tool nor a service, and shipped examples do not mount this plugin because its time-zone disclosure and token cost are deployment policy. It registers a prepended `agent/pre-step` listener and, when a reading is due and the downstream decision enters, returns one additional `UserMessage`. The message carries source `{ kind: 'plugin', plugin: 'time-context' }`; a suppressed, rejected, or failed attempt appends nothing.

The listener samples before `step/start`, then settles its reading only in the final enter decision. AgentLoop records it after `step/start` and before request derivation. A downstream rejection or failure therefore prevents the reading from entering durable history.

The optional `timeZone` config resolves the Node process's IANA zone once at plugin load when omitted; an explicit value is validated by `Intl.DateTimeFormat`. The timestamp includes the numeric UTC offset and resolved IANA zone.

The optional `refreshIntervalMs` config is manually validated at plugin load as a non-negative safe integer. Omission or `0` injects on every eligible preparation attempt. A positive value scans the raw session events for the most recent `user/message` with this plugin's source and injects when none exists, wall time moved backward, or the event is at least the configured age. The raw event timestamp governs even after compaction shadows the message, so scheduling persists across turns and process resume without a timer or process-local cache.

### Text and elapsed baselines

An injected first-step reading is:

```text
Time sampled while preparing turn <turn>, step 1: <timestamp>
Elapsed since the preceding model-visible message: <duration-or-unavailable>.
```

The baseline is the latest preceding user, assistant, tool-result, or steering message. This includes the accepted prompt that opened an ordinary message turn. If no model-visible message exists, the duration is `unavailable`.

An injected later-step reading is:

```text
Time sampled while preparing turn <turn>, step <step>: <timestamp>
Elapsed since the preceding step context: <duration-or-unavailable>.
```

Their baseline is the durable event timestamp of the preceding time-context message in the same turn. If interval suppression leaves no earlier same-turn reading, the duration is `unavailable`. Duration formatting uses compact whole-second units and clamps backward wall-clock movement to zero. The explicit turn and step make every retained reading attributable to its historical preparation attempt after later turns append more context.

### Durability and request reconstruction

Each reading remains a normal surface node until compaction shadows it; positive interval scheduling never removes existing readings. A later request therefore sees the cumulative unshadowed readings that affected earlier preparation and steps, rather than a system-prompt value rewritten in place.

The plugin contributes nothing to system-prompt assembly. `request/header` contains no time-context text; request reconstruction obtains the complete durable surface prefix at each `step/start`. Readings and requests need not map one-to-one because interval suppression can enter a request without appending a reading, while rejection or failure appends neither. The plugin depends on the agent registry for its lifecycle listener and does not require the system-prompt service at runtime.

## Testing

Unit and real-loop tests pin formatting, both elapsed baselines, interval omission and zero, threshold boundaries, cross-turn and per-session scheduling, backward-clock behavior, invalid config, resumed raw-event lookup after compaction, aborted-signal behavior, later-listener cancellation and failure, listener disposal, source and surface metadata, cumulative multi-step visibility, and absence from request headers. A keyless subprocess e2e boots the real Loader with the Headless composition, drives two ordered one-shot turns, and verifies the persisted plugin-attributed messages externally.

## Alternatives considered

- **Keep the dynamic system-prompt section and process-local refresh cache** — rejected because replacement erases earlier readings, cache state is not replayable, and a frozen request envelope would make the value stale for an entire loop instance.
- **Replace the preceding context surface node** — rejected because replacement preserves the old node's position or shadows intervening conversation; neither represents when the new reading became visible.
- **Inject from a background timer** — rejected because idle time has no pending request to consume the value, and timer-driven injection would create durable turns solely to report time passing.
- **Expose time only through a tool** — rejected because ordinary temporal reasoning would require an avoidable tool round trip and would not guarantee a reading before every step.
- **Use `agent/session-prefix`** — rejected because one loop-instance prefix cannot represent distinct step timestamps and does not accumulate historically attributable readings.
- **Mutate assembled requests or register independent prompt variables** — rejected because request-local insertion bypasses the durable surface and separate providers can sample different instants. One attributed context message records the timestamp and elapsed baseline atomically.
- **Default to UTC or add a time-zone detection dependency** — rejected because an explicitly mounted plugin follows its process environment unless the operator selects an IANA zone, while no server-side library can infer a remote user's zone.
- **Mount the plugin in shipped compositions or place it in `core/`** — rejected because disclosure, time zone, freshness, and history cost are deployment choices for an optional context leaf, not product-spine policy.

## Consequences

- Omission or `0` records every eligible preparation attempt; a positive interval reduces append frequency and history growth while preserving durable scheduling across resume.
- Timing context remains append-only until compaction shadows older surface nodes, including a preparation reading left by a later cancellation or failure.
- The first-step duration normally measures from the prompt that opened the turn, while later-step durations measure model and tool processing since the preceding step context.
- An omitted `timeZone` still reflects the deployment process rather than a remote user, and elapsed time still uses durable harness append boundaries rather than client-origin timestamps. Supporting client-origin time requires a separate durable input contract.
