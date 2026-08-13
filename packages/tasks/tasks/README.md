# @deepseek-ai/dsh-tasks

English | [中文](README.zh.md)

The background task registry contract (`ctx.tasks`). The abstract `TaskService` and its vocabulary types give long-running producers shared ids, owner isolation, reads, cancellation, waiting, notices, and cleanup under one contract; the process-local registry lives in [`dsh-tasks-local`](../tasks-local/README.md). Producer plugins extend `TaskKindMap` with their opaque id namespace.

## Service contract

- `start(spec): TaskId` validates the control surface, spec, exact live owner, and optional positive `outputLimitBytes` before calling the producer's `run()` once. A starter throw leaves nothing registered; successful return commits without another failable step.
- `get(id, caller?)` and `list(caller?)` return non-consuming snapshots. Listing includes only caller-owned and unowned tasks.
- `read(id, caller?)` consumes the single cursor for stream tasks and reads terminal output idempotently for final-output tasks.
- `kill(id, caller?, reason?)` invokes producer cancellation before changing status. A cancellation throw leaves the task running; success changes it to `stopping` and marks terminal delivery reported.
- `wait(id, timeoutMs, caller?, signal?)` returns a terminal snapshot or the live snapshot at timeout. Aborting stops only the wait; settlement wins once it has committed terminal delivery to that waiter.
- `onTaskDone(listener)` observes each terminal record with the exact owner. Listener throws and rejections are contained; listener work is not awaited.
- `attachSurface(name)` declares a control surface for its effect lifetime. `start()` fails before producer execution when none is attached.

Owned access compares the task's `SessionId` with the caller's. Ids such as `bash-1` are predictable, so this fence is the boundary. Unowned tasks are open to callers and last until service disposal.

`outputLimitBytes` is producer-owned model-presentation policy carried unchanged into snapshots. A control surface applies it after adding status or notice metadata; the registry does not rewrite producer output or invent a default for producers that omit it.

Implementations also owe the lifecycle semantics of the contract: registrations outlive producer and control-surface fibers, owner and service disposal cancel live work and await compliant producers, and settlement is first-wins — one terminal record, one round of contained listener notification, released waiters.

See the [task type catalog](../../../docs/subsystems/tasks.md), the [runtime Agent Note](../../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md), and the [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-26-task-registry-seam.md).

## Model Experience

Indirectly, through producer plugins and [`dsh-tool-tasks`](../tool-tasks/README.md), which render task ids, output, status, cancellation, and completion notices.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Stream output has one consuming cursor** — independent observers need a cursor or snapshot API.
- **Foreground work cannot be promoted** — producers choose foreground or background before starting.
- **The contract is in-process** — `TaskStart.run()` passes callbacks and exact `Agent` objects; a durable or cross-process backend must reshape identity, restart, ownership, and observation semantics before it can implement this seam.
