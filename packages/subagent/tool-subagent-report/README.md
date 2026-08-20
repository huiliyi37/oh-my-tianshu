# @huiliyi37/dsh-tool-subagent-report

English | [中文](README.zh.md)

The optional child-scoped `report` tool is a thin adapter over `ctx.subagents.reportFrom()`. It gives every continuable in-process child a return channel to the Agent that started it. The package registers a continuable-child setup contribution instead of a global tool, so `report` exists only inside those children. Roots, one-shot subagents, remote subagent providers, sibling scopes, and agentless tool execution never present or execute it. Installing this package grants only that child-scoped capability; the parent-to-child direction remains the independent [`@huiliyi37/dsh-tool-subagent-control`](../tool-subagent-control/README.md), and continuable mode depends on neither package.

A child may call `report` zero or many times in one turn. A successful call neither concludes the turn, settles the Activation, nor prevents later parent follow-ups, and finishing a turn never reports automatically. The tool accepts no recipient: `exec.agent` is the sender's exact live Agent and the authority credential, and the service derives the sole recipient from that child's durable `parentSession`. Success returns the stable `MessageId` of the parent-accepted message, not a read receipt, an inbox-occurrence id, a parent-log acknowledgement, a turn-completion receipt, or a persistence flush. A parent absent from the registry fails the call with `direct parent is not live; report was not delivered` — registry presence governs parent resolution, and a registered parent already in host-owned disposal still accepts while its log admits appends. The service performs no injection, parent cold resume, or offline mailbox write; the durable child transcript remains the recovery source, and a failed tool call does not prove non-delivery (a later `tools/post-execute` veto can fail a call whose report was already accepted).

`reportDelivery` selects parent scheduling for every accepted report. `next-step` (the default) uses `parent.steer()`: a running parent receives the report at its nearest safe step boundary, while an idle parent starts a turn. Reports accepted in sequence share the next-step FIFO, so reports waiting together enter one claimed batch. `quiet` uses `parent.inject()`, adding the same next-step context without waking a parked parent. This is deployment scheduling policy, so the model-facing schema cannot select or override it per call.

Scope-local registration deliberately survives the child's global `toolFilter`, so a delegation allow-list cannot remove the only return channel. A deployment that requires a child with no return channel omits this package.

The contribution body is exported as `installReportTool(childCtx, ctx, delivery)` so inspection consumers can install `report` into a minted child scope. The generated tool catalog uses that path because the global registry cannot expose a scope-local schema. Production composition still enters through `apply()`; the subagent seam's contribution registry remains private.

## Model Experience

### Tool schema

#### What the model sees

The generated [`report` schema](../../../docs/tool-catalog.md#huiliyi37dsh-tool-subagent-report): one required `output` string. Its description states that reporting is explicit and repeatable, reaches only the Agent that started the child, and does not end the turn. It carries no recipient or delivery-mode parameter.

#### Token effect

Fixed schema cost per continuable-child request, and none in any other Agent's requests.

#### KV Cache effect

Prefix-stable within a child; the schema does not change at runtime. Removing the package revokes the schema from resident children, which changes their next request prefix.

### Report result

#### What the model sees

`report accepted by the agent that started you as message <messageId>` on acceptance; the canonical output carries the stable `messageId`. A failure from an unauthorized sender, an unavailable parent, or a closing lifecycle is an errored result. The description says a failed call may still have arrived because a later `tools/post-execute` failure can replace the result after `reportFrom()` accepted the message.

#### Token effect

One short acknowledgement per call in the reporting child. The reported content is additionally billed to the parent: next-step delivery joins the next request in an open parent turn or starts a turn for an idle parent, while quiet delivery waits for another input to wake the parent.

#### KV Cache effect

Append-only in the child. In the parent, the framed report follows existing history and preserves the reusable prefix.

### Parent-visible report

#### What the model sees

One user-role parent message framed as `Background subagent <child-id> reported:` followed by the child's `output` with pseudo-XML escaped (`&`, `<`, `>` neutralized at this boundary, so markup a child read from hostile content reaches the parent model inert; the durable record holds exactly the escaped text), with a durable source `{ kind: 'subagent-report', senderSessionId: <child-id> }` that names the child.

#### Token effect

The child's complete `output` plus the one-line frame, uncapped by this package.

#### KV Cache effect

Append-only; the report follows the parent's reusable request prefix. Next-step delivery wakes the parent and may extend its open turn, while quiet delivery does not wake it.

## Known Limitations and Deferred Work

- **A parent whose host-owned disposal already started can still accept** — `AgentHandle.dispose()` cancels, awaits quiescence, and only then unwinds the scope and leaves the registry; it exposes no signal for "disposal started." A report accepted in that window is appended to the parent's transcript, but that parent will not act on it in this process. A continuation-manager-owned parent rejects forest teardown through the manager's admission boundary.
- **Acceptance is weaker than durable delivery** — there is no durable mailbox, idempotency key, delivery receipt, retry protocol, or exactly-once claim. A process failure after one side recorded acceptance leaves the outcome ambiguous, and an external retry may duplicate the report.
- **A staged quiet report is not immediately reconstructable** — acceptance returns its stable `MessageId`, but the parent Session reconstructs the framed content only after pending context reaches its ordinary log boundary.
- **Granting waits for the next Activation; revocation is immediate** — installing this package after a child becomes resident grants `report` only on that child's next Activation, while removing the package revokes the schema from resident children immediately.
- **Nested reporting reaches exactly one edge upward** — a grandchild reports to its direct child parent, never to the top-level coordinator, which must explicitly report a derived update later.
- **No rate limiting** — the default `next-step` mode can amplify model work when nested children report frequently, although reports waiting together share one step; a deployment that accepts unread reports over that amplification selects `quiet`.
