# Agent Note: dsh agent-router port (S7: metrics → algorithm → MoE routing → dsh-native subagents)

Status: implemented

English | [中文](2026-08-11-agent-router-port.zh.md)

## Problem

dsh has discipline — the evidence gate's "what you must not do" — but nothing that answers "who should do it". The port sources are the Tianshu (opencode-tui) prediction-error pure-function core plus expert-router's star-domain mapping idea, of which only the routing-table part is taken. Two user constraints bound the port: **no heavy CMV** — take only the basic metrics into the algorithm; **subagents go dsh-native** — use what dsh already has, and evolve it gradually later.

## Decision

- **New package** `packages/guard/agent-router/` (guard group, sibling of evidence-gate) — discipline (the evidence gate's "what you must not do") and scheduling (the routing layer's "who should do it") are two orthogonal layers.
- **prediction.ts**: the Tianshu prediction-error pure-function core ported in full (window 10, `<3 samples → 0`, thresholds 0.4/0.6/0.8 with equality included, `consecutiveCorrect >= 3` tipping point) — zero dependencies (type-only imports). **EFE/computeEFE/adjustReasoningEffort are deliberately not ported** (they depend on the heavy vigor/sensorium/season state, violating "no heavy CMV").
- **router.ts**: a deterministic routing table (a pure function, unit-testable; no learning/bandit — "evolve it gradually later"). Rule priority in descending order:
  1. `escalate` (error rate ≥0.8) → delegate verifier (independent-channel recheck)
  2. `gate` (≥0.6) + probe cooldown exhausted → delegate code_scout (reconnaissance from a fresh angle)
  3. default self — obligations/verifications are collected into the metrics but no rule consumes them yet (the comment once listed an obligation rule the code never implemented; the comment now matches the code)
