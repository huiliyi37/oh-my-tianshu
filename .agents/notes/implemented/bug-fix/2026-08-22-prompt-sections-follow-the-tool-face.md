# Agent Note: The assembled prompt never advertises a tool off the face

Status: implemented

English | [中文](2026-08-22-prompt-sections-follow-the-tool-face.zh.md)

## Problem

Narrowing the tool face left the system prompt untouched, so the harness shipped requests that argued against themselves. A tool plugin registers its guidance as a `tool:<name>` section beside the tool, and `read`'s section says: "Use the read tool — not shell commands like cat — to inspect text files." The TUI's `promoteDeny` removed `read` from the parent face. Every promoted request therefore ordered the model to call a tool that could not run, and forbade the one substitute it still had.

The model behaved correctly and still lost. In a real session it called `read` twice during the zen phase (the guard answered with the locked-tool message), then twice more after promotion, where `restrict({ deny })` had removed `read` from the scope's view entirely and the dispatch answered `unknown tool "read"` — a message that names no substitute, so the post-promotion failure reads *worse* to the model than the zen-phase one. Only then did it fall back to `str_replace_editor`'s view command. Four failed calls, all provoked by the prompt.

The contradiction was not incidental. In the last `request/header` of that session the face carried 32 tools and none of `read`, `write`, `edit`, `grep`, `glob`, or `git`, while the same request's system prompt spent about 388 tokens across six sections naming exactly those tools — three of them imperatives that also forbid the shell path (`not shell commands like cat`, `not shell find`, `not shell grep or rg`). The zen phase was worse still: a 5-tool face shipped alongside prose teaching `memory_search`, `memory_save`, `memory_deep_recall`, ralph, and goal tools.

The phase already knew about the hazard and had answered it with more prose — a `Zen-phase callable tools:` inventory line appended to the policy section, meant to stop the model reaching for tools the face removed. An inventory cannot win an argument with an imperative, and it did not.

## Decision

Every assembly drops each `tool:<name>` section whose named tool is absent from that assembly's own tool list. The rule is keyed on the assembly rather than on any config, so one filter covers the zen allow-list, `promoteDeny`, and subagent tool filters, and no list has to be maintained alongside the deny list. `stripUnbackedToolSections` in `packages/guard/zen/src/tool-sections.ts` is the pure function; `ZenPhaseService` installs it on `system-prompt/assemble`, taking the visible names from `assembled.tools` and testing registration through `ctx.tools.get`.

A section whose suffix names no registered tool documents a family — `tool:tasks` covers `task_output`, `task_kill`, and `task_list` — and survives. Only the owning plugin knows whether its remaining tools still back the prose, so the filter declines to guess.

The zen face became `[bash, read]`, the smallest pair that can both discover and verify. `read` is the tool the shipped `tool:read` section already tells the model to prefer over `cat`, so prompt and face agree on the file-reading path from the first request instead of contradicting each other; `bash` covers every other read-only check — `ls`, `git status`, `rg` — without a second schema. Neither writes, which moves "no modification before the anchor" from an instruction the model may ignore into a property of the face. `read` consequently leaves `promoteDeny`, which `resolveConfig` requires — a name in both lists fails at plugin load.

The anchor-rejection message now names the deployment's own face instead of the fixed example `bash ls / cat / git status`, which would otherwise have become the next dangling recommendation the moment `bash` left the face.

The promoted TUI face is 15 tools: the 23 this deployment registers, less the eight in `promoteDeny`. Nine plugin rows are unmounted rather than denied, because unmounting takes the plugin's prompt section and startup cost with it while `promoteDeny` only hides the tool from the parent catalog. Three TUI-owned rows carry `disabled: true` in place (`tool-memory`, `tool-session-query`, `tool-memory-recall`); six base-owned rows are disabled by id-keyed override (`tool-run-tests`, `tool-workflow`, `tool-ralph`, `tool-subagent-fork`, `tool-meridian`, `tool-skill`). `interrupt_agent` and `semantic_search` are denied rather than unmounted because each shares a plugin with a tool that stays, or is still reachable through a subagent allow-list.

The composition is measured, not guessed: across 116 recorded sessions the fifteen unmounted tools drew zero calls between them, and the two denied ones drew two.

## Alternatives considered

