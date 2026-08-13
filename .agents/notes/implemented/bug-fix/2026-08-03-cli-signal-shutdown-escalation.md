# Agent Note: Bounded, escalating signal shutdown for Web and headless

Status: implemented

English | [中文](2026-08-03-cli-signal-shutdown-escalation.zh.md)

## Problem

The default telemetry mount added SIGINT/SIGTERM handlers to `dsh web` and the headless command (now `dsh run`) so process exit could drain the Cordis tree instead of dropping queued telemetry. Each handler used a one-way boolean latch and exited only after `ctx.fiber.dispose()` settled. Headless normal completion also awaited that disposal without a bound.

A user then reproduced the headless command hanging immediately after the observation URL and ignoring repeated `Ctrl+C`; `DSH_TELEMETRY_DISABLED=1` removed the hang, while a standalone Node handler in the same Linux sandbox received SIGINT. This isolated the pending disposer to telemetry rather than terminal signal forwarding. OTel's `BatchLogRecordProcessor.shutdown()` awaits `exporter.forceFlush()` before the `exportTimeoutMillis`-bounded completion promise, and the OTLP exporter's `forceFlush()` waits directly on its in-flight HTTP Promise. A proxy/sandbox connection that never obtains a socket can therefore leave provider shutdown pending despite both configured SDK timeouts.

The latch then turned that telemetry defect into an unkillable CLI: normal completion was already awaiting the single-shot root disposal; the first SIGINT joined the same pending disposal and set the signal latch; later SIGINTs returned at the latch, so the process had no remaining escape. A signal received before normal completion had the same unbounded wait. Web used the same latch shape.

Telemetry's own timeouts cannot prove that the whole plugin tree settles. Any current or future disposer can wedge, and the process boundary must preserve both a graceful first attempt and a user-controlled way out.

## Decision

The fix has two ownership layers. The OTel backend adds `shutdownTimeoutMillis` (default and shipped value: three seconds) around the SDK provider's complete shutdown Promise. Crossing it rejects into the telemetry coordinator's existing contained-failure path, allowing the Cordis tree to finish disposal; pending records may be lost because OTel exposes no cancellation for the transport Promise.

Web and headless share `createProcessShutdown`, one process-level controller around root disposal:

- Normal shutdown calls coalesce onto one disposal and retain the first requested exit code; they never escalate one another.
- The first signal starts the same graceful disposal and a referenced five-second exit backstop. Disposal success or failure exits once; neither can cancel the process exit.
- A signal received while shutdown is pending forces immediate exit with that signal path's code. This includes the first `Ctrl+C` after headless normal completion has already entered disposal, and a second signal after a signal initiated the drain.
- The five-second bound is a process-safety invariant, not a deployment tunable. It is long enough for the telemetry deployment's ordinary drain ceiling while still bounding any wedged disposer at the launcher boundary.

Headless preserves exit 0 for a completed turn, exit 1 for another turn-end reason or API business error, 130 for SIGINT, and 143 for SIGTERM. Web preserves its existing SIGTERM exit 0 and SIGINT exit 130 behavior.

This supersedes the [telemetry deployment Note's](../feature/2026-07-31-web-telemetry-default-mount.md) assumption that SDK exporter/processor timeouts bound complete provider shutdown, and its earlier decision to defer a process-level backstop. The backend owns its export loss/latency policy and closes the known SDK `forceFlush()` gap; the launcher owns the outer guarantee that no plugin can trap the process indefinitely.

## Alternatives considered

**Bound only the telemetry backend's `shutdown()`.** Insufficient because it protects the known OTel wait but cannot protect the launcher from another plugin's disposer.

**Restore Node's default immediate signal exit.** Rejected because a healthy first signal should still flush telemetry and release other resources. Immediate exit is the explicit escalation path, not the default.

**Add only the five-second timeout.** Rejected because a user pressing `Ctrl+C` again is asking to stop waiting now. Swallowing that intent for the rest of the grace period recreates the reported behavior at a shorter duration.

## Consequences

A healthy exit still disposes the complete Cordis tree. The known telemetry wait releases after at most three seconds; any other wedged exit lasts at most five seconds without further input, and a repeated signal ends it immediately. Forced or deadline-bounded exit can interrupt telemetry export or remaining cleanup, which is intentional only after the graceful contract has failed or the user has explicitly escalated.

The controller is launcher infrastructure rather than a Cordis plugin: it makes no claim that disposal completed, and it does not weaken the lifecycle rule that ordinary disposers must reach quiescence.

## Testing

`apps/cli/tests/process-shutdown.spec.ts` pins resolved and rejected disposal, the five-second backstop, normal-call coalescing, a signal interrupting normal disposal, and second-signal escalation.

`apps/cli/tests/headless-shutdown.e2e.ts` boots the real shipped Web/headless Loader tree in a PTY with a test-only plugin whose disposer announces entry and never settles. The test sends SIGINT after the observation URL, waits for proof that disposal started, sends SIGINT again, and requires exit 130. The source/artifact launch resolver keeps the same regression on both execution planes. This PTY case covers the user-visible process state; no model-output snapshot changes.

`packages/session/session-telemetry-otel/tests/otel.spec.ts` holds a real OTLP request open after timer export begins and pins that Cordis disposal returns at `shutdownTimeoutMillis`, despite the SDK's `forceFlush()` remaining pending. The collector is then released so the still-observed provider Promise settles cleanly.
