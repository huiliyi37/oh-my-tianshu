# Agent Note: Prompt sections follow the tool face, and arming tolerates a filling registry

Status: implemented

English | [中文](2026-08-23-zen-section-pruning-deferred-arming.zh.md)

## Problem

Two coupled defects in the zen phase, both first shipped as part of the reverted `5e5804baec` and recovered here without that commit's tool reduction (see [the revert note](2026-08-23-zen-face-narrowing-reverted.md)).

Narrowing the tool face left the system prompt untouched, so the harness shipped requests that argued against themselves. A tool plugin registers its guidance as a `tool:<name>` section beside the tool, and `read`'s section says: "Use the read tool — not shell commands like cat — to inspect text files." The TUI's `promoteDeny` removes `read` from the parent face after promotion. Every promoted request therefore ordered the model to call a tool that could not run, and forbade the one substitute it still had. In a recorded session the model called `read` twice during the zen phase (the guard answered with the locked-tool message), then twice more after promotion, where `restrict({ deny })` had removed `read` from the scope's view entirely and the dispatch answered `unknown tool "read"` — a message that names no substitute, so the post-promotion failure reads *worse* to the model than the zen-phase one. Four failed calls, all provoked by the prompt. The phase had already answered the hazard with more prose — a `Zen-phase callable tools:` inventory line — and an inventory cannot win an argument with an imperative.

Separately, `tools.restrict()` validates names against the tools registered at the moment it runs, and `agent/created` fires before plugins that inject a service — `tool-bash` behind the bash executor, `tool-fs-search` behind `subprocess` — have registered theirs (a probe observed roughly 350 ms). Arming or promoting inside that window vetoed agent creation with `tools.restrict() names unknown global tools …`: a startup race, not a misconfiguration, decided whether a session could attach.

## Decision

**Every assembly drops each `tool:<name>` section whose named tool is absent from that assembly's own tool list.** The rule is keyed on the assembly rather than on any config, so one filter covers the zen allow-list, `promoteDeny`, and subagent tool filters, and no list has to be maintained alongside the deny list. `stripUnbackedToolSections` in `packages/guard/zen/src/tool-sections.ts` is the pure function; `ZenPhaseService` installs it on `system-prompt/assemble`, taking the visible names from `assembled.tools` and testing registration through `ctx.tools.get`. A section whose suffix names no registered tool documents a family — `tool:tasks` covers `task_output`, `task_kill`, and `task_list` — and survives: only the owning plugin knows whether its remaining tools still back the prose.

**Arming tolerates a registry that is still filling in.** `armRestrict` installs the restriction on the subset of configured names the registry already carries — strictly narrower than configured, so no tool leaks — and records the remainder as `pending` on the install. `completeArm` reapplies the whole list at the first per-agent seam (`agent/inbox/inserted`, then `agent/pre-step` for sessions that reach a step without an inbox insert); the first assembly therefore already ships the completed face, so `request/header` stays the faithful record. A name nothing registers by then is misconfiguration and fails loud through the `agent/pre-step` waterfall — the failure moved from a creation veto to a step rejection, and the old `assertPromoteDenyRegistered` creation-time check is gone. The shipped face composition is unchanged: the TUI keeps `face: [bash, str_replace_editor, todo_write, subagent]` and `promoteDeny: BASH_OVERLAP_TOOLS`.

The anchor-rejection message names the deployment's own face instead of the fixed example `bash ls / cat / git status`, which is the same dangling recommendation the filter exists to remove the moment a deployment's face drops `bash`.

## Alternatives considered

**Fix the invariant in `core/system-prompt` instead of zen.** The rule "an assembly must not advertise a tool it does not carry" is a property of the prompt registry, and a core filter would also cover deployments that narrow without mounting zen. Rejected for blast radius: the `tool:` prefix is a convention no core type declares, and an unconditional filter in `assemble()` changes every deployment's prompt at once. Zen owns face narrowing and already hooks the waterfall; if a second face-narrowing consumer appears without zen, the filter moves down.

**Leave the sections and add more counter-prose.** That is what the `Zen-phase callable tools:` line already did, and the four failed calls measure how well it works. Guidance contradicting guidance does not substitute for deleting the wrong guidance.

**Keep the creation-time veto (the previous arming).** A synchronous throw at `agent/created` fails creation loud, which is the right shape for a genuine misconfiguration but the wrong one for a registry that has not finished filling — the veto cannot tell a misspelled face from a plugin waiting on its service, so it rejected legitimate sessions on a race. Making the front door wait on every tool plugin's injected services instead would couple session creation to plugin internals; arming the registered subset needs no such coupling because it is strictly narrower than configured and the guard still locks non-face tools while the log says zen.

**Complete the arm lazily without ever failing.** Silently widening to the configured list once the registry settles would hide genuine misconfiguration forever. The pending debt is cheap to keep and the pre-step failure costs the session rather than the process, so loud loses nothing.

## Testing

- `packages/guard/zen/tests/zen.spec.ts` — `stripUnbackedToolSections` over the three cases: a registered tool off the face is dropped, a face carrying every documented tool keeps all sections, and a family suffix naming no tool survives.
- `packages/guard/zen/tests/integration.spec.ts` — a scripted loop registers `tool:probe`, `tool:hammer`, and `tool:family`, then asserts the hammer guidance is absent from both the zen-phase request (allow-list narrowing) and the promoted request (`promoteDeny` narrowing) while the registered catalog still holds `hammer`; a late-registering face tool reaches the first `request/header` whole; a face naming a tool nothing registers never reaches the model (the pre-step waterfall keeps rejecting); a `promoteDeny` naming an unregistered tool fails loud when `/fast` installs the deny list.

## Consequences

- A tool the face hides costs nothing in prompt tokens: hiding a tool is now a complete operation rather than half of one. The bridged default path benefits identically — the alignment session carries `promoteDeny` through the resume branch, so its assemblies prune the same sections.
- Pruning is keyed on names, not meaning. A section that mentions another plugin's tool in passing still ships its stale sentence, and a family section covering both a live and a hidden tool keeps prose for the hidden one; closing those needs the owning plugin to split its section or condition its text on the face (recorded under Known Limitations in the package README).
- Misconfiguration timing changed: a misspelled `face` or `promoteDeny` name no longer fails `agents.create` but rejects the first step through the `agent/pre-step` waterfall. The session exists, holds the narrowed subset the whole time, and never reaches the model.
- The two defect paragraphs the revert note restored (the intermittent `restrict()` failure and the dangling guidance) are closed by this change; the tool reduction that note keeps reverted stays reverted.

## Related

- [The zen-phase Agent Note](../architecture/2026-08-17-zen-phase-engineering-paradigm.md) owns the phase itself.
- [The zen face narrowing revert](2026-08-23-zen-face-narrowing-reverted.md) records why the companion tool reduction stayed out and holds the measurement discipline any future reduction must satisfy.
- [Zen direct entry](../feature/2026-08-22-zen-direct-entry-fast-skip.md) owns the `/fast` skip the deferred-arming tests exercise.