- **dispatch.ts**: **dsh-native dispatch** — **the Tianshu worker/dispatcher/council lifecycle is not carried over.** Dispatch goes through the dsh subagent seam: `ctx.subagents.start` (named provider, config `subagentProvider`, default `spawn`) delivers the task as the child's first user message; `await run.result` settles; `dispose` cleans up. The seam stamps `parentSession`/`origin: 'subagent'`/`delegationDepth`, so routed children appear under `/subagents`/`list_agents`/the descendants projection and zen never arms them (zen skips by `parentSession`). `execute(action, { sessionId })` requires the live parent session — the seam derives workspace/lineage/depth from it. The profile tool restriction installs via `toolFilter` fail-loud — unknown tool names or a missing service abort the dispatch, never silently widening the tool face. `profileTools` (Config) overrides the built-in defaults for slim assemblies (e.g. the headless fixture declares `['read','bash']`).
- **index.ts wiring**: `session/event` tool/result → recordPrediction (isError judgment), keyed per session and excluding child sessions (`header.parentSession` — mirroring zen's skip); evidence tracker metrics are optionally consumed via `ctx.reflect.get('evidence', false)` (prediction works standalone without evidence-gate); the `ctx.router` service surface (`metrics`/`decide`/`execute` all take the owning `sessionId`; `resetPrediction(sessionId?)`).
- **Zero new channels for accounting**: subagent tool/result events are accounted back to evidence-gate automatically through the existing session/event stream.
- **Decision auditability**: each accepted delegate appends a log-only `router/route` record on the parent session at acceptance (profile/task/targets/child session id) — route decisions are reconstructable from the session log.
- **Structured result return** (closed-loop Phase 2): `execute` returns `DispatchOutcome { sessionId, stopReason, output }` (was child id only); dispatch appends a paired log-only `router/outcome` record when the child settles, so terminal state is reconstructable and callers can feed it to synthesis.
- **Primary-agent synthesis** (closed-loop Phase 2): a `router:synthesis` prompt section renders when unresolved child findings exist (derived purely from the logged `router/outcome` minus `router/adoption` records — model-visible ⟺ logged); the `router_adopt` tool records adopt/reject declarations as log-only `router/adoption` (exactly one per outcome, enforced at the tool boundary and by the invariant companion's per-session pairing state). The router never merges or votes — synthesis is the main agent's act. A verification gap (file mutation without a fresh `run_tests`/`related_tests`) appends a soft reminder in the section (claim-audit freshness, advisory only). The plugin now declares `inject: ['tools', 'systemPrompt']` and adds `dsh-tools`/`dsh-system-prompt` peer dependencies plus tsconfig references.
- **Route-record invariant**: the package-owned durable state is the `router/route` record; the invariant companion validates payload shape (known profile, non-empty task, string-array targets, non-empty child id) and, when the child is live, lineage consistency (the record's session is the child's `header.parentSession`). A not-live child downgrades to shape-only — a session may route many delegates, so no uniqueness check.
- **Accumulator eviction**: the per-session prediction map deletes the entry on `agent/disposed`, so a long-lived TUI process does not accumulate one small object per ended session.
- **Escalation hysteresis** (closed-loop Phase 1): `consecutiveFailed` on the accumulator feeds `RouterMetrics.consecutiveFailures`; the escalate branch fires only when failures ≥ `escalation.minConsecutiveFailures` (default 2) and `escalation.cap` is not `off` — a single sporadic failure never escalates. Policy resolves via `resolveEscalationPolicy` (fail-loud config validation).
- **Turn-end trigger** (production trigger point): `trigger: { mode, onTurnEnd }` defaults to off. Shadow mode decides at `turn/end` and appends a log-only `router/decision` (never dispatches — the standard start); auto dispatches through the seam and records `dispatched` + `subagentSessionId`, with dispatch failures contained (logged + recorded as not-dispatched) so a background trigger never breaks a turn. Child sessions are excluded (same `parentSession` skip as the metrics). The shipped TUI re-mounts agent-router with `trigger: { mode: 'shadow', onTurnEnd: true }` (bundle-patch test pins the config); switching to auto is a product call after the closed loop is verified.

## Key verification facts

- Package-level tests: 78 all green (prediction 18 / router 12 / dispatch 8 / integration 15 / invariant 16 / synthesis 9).
- Integration (a real cordis Context + real event objects, no mocked middle layers): 8 consecutive failures → escalate → delegate verifier → execute dispatch call-sequence assertion; 3 consecutive successes → tipping-point reset → decide returns self; dispatchEnabled:false does not dispatch.
- Test-driven correction: a mock Context that overrides the real `ctx.reflect` crashes (`ctx.on`'s proxy depends on the reflection layer) — **integration tests always use a real `new Context()` + provide**, never hand-patch reflect.
- dispatch resolves `subagents` and `agents` through `ctx.reflect.get(name, false)` (the Cordis 4 injection proxy pattern — the same as T4/compact/evidence-gate); the parent session must be a live agent, else dispatch fails loud.
- Three rounds of lint polish: `block.isError === true` (no optional chain needed after type narrowing), branded sessionId asserted directly with toMatch, mockImplementation returns the handle synchronously (avoids misused-promise).

## Not-ported list

The full EFE suite, season/vigor/sensorium, the Tianshu worker/dispatcher/council, bandit-promotion (adaptive routing), expert-router multi-expert merging (the star-domain role table is borrowed only for its routing semantics).

## Real assembly (S7 wrap-up)

- **examples/headless-agent** mounts agent-router: cli.cordis.yml adds the plugin (provider/model: cli-mock) + a mock LLM consecutive-failure mode (`DSH_CLI_MOCK_FAIL_LOOP=1`, an instance field failCount counts across turns, back to normal replies after 8 failed turns to prevent an infinite loop) + the driver exposes router state (`DSH_ROUTER_DEMO=1` prints metrics + decide).
- **Shipped TUI unmount decision**: the TUI bundle used to mount agent-router with no config — inert (no production caller of `decide`/`execute`, `execute` short-circuits on missing provider/model) while its `session/event` listener ran unconditionally. The mount is removed from `cordis.patch.yml` (and the tui package dependency) until a caller wires the decision into the turn pipeline; the headless e2e assembly remains the reference integration. Re-mounting is a one-row patch + dependency restore.
- **A judgment gap exposed by real assembly**: dsh bash does **not mark isError** on a non-zero exit code (measured: 8 times `isError: false` while the command failed; the exit code sits in the text as `[exit code: 1]`) — success/failure judgment = `isError || text contains [exit code: non-zero]`. Another instance of "trust TypeScript, but never trust a single signal".
- **evidence service-surface gap**: agent-router consuming `evidence?.cooldown()` crashed (the service surface has no such method) — evidence-gate added `cooldownTable()`/`verificationCount()` (exposing state the tracker already holds).
- **e2e assertion lesson**: the failure-count assertion was first written as isError:true (stale — real failures live in the text); changed to check for the `[exit code: 1]` text.

## Verification commands

```sh
pnpm vitest run packages/guard/agent-router/tests/                     # 6 文件 78 测试全绿
npx oxlint packages/guard/agent-router/                                # 0 错误
npx tsc -p packages/guard/agent-router/tsconfig.json                   # 0 错误
```

## Alternatives considered

**Porting the EFE suite (EFE/computeEFE/adjustReasoningEffort) with the prediction core.** Rejected: it depends on the heavy vigor/sensorium/season state, which violates the "no heavy CMV" constraint — only the basic metrics go into the algorithm.

**A learning router (bandit-promotion / adaptive routing).** Rejected: a deterministic routing table is a pure function and unit-testable, and the port's rule is to evolve it gradually later rather than ship adaptivity that no test can pin.

**Carrying over the Tianshu worker/dispatcher/council lifecycle.** Rejected: dsh already has the pieces — `ctx.agents.create` plus `followup`, `whenIdle`, and `dispose` — so dispatch is dsh-native, with a finally guaranteeing cleanup on every path.

**Merging multiple experts the way expert-router does.** Rejected: only the star-domain role table's routing semantics are borrowed; multi-expert merging is not part of the routing-table port.

**Folding routing into evidence-gate.** Rejected: discipline and scheduling are orthogonal layers, so routing lands as its own guard-group package beside evidence-gate.

**Blocking edits from the routing layer when obligations are pending with zero verifications.** Rejected: the evidence gate already blocks edits, so the rule routes to self ("write a probe first") instead of blocking a second time.

**New event channels for subagent accounting.** Rejected: subagent tool/result events already flow through the existing session/event stream and are accounted back to evidence-gate automatically.

**A mock Context with a hand-patched `ctx.reflect` in integration tests.** Rejected because it crashes: `ctx.on`'s proxy depends on the reflection layer, so integration tests use a real `new Context()` + provide.

## Consequences

The routing layer is a pure decision function over basic metrics, so 32 package tests and an integration suite on a real Context pin it, prediction still works standalone when evidence-gate is absent, and accounting costs zero new event types. The price is that everything adaptive stays out: without bandit promotion and the EFE suite, routing reacts only to the error-rate thresholds and cooldown state the table was written against, and widening it means adding rules, not learning them.

Dispatch inherits the same bounded shape. It runs without tool restriction because the dsh restrict signature is unexplored, so a delegated subagent gets the parent's tool surface; the e2e evidence stops at the routing decision rather than the verifier subagent's actual turn; the table carries the profiles it was written with, without doc_scout/verifier variants; and the link to evidence-gate is one-way metric consumption — an escalate neither creates an obligation nor records the delegate attempt. Real assembly bought two corrections in exchange: success/failure judgment now reads the `[exit code: …]` text because dsh bash does not mark isError, and evidence-gate exposes `cooldownTable()`/`verificationCount()` for state its tracker already held.
