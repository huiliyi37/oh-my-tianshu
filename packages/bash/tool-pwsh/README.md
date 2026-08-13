# @deepseek-ai/dsh-tool-pwsh

English | [中文](README.zh.md)

The model-facing `pwsh` tool registered over the `ctx.bash` executor seam. Intended for Windows compositions where a PowerShell executor (e.g. `@deepseek-ai/dsh-pwsh-local`) backs `ctx.bash`; the tool contract is PowerShell-dialect: native `C:\...` paths and `$env:NAME` variables. Behavior mirrors `dsh-tool-bash` call-for-call minus the sandbox surface — foreground and `run_in_background` execution through the generic task runtime, the managed `DSH_*` environment through the shared `bash-env` registry, and the bash marker/truncation rendering story (a clean exit produces no marker).

Requires a loaded executor implementation and the `bash-env` plugin; the tool stays pending until both exist (`inject: ['tools', 'bash', 'systemPrompt', 'bashEnv']`).

The package root exposes only the Cordis plugin contract (`name`, `inject`, `Config`, `apply`); result rendering (`src/render.ts`) and background-task adaptation (`src/background.ts`) mirror the bash tool's structure and stay reachable through the package's `./src/*` export.

The plugin also contributes the `tool:pwsh` prompt section (order 105): non-zero exits are reported as `[exit code: N]` markers, and Windows interruption settles as exit 1 without a signal marker.

## Tools

### `pwsh`

| Arg | Type | Notes |
|---|---|---|
| `command` | string (required) | Run via `pwsh -Command`. No state persists between calls — use `workdir`, not `cd`. |
| `description` | string (required) | One-line, active-voice summary of the command (5-10 words), for UI/log display only — no effect on execution. |
| `timeoutMs` | number | Timeout override in milliseconds. The executor applies its configured default and cap. |
| `workdir` | string | Working directory for this call. Defaults to the calling agent's session cwd (`session.header.cwd`) so each session runs in its own workspace; a relative `workdir` is resolved against that same identity. |
| `run_in_background` | boolean | Return a task id immediately; no timeout applies. |

`command`, `workdir`, and `timeoutMs` are resolved against the executor's config defaults via `ctx.bash.resolve()` before execution. The workdir default is applied in the tool layer from the calling agent's `session.header.cwd` BEFORE `resolve()` — the per-session cwd must come from `exec.agent`, since N sessions share one executor; only when no session cwd is available does the executor fall back to its own config / `process.cwd()`.

### Managed shell environment

Every foreground and background model pwsh call receives a freshly collected trusted `DSH_*` environment through the shared [`dsh-bash-env`](../bash-env/) registry: `DSH_HOME` (the absolute Harness home), `DSH_SHELL=1`, the agent's `DSH_SESSION_ID`, and `DSH_SESSION_JSONL` when the active persistence backend locates one. Plugins contributing `DSH_*` facts to `ctx.bashEnv` apply to pwsh calls exactly as they do to bash calls. The snapshot passes through the dedicated `BashExecRequest.dshEnv` channel; `process.env` is never modified. The description teaches the generic `$env:DSH_*` convention rather than naming persistence-specific variables.

Result text contains stdout, an optional `[stderr]` section, then applicable truncation, timeout, signal, and exit markers. A clean exit (0, no signal) produces no marker; an empty body renders as `(no output)`. Truncation links a safe complete spill file or reports it unavailable. Timeout is reported independently of final exit status; nonzero exit remains a model-interpreted result rather than `isError`. Windows reports forced termination as exit 1 without a signal, so `[killed by signal: …]` is POSIX-only there. Only infrastructure failures — spawn errors and aborts (`tool call aborted`) — produce `isError`.

The canonical success is `{ kind: 'foreground', ...BashRunResult }` for a completed foreground process or `{ kind: 'background', taskId }` for a published task. The renderer preserves exactly `started background task <id>` for background acks; programmatic consumers use the typed fields without parsing the rendered text.

