# Agent Note: Plan mode reprices the cached prefix

Status: proposed

English | [中文](2026-08-23-plan-mode-reprices-the-cached-prefix.zh.md)

## Problem

Entering or leaving plan mode rewrites the system prompt mid-session, which invalidates the provider's cached prefix for the entire conversation. Every plan cycle pays this twice, and the second payment lands when the conversation is at its longest.

[`plan-mode`](../../../../packages/plan/plan-mode/src/index.ts) registers a `plan:policy` section at order 50 whose text is a function of session state: it returns the policy prose while plan mode is active and the empty string otherwise. The prose is roughly 2345 characters across six paragraphs, and order 50 places it ahead of the tool-guidance band at 100–199, so a toggle also displaces every tool section behind it.

The section's own text states the problem it does not solve: "The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed only to keep the request shape stable." Plan mode already recognizes that mode-dependent request shape costs cache, and freezes the tool catalog to protect it — while writing the mode-dependent bytes into the system prompt, which precedes the tools and the entire message history in the prefix and therefore invalidates strictly more than the catalog it protected.

## Where the uncached tokens actually go

A high aggregate hit rate and an expensive invalidation coexist, which is why the cache-hit percentage is the wrong instrument for this. Across the recorded DeepSeek sessions the input hit rate is 99.4%, and the surviving 0.6% is not one thing. Splitting every uncached token in the 44 sessions of at least 30 steps by what preceded it:

| Where the uncached tokens come from | Tokens | Share | Recoverable |
|---|---|---|---|
| The first request of a session | 346,007 | 3.0% | No — nothing is cached yet |
| A step following a `request/header` change | 1,517,892 | 13.1% | **Yes** |
| Every other step | 9,711,118 | 83.9% | No — new output and tool results |

The 83.9% is the dominant term and is not a defect: each step appends the previous assistant message and its tool results, and tokens that did not exist cannot have been cached. It runs at roughly 3,400 uncached tokens per request and is why a session with no prefix change at all still shows a few percent uncached. Sessions `66b260f8`, `d991953b`, `545856ce`, and `e09a6b2b` emit exactly one header each and carry no invalidation whatsoever; all of their uncached volume is this term.

The 13.1% is the recoverable slice, and it concentrates. In `7635e035` (336 steps) the two plan-mode toggles alone reprice 115,683 and 146,074 tokens — 261,757 between them, or 53% of that session's entire uncached volume. `1b4e7f75` reaches 66.0%, `7e29a310` 61.8%, `15a62c0d` 55.0%, and `940cd8c9` 49.6%.

## The break inventory

Twenty-six header changes occur across those 44 sessions, and every one falls into one of two causes, identified by the exact text the assembly gained or lost.

**Plan mode, ±2345 characters, twice per cycle — the expensive one.** In `7635e035` the assembly gains six paragraphs at step 39 (`4283 → 6628`), beginning "You are in plan mode. Stay in plan mode until exit_plan_mode succeeds", and loses the same six at step 49. `940cd8c9` shows the identical pair at steps 23 and 36 (`1763 → 4108 → 1763`), `691f01ce` at 46 and 50, `15a62c0d`, and `763dfbcf`. The block is inserted immediately before the `git:` tool section rather than at either end, so the displaced remainder includes every tool section behind it. Because a plan cycle by construction happens after exploration, both payments land on a long conversation: the two in `7635e035` reprice 115,683 and 146,074 tokens against a first-request cost of 7,112.

**Zen promotion, −438 characters plus 25 tools, once per session — cheap by construction.** At `7635e035` step 3 the assembly loses "Zen phase — the toolset is reduced while you anchor the task" and simultaneously gains `create_goal`, `exit_plan_mode`, `get_goal`, `interrupt_agent`, `list_agents`, `memory_deep_recall`, `memory_save`, `memory_search`, `ralph`, `repo_graph`, `semantic_search`, `send_message`, `session_event_read`, `session_event_search`, `session_event_trace`, `session_search`, `session_trace`, `skill`, `subagent_fork`, `task_kill`, `task_list`, `task_output`, `update_goal`, `web_search`, and `workflow`. The tool schemas are part of the cached prefix, so promotion is a full invalidation — but it costs 14,185 tokens because it fires at step 3, while the conversation is still small. The same `4721 → 4283` and `4958 → 4390` signatures appear in `95b9dca1`, `54c42dc7`, `3330ae51`, and `4bbcb226`, each once and each early. This is the shape plan mode should copy, not the one it should be measured against.

