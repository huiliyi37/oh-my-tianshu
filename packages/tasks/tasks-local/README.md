# @deepseek-ai/dsh-tasks-local

English | [中文](README.zh.md)

Process-local implementation of the [`@deepseek-ai/dsh-tasks`](../tasks/README.md) registry contract: `LocalTaskService` keeps every record in memory, issues per-kind `<kind>-N` ids, and hands out fresh snapshots, never live state. It has no config; load it as a plugin and it registers as `ctx.tasks`.

## Lifecycle

Tasks belong to their owner and backend, not the producer tool fiber, so producer and surface reloads do not stop them. The first task for an owner attaches one awaited effect to the exact `Agent` scope. Owner disposal cancels that object's tasks, awaits producer quiescence, and removes their snapshots; reused agent or session ids cannot redirect an old cleanup.

Service disposal closes listeners, cancels all live tasks, awaits their records, and detaches effects from surviving owner scopes. If teardown cancellation throws, the service force-fails the record and warns that work may be orphaned instead of deadlocking. A cancellation that returns but never settles `done` remains indistinguishable from a slow stop and can stall teardown.

Settlement is first-wins: the earliest terminal outcome — producer settlement, a rejected `done` contained as `failed`, or a teardown force-failure — records once, notifies listeners once with per-listener containment, and releases waiters. Pending waits mark the task reported before listeners run so completion surfaces do not duplicate notices.

## Model Experience

Indirectly, through producer plugins and [`dsh-tool-tasks`](../tool-tasks/README.md), which render task ids, output, status, cancellation, and completion notices.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Tasks are process-local** — records die with the harness process; durable or cross-restart execution needs a separate backend implementing the seam.
- **A silently ineffective cancel can stall teardown** — only an explicit throw can be force-failed safely.
