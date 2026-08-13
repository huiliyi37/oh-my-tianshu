# Agent Note: The task registry is a capability seam (`dsh-tasks` / `dsh-tasks-local`)

Status: implemented

English | [中文](2026-07-26-task-registry-seam.zh.md)

## Problem

The [background-task runtime](2026-06-20-generic-long-running-tool-runtime.md) shipped `TaskService` as one concrete package: `@deepseek-ai/dsh-tasks` owned both the `ctx.tasks` contract every producer and control surface programs against and the process-local provider (the in-memory store, settlement bookkeeping, owner-cleanup effects, teardown). That bundling recouples the two rates of change the repository's [capability-seam rule](2026-06-13-capability-seams.md) separates: swapping the registry's storage or lifecycle backend would churn the same package whose types and `ctx.tasks` surface producers (`dsh-tool-bash`, `dsh-tool-pty`, `dsh-tool-subagent`), the control surface (`dsh-tool-tasks`), and `TaskKindMap` extenders import. Every other swappable capability in the harness — bash, pty, fs, skill, subagent, web, session persistence — already carries the Service Definition / Service provider / Consumer split; the task registry was the remaining `core`-mode exception, guarded only by a `TODO(task-service-backend)` comment.

## Decision

`tasks/` is now a three-package capability family in the bash-trio shape:

- **`@deepseek-ai/dsh-tasks` (Service Definition)** — the abstract `TaskService extends Service` owning `ctx.tasks`, the eight-method contract (`start`, `list`, `get`, `read`, `kill`, `wait`, `onTaskDone`, `attachSurface`), all vocabulary types (`TaskId`, `TaskKindMap`, `TaskStart`, `TaskHooks`, `TaskOutcome`, `TaskSnapshot`, `TaskRead`, `TaskDoneListener`), and the snapshot invariant companion. The class-level JSDoc states the semantics every Service provider owes: registrations outlive producer and surface fibers, owned access is session-fenced, settlement is first-wins with contained listeners, and `start` refuses work while no control surface is attached.
- **`@deepseek-ai/dsh-tasks-local` (Service provider)** — `LocalTaskService`, the process-local registry moved verbatim: the in-memory store, per-kind counters, waiter bookkeeping, `TASK_WAIT_TIMEOUT` deadline code, owner-cleanup effects, and force-fail teardown. The `dsh-timeout` dependency moves here with it; the Service Definition package has no provider dependencies.
- **`@deepseek-ai/dsh-tool-tasks` (Consumer)** — unchanged; it injects `'tasks'` and never imports provider types.

Compositions load `dsh-tasks-local` where they previously loaded `dsh-tasks` (the CLI cordis.yml row, `agent-spine-demo`, test harnesses, the tool-catalog generator boot). Producer misconfiguration diagnostics ("background tasks unavailable: load …") name `dsh-tasks` — the Service Definition package that declares the absent `ctx.tasks` service — and the Service Definition package's own surfaces (its README and the direct-mount fence) point at Service providers, so the producer message stays correct when another backend becomes the recommended default. Producers, `TaskKindMap` declaration merges, and the control surface keep importing `@deepseek-ai/dsh-tasks` only.

The seam keeps the in-process contract semantics unchanged: `TaskStart.run()` still passes callbacks and exact `Agent` objects, so a durable or cross-process backend still has design work to do before it can satisfy this Service Definition (identity, restart, ownership, observation). The split moves that future work out of every Consumer's dependency graph; it does not pre-design the backend.

## Alternatives considered

**Keep the concrete service until a second backend exists (status quo).** This was the original runtime note's position: extracting a Service Definition before a second provider risks freezing the wrong boundary. It lost because the boundary is no longer speculative — the eight service methods and their semantics have been stable across every producer integration since introduction, they are exactly the surface `dsh-tool-tasks` and the producers already program against, and the repository convention treats swappable capabilities as three packages by default. The residual risk (a durable backend needing contract changes) is unchanged by the split: those changes would land in the Service Definition package either way, and today they would also churn every Consumer's provider dependency.

**Service-Definition-only extraction inside one package (export an abstract class beside the concrete one).** Rejected because it separates nothing operationally: Consumers still depend on the package that carries the provider and its dependencies, and a replacement backend still cannot ship without the local one in its graph. The package boundary is the unit of independent evolution here.

**Splitting `types.ts` out but leaving the service concrete.** Rejected for the same reason — the types are not the complete capability; the `ctx.tasks` Service Definition and its method contract are. Producers need the service key and semantics, not just the shapes.

## Consequences

Bought: the task registry now matches the repository-wide seam shape; a durable, remote, or instrumented registry is a sibling Service provider implementing eight abstract methods, and no producer, control surface, or `TaskKindMap` extender changes when one lands. The Service Definition README states the contract; the provider README owns the lifecycle bookkeeping facts. The registry behavior suite (owner cleanup, settlement, waits, teardown) lives with `dsh-tasks-local`; the Service Definition package keeps a stub-subclass test pinning registration under `ctx.tasks` and single-service duplication behavior, plus the probe-based invariant suite.

Cost: one more package (manifest, tsconfig, README, invariant companion), and compositions must name the Service provider package. `abstract` erases at runtime and this package name used to be the mountable registry, so the Service Definition constructor fails loudly when mounted directly — a stale composition row gets "load a Service provider such as @deepseek-ai/dsh-tasks-local" at load time instead of a half-registered `ctx.tasks` failing far from the misconfiguration.
