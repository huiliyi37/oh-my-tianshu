# `@deepseek-ai/dsh-telemetry`

English | [中文](README.zh.md)

Launcher-side telemetry primitives for the dsh-sdk toolchain. This is a plain library the launcher imports around each command; it is **not** a Cordis plugin, because `build` and first-init `create` never boot Cordis. Wiring the reporter into the launcher command dispatch and adding the telemetry consent feature to the `dsh-helper` catalog live in their owning packages, not here.

| Export | Role |
|---|---|
| `SecretRedactor` | Conservative safety backstop: replaces secret-shaped values (secret-like keys, known token shapes, PEM blocks, URL credentials, high-entropy opaque tokens) with a placeholder in both parsed values (`redactValue`) and raw text (`redactText`). Never drops a field or line. |
| `ConsentResolver` | Parses (never boots) a project `cordis.yml` and reads the telemetry entry's enabled/disabled state as consent; `DO_NOT_TRACK`/CI env force a hard opt-out. |
| `buildTelemetryPayload` | Assembles `{command, durationMs, success, cordisYmlContent, packageJsonContent}`, running the redactor over the full `cordis.yml` and `package.json` text. Never reads `.env`; `package.json` ships only alongside a `cordis.yml`, so a command run in a non-SDK directory never uploads that directory's unrelated manifest. |
| `getOrCreateAnonymousId` | Random UUID persisted in the harness home resolved by [`@deepseek-ai/dsh-paths`](../../util/paths/README.md) (`$DSH_HOME` > `~/.dsh`), scoped to that home rather than the machine, never derived from git. |
| `TelemetryReporter` | Fire-and-forget send: `report()` never blocks or throws; delivery resolves on every path; `flush()` optionally drains in-flight sends within a cap. |

Consent is carried by the telemetry entry in `cordis.yml`, so disabling telemetry is disabling that entry. Telemetry reports by default and is off only when a present telemetry entry is explicitly `disabled`: a missing `cordis.yml` (first `create`), an enabled entry, or a `cordis.yml` with no telemetry entry all report. `DO_NOT_TRACK`/CI always deny. The no-config and absent-entry defaults are configurable on `ConsentResolver`.

The collection endpoint is a fixed constant (`DSH_TELEMETRY_ENDPOINT`); its fail-safe `.invalid` placeholder must be replaced with the real endpoint before release.

## Model Experience

None, as the reporter sends developer-cycle telemetry from the launcher and never reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Placeholder endpoint** — `DSH_TELEMETRY_ENDPOINT` points at `.invalid` until the real endpoint is set.
- **Redaction is heuristic** — a conservative backstop, not a guarantee; secrets belong in `.env`, which is never read or reported.
