# 后台任务运行时

[English](tasks.md) | 中文

长时间运行的生产方、`ctx.tasks` 与任务控制接口共用的类型。[运行时 Agent Note](../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md)负责设计；本页记录 [`packages/tasks/tasks/src/types.ts`](../../packages/tasks/tasks/src/types.ts) 中的字面形状。

## ID 与状态

`TaskId` 是按 `<kind>-N` 生成的[品牌化 id](core.md#branded-ids)。访问控制依赖拥有者授权，而非 id 的保密性。`TaskKind` 派生自可合并扩展的 map；注册表将各个 kind 视为不透明的 id 命名空间。

```ts type-equiv
/**
 * Producer-defined task kinds. Plugins extend this map by declaration merging;
 * the registry treats every value as an opaque id namespace.
 */
interface TaskKindMap {
  bash: 'bash'
  subagent: 'subagent'
}
```

`TaskStatus` 为 `'running' | 'stopping' | 'completed' | 'killed' | 'failed'`；生产方特有的事实归入 `TaskSnapshot.detail`。

## 生产方约定

`TaskStart` 声明身份和启动器。运行时会在调用 `run()` 前完成预检，随后提交注册，不再执行可能失败的步骤。生产方拥有执行资源；运行时拥有身份、访问权限和生命周期状态。

```ts type-equiv
/**
 * Producer declaration passed to {@link TaskService.start}. The runtime
 * preflights access and cleanup before invoking {@link run}; the producer owns
 * execution resources while the runtime owns identity and lifecycle state.
 */
interface TaskStart {
  /** Producer kind — also the id prefix (`bash`, `subagent`, …). */
  kind: TaskKind
  /** One-line model-facing label (the command; the delegation description). */
  label: string
  /**
   * Optional UTF-8 byte cap for each complete model-facing completion notice or
   * output read, including control-surface status metadata.
   */
  outputLimitBytes?: number
  /**
   * Owning live agent. Access is fenced by its session id, and agent disposal
   * cancels and awaits the task. The instance must be the one currently
   * registered under its agent id. Omitting the owner creates an unowned task,
   * open to any caller until service disposal.
   */
  owner?: Agent
  /**
   * Start the work after preflight and synchronously return its hooks. Called
   * once; a throw leaves nothing registered, and the producer must clean up any
   * partially started resources.
   */
  run(): TaskHooks
}
```

`TaskHooks.done` 是完全停稳边界。可选的 `readOutput` 用来区分会消费输出的流式任务和仅有最终输出的任务。

```ts type-equiv
/** Hooks through which the runtime controls and observes producer work. */
interface TaskHooks {
  /**
   * Request termination. Must be synchronous, idempotent, and eventually settle
   * {@link done}; throws propagate. The optional reason is forwarded verbatim.
   */
  cancel(reason?: string): void
  /**
   * Resolves after the producer releases its resources, not merely when work
   * finishes. Must not reject; the runtime converts a rejection to `failed`.
   * If teardown cancellation throws, the runtime may force-fail only the
   * registry record without claiming that the work stopped.
   */
  done: Promise<TaskOutcome>
  /**
   * Consume output produced since the previous call. The producer formats
   * truncation and spill notices. Absence marks a final-output-only task; each
   * task has one consuming cursor.
   */
  readOutput?(): string
}
```

```ts type-equiv
/** Terminal result supplied by a producer through {@link TaskHooks.done}. */
interface TaskOutcome {
  /** How the task ended: finished (`completed`), cancelled (`killed`), or broke (`failed`). */
  status: 'completed' | 'killed' | 'failed'
  /** Kind-specific detail rendered into status lines ('exit code: 3', 'max-tokens'). */
  detail?: string
  /** Final output for tasks without `readOutput`; stream tasks leave it unset. */
  output?: string
}
```

## 消费方视图

快照是每次新建的只读投影。`ownerSession` 携带用于授权的共享 `SessionId`；完成监听器则会另行收到用于生命周期清理的确切拥有者对象。另一个接口已经交付终止状态或承诺交付时，`reported` 会抑制完成通知。

```ts type-equiv
/**
 * A read-only projection of one task, safe to hand to listeners and tools —
 * a fresh object per call, never live registry state.
 */
interface TaskSnapshot {
  /** The registry-issued id (`<kind>-N`). */
  id: TaskId
  /** The producer kind the task was registered with. */
  kind: TaskKind
  /** The producer-supplied one-line label. */
  label: string
  /** Producer-owned cap for complete model-facing notices and output reads. */
  outputLimitBytes?: number
  /**
   * Owner session id used for authorization and correlation; absent for
   * unowned tasks. Completion listeners receive the exact {@link Agent}
   * separately through {@link TaskDoneListener}.
   */
  ownerSession?: SessionId
  /** Current lifecycle state. */
  status: TaskStatus
  /** Kind-specific status detail, present once the producer supplied one (usually terminal). */
  detail?: string
  /** Epoch ms when the task was registered. */
  startedAt: number
  /** Epoch ms when the task settled; absent while `running`/`stopping`. */
  finishedAt?: number
  /**
   * True when a kill, read, or wait has reported or committed to report the
   * terminal state. Completion surfaces suppress redundant notices when set.
   */
  reported: boolean
}
```

```ts type-equiv
/** Output and post-read state returned by {@link TaskService.read}. */
interface TaskRead {
  /**
   * Stream kinds: the consuming delta since the previous read. Final-output
   * kinds: empty while live, the terminal {@link TaskOutcome.output} (or
   * empty) once settled — idempotent, never consumed.
   */
  text: string
  /** The task's state at read time. */
  snapshot: TaskSnapshot
}
```

## 服务行为

抽象的 [`TaskService`](../../packages/tasks/tasks/src/index.ts) Service Definition 规定原子 `start`、限定调用方作用域的 `get` 和 `list`、`read`、`kill`、有界 `wait`、故障隔离的 `onTaskDone` 监听器，以及 `attachSurface` 可用性防线；[`LocalTaskService`](../../packages/tasks/tasks-local/src/index.ts) 是其进程局部提供方。授权会比较拥有者会话；拥有者清理会选择确切的已注册 `Agent` 实例。Service Definition 约定见 [`dsh-tasks`](../../packages/tasks/tasks/README.md)，注册表生命周期见 [`dsh-tasks-local`](../../packages/tasks/tasks-local/README.md)，面向模型的 Consumer 见 [`dsh-tool-tasks`](../../packages/tasks/tool-tasks/README.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis surface

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` surface lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtasks--taskservice-abstract-seam"></a>

### `ctx.tasks` — `TaskService` (abstract seam)

Abstract background task registry. Subclass, implement the abstract methods, and load the subclass as a plugin — it registers as `ctx.tasks` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Implementations must honor these semantics:

- Registrations outlive producer and control-surface fibers. Owner and service disposal cancel live work and await compliant producers; a throwing teardown cancel force-fails only the record.
- Owned-task access is fenced by the owner's session id. Ids are predictable, so authorization — not secrecy — is the boundary.
- Settlement is first-wins: one terminal record, one round of contained listener notification, and released waiters, even against a late producer outcome.
- start refuses work while no control surface is attached, so a producer cannot start work that callers cannot collect or stop.

```ts cordis-catalog
/**
 * Preflight access, validation, and owner cleanup before starting and
 * atomically registering work. A throwing starter leaves nothing registered;
 * after it returns, registration cannot fail. Settlement records the outcome,
 * notifies listeners, and releases waiters.
 * @param spec - task identity, owner, and synchronous starter.
 * @returns the registry-issued `<kind>-N` id.
 */
abstract start(spec: TaskStart): TaskId

/**
 * List caller-owned and unowned tasks in registration order without exposing
 * another session's labels.
 * @param caller - reading agent; a non-agent caller sees only unowned tasks.
 * @returns fresh snapshots.
 */
abstract list(caller?: Agent): TaskSnapshot[]

/**
 * Return a non-consuming snapshot without changing its read cursor or notice
 * state. Throws for an unknown or foreign task.
 * @param id - task to look up.
 * @param caller - reading agent checked against the owner.
 * @returns a fresh snapshot.
 */
abstract get(id: TaskId, caller?: Agent): TaskSnapshot

/**
 * Read the next stream delta, or the idempotent final output after settlement.
 * A terminal read marks the task reported. Throws for an unknown or foreign
 * task.
 * @param id - task to read.
 * @param caller - reading agent checked against the owner.
 * @returns output text and the post-read snapshot.
 */
abstract read(id: TaskId, caller?: Agent): TaskRead

/**
 * Request cancellation, then mark the task stopping and reported. A producer
 * throw propagates without changing task state. Throws for an unknown or
 * foreign task.
 * @param id - task to cancel.
 * @param caller - killing agent checked against the owner.
 * @param reason - logged reason forwarded to the producer.
 * @returns `requested` for live work, otherwise `already-finished`.
 */
abstract kill(id: TaskId, caller?: Agent, reason?: string): 'requested' | 'already-finished'

/**
 * Wait for settlement or timeout without cancelling the task. Caller abort
 * rejects only while the task is live; after settlement the terminal
 * snapshot wins so a notice suppressed for this waiter is still delivered.
 * Throws for invalid, unknown, or foreign input.
 * @param id - task to wait for.
 * @param timeoutMs - positive finite wait bound in milliseconds.
 * @param caller - waiting agent checked against the owner.
 * @param signal - optional cancellation of the wait itself.
 * @returns snapshot at settlement or timeout.
 */
abstract wait(id: TaskId, timeoutMs: number, caller?: Agent, signal?: AbortSignal): Promise<TaskSnapshot>

/**
 * Register an effect-scoped completion listener. Each listener is contained;
 * returned promises are observed but not awaited. No listener runs after
 * service disposal.
 * @param listener - receives each terminal snapshot and its exact owner.
 * @returns disposer that unregisters the listener.
 */
abstract onTaskDone(listener: TaskDoneListener): () => void

/**
 * Attach an effect-scoped surface that can read and stop tasks. {@link start}
 * refuses work while none is attached.
 * @param name - diagnostic label; duplicate names remain independent.
 * @returns disposer that detaches this surface.
 */
abstract attachSurface(name: string): () => void
```

Types: [Agent](core.md)

Source: [`packages/tasks/tasks/src/index.ts:50`](../../packages/tasks/tasks/src/index.ts)
<!-- END GENERATED cordis-surface -->
