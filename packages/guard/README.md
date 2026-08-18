# guard/ — loop-hygiene guard family

English | [中文](README.zh.md)

Behavioral guard plugins watch the agent loop for unproductive patterns and enforce per-call budgets. A guard is a self-contained consumer of core services and extension points, not a swappable capability.

## Hygiene as mechanism, not hints

Guards turn rules that would otherwise be prompt guidance into enforced, event-accounted mechanisms on the agent loop. They reuse the extension points every other dsh capability uses — `ctx.tools.guard`, `tools/execute`, `tools/post-execute`, `agent/pre-step`, and `session/event` — and either enrich the model's next request or veto a call. Two tiers:

- **Advisory** — `repeat-tool-guard` folds a reminder into the next request but never vetoes.
- **Enforcing** — `evidence-gate`, `agent-router`, `timeout-policy`, and `zen` veto, reroute, or gate work.

## The verification-and-routing loop

`evidence-gate` and `agent-router` close the loop that matters most for autonomous coding:

```text
tool outcomes → failure prediction (agent-router)
             → verification discipline (evidence-gate)
             → routing escalation (agent-router → native subagents)
             → results accounted back through session/event (evidence-gate)
```

Accounting rides the session event stream, so there are no new channels: a subagent's `tool/call` → `tool/result` pairs reach `evidence-gate` exactly like the main agent's.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`evidence-gate/`](evidence-gate/README.md) | RED-first verification discipline for bugfix obligations | `ctx.evidence` |
| [`agent-router/`](agent-router/README.md) | Failure-prediction routing with native subagent dispatch | `ctx.router` |
| [`repeat-tool-guard/`](repeat-tool-guard/README.md) | Advisory reminders for repeated tool calls | listens on tool/agent events |
| [`timeout-policy/`](timeout-policy/README.md) | Per-call tool deadlines as deployment policy | registers a `tools/execute` listener |
| [`zen/`](zen/README.md) | Anchored minimal first-face with host-verified promotion | `ctx.zen` |
| [`task-card/`](task-card/README.md) | First-message task-card rewrite for clearer model semantics | `ctx.taskCard` |
| [`pheromone/`](pheromone/README.md) | File-level stigmergy signals | pure library |

### evidence-gate — RED-first verification

An **obligation** (`family` + `claim`) is the unit of verification discipline. The `bugfix` family is RED-first: a fix's GREEN must be backed by a RED — a failing test recorded as `red:` evidence — before the gate lets the source edit through.

- **L1 edit gate** blocks the first edit of a target source file while a high-risk `bugfix` obligation has no RED evidence. The block is once-per-obligation (re-send the identical edit to proceed) and exempts test/scratch paths, which are themselves the RED action.
- **TDD gate** counts consecutive edits without verification; at the threshold (default 3) it suggests, or blocks under `{ tddMode: 'enforce' }`.
- **L2 final gate** (`evaluateFinal`) decides a task's end: `allow`, `continue_once` (with precise RED-probe suggestions), or `honest_blocked` (disclose the unresolved obligations).

Verification is detected with zero test-framework coupling: the plugin reads `tool/call` commands and `tool/result` output, classifies `passed` / `failed` / `blocked` from command text (`vitest`, `pytest`, …) plus output markers, and applies the RED rules. Probe suggestions degrade from `targeted_test` (expected to fail) to `grep` once a target is covered, and a cooldown table suppresses repeatedly uninformative probes. Details: [evidence-gate README](evidence-gate/README.md).

### agent-router — failure-prediction routing

A **prediction accumulator** slides a 10-round window over tool outcomes and derives an intervention level from the error rate: ≥0.4 `hint`, ≥0.6 `gate`, ≥0.8 `escalate`; three consecutive successes reset the window (environment recovered). A **deterministic router table** then maps metrics to an action, highest priority first:

1. `escalate` → delegate a `verifier` subagent (independent re-check);
2. `gate` with exhausted probe cooldown → delegate a `code_scout` subagent (fresh angle);
3. unresolved obligation with zero verifications → `self` (write a probe first — the edit gate already blocks edits);
4. otherwise `self`.

Delegation is dsh-native: `ctx.agents.create` → `followup` injects the task → `whenIdle` waits → `dispose` cleans up; each profile restricts the subagent's tool set (read/search/bash). Results land back in `evidence-gate` through `session/event`. Details: [agent-router README](agent-router/README.md).

### repeat-tool-guard — repeat-call reminders

Per-agent chains of identical calls (arguments deep-key-sorted then stringified, so property order is irrelevant) trigger reminders at configurable thresholds (default 3, 5, 8). It observes and enriches — never vetoes — and a user interjection resets the chain. Details: [repeat-tool-guard README](repeat-tool-guard/README.md).

### timeout-policy — per-call deadlines

A `tools/execute` wrapper arms the deadline a tool declares (`timeoutMs`) on `exec.signal` and replaces the result with a structured `TOOL_TIMEOUT` when its own timer wins — without racing or abandoning the tool promise. Details: [timeout-policy README](timeout-policy/README.md).

### zen — anchored first-face

A fresh top-level session's first steps run on a minimal anchored tool face (default: the official DeepSeek evaluation recipe plus `zen_anchor`) under a `zen:policy` prompt section; a host-verified predicate — validated anchor with probe evidence, step-budget timeout, or first-message triage — promotes to the full face by lifting an agent-scoped `tools.restrict`. Phase state is the durable `zen/phase` event, folded on read. Details: [zen README](zen/README.md).

### pheromone — file-level stigmergy

Session-scoped spatial memory: signals (`fragile`, `well-tested`, `entry-point`, `dead-end`, `coupling-hub`) decay exponentially (7-day half-life), enforce LRU capacity, and persist atomically to `.rivet/pheromones.json`. It is a pure library; signal sources (test-failure RED, read/edit traces) are wired by consuming plugins. Details: [pheromone README](pheromone/README.md).

## How guards reach the model

Advisory reminders ride the `tools/post-execute` waterfall as `additionalContexts` and are appended as plugin-sourced `user/message` events, so they are logged and reconstructable. Enforcing rejections return a reason string that the loop delivers as the blocked call's tool result — the model sees the reason and can act on it ([tools subsystem](../../docs/subsystems/tools.md)).

The timeout split across `dsh-timeout`, capability termination, and this policy layer is recorded in the [timeout-library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md).
