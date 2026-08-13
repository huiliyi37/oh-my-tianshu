# @deepseek-ai/dsh-jsonrpc-demo

English | [中文](README.zh.md)

Bin-only app that boots an external `cordis.yml`; its [`jsonrpc`](../../scaffold/server/README.md) entry serves SDK clients over newline-delimited stdio. The config composes the spine, backends, and serving plugin. The published bin is `dsh-jsonrpc-agent`, and `lib/bin.js` also ships as the `dsh-jsonrpc-agent-pkg` [single-executable runtime](../../../.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md) used by the Python SDK.

## Config discovery

The first non-empty channel wins: `$DSH_CORDIS_CONFIG`, then positional `argv[2]`. If neither names an existing file, the bin prints one-line usage to stderr and exits 1; there is no working-directory or built-in fallback. [`dsh-app-boot`](../../boot/app-boot/README.md) makes plugin load failures fatal. This protocol does not use `DSH_SNAPSHOT`.

A config without `dsh-jsonrpc` is valid and serves nothing; the bin does not designate a server plugin.

## Exit lifecycle

stdin EOF and `SIGTERM` dispose the root to quiescence and exit 0; `SIGINT` exits 130 after the same disposal. EOF may cut off an in-flight turn as documented in the [distribution Agent Note](../../../.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md). The `jsonrpc` plugin owns response-before-exit protocol shutdown; both paths are idempotent and safe to race.

## stdout is the protocol

stdout carries only JSON-RPC frames. The bin and boot guards diagnose on stderr, and the config must omit stdout loggers.

## Model Experience

Indirectly, through the plugins loaded from the external `cordis.yml`, which own every model-bound prompt, schema, message, and result; this bin adds none of its own.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **The bin cannot prove that the config serves JSON-RPC** — a valid config with no `dsh-jsonrpc` entry boots successfully and serves nothing.
- **No built-in or default config exists** — every launch must provide `DSH_CORDIS_CONFIG` or a positional path, and deployment owns the complete plugin tree and stdout discipline.
- **stdin EOF cuts off in-flight work** — client disappearance disposes the root immediately; callers that need orderly completion use the protocol-level `shutdown` request.
