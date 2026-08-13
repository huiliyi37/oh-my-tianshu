# @deepseek-ai/dsh-subprocess-local

English | [中文](README.zh.md)

Local Service provider for the [`@deepseek-ai/dsh-subprocess`](../subprocess/README.md) seam. `LocalSubprocessService` resolves local executables, spawns ordinary detached process trees with explicit stdio, and implements terminal processes through `node-pty` plus platform process inspection. It has no config: every disposition, limit, terminal dimension, grace, and directory arrives from the calling capability seams ([`dsh-bash-local`](../../bash/bash-local/README.md), [`dsh-lsp-local`](../../lsp/lsp-local/README.md), and [`dsh-pty-local`](../../pty/pty-local/README.md)).

## Behavior (and where it came from)

- **Detached process trees with platform-correct signalling** — POSIX children are spawned `detached` (own process group) and signalled by negative pgid with a direct-child fallback; Windows terminates the tree via `taskkill /PID <pid> /T /F`. `terminate()` — the handle's only termination verb — sends SIGTERM then SIGKILL after the spec's grace (OpenCode's escalation; pipelines and subshells die with the parent) and is a no-op once the tree is gone; `waitForExit()` polls whole-tree liveness so consumer teardown confirms real quiescence. After the leader exits, still-open pipes receive the same bounded drain grace so a surviving descendant cannot hold the outcome open indefinitely. ESRCH is tolerated; daemons that re-parent away from the group can still survive — the same caveat as the surveyed tools.
- **Per-stream dispositions** — `'pipe'` hands the raw stream to the caller untouched (protocol framing stays consumer-owned); `'inherit'` passes the parent descriptor through; collect mode keeps the in-memory TAIL beyond its cap (errors and results cluster at the end — pi/OpenCode rationale) while the FULL stream is appended to a private temp file when a spill cap is configured — omitting `spill` keeps only the tail, the diagnostic shape. A stream larger than the spill cap discards its now-incomplete spill and returns only the marked truncated tail; spill fds are sealed at settlement, and a failed final close withholds the path rather than advertising an incomplete file. Spill files are `0600` with random names under a lazily-created `0700` per-process directory.
- **Credential scrub + explicit merge** — `process.env` minus credential-shaped vars (`*KEY*`/`*PASSWORD*`/`*SECRET*`/`*TOKEN*`) and all ambient `DSH_*` names; the spec's explicit `env` merges after that scrub with no namespace validation, so a deliberately supplied credential or current `DSH_*` fact wins while stale nested-harness identity cannot leak in ambiently. Supplied stdin is written and closed; otherwise fd 0 is `/dev/null`. See the [stdin/env Agent Note](../../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-surface.md) and [managed environment Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-agent-session-identity-and-log-location.md).
- **Offset-based reads** — collect-mode readers return deltas in whole-stream byte coordinates; the service never holds a cursor, so consumer-owned cursors (the bash background read path) and full-stream re-reads coexist, before and after settlement.
- **Executable lookup** — `resolveExecutable` checks absolute files or searches the scrubbed effective PATH with platform-aware executable extensions; relative paths containing separators are rejected at the seam, and relative PATH entries resolve from the host process cwd.
- **Terminal-process ownership** — `spawnTerminal` allocates `node-pty`, bridges UTF-8 terminal text, inspects and signals the current foreground process group, and exposes one awaited termination operation that sweeps descendants before and after terminating the top-level shell. Each foreground inspection retains exact identities from the rooted tree; Linux also enumerates the POSIX session after its leader exits. A previously observed macOS descendant and any same-session Linux member therefore remain fenced after reparenting, while pid/start identity prevents cleanup from following PID reuse. The higher PTY backend owns prompt readiness, buffers, and model-facing operations.
- **Terminate-and-join disposal** — the service retains live handles only so its own disposal can escalate every running tree and await its exit; settled and spawn-failed handles leave the live set on settlement.

## Model Experience

Indirectly, through Consumers (today the bash executor family behind `dsh-tool-bash`), which own all model-facing rendering of process output and lifecycle.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

- **Windows tree support is best-effort** — termination routes through `taskkill /PID <pid> /T /F` with all outcomes contained (absent tree, races, missing binary), and liveness falls back to the direct-child boundary.
- **Terminal process inspection is Linux/macOS only** — the terminal primitive fails when its inspector has no supported platform implementation; Linux exact probes cover x64 and arm64, while macOS uses `ps` snapshots.
- **A daemonized terminal descendant can still escape the observable boundary** — on macOS, a child that reparents before any foreground-inspection snapshot is no longer discoverable from the `node-pty` root; on Linux, a child that calls `setsid` leaves both the tree and owned terminal session. The local provider does not add a continuous process-table monitor.
- **The credential scrub is a name heuristic** — `*KEY*`/`*PASSWORD*`/`*SECRET*`/`*TOKEN*` only; differently-named secrets (e.g. `*PASSPHRASE*`) pass through, and a whitelist for over-scrubbed vars is noted future work.
- **Completed spill files are not deleted** — bounded full-output recovery files (and the private per-process spill dir) accumulate under the OS tmpdir until something external cleans them; oversize incomplete spills are discarded and deletion is attempted immediately, but a cleanup failure can leave a bounded file behind.

The raw process handling lives in `src/spawn.ts`; `src/index.ts` is the service wiring.
