# Agent Note: Default session-telemetry mount (OTel reporting) in the dsh web composition

Status: implemented

English | [中文](2026-07-31-web-telemetry-default-mount.zh.md)

## Problem

The telemetry seam and OTel backend ([revival Note](2026-07-23-session-telemetry-otel-revival.md)) had never been wired into any deployment composition since completion: no roster row, no switch, no cadence ruling, and zero observability over user sessions for the internal deployment. A deployment decision was needed: which surfaces report, to where, on what cadence, how to opt out, and how CI stays isolated.

## Decision

The shared `dsh` base (`apps/cli/config/base.cordis.yml`) mounts the `telemetry-otel` row by default with a baked-in production endpoint, so Web and headless report; the raw-config command also mounts it before applying its required deployment overlay. This is the **internal-testing deployment stance** — reporting is on when an endpoint exists, and users opt out through the environment. Web and headless use the [bounded, escalating process-shutdown controller](../bug-fix/2026-08-03-cli-signal-shutdown-escalation.md) on SIGINT/SIGTERM, giving the backend's three-second shutdown deadline time to drain before the five-second launcher bound.

| Ruling | Value | Rationale |
|---|---|---|
| Mount surface | base.cordis.yml (raw config + Web + headless) | One deployment stance for every tree that loads the shared base; the raw overlay decides whether that deployment creates sessions |
| Endpoint | `DSH_TELEMETRY_OTLP_URL`, default `https://harness-telemetry.deepseeksvc.com/v1/logs` | Internal collector; the env override serves local/dev runs |
| Opt-out switch | any non-empty `DSH_TELEMETRY_DISABLED` (including `0`/`false`) disables | A privacy switch prefers off-by-mistake over on-by-mistake; a row can only be disabled at AppCLIEntry's patch layer (config has no disable semantic, and the switch must precede the load-time `exporter.url` validation) |
| Cadence | `processor.scheduledDelayMillis: 10000` (10s/batch) | Streaming while the session runs, never exit-time-only; a crash loses at most the last unexported interval |
| Exit-drain bound | `exporter.timeoutMillis: 1000` + `maxExportBatchSize: 2048` (== maxQueueSize) + `exportTimeoutMillis: 1500` + `shutdownTimeoutMillis: 3000` | Ordinary unreachable-collector failure releases in ~1s: timeoutMillis is the per-attempt socket timeout and retry deadline, while one queue-sized batch avoids sequential drain multiplication. The DSH-owned 3s outer bound covers the SDK's preceding unbounded `forceFlush()` wait when the transport Promise never obtains a socket. |
| Compression | `compression: gzip` | Event bodies carry full content; cross-datacenter bandwidth |
| CI isolation | top-level `env: DSH_TELEMETRY_DISABLED: '1'` in all 8 GitHub workflows | Every CI channel that boots the web composition (e2e/snapshot/built smokes) must not stream test sessions to the production endpoint |

The keyless integration test `apps/cli/tests/telemetry-web.e2e.ts` pins the deployment-level behavior: an in-test OTLP collector plus a mock LLM server, a real `dsh web` boot, asserting ledger coverage, seq monotonicity, the first-of-step chunk projection, and the ops `shutdown` marker arriving through the SIGINT drain.

## Alternatives considered

**No default mount; deployments add the row themselves (continuing the SDK stance).** Rejected for this stage: this repo's web/headless composition IS the internal deployment, and default-on reporting is that deployment's product requirement; the SDK stance survives in the Service Definition packages (unmounted = nothing leaves).

**A config field instead of an env patch for the switch.** Infeasible: cordis rows have no config-level disable semantic, and `exporter.url` validation fails loud at plugin construction, so the switch must take effect before the Loader — AppCLIEntry's patch layer is the only seat.

**A `Promise.race` timeout backstop around exit.** Originally deferred because the SDK parameters appeared to bound the backend's drain to ~1.5-3s (typically <100ms), with measured SIGINT-to-exit of 110ms-1.1s. A Linux sandbox reproduction later proved that `BatchLogRecordProcessor.shutdown()` can wait forever in `exporter.forceFlush()` before reaching its `exportTimeoutMillis`-bounded completion Promise. The [CLI shutdown fix](../bug-fix/2026-08-03-cli-signal-shutdown-escalation.md) therefore adds both a three-second backend bound for that specific gap and a five-second process-level bound plus repeated-signal escape for the whole plugin tree.

## Consequences

- A developer running `dsh web` without a local collector POSTs to the production endpoint every 10s (silent failure when unreachable; no OTel diag logger is registered); local development sets `DSH_TELEMETRY_DISABLED=1` or points `DSH_TELEMETRY_OTLP_URL` locally.
- **No redaction rule is mounted yet**: exports are the raw captured copy (full user/assistant message text, tool arguments and results, the system prompt, the local `session.cwd` path). Crossing a trust boundary requires `telemetry/record` rules first — the redaction rule, the remaining identity Resource attributes (hostname / surface; the anonymous user id shipped via the [anonymous-user-id Note](2026-07-31-telemetry-anonymous-user-id.md)), and the usage-metrics track are the explicit follow-ups of this decision.
- Test rigs reusing this tree (e.g. `apps/web/tests/scaffold.ts`) must explicitly disable the row, or fixture sessions stream to whatever collector the environment happens to name.