**Fix the invariant in `core/system-prompt` instead of zen.** The rule "an assembly must not advertise a tool it does not carry" is a property of the prompt registry, and a core filter would also cover deployments that narrow without mounting zen. It was rejected for blast radius: the `tool:` prefix is a convention no core type declares, and an unconditional filter in `assemble()` changes every deployment's prompt at once. Zen is the package that owns face narrowing and already hooks the waterfall. If a second face-narrowing consumer appears without zen, the filter moves down.

**Leave the sections and add more counter-prose.** This is what the `Zen-phase callable tools:` line already did, and the four failed calls are the measurement of how well it works. Guidance on a wide face does not substitute for a smaller catalog, and the same holds one level up: guidance contradicting guidance does not substitute for deleting the wrong guidance.

**Keep the official evaluation recipe (`bash`, `str_replace_editor`, `todo_write`) as the zen face.** This was the previous shipped default. It loses on coherence: `str_replace_editor` is a write-capable editor on a face whose whole point is that nothing can write before the anchor, so the policy section's "before any modification" framing depends on the model's restraint rather than on the catalog. `todo_write` earns no anchor evidence either — the evidence gate excludes bookkeeping calls — so it occupies a schema slot the anchoring step cannot spend.

**Face of `[read, write]`.** Proposed as the minimal pair matching what the model reaches for. Rejected because the system prompt carries no directory listing — verified against a real header — so a face with no `glob`, `grep`, or `bash` gives a fresh session no way to discover which paths exist. `read` on a guessed path fails, a failed call is not anchor evidence, and the only tool that could reliably succeed would be `write`. The phase would degrade into burning the four-step budget before an automatic timeout promotion.

**`promoteDeny` for all nine rows instead of unmounting.** Denial keeps the plugin registered for subagent roles, which is why two tools still use it. As the general answer it pays the plugin's startup cost and — before this change — kept its prompt section, for a tool nobody calls.

## Testing

- `packages/guard/zen/tests/zen.spec.ts` — `stripUnbackedToolSections` over the three cases: a registered tool off the face is dropped, a face carrying every documented tool keeps all sections, and a family suffix naming no tool survives.
- `packages/guard/zen/tests/integration.spec.ts` — a scripted loop registers `tool:probe`, `tool:hammer`, and `tool:family`, then asserts the hammer guidance is absent from both the zen-phase request (allow-list narrowing) and the promoted request (`promoteDeny` narrowing) while the registered catalog still holds `hammer`. Neutering the filter fails this test on the zen-phase assertion.
- `packages/tui/tui/tests/bundle-patch.spec.ts` — the zen row's face, the `promoteDeny` derivation from `BASH_OVERLAP_TOOLS`, their disjointness, the three in-place disables, and the six id-keyed overrides. Each override is checked against the base patch for a live id/name pair, because `applyEntryPatches` only warns on a miss: a base rename would otherwise re-mount a dropped row silently.

## Consequences

- A tool the face hides costs nothing in prompt tokens, so hiding a tool is now a complete operation rather than half of one.
- The TUI's first request carries three schemas and their three sections; the promoted face carries 18. The previous shape was a 5-tool zen face and 32 promoted, both alongside prose for tools neither face held.
- Pruning is keyed on names, not meaning. A section that mentions another plugin's tool in passing still ships its stale sentence — the ralph section's advice about goal tools outlives an unmounted `tool-goal` — and a family section covering both a live and a hidden tool keeps prose for the hidden one. Closing those needs the owning plugin to split its section or condition its text on the face.
- `agent-router`'s `verificationGap` cannot see verification any more: its `VERIFICATION_TOOLS` set holds only `run_tests` and `related_tests`, both registered by the now-unmounted `tool-run-tests`, so any mutation reads as a gap. The effect is bounded — a soft reminder, only when subagent outcomes are pending, and the TUI runs the router in shadow mode — and the real fix is to recognize verification run through `bash`, as `doom-loop-guard`'s test-churn detector already does. A TODO at the declaration records this.
- Restoring any dropped capability is a one-line edit at the row that documents why it went.

## Related

- [The zen-phase Agent Note](../architecture/2026-08-17-zen-phase-engineering-paradigm.md) owns the phase itself; this note owns the prompt-coherence invariant and the shipped face composition.
