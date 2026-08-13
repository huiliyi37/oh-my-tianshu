# Tianshu Harness Architecture

English | [中文](architecture.zh.md)

**Tianshu Harness SDK** uses Cordis: **everything is a plugin**, including the loop.

## Overview

Harnesses are [Cordis](cordis-primer.md) contexts; packages contribute services, typed events, and disposable registrations. `packages/core/` groups the default flow; capabilities remain plugins.

### Default Services

| ctx key | Package | Role |
|---|---|---|
| — | [`dsh-scope`](../packages/core/scope/README.md) | scoped-context registrations and shared layer storage (library) |
| `ctx.sessions` | `dsh-session` | in-memory event-sourced sessions |
| `ctx.systemPrompt` | `dsh-system-prompt` | ordered prompt sections, tool schemas, and variables |
| `ctx.tools` | `dsh-tools` | tool registry and [execution pipeline](tool-execution-pipeline.md) |
| `ctx.agents` | `dsh-agent` | live agents, delegated creation, `agent/*` events, process-local initiator scope |
| `ctx.agentDefaultModel` | [`dsh-agent-default-model`](../packages/core/agent-default-model/README.md) | Settings-backed model selection shared by Agent front doors |
| `ctx.agentLoop` | `dsh-agent-loop` | concrete `Agent` driver |

### Capability Services

| ctx key | Package family | Role |
|---|---|---|
| `ctx.llm` | [`llm/`](../packages/llm/README.md) | adapter registry, streaming model calls |
| `ctx.tokenMeter` | [`llm/token-meter`](../packages/llm/token-meter/README.md) | replay-aware request and surface pressure |
| `ctx.bash` | [`bash/`](../packages/bash/README.md) | foreground/background command execution |
| `ctx.subprocess` | [`subprocess/`](../packages/subprocess/README.md) | executable lookup, managed trees, terminals |
| `ctx.pty` | [`pty/`](../packages/pty/README.md) | owner-scoped persistent terminal sessions |
| `ctx.sandbox` | [`sandbox/`](../packages/sandbox/README.md) | same-world process confinement through argv wrapping and per-call policy |
| `ctx.sandboxPolicy` | [`sandbox/`](../packages/sandbox/README.md) | shared sandbox policy home |
| `ctx.codeRuntime` | [`code-runtime/`](../packages/code-runtime/README.md) | model-written program execution |
| `ctx.fs` | [`fs/`](../packages/fs/README.md) | execution-world paths, bounded IO, and policy events |
| `ctx.lsp` | [`lsp/`](../packages/lsp/README.md) | semantic navigation registry |
| `ctx.skills` | [`skill/`](../packages/skill/README.md) | skill provider registry, progressive disclosure |
| `ctx.web` | [`web/`](../packages/web/README.md) | search/fetch provider registries |
| `ctx.compact`, `ctx.toolResultPrune` | [`compact/`](../packages/compact/README.md)/[`compact-tool-result-prune`](../packages/compact/compact-tool-result-prune/README.md) | summary compaction, optional model-free result pruning |
| `ctx.subagents` | [`subagent/`](../packages/subagent/README.md) | named delegation providers |
| `ctx.planMode` | [`plan/`](../packages/plan/README.md) | logged plan collaboration state |
| `ctx.tasks` | [`tasks/`](../packages/tasks/README.md) | background task registry, generic `task_*` controls |
| `ctx.workflows` | [`workflow/`](../packages/workflow/README.md) | script-driven multi-agent orchestration |
| `ctx.goals` | [`goal/`](../packages/goal/README.md) | persisted same-session goals |
| `ctx.sessionPersistence` | [`session/`](../packages/session/README.md) | durable session-log storage |
| `ctx.sessionQuery` | [`session-query/`](../packages/session-query/README.md) | live-preferred exact/filter/trace queries over SQLite FTS, workspace-authorized model tools |
| `ctx.sessionTitle` | [`session/session-title`](../packages/session/README.md) | log-backed fallbacks, one optional asynchronous provider |
| `ctx.settings` | [`settings/`](../packages/settings/README.md) | per-plugin user-settings namespaces layered over composition entries |
| `ctx.credentials` | [`credentials/`](../packages/credentials/README.md) | named secret references resolved per operation, never inlined in configuration |
| `ctx.directoryPicker` | [`host/directory-picker`](../packages/host/directory-picker/README.md) | GUI-host directory picking (`native`/`browse` interactions) |
| `ctx.typert` | [`typert/registry`](../packages/typert/registry/README.md) | runtime registry for generated package reflection and live Zod schemas |
| `ctx.typertGateway` | [`api/gateway`](../packages/api/gateway/README.md) | dispatches TypeRT Remote unary calls through the [API Gateway](api-gateway.md) |
| `ctx.invariants` | [`support/invariants`](../packages/support/invariants/README.md) | package-name-selected registry of package-owned runtime checks |

