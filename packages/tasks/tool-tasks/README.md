# @deepseek-ai/dsh-tool-tasks

English | [中文](README.zh.md)

The model-facing control surface for `ctx.tasks`: three kind-independent tools, completion notices, and one background-work prompt section. Loading the plugin attaches the surface required by `ctx.tasks.start()`.

## Tools

- `task_output(task_id, wait?, timeout_ms?)` reads without blocking by default. Stream tasks return only the next delta; final-output tasks return their result after settlement. Every response ends with `[status: ...]`. `wait: true` waits up to the configured cap and leaves a still-running task alive on timeout.
- `task_list()` returns caller-visible tasks as `<id> [<kind>] <status> — <label>`.
- `task_kill(task_id, reason?)` requests cancellation immediately and forwards the logged reason. Terminal tasks return a non-consuming snapshot.

All three use generic UI cards: `read` for output and list, `execute` for kill.

Their canonical values are `{ text, task }`, `PublicTaskSnapshot[]`, and `{ outcome: 'cancellation-requested' | 'already-finished', task }`. A public snapshot carries id, kind, label, status/detail, and start/finish times; it deliberately omits `ownerSession` and the internal `reported` notice bit. Native renderers preserve the status and acknowledgement text above.

When a producer supplies `outputLimitBytes`, `task_output`, terminal `task_kill`, and completion notices cap the complete Native UTF-8 result after adding status or notice text. Reads retain the output tail and control suffix when they fit; a bounded completion notice instead reserves `background task <id>` and the `task_output` collection instruction before spending remaining bytes on its variable kind, label, status, detail, and truncation marker. A prepended pre-execute listener captures the caller-visible task before policy, and each task-control definition's final-content callback applies its producer cap to single-text denials, short-circuits, normalized tool or pipeline failures, replacements, and blocks; structured multi-block policy results retain their shape. An existing producer truncation marker is reused rather than duplicated. Producers that omit the field retain the existing unbounded control-surface behavior.

## Completion notices

An unreported completion injects `background task <id> (<kind>: <label>) finished [status: ...]. Read its output with task_output.` into the exact owner's next-step inbox. When bounded, the stable id prefix and collection command outrank variable label/detail so the notice remains actionable at PTY's supported 64-byte minimum. Injection is durable pending context for a later pre-step claim, not a wake-up; cancellation or owner disposal may discard it before claim. A kill or terminal read/wait marks delivery reported and suppresses the redundant notice.

## Config

| key | default | meaning |
|---|---|---|
| `waitTimeoutMs` | `30000` | wait used when `wait: true` omits `timeout_ms` |
| `maxWaitTimeoutMs` | `600000` | cap for model-supplied waits |

A default above the cap fails at load.

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains this guidance. Agent-scoped tool filtering may hide the tools without removing the independently registered prompt section.

##### Background-task guidance

```markdown
Track every background task id you start. You are notified in-session when a task finishes — do not busy-poll or sleep on one; keep working on independent steps and do not duplicate a running task's work. Before giving a final answer, collect every still-relevant task with task_output (set wait: true only when you are genuinely blocked on it), and task_kill tasks that stopped mattering.
```

#### Token effect

Small fixed input cost per request while active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged. Activation or disposal may invalidate reuse from this prompt section.

### Tool schemas

#### What the model sees

The generated [`task_output`, `task_list`, and `task_kill` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-tasks) while this surface is visible.

#### Token effect

Fixed schema cost on each request where the tools are visible.

#### KV Cache effect

Prefix-stable while tool definitions and visibility are unchanged. Registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results and notices

#### What the model sees

Reads return output or `(no new output)` followed by `[status: <status>]` and optional detail. An empty list returns `(no background tasks)`. Kill returns `requested cancellation of task <id>` or the existing terminal status. Unreported owned completion uses the notice above.

#### Token effect

Results and notices remain in parent history until compaction. Stream reads do not repeat consumed output; a producer-supplied `outputLimitBytes` bounds each complete read or notice.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Completion notices do not wake idle agents** — callers needing an immediate result must use `task_output`.
- **Stream reads are single-consumer** — independent observers need another runtime API.
- **Unowned tasks have no session fence** — external surfaces must supply caller policy or avoid them.
