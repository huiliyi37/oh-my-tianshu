# `@deepseek-ai/dsh-headless`

English | [中文](README.zh.md)

The dsh one-shot bundle. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](../base/README.md): it supplies the coding persona and tool mode, disables HMR, mounts Code Mode's worker as a core execution capability, and inserts this package's `headless-runner` plugin (config `{task}`). It mounts no Host, HTTP server, Web runtime, or browser plugin.

After the Loader settles, the runner reads the shared [`ctx.agentDefaultModel`](../../core/agent-default-model/README.md), creates one fresh persisted Agent through `ctx.agents`, submits the task as an ordinary user message, and waits for quiescence. It flushes the Session before folding the owned durable event interval, writes the last non-empty assistant text to stdout, and requests exit through the launcher-provided `ctx.headlessIo` host hook (final `turn/end` completed → 0, otherwise 1). A terminal `error` reason also writes its code and message to stderr; successful runs keep stderr empty. The process opens no listening port. The launcher patches the task text in (`dsh run "task"`) and fails loud when the selected profile lacks this row.

## Model Experience

None, as the runner submits the task as an ordinary user message; prompts and tools belong to the base and headless bundle rows.

#### KV Cache effect

None; the runner adds nothing to the request prefix.

## Known Limitations and Deferred Work

- **One submitted task only** — the runner has no interactive follow-up surface; it waits through any work the Agent completes before returning to idle and prints the last non-empty assistant message in that interval.
- **`ctx.headlessIo` is launcher-owned** — booting the headless profile outside the `dsh` launcher fails loud at activation until the host provides the hook.
