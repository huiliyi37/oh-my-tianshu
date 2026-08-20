# Agent Note: Cancelled streams finalize their delivered prefix

Status: implemented

English | [中文](2026-08-10-cancelled-stream-prefix-finalize.zh.md)

## Problem

A cancelled stream can leave `assistant/chunk` events that clients continue rendering while `deriveMessages()` excludes them because no `assistant/message` records the delivered prefix. A follow-up such as "expand on your second point" then lacks text the user read, and a fork at the cancelled turn inherits the same gap.

The model history must contain assistant content that remains visible to the user after cancellation.

## Decision

`ReactLoopAgent.step()` catches cancellation while consuming a model stream, when its `BlockAssembler`, logged chunk seqs, and provider route identify the delivered prefix. It appends that prefix as the step's `assistant/message` with `interrupted: true`, `surfaceOp: 'append'`, and `sourceEventSeqs` containing exactly the logged chunks. The append precedes `step/end` and the aborted `turn/end`.

`BlockAssembler.interruptedBlocks()` returns closed and open `text` and `reasoning` blocks with non-whitespace content in stream order. It omits tool calls because interruption precedes dispatch and no real result exists; it also omits empty blocks and open unknown block types. An empty result appends no assistant message. Provider `error` and `aborted` finishes leave the stream-consumption scope before `agent/request-error`, so provider failures and cancellation during recovery commit no content from the failed request.

The Chat Conversation Definition reads `interrupted` from the durable message and renders the Stopped marker, while the client runtime's request inspection leaves a cancellation-finalized request `running` past `step/end` — retaining the durable result seq and provenance — so Trajectory classifies it under the error lifecycle as if the prefix event did not exist. The TUI transcript folds the interrupted message as one ordinary settled row: the live cancel path has already discarded the in-flight buffer, so the prefix resurfaces only through the projection. Cancellation during tool execution follows the tool scheduler contract because the assistant message has already committed: started calls produce real results, and undispatched calls receive `ABORTED_BEFORE_DISPATCH` results.

## Alternatives considered

**Always discard the prefix.** This avoids a new durable marker but makes every cancel-then-follow-up and fork omit assistant content that remains visible to the user.

**Assemble the prefix from chunks during projection.** `deriveMessages()` and client Conversation Definitions would each need interruption assembly rules, and the log would have no authoritative assistant message for the prefix. This also expands model history beyond the three `SurfaceEventType` events.

**Retain complete tool calls with synthetic aborted results.** These calls never dispatched, so synthetic results would claim an execution outcome that did not occur and add content the user did not receive as a tool result.

**Append a model-visible interruption message such as `[interrupted by user]`.** This can tell the model that the prefix is incomplete, but it requires a separate source type, projection rule, UI treatment, and localized wording. The durable aborted `turn/end` preserves the fact needed for that later decision.

## Consequences

Post-cancel follow-ups and forks include the delivered prefix. The ACP bridge drains ordered assistant output before settling the prompt, so the final `agent_message_chunk` update precedes the cancelled stop reason.

Terminal provider errors still discard their streamed prefix. That asymmetry remains because an error turn ends without the user's cancellation decision and requires its own retention policy.

## Testing

`packages/core/agent-loop/tests/cancel.spec.ts` covers content, cited seqs, event order, next-request parity, reasoning-only output, tool-call omission, recovery cancellation, and the empty-prefix case. `packages/llm/llm/tests/assembler.spec.ts` covers `interruptedBlocks()`. `packages/client/ui-conversation/tests/conversation-node-definitions.spec.ts` covers the Chat projection; `packages/client/runtime/tests/request-inspection.spec.ts` covers the Trajectory-facing request lifecycle. `packages/tui/tui/tests/adapter-transcript.spec.ts` pins the fold of a dangling stream closed by an interrupted message, and `packages/tui/tui/tests/app.spec.ts` pins that the live cancel path keeps the residue out of scrollback. The keyless `cancel` ACP snapshot and the `goal-session` goal snapshot cover assembled applications.
