# Agent Note: Persistent Bash and string-replacement editor tools

Status: implemented

English | [中文](2026-07-29-persistent-bash-str-replace-editor.zh.md)

## Problem

Some deployments need a one-call Bash schema whose shell state survives across model turns, while others need a Claude-style `str_replace_editor` independent of their terminal choice. Bundling the two tools or naming them after one benchmark would prevent reuse and blur configuration ownership.

## Decision

`@deepseek-ai/dsh-tool-bash-persistent` consumes `ctx.pty` and registers one `bash(command)` tool. It lazily creates one interactive shell per exact Agent and serializes that owner's calls. Cwd, exported variables, activated environments, functions, and background jobs persist. Random private markers delimit command output. Retained scrollback is paged backward to recover the command's original prefix; a dropped prefix is reported explicitly. A nonzero wrapped command appends `[exit code: N]`; a shell that dies before reporting that status instead appends `[shell exited: code N]`, `[shell killed by signal: SIG]`, or `[shell exited]` when the backend supplies neither. `maxOutputChars` bounds retained command output, while fixed diagnostics can extend the returned string. Timeout or cancellation closes the shell before another call can reuse uncertain state, and model-visible timeout/exit results disclose that reset. Cancellation always resets and discards the result, even when a complete status marker is already observable, so state changes the model never saw cannot survive. The configurable description defaults to persistence facts only, so network and package-mirror claims remain deployment-owned.

`@deepseek-ai/dsh-tool-str-replace-editor` independently consumes `ctx.fs` and registers `str_replace_editor` with `view`, `create`, `str_replace`, and `insert`. It provides numbered text views, filtered two-level directory listings, unique literal replacement, canonical insertion boundaries, and bounded output. Paths are absolute; file views preserve content tabs so copied text remains valid literal replacement input; mutations preserve tabs outside the requested edit; and the public schema and failures use only `old_str`. The plugin can compose with persistent Bash, one-shot Bash, sandboxed Bash, or no shell.

`dsh-system-prompt` accepts `includeHarnessIdentity: false`, while `dsh-agent-spine-demo` forwards that setting and accepts `toolBash: false`. A deployment can therefore own an exact persona and replace the spine's native Bash without duplicate prompt or tool registrations. Existing defaults remain unchanged.

Both plugins are included in the Python runtime closure. The persistent Bash closure also includes the PTY service/local backend and the sandbox services required by that backend. Because `node-pty` executes a native `spawn-helper` on macOS, each packaged macOS runtime executable ships with a `-spawn-helper` sibling; Linux uses `forkpty` directly. A pinned `node-pty` patch checks `DSH_NODE_PTY_SPAWN_HELPER` first, so it remains a true override for a current external consumer that supplies a non-sibling helper. When the override is unset, the patch resolves the packaged executable sibling if present and otherwise preserves upstream lookup in ordinary Node runs. The macOS builders fail before publication when the helper is absent or not executable.

The shipped [`core-web.cordis.yml`](../../../../apps/cli/config/core-web.cordis.yml) overlay composes both plugins over the ordinary Web surface for the Claude SWE-compatible RL contract. It pins native tool mode and makes the complete system prompt `DSH_SYSTEM_PROMPT` when set or `You are a helpful software engineer assistant.` otherwise, with no harness identity, source-checkout section, Web orientation, Workspace instructions, or tool-mode guidance. It disables every other model-facing consumer, so the model receives exactly the persistent `bash` and `str_replace_editor` schemas, while the Web host, browser, Workspace, persistence, sandbox, and permission stack remains in place. The local PTY backend resolves the effective session sandbox mode when it creates the shell. While that owner has an open shell or a spawn in progress, a different permission mode is rejected before its session event commits; the editor continues through the Web filesystem sandbox.

## Alternatives considered

**One combined compatibility plugin.** Rejected because neither tool requires the other and the combined name would tie reusable capabilities to one benchmark.

**Reuse one-shot Bash.** Rejected because `bash -c` cannot preserve cwd or environment state across calls.

**Expose terminal management tools.** Rejected because open/send/read/close is a different model action space from one persistent `bash` call.

**Modify native read/write/edit.** Rejected because it would distort their general-purpose contracts instead of adding an independently composable editor.

## Consequences

Profiles can reproduce an external agent by configuring persona and descriptions while the underlying packages remain general. Persistent Bash requires an owning Agent and real PTY backend. Shell exit, timeout, or cancellation loses state. The editor delegates security and mutation policy to the mounted filesystem stack. The Core Web profile retains Web permissions but must close its persistent shell before changing modes. Runtime-wheel consumers still need no Node installation; Linux wheels contain one executable, while macOS wheels also contain its private native helper.
