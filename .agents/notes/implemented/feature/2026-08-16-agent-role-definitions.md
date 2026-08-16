# Agent Note: Agent role definitions — markdown-discovered delegation roles

Status: implemented

English | [中文](2026-08-16-agent-role-definitions.zh.md)

## Problem

The delegation tools could compose a child's persona, tool filter, model route, and depth only through per-instance deployment config: every composition a deployment wanted had to be a distinctly named tool, and the model had no way to pick a composition per call. Claude Code's comparable surface is markdown agent definitions with description-driven delegation. Meanwhile the capability bits showed only in-process providers can honor `persona`/`toolFilter` at all, the child-to-parent text path had zero sanitization (a child that read hostile content could return markup the parent parses as harness instructions), and there was no read-only built-in role for cheap exploration delegation.

## Decision

A **role is a named combination of start-request inputs**, not a new provider (`packages/subagent/agent-definitions`, `ctx.agentDefinitions`):

- **Discovery copies the skill seam's local shape**: flat `<name>.md` files (frontmatter `name`/`description` required, optional `tools` allow list and `model`; body becomes the persona) under ranked roots — project `.dsh/agents` 100, `.agents/agents` 200, custom 300, user `~/.dsh/agents` 400, `~/.agents/agents` 500, bundled 600 — with first-wins duplicates, chokidar invalidation, and `fs/observed` first-party mutation invalidation. The primitives are intentional copies of `dsh-skill-local`'s private ones (jscpd-marked); runtime `register()` sits at rank 250. One service package owns discovery and registration; there is no provider registry because no second source exists.
- **The model meets roles through a durable catalog message, not the schema.** The `agent` parameter is a free string; one tool instance per assembly (`agentCatalog: true`, enabled on `subagent` in the base bundle) publishes `<available_agents>` as a durable `catalog`-form user message with sha256 entry-digest versioning and first/replace/remove states, copied from `dsh-tool-skill`. The catalog disappears when the owning tool is restricted away. This preserves "model-visible ⟺ logged": a schema enum would change every request without a session event.
- **A role never widens the deployment.** The instance's configured `toolFilter` stays a ceiling intersected with the role's allow list (empty intersection fails loud); persona and model replace instance config; an unknown name errors toward the catalog.
- **`sandboxMode: 'read-only'` joins the start-request capability set** (`SubagentCapabilities.sandboxMode`; spawn/fork advertise it, out-of-process providers reject at start). In-process children get a durable `sandbox/mode {source: 'delegation'}` event appended in the creation window — the same append for one-shot and continuable fresh creation — so the narrowing lives on the child log and cold resume replays it. Only narrowing is representable; the field's literal type makes widening inexpressible. The descriptor stays at version 2: role composition persists as resolved `persona`/`toolFilter` plus that log event, never as a role name.
- **The built-in `explore` role registers from code** (`builtinExplore: false` opts out): read-only persona, an allow list of the base assembly's read tools (`grep`, `read`, `glob`, `semantic_search`, `bash` — the `code_scout` precedent updated to current tool names), and the read-only sandbox narrowing that keeps its shell access non-mutating.
- **Return-path sanitization**: child output text (foreground results, one-shot background task output), `report` deliveries, and `send_message` follow-ups pass through `escapeText` pseudo-XML escaping at the tool boundary, so the durable record holds exactly the inert text the receiving model sees.

## Alternatives considered

- **A new provider per role**: rejected — provider selection is deployment wiring (`provider: spawn` in cordis.yml), and only in-process providers can honor persona/toolFilter anyway; roles as request inputs reuse `applyChildComposition`, the descriptor, and capability validation unchanged.
- **Schema `enum` of role names on the tool**: rejected — every enum in the repo is a static closed set, and a per-request dynamic enum violates "model-visible ⟺ logged" because the session log could not reconstruct what the model was offered.
- **Catalog listener in every tool instance**: with the shipped two instances (`subagent`, `subagent_fork`) sharing one `agent-catalog` source kind, the restrict-away case produced contradictory publish/remove decisions in one step; a single designated owner (`agentCatalog` config) keeps the skill-catalog semantics exact.
- **Descriptor version 3 carrying the role name or sandbox mode**: rejected — cold resume needs the composition, not its name, and the `sandbox/mode` event is already durable on the child log; the continuable path therefore needed no fail-loud branch either.
- **Extracting shared skill/agent discovery primitives into a common package**: deferred — the skill originals are private and still evolving (directory bundles, invocation policy); a narrow flat-file copy is cheaper than coupling the two packages today.
- **Targeted tag neutralization instead of full `escapeText`**: the skill-catalog precedent escapes all of `&`, `<`, `>`, which is total and auditable; role return text remains readable to the model, and the durable record matches what the model sees.

## Consequences

- Coverage: 12 new `agent-definitions` specs (discovery/rank/frontmatter/watch/builtin), 11 new `tool-subagent` specs (role merge, ceiling, unknown name, catalog states, escaping), plus seam-level cases for the capability rejection, the one-shot `sandbox/mode` append under a real walled filesystem, continuable persistence across cold resume, and `report`/`send_message` escaping. The whole `packages/subagent` suite and the touched `workflow`/`scaffold` suites stay green.
- The `SubagentCapabilities` addition is a breaking shape change for out-of-tree providers (pre-release stance: no compat shim); every in-repo literal was updated.
- Deferred, recorded in the new package's README: trimming scoped child tools (`report`) per role, a `.claude/agents` compatibility source, and a markdown frontmatter field for the sandbox narrowing.
- Composition-controls rationale for config-time persona/toolFilter/depth stays with [the subagent composition-controls Agent Note](2026-07-12-subagent-persona-tool-filter-and-depth.md); this note owns the per-call role layer on top.
