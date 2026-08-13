# Defensive patterns

English | [中文](defensive-patterns.zh.md)

Hard-won bug-class rules: each pattern below is a class of defect that actually shipped or nearly shipped here, stated as the rule that prevents its recurrence. Read this before writing lifecycle, concurrency, subprocess, or teardown code. Test-tier counterparts (real entry path, world-verification, resource ownership) are in [testing.md](testing.md).

## Report orthogonal outcomes independently

A result can be several things at once — a process can time out AND exit 0 because it trapped the signal. Surface each independent fact (`timedOut`, `signal`, `exitCode`) on its own; never nest one flag's report inside another's branch, or a caller reads a cut-short run as a clean success.

## Honor public contracts on BOTH sides

When an implementation boundary receives several representations of one outcome, normalize them before crossing the public contract. `LlmAdapter.stream()` implementations may throw or emit `finish {kind:'error'|'aborted'}`, but `LlmService.stream()` exposes model-request failures only as terminal finish chunks; middleware and consumer defects remain thrown. This keeps consumers from guessing whether a caught exception came from the provider, a wrapper, chunk logging, or their own assembly. Document the normalized contract where the type is defined; exercise every source form through the real consumer.

## Async state is not synchronous state

`agent.followup()` has no per-message completion or result; a background task's completion races turn boundaries; `reader.close()` fires for both EOF and disposal. Never treat `agent/status` or `whenIdle()` as the result of one follow-up: several queued follow-ups, steering, and injected work may share one `running` interval, while cancellation or disposal can discard unstarted items. An automation caller that truly owns a run must define its interval explicitly—for example, from its message's durable inbox receipt through the next whole-agent `idle`—and describe any selected output as interval-wide rather than causally attributed to that message. The guard cuts both ways: if the awaited transition can never occur, the wait hangs, so handle the "nothing to wait for" branch explicitly.

## Dispose must reach quiescence, not just request it

A teardown that issues kills/aborts but returns before the work stops leaves orphans. Make cleanup async and await the children's exit (kill → await `done`), and close listener/notification registries BEFORE killing so late completions stay silent.

## Contain callback exceptions at the boundary

A user-supplied listener that throws must not reject the promise it runs inside or starve the listeners after it. Wrap the dispatch loop in try/catch and log; one bad subscriber never breaks core lifecycle.

## Never hand untrusted output the ambient environment or predictable paths

Spawned commands get a scrubbed env (drop `*KEY*`/`*SECRET*`/`*TOKEN*`/`*PASSWORD*`) so harness credentials cannot leak into output, `env`, or spill files. Temp/spill files use a private (0700) dir, random names, and exclusive owner-only opens (`'wx'`, `0o600`) — predictable world-readable paths invite symlink races and disclosure.
