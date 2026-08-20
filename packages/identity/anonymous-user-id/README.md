# @huiliyi37/dsh-anonymous-user-id

English | [中文](README.zh.md)

Shared anonymous identity for the Tianshu Harness. `getOrCreateAnonymousUserId()` returns a random UUID v4 scoped to one harness home, persisted as the bare line `$DSH_HOME/.anonymous-user-id` (`~/.dsh-tianshu/.anonymous-user-id` when `DSH_HOME` is unset). The OpenTelemetry backend (`dsh-session-telemetry-otel`) reports it as the OTel Resource `user.id`, allowing receiving systems to correlate records without independently generated identities.

The identity is never derived from the hostname, network address, git remote, or another identifying source. Deleting `.anonymous-user-id` resets the identity on the next process launch. Separate harness homes have separate identities.

## Storage contract

Reads and writes are synchronous because both boot-time telemetry construction and direct command execution need one API. The result is memoized per resolved file path for the process lifetime. A first writer uses exclusive creation and a concurrent loser adopts the persisted winner; a corrupt file is replaced. Persistence is best-effort, so an unwritable home still receives a process-local UUID rather than blocking telemetry.

## Composition

This package is a shared library, not a Cordis plugin. Consumers import `getOrCreateAnonymousUserId()` directly. Its invariant companion is intentionally empty because the package owns no event stream or public mutable relation that can be checked without creating the identity as a side effect. `dsh-session-telemetry-otel` is the current consumer; other correlation consumers (feedback acknowledgement, provider requests) can adopt the same id without changing this package.

## Model Experience

None, as the identifier travels only as OTel Resource metadata and never enters the request body, prompt, or model-visible content.

#### KV Cache effect

None; the Resource attribute changes neither tokens nor the model-visible prefix.

## Known Limitations and Deferred Work

- **No recovery after deletion** — loss mints a new anonymous identity by design; recovery would require stable derivation material that weakens anonymity.
- **Best-effort concurrency** — a reader landing in the narrow interval between a concurrent process's exclusive create and completed write can use a different in-memory UUID for that run; later launches converge on the persisted value.
- **No cross-home identity** — different `$DSH_HOME` values cannot be correlated.
- **`.userid` migration** — the earlier telemetry-local implementation (removed by this package's port) persisted to `.userid`; existing files are not migrated, and the next launch mints a fresh id under the canonical `.anonymous-user-id` name.