A third pattern is a `reason="change"` event whose header is byte-identical to its predecessor. It costs nothing and is a logging artifact rather than an invalidation.

## Proposal

Move the mode-dependent text out of the system prompt and into the tail of the request, so the cached prefix ends before it rather than in front of it.

The concrete shape is an `agent/pre-step` injection carrying the policy prose as the last thing the model reads while plan mode is active, leaving `plan:policy` either absent or reduced to a constant that never varies within a session. Everything ahead of the injection point — identity, persona, tool guidance, and the whole message history — then stays byte-identical across the transition.

Reordering within the system prompt does not work and should not be attempted as a cheaper substitute. Raising `plan:policy` above the tool-guidance band would preserve the sections before it, but the message history follows the entire system prompt in the request, so a change anywhere in that string still reprices every message. Only moving the toggle behind the history helps.

Whether the injection is a synthetic message or a provider-level suffix depends on what `agent/pre-step` consumers already do for the spark-anchor injection, which solves the adjacent problem of putting per-step content where it does not disturb the prefix.

## Alternatives considered

**Leave it: a plan cycle is rare and the user chose it.** This is the status quo and it is not obviously wrong, since a plan transition is a deliberate act a few times per session. It loses on the attribution above: two toggles in `7635e035` account for 53% of that session's uncached volume, and the sessions that use plan mode are exactly the long ones where the cached history is most valuable. Rarity is what makes it survivable, not what makes it cheap — each individual toggle is the single most expensive event in the session that contains it.

**Fire the toggle early, as zen promotion does.** Zen's promotion is a full prefix invalidation too, and it costs 14,185 tokens instead of 146,074 purely because it lands at step 3. Constraining plan mode to an early window would borrow that property without moving any text. It loses because the constraint is unenforceable in the direction that matters: a plan cycle is a response to what exploration found, so requiring it early would either forbid the legitimate mid-session plan or push users to start over. Zen's shape works because anchoring genuinely belongs at the start; planning does not.

**Make the section constant — ship the plan-mode prose unconditionally.** This removes the toggle entirely and is the smallest possible change. It loses because the prose is imperative and mode-specific: "Stay in plan mode until `exit_plan_mode` succeeds", "Do not edit or write files". Shipping it outside plan mode would contradict every other instruction in the assembly, which is the same dangling-guidance failure that unbacked `tool:<name>` sections produce.

**Accept the reprice but shrink the section.** Cutting the six paragraphs down would reduce the inserted bytes but not the invalidation, because any change at that offset discards everything after it. The saving would be proportional to the section and the cost is proportional to the history.

## Acceptance criteria

A session that enters and leaves plan mode logs no `request/header` change attributable to the transition, and the steps immediately after each transition report a `cacheReadTokens` comparable to their neighbours rather than a fully uncached prompt.

Replaying the same attribution over sessions recorded after the change puts the "step following a header change" row at zero for plan transitions, leaving only zen promotion — whose cost is bounded by firing at step 3 — in the recoverable column.

The plan-mode instructions remain absent from assemblies outside plan mode, so the model is never told to stay in a mode it is not in.

## Risks

Moving instructions from the system prompt to the message tail changes how strongly a model weights them, and plan mode's guarantees are exactly the kind that a model treats differently when they arrive as conversation rather than as system policy. The `exit_plan_mode`-only-final-call rule and the "conversational agreement approves nothing" rule are the two most likely to weaken, and both have user-visible consequences if they do.

The attribution splits uncached tokens by whether a header change preceded the step, which is a correct classifier for prefix invalidation but assumes the provider's own `cacheReadTokens` accounting is faithful. It also cannot separate a transition's cost from the ordinary growth of the step it lands on, so the per-toggle figures are upper bounds by a few thousand tokens.

The recoverable share is 13.1% of uncached tokens, which is itself 0.6% of all input. Sizing this by the absolute bill of any single hour understates it, because the invalidation concentrates in exactly the long sessions that dominate total spend; sizing it by aggregate cache-hit percentage hides it entirely, because 99.4% and a 146,074-token reprice are the same measurement.
