# Agent Note: Subagent model-routing arc — pure core, durable policy, tool wiring

Status: implemented

English | [中文](2026-08-28-subagent-model-routing-arc.zh.md)

Scope: `packages/subagent/subagent`, `packages/subagent/tool-subagent`, and every `SubagentProvider` capability advertisement

## Problem

The delegation tool could configure child routes only at deployment time (`Config.agentOptions`); the model could not route one suitable subtask to a different provider/model/effort, and route capability was silently ignored on providers that cannot honor it. Upstream `deepseek-ai/deepseek-harness` shipped the full arc (base layer `2026-08-18-model-selected-subagent-routes`, authorization `2026-08-24-user-authorized-subagent-model-routes`) after this fork's baseline; this wave ports it.

## Decision

**Pure core, durable policy, then consumers — three commits.** `model-selection.ts` owns the seam's vocabulary and rules: exact `{provider, model}` routes with fail-closed validation (non-empty, deduplicated), the merge semantics (provider and model are one route and must be supplied together; changing the effective route without naming an effort clears the configured route-owned effort), executor-side allowlist enforcement, and preflight through `ctx.llm.resolveCallConfig()`. `model-selection-state.ts` declares the log-only `subagent/model-selection-policy` session event (appended once, before selection can be exercised; absence means the fixed-route definition) with read/record accessors. `model-selection-settings.ts` is the Host-owned `subagent-model-selection` settings section as a separately composed entry (default off; enabling requires at least one route; sampled at use, so a settings change never rebuilds a running Agent).

**The tool wiring consumes the policy per delegation call — a deliberate divergence from upstream's per-Agent publication sampling.** Upstream mounts tool instances in Agent scopes and samples the setting at Agent publication, omitting the route fields from schemas of policy-less Sessions. This fork's `tool-subagent` is a deployment-level single instance composed from `cordis.yml`; restructuring it into per-Agent mounts to replicate the omission is a lifecycle rewrite out of proportion to the benefit. Instead the schema carries the three route fields whenever `modelSelectionSettings` is configured, and the policy is resolved at the first delegation call: read the session's recorded event (a decision is anchored in the log); else, for a child session whose parent agent is still reachable, inherit the parent session's event (parent-child consistency first); else, sample the settings and record once. That sampling covers fresh top-level sessions, resumed legacy top-level sessions without an anchor, and child sessions whose parent agent is unreachable (out-of-process backends, orphaned resumes) — for the last, sampling is upstream's per-Agent publication equivalent and may diverge from the unreachable parent's anchored decision. Disabled Sessions therefore still see the fields but every call bearing them is rejected (`child model selection is disabled for this tool instance`), and a recorded decision is anchored in the session log — settings edits affect only sessions that have not yet recorded.

**Capability advertisement is the transport truth.** `SubagentCapabilities` gains `agentOptions` as its first member. The service rejects a request carrying `agentOptions` on a provider advertising `false` before `start` runs, and the tool's mount fails when `Config.agentOptions` is set against such a provider — the accepted-then-ignored path no longer exists. The in-process providers (`fork`, `spawn`) advertise `true`; `acp` and `dsh-sdk` advertise `false`. The DSH SDK half of upstream's arc (routing across the SDK wire plus the provider's immutable `agentRouteDefaults`) is **not** ported: this fork's SDK transport never consumed `agentOptions`, so advertising `false` keeps it honest, and previously-silently-ignored configured routes now fail loud. The `agentRouteDefaults` provider surface and the schema-description variants that reference it are ported for shape parity; no shipped provider currently publishes one, so the parent-request-header fallback (`parentAgentOptionsForDelegation`, newest logged request over creation options with `maxTokens` retained) is the active baseline path.

**Preflight closes the race.** After the asynchronous `resolveCallConfig`, the tool re-checks that the same provider instance is still registered before creating the child, so an HMR swap cannot combine one provider's defaults with another provider's process. The parent options read is lazy — a bare calling agent (direct invocation, test doubles) never touches the header path.

**The discovery tool's registration follows the fiber, not provider availability.** `list_subagent_models` reads only the live LLM directory and the calling Session's policy, so it registers once in `apply()` — never inside `mount()`, where a provider disappear/reappear cycle would re-insert the global-singleton name and throw (`tool "list_subagent_models" is already registered`), leaving the delegation tool unmounted with no recovery path. Multiple selection-capable instances share one registration: the resolver is per-calling-Session and instance-independent, so a concurrent sibling's tool is interchangeable — the registration catch confirms an existing same-scope tool before rethrowing anything else.

Not ported: upstream's `tool:subagent` prompt guidance section (this fork's delegation tool never registered one; adopting it is an independent model-visible change), the invariant machinery pinning upstream's per-Agent definition stability (our single instance has one static definition), and the Web management card (a later wave).

## Alternatives considered

### Why not sample the policy per Agent like upstream?

It requires per-Agent tool mounting this fork does not have. Per-call resolution keeps every upstream guarantee that matters — one decision per session, recorded durably, inherited by children when the parent agent is reachable (else sampled like upstream), immune to live settings edits — at the cost of advertising (not hiding) route fields on disabled Sessions, where the executor's rejection preserves the authorization boundary.

### Why advertise the fields when selection is disabled?

Schema membership is deployment-level in this fork; per-session omission would need the upstream mount model. The rejected call is the boundary; the fields are inert metadata.

### Why leave the SDK at `false`?

Advertising `true` without implementing wire transport would claim a route choice that never happened. Upstream's SDK routing is a self-contained follow-up.

### Why not register the discovery tool inside `mount()`?

The original wiring registered `list_subagent_models` inside `mount()` without retaining its disposer. A provider removed→re-added cycle (HMR, reconnect) re-ran `mount()` and re-inserted the global-singleton name, throwing `tool "list_subagent_models" is already registered` from the `subagent/provider-added` listener and leaving the delegation tool unmounted with no recovery path; two selection-capable instances hit the same collision at load. The fix registers once per fiber in `apply()` and, on a collision, shares the sibling's registration instead of failing loud: both resolvers are equivalent (policy is resolved per calling Session), so rejecting the second instance would block identical, correct behavior.

## Consequences

Bought: model-facing child route selection with durable per-Session authorization, prefix-stable discovery, capability honesty across every provider, and fail-loud behavior where this fork previously ignored configuration silently. The authorization matrix is complete at the tool/service layer, and the TUI management surface landed with the arc: a `/config` 子代理模型 category (present when the settings entry is composed) toggles the switch, removes authorized routes in place, and adds routes through a provider/model picker over the live LLM directory — all through revision-fenced writes to the settings document. The discovery tool survives provider disappear/reappear cycles (its registration follows the fiber, and selection-capable siblings share one equivalent tool); regression tests cover the re-add cycle, dual-instance sharing, resumed-session sampling, and parent-reachable inheritance. Policy resolution now also covers resumed legacy sessions and parent-unreachable child sessions by sampling instead of rejecting every explicit route request. What remains for later waves is the Web management card and the DSH SDK transport.