When `run_in_background` is true, this plugin preflights `ctx.tasks.start()` before spawning, registers the calling agent as owner, and adapts the returned `BashProcess` handle into generic cancel/done/incremental-output hooks. The task runtime owns ids, cross-session isolation, completion notices, waiting, and disposal cleanup; this plugin only maps pwsh exit facts into task output and outcome detail. `enableRunInBackground: false` removes the parameter and rejects a forced background call at execution time.

## UI presentation

The tool owns its `presentCall`/`presentResult` render intent. A foreground call is a `terminal` card carrying command, description, and optional cwd; a `run_in_background` call is a `generic` card with the raw command, mirroring the bash tool's background presentation. A completed foreground result is a `terminal` card too: the exit marker becomes the card's exit-status pill (`exitCode`/`signal`), and the marker-free body is the card's output — exactly the bash tool's terminal-card story, via the shared exit-status parse from `@deepseek-ai/dsh-bash`. Background acks and execution errors stay `generic` cards with the rendered output in a `console` fence. These presenters are pure and replay-safe.

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the pwsh guidance below. Scoped tool restrictions can hide the schema without removing this independently registered section.

##### Pwsh guidance

```markdown
Non-zero exits are reported as `[exit code: N]` markers; investigate failures before moving on. On Windows a killed process settles as `[exit code: 1]` without a signal marker; treat a bare exit 1 after an interruption as a termination, not a command failure.
```

#### Token effect

Small fixed input cost per request while the plugin is active.

#### KV Cache effect

Prefix-stable while the registration scope and prompt text are unchanged. Plugin activation or disposal may invalidate reuse from this prompt section.

### Tool schemas

#### What the model sees

The model sees the generated [`pwsh` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-pwsh). Agent-scoped tool restrictions can remove the definition for that agent.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while visibility and the tool definition are unchanged. A restriction or config change may invalidate reuse from the first changed token.

### Foreground result

#### What the model sees

The renderer emits the data-dependent stdout tail, then optional `[stderr]` and the stderr tail. Conditional lines are exactly `[output truncated; full output: <path>]`, `[timed out after <timeoutMs>ms]`, `[killed by signal: <signal>]`, and `[exit code: <exitCode>]` (nonzero exits only); an empty body renders as `(no output)`.

#### Token effect

Zero result tokens before a call. Output is bounded per stream, while each emitted line remains in history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Background result

#### What the model sees

A background start renders exactly `started background task <id>`; subsequent reads and status flow through the generic `task_output`/`task_kill` tools, including the lossy-read spill notice when in-memory truncation dropped unread bytes.

#### Token effect

The ack is a fixed short line; task output is bounded per read.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Tool errors

#### What the model sees

Validation and infrastructure failures are normalized as `Error: <message>`. This package's stable messages are `invalid command: expected a non-empty string`, `invalid description: expected a non-empty string`, `invalid timeoutMs: expected a positive number, got <value>`, `run_in_background is disabled for this deployment (enableRunInBackground: false)`, `background tasks unavailable: load @deepseek-ai/dsh-tasks and @deepseek-ai/dsh-tool-tasks`, and `tool call aborted`.

#### Token effect

Only the failing call adds these retained tokens; an aborted call adds no command output.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No sandbox escalation** — `sandbox_permissions`/`justification` are absent; escalation waits for a Windows-confining executor (the bash tool's sandbox surface is not mirrored).
- **No persistent shell or PTY** — every call starts a fresh `pwsh -Command`; the PTY backends are Linux/macOS-only today, and a Windows ConPTY persistent shell is roadmap work.
- **PowerShell-dialect contract** — the model must write PowerShell (native paths, `$env:` variables), not bash; there is no dialect translation.
- **Session-cwd identity is not canonicalized** — the workdir base is the session header cwd as-is, unlike the bash tool's sandbox-root-canonicalized identity; only the sandbox-less case applies here.
