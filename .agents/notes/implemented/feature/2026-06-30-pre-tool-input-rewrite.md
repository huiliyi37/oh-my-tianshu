# Agent Note: Pre-tool input rewrite — a consistent design

Status: implemented

English | [中文](2026-06-30-pre-tool-input-rewrite.zh.md)

## Problem

The [interception extension-points Agent Note](2026-06-30-interception-extension-points.md) defines `tools/pre-execute` as an allow/deny/ask gate over an execution whose identity is already protected and whose arguments are deeply frozen. Claude Code's `PreToolUse` hook also offers `updatedInput`, so a faithful bridge needs an explicit rewrite mechanism. A rewrite cannot be a mutation escape hatch on the existing execution object: it must keep the durable history, audit record, presentation, and executed value consistent.

## The problem: three readers of pre-execution arguments

In the loop, a tool call's arguments are committed to the log and read by live consumers BEFORE the tool executes:

1. **`assistant/message`** is appended before tool dispatch — it is the model-history source `deriveMessages()` replays, so it carries the tool-call arguments the model itself emitted.
2. **`tool/call`** is the durable AUDIT record, appended before `ctx.tools.execute()`.
3. **Human-facing presentation reads `tool/call.arguments`**: UI renderers pass them to `presentResult`; `dsh-tool-bash` derives the card title, the rawInput, the cwd, and the terminal-vs-background treatment from them.

An execution-only rewrite would make the UI show one command while another ran and render the result against the wrong arguments. The registry prevents that failure mode today: it structured-clones and deep-freezes `arguments`, makes the execution identity properties non-writable, and exposes no test shim or listener path that can replace them. The rewrite design must preserve that protected-identity boundary rather than weaken it.

## Decision

A rewrite is a pre-identity consistency transaction, implemented as the `agent/pre-tool-commit` waterfall (declared in `packages/core/agent/src/runtime-types.ts`, fired by the loop in `packages/core/agent-loop/src/agent.ts::rewriteToolCalls`):

- The phase runs after the response is assembled and BEFORE the `assistant/message` append. Because `deriveEventMessage` projects only `assistant/message` (verbatim) and `tool/result` — `tool/call` is pure audit — committing the message with the EFFECTIVE arguments makes derived history agree with what executed by construction (the CC model: the model sees the rewrite took effect).
- The `tool/call` audit event records the rewritten arguments with the model's own raw string preserved in the new `originalArguments` sidecar field.
- Presentation reads `tool/call.arguments` as before, so it renders the effective call — what actually ran.
- A listener's replacement set must keep the same call ids in the same order (anything else throws); each rewritten value must be lossless JSON and pass the tool's own parameter schema through the new `ToolRegistry.validateArguments` — a failure drops the rewrite with a warning, never recording a call the tool would reject.
- The Claude bridge fires `PreToolUse` exactly once, at this phase, and memoizes the merged outcome per call id; its `tools/pre-execute` listener replays the memoized decision (deny/ask unchanged), so hook processes never run twice. Calls that bypass the phase (code-mode sub-calls, direct registry executions) fire at the registry boundary as before, but their arguments are already frozen — a rewrite request there keeps the faithful degraded warning.
- Multiple rewriting hooks fold deterministically: last in declaration order wins, wholesale (`hook-protocol/src/merge.ts`), where CC's "last finisher, order unspecified" is made deterministic.

## Alternatives considered

### Why not mutate the execution object?

Allowing a pre-execute listener to assign `exec.arguments` would provide only an execution rewrite, leaving model history, audit, and presentation unchanged. Keeping the identity protected makes such partial behavior unrepresentable.

### Why not a surface replacement on the assistant message?

`surfaceOp: 'replace'` today targets only `tool/result` nodes (core/session/src/surface.ts:291-313). Extending it to rewrite assistant tool-call blocks would touch the surface invariants for no gain: committing the message with effective arguments up front achieves the same history with zero surface surgery.

### Why not a correction message after the fact?

A separate "the hook rewrote X to Y" notice leaves the durable assistant turn inconsistent with the audit and wastes tokens on every replay; the pre-commit placement makes the correction unnecessary.

### Why not fire hooks twice (rewrite early, decide at the registry)?

Command hooks are arbitrary user processes with side effects; firing twice is unfaithful and unsafe. The memoized single-fire keeps one execution and both decision points.

## Consequences

- Acceptance criteria from the proposal all hold: the rewrite resolves before `ToolExecution` identity exists; `tool/call` records the rewritten arguments with `originalArguments` retained; derived history agrees with execution (the bridge coverage suite asserts the next request carries the rewritten call); presentation reads the rewritten arguments; the effective `ToolExecution.arguments` remains deeply frozen end to end.
- The provider-replay risk is settled structurally: providers pair tool calls with results by id and treat arguments as opaque JSON, so an assistant turn carrying effective arguments replays legally; the loop-level test asserts the exact serialized shape.
- A new registry public surface exists for the legality check: `ToolRegistry.validateArguments` (validation without execution).
- New durable surface: `tool/call.originalArguments` (log-only audit; persistence catalog regenerated). New live event: `agent/pre-tool-commit` (scoped waterfall; scoped-events resolvers regenerated).
- Residual, recorded: code-mode sub-calls and direct registry executions cannot be rewritten (their firing point is post-freeze); the bridge warns there instead of pretending.