## Event

Events are the service extension API ([subsystems](subsystems/core.md), [producer/consumer map](event-producer-consumer.md)).

### Event Domains

- **Session events** are durable log facts emitted through `session/event`.
- **Agent events** carry live `Agent` for inbox, step, status, request, validation, and continuation.
- **Capability events** attach policy and adapters without a loop import.

### Interception Semantics

Waterfalls are around-middleware: listeners delegate with `next()`; returning without it short-circuits or takes over ([semantics](cordis-primer.md#cordis-waterfall-semantics)).

## Default Loop Lifecycle

A **session** is append-only. A **turn** claims one queued follow-up, waits for its predecessor's checkpoint, and may share its `running` interval ([decision](../.agents/notes/implemented/simplification/2026-07-17-one-send-one-turn.md)); injection claims none. A **step** is one model request plus tools. Fresh creation and persisted resume first acquire an exact unpublished `SessionPreparation`; Agent and session publication happen only after private setup against that Session is ready ([decision](../.agents/notes/implemented/architecture/2026-08-05-session-preparation.md)). Quotes in the [sequence](agent-lifecycle.md) mark durable events.

Creation without an id mints `<config-id>-session-<uuid>`; `sessionId` resumes or creates, while `resumeSessionId` requires history. Resume restores lineage and delegation depth before publication; setup failure emits `agent-loop/config-start-failed`.

### Turn Flow

```text
choose declarative identity and acquire fresh/restored SessionPreparation
  -> prepare private agent.ctx around exact Session -> await unpublished setup -> invoke optional synchronous setup commit
  -> enter session + agent -> session/created -> agent/created
  -> enable driving -> agent/session-start(source) -> start driver
forever:
  waking inbox insertion starts the driver before send returns
  -> emit agent/status(running) if starting an interval
  -> 'turn/start'
  claim next-step input plus one next-turn message
  -> emit agent/inbox/claimed({ message, turn }) for each claimed message
  -> agent/pre-step({ agent, messages, turn, step, signal })
    reject, empty input, cancellation, or listener failure
      -> the claimed batch stays removed; close the no-step turn; stop the driver
    enter -> step loop:
      'step/start'
      append the returned batch as separate 'user/message' events
      assemble ordered prompt and tool schemas -> snapshot derived messages
      agent/request (config only) -> resolve adapter defaults and mark defaulted fields + context capacity under turn signal -> log request/header (+ request/context on route change) -> llm/stream (frozen, registration-bound)
      'assistant/chunk'
      'assistant/message'
      schedule tool calls by ctx.tools.executionMode:
        exclusive -> barrier
        parallel -> rolling pool, <= maxParallelToolCalls; reclassify at start
        start -> 'tool/call' -> tools/pre-execute -> concurrent tools/execute
        model-order result -> ordered tools/post-execute -> 'tool/result'
      'step/end'
      tools owe another request or next-step inbox is nonempty
        -> claim -> agent/pre-step -> append entered batch -> continue
      otherwise agent/turn-stopping -> re-check the next-step inbox
    'turn/end'
  start the next waking queued message, or emit agent/status(idle)

idle inject:
  queue non-waking next-step context
  leave it pending until followup or steer wakes the driver
```

Each step assembles ordered prompt sections, tool schemas, and variables; unknown references fail the turn. `dsh-system-prompt` owns identity and persona; the loop supplies `provider`, `model`, and `cwd` ([prompt ownership](../.agents/notes/implemented/architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md)).

`inject()` queues non-waking `next-step` context; an idle driver leaves it pending until `followup()` or `steer()` wakes the driver. Post-tool `additionalContexts` use the same inbox. The `agent/pre-step` payload carries the exclusive claimed batch and the upcoming turn, step, and signal. Reject opens no step; enter supplies the complete batch appended after `step/start`. Empty tool continuations still traverse the waterfall, whose final value settles all rewrites.

Pruning precedes summaries; overflow retries require durable progress. `agent/request-error` may authorize a same-step retry of the frozen prompt; cancellation wins. Adapter `retryPolicy` bounds normal mode, while always mode retries after specialized recovery ([compaction](../.agents/notes/implemented/architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md), [retry foundation](../.agents/notes/implemented/architecture/2026-06-21-bounded-llm-request-recovery.md), [provider policy](../.agents/notes/implemented/feature/2026-07-24-provider-retry-policies.md)). The generated [agent lifecycle](agent-lifecycle.md) owns exact event order, and the [agent-loop README](../packages/core/agent-loop/README.md) owns queue, steering, retry, and cancellation mechanics.

### Failure Boundaries

Adapter selection, dispatch, and iteration failures become terminal error or aborted `finish` chunks. `agent/request-error` receives request coordinates, normalized `LlmFailure`, available retry policy, and signal; middleware and consumer errors remain outside recovery. Failed chunks commit neither messages nor tool calls.

Other failures use `agent/error`; cancellation and disposal beat recovery. Before request-header commit, the turn signal cancels capability preparation; undispatched tools get synthetic `tool/call`/`ABORTED_BEFORE_DISPATCH` pairs. Effective `cancel(cause)` reports its cause before clearing and aborting; idle calls emit nothing. Waking input that lands after the abort fires but before convergence runs at the driver's convergence boundary, while a `disposed` cancel leaves it parked ([cancel-convergence wake latch](../.agents/notes/implemented/bug-fix/2026-08-07-cancel-convergence-wake-latch.md)). Durability distinguishes `aborted` cancellation from `disposed` teardown, which awaits quiescence ([decision](../.agents/notes/implemented/architecture/2026-07-16-explicit-turn-cancellation.md)).

Turn and step events are turn-enclosed; the loop appends `user/message` events only from entered batches inside a turn. A turn opens before the initial claim and pre-step, so rejection, empty input, cancellation, or failure closes a durable turn without any step events. Standalone `compact/* { turn: null }` events consume no turn, and their lock-time markers may interleave with inbox splices. Reload synthesizes interrupted turn ends; `session/end-seed` distinguishes stale compaction orphans from live locks. After close, only `agent/error` reports failures. Each turn has one [TurnEndReason](subsystems/session.md#why-a-turn-ended-turnendreasonmap).

### Agent Handles

`ctx.agents` owns agents and returns `AgentHandle { agent, dispose() }`. Plugins use `send()` or its `followup()`, `steer()`, and `inject()` presets. `cancel()` and `whenIdle()` control lifecycle, while awaited disposal owns teardown. A follow-up `MessageId` follows durable inbox insertion, claiming, and discard notifications, not prompt output or turn ending; only an owner of a whole activity interval may summarize it as a run result ([decision](../.agents/notes/implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.md)).

### Agent Scope

Each agent owns scoped `agent.ctx`; shared storage overlays its tool, prompt, and command entries on globals while preserving domain views ([decision](../.agents/notes/implemented/architecture/2026-07-12-scoped-layers-store.md)). Scoped listeners filter dispatch; contributions unwind with awaited cleanup. `CreateAgentOptions.setup(agentCtx)` composes before publication. Typed resolvers derive carrier checks from merged `Events` and `scopeTarget` ([semantic gates](../.agents/notes/implemented/process/2026-07-14-typescript-program-backed-semantic-gates.md)). Details: [agent scope](../.agents/notes/implemented/architecture/2026-07-08-agent-scope-contexts.md), [subagent composition](../.agents/notes/implemented/feature/2026-07-12-subagent-persona-tool-filter-and-depth.md). `AgentLoop` runs under `ctx.agents.withInitiator()`; private orchestration derives `agent.session`, but turn, step, signal, cwd, and authority stay explicit ([decision](../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md)).

## State

### Session Log

The session log is authoritative. `deriveMessages()` projects model history; raw `assistant/chunk` events preserve replay and UI fidelity. Fork, resume, transcript rendering, telemetry, and persistence derive from this stream. Truncation rewinds the log with derived-state reset.

**Model-visible ⟺ logged**: messages entering at `step/start` plus the folded `request/header` reconstruct every request. The header marks adapter defaults so later proposals discard them and re-resolve the route without losing explicit settings. `request/context` separately records registration-bound provider, model, and capacity metadata when the route changes; it does not participate in request reconstruction or header equality. `dsh-agent-loop/invariant` asserts reconstructability through `ctx.invariants` ([reconstructability](../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md)).

Durability is a plugin concern. Backends copy synchronous `session/event` notifications into fixed-window durable batches; `session/flush` bypasses the wait before requests and top-level tool dispatch, and after `turn/end` before another turn or idle. `SessionPersistence` stores events and header metadata; JSONL defaults to checksummed Zstandard and SQLite shares the contract ([checkpoint decision](../.agents/notes/implemented/bug-fix/2026-07-21-semantic-session-checkpoints.md), [batching decision](../.agents/notes/implemented/architecture/2026-08-08-bounded-session-persistence-write-batching.md)).

Between turns, owners append log-only events through `Session`, flushing only for durability. `session/title` relies on bounded background persistence and lifecycle drains; manual compaction flushes its bracket before the operation completes. Title work never delays responses; the latest title event wins, and it records the source message seqs and whether the user, fallback, or provider supplied it. Title records are inherited fork boundaries ([decision](../.agents/notes/implemented/feature/2026-07-21-log-backed-session-titles.md)).

### Model Content

Messages use typed blocks from merge-extensible `ContentBlockMap`; the pattern also types `MessageSource`, `FinishReason`, `TurnTrigger`, and `TurnEndReason`. New blocks coordinate adapters, UI, compaction, token metering, and persistence; replay measurements live in [token-meter.md](subsystems/token-meter.md).

Streaming uses raw chunks and `BlockAssembler`. Each `LlmAdapter.stream()` is one provider attempt; adapters report normalized failure facts, and a handling `agent/request-error` plugin returns a retry action. The loop logs chunks, the successful provider/model route, and replay state. Remote adapters use per-read idle watchdogs. Replay crosses routes only through a shared adapter instance ([contract](subsystems/llm-streaming.md)).

## Extension And Composition

### Capability Pattern

A **seam** is a swappable capability with **Service Definition**, **Service provider**, and **Consumer** roles. Packages may combine roles; individual roles are not seams. Filesystem and subprocess providers share one execution world; Bash, PTY, and LSP need no provider forks ([capability graph](capability-seams.md)).

Exceptions combine LLM Service Definition/Consumer roles, filesystem policy, web registries, and skill/subagent providers. Subagents spawn fresh, fork a completed-turn prefix, use ACP children, or delegate a self-contained turn to Codex or another product provider ([subagent.md](subsystems/subagent.md)).

`dsh-workspace-context` composes its baseline on the first `agent/pre-step` and folds it into the final entering batch right after the claimed prompt, so it reaches the first request with the direct prompt; rejection keeps it in the next-step inbox. When compaction removes that baseline from the visible surface, the next entering pre-step composes the current baseline and carries it in the same request. Filesystem changes projected after tools are likewise folded into the next entering pre-step instead of creating a later context-only step ([decision](../.agents/notes/implemented/feature/2026-06-24-workspace-context.md)). `dsh-paths` owns shared paths.

### Bundles And Apps

`dsh-agent-spine-demo` bundles a spine and optional goals. App packages own CLI, ACP automation, and JSON-RPC front doors ([README](../packages/examples/agent-spine-demo/README.md), [acp/](../packages/acp/README.md), [interaction/](../packages/interaction/README.md)). `dsh-jsonrpc-agent` boots external `cordis.yml`; the Python SDK defaults when config is absent ([Python SDK](../python/README.md)). Thin deployments use swappable backends and optional tools ([examples/](../examples/AGENTS.md), [runnable wirings](cookbook/extension-cookbook.md#runnable-wirings), [graph atlas](graph-atlas.md)).

### Where New Behavior Goes

New behavior attaches to a documented extension point; a loop change updates this map.

| Goal | Mechanism |
|---|---|
| Add a model provider | register its adapter on `ctx.llm` |
| Add a model-facing capability | register on `ctx.tools`; schemas join prompt assembly |
| Add shell execution | implement and register a `ctx.bash` backend; the local backend spawns through `ctx.subprocess` |
| Add persistent terminal execution | register a `ctx.pty` backend plus `dsh-tool-pty` |
| Add a human command | register on `ctx.commands`; adapters discover and dispatch without a model turn |
| Add background work | register on `ctx.tasks`; generic `task_*` tools collect or stop it |
| Add filesystem access or policy | implement a `ctx.fs` provider or listen to `fs/*` policy events |
| Confine spawned processes | use a `ctx.sandbox` backend; consumers wrap argv before spawning |
| Intercept a request, tool, or turn | use its `agent/*` or `tools/*` event; `agent/turn-stopping` is the stop boundary |
| Enforce verification or routing discipline | register a guard plugin on tool/agent events (`guard/` family) |
| Add model-facing context | call `agent.inject()` to queue sourced context for the next admitted request |
| Add UI or editor integration | drive `ctx.agents` and render from `session/event` |
| Web Client Chat node | register a `ConversationNodeDefinition` + keyed renderer |
| Add durable session state | extend `SessionEventMap`; render and replay from the log |
| Rewind a session's log | call `Session.truncate`; persistence backends implement `deleteFrom` |
| Add asynchronous session-title generation | register the sole `ctx.sessionTitle` provider |
| Manage a same-session objective | use `ctx.goals`; continue through `Agent` and `agent/*` |
| Fork a live session | call `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| Scope a registration to one agent | use its `agent.ctx` (see Agent Scope) |

[Extension cookbook](cookbook/extension-cookbook.md) maps features to capabilities; guides cover [packages](cookbook/adding-a-package.md), [tools](cookbook/adding-a-tool.md), [LLM adapters](cookbook/adding-an-llm-adapter.md), [Chat nodes](cookbook/adding-a-conversation-node.md), and [vendored packages](cookbook/adding-a-vendored-package.md).
