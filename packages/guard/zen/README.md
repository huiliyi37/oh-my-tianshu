# @huiliyi37/dsh-zen

English | [中文](README.zh.md)

The zen phase is a built-in agent-lifecycle phase, not a skill: a fresh top-level session's first steps run on a minimal anchored tool face — the official DeepSeek evaluation recipe (`bash`, `str_replace_editor`, `todo_write`) plus the agent-scoped `zen_anchor` — while a `zen:policy` prompt section directs the model to anchor the task: restate the goal, verify a landmark with a read-only probe, then call `zen_anchor`. A host-verified predicate — or the user's explicit `/fast` skip — promotes the session to the full face; the model's own claim of readiness is never trusted. Decision record: [the zen-phase Agent Note](../../../.agents/notes/implemented/architecture/2026-08-17-zen-phase-engineering-paradigm.md). After promotion the TUI parent catalog hides stacks that compete with `bash` for the same intent (`promoteDeny`).

The phase physically shrinks the first-request face instead of asking the model to ignore extra tools: guidance on a wide face does not substitute for a smaller catalog. After promotion the remaining overlap is with `bash`, which is why the TUI `promoteDeny` list hides the competing stacks rather than growing the catalog.

Narrowing prunes the prompt with the face. Tool plugins register a `tool:<name>` section beside the tool, so an unreachable tool leaves prose arguing for a call that cannot run — `tool:read` prefers `read` over `cat`, which sends the model into a `ToolNotFoundError` and then forbids the shell fallback it would otherwise reach for. Every assembly therefore drops each `tool:<name>` section whose tool is off that assembly's face, which covers the zen allow-list, `promoteDeny`, and subagent tool filters alike. A suffix naming no registered tool documents a family (`tool:tasks` covers `task_output`/`task_kill`/`task_list`) and survives: only the owning plugin knows whether its remaining tools still back the prose.

## Config

```yaml
- id: zen
  name: '@huiliyi37/dsh-zen'
  config:
    section: |                    # REQUIRED; the zen:policy guidance text
      Zen phase — the toolset is reduced while you anchor the task. …
    face: [bash, str_replace_editor, todo_write]  # default; global tools visible while zen
    promoteDeny: []               # default; names hidden after promotion (TUI list below)
    timeoutSteps: 4               # default; step budget before automatic promotion
    requireEvidence: true         # default; zen_anchor demands ≥1 successful probe first
    triage:
      enabled: true               # default; skip the phase for trivially short first messages
      maxChars: 80                # default; single-line text-only threshold
    faceSelection:
      enabled: false              # default; freeze a task-conditioned face on the first message
    diet:
      maxDescriptionChars: 80     # optional; omit = no clipping. TUI ships 80
    enabled: true                 # default; false mounts the service with no behavior
```

`resolveConfig` fails loud at plugin load on a blank `section`, unknown keys, an empty/duplicated `face`, a `face` naming `zen_anchor`, a `promoteDeny` that repeats a `face` name, or non-positive budgets. A `face` or `promoteDeny` naming an unregistered global tool fails at `agent/created` — synchronous listener failure vetoes publication, so a misconfigured deployment cannot silently run unrestricted.

The TUI patch anchors on `face: [bash, read]` — `read` is the tool the shipped `tool:read` section already tells the model to prefer over `cat`, and `bash` covers every other read-only check; neither writes, so "no modification before the anchor" is a property of the face rather than of the model's restraint. Its `promoteDeny` is `BASH_OVERLAP_TOOLS` minus that face (`edit`, `file_info`, `git`, `glob`, `grep`, `write`) plus `interrupt_agent` and `semantic_search`; `diet.maxDescriptionChars` is 80.

Arming tolerates a registry that is still filling in. A plugin that injects a service registers its tools whenever that service lands — `tool-bash` waits for the bash executor, `tool-fs-search` for `subprocess` — and a front door that attaches on its own services reaches `agent/created` before either. `restrict()` rejects a name it cannot see, so arming the whole list there would veto a session for a race. Arming instead takes the subset the registry already carries, which is strictly narrower than configured, and the remainder lands at the first per-agent seam; a name nothing registers by then is misconfiguration and fails loud through the `agent/pre-step` waterfall.

## Phase mechanics

- **Arming** — at `agent/created` (before the driver and the first assembly) the plugin registers `zen_anchor` on the agent scope, installs `ctx.tools.restrict({ allow: face })`, and logs `zen/phase {phase: 'zen', reason: 'arm'}`. The first `request/header` therefore already carries the anchored face: model-visible ⟺ logged holds with no extra bookkeeping.
- **Subagents never arm** — a session with `header.parentSession` keeps its dispatcher-owned tool profile; the dispatch prompt is already its anchor.
- **Resume and fork fold the log** — `foldZenPhase` (last `zen/phase` wins) decides whether to reinstall the zen allow-list or the promoted face (`promoteDeny`, or unrestricted when that list is empty); there is no live mirror to drift.
- **Promotion** — one of the promotion predicates logs `zen/phase {phase: 'full', reason}`, lifts the zen allow-list, and installs `restrict({ deny: promoteDeny })` when that list is non-empty:
  - `anchor` — the model calls `zen_anchor` with a non-empty goal, 2–4 landmarks, and a pass level, and (under `requireEvidence`) the log already holds ≥1 successful non-bookkeeping tool result; a bare anchor is rejected back to the model with the probe-first instruction.
  - `timeout` — the step budget ran out. Promotion fires on the budget's final step and the unlock is visible on the following assembly; a plugin-sourced notice tells the model.
  - `triage` — the first user message is trivially short (≤ `maxChars`, single-line, text-only), so the phase is skipped before the first request ever assembles.
  - `user` — the user ran `/fast [message]`: the phase ends on request and the optional message steers the turn on the full face. The command child registers only when a command registry is composed (the TUI reaches it through its CommandService fallback, like `/plan`); under `faceSelection` it refuses — the face is frozen.
- **After promotion** the `zen:policy` section folds to empty and `zen_anchor` stays registered; calling it once the phase has ended (anchor, budget, triage, or `/fast`) resolves as a benign no-op success — the full toolset is already unlocked — mirroring plan mode's stable-catalog rule. Crossing the boundary changes only the restriction, and the guidance sections follow the face across it. Overlapping plugins remain registered so a subagent role can still allow the tools `promoteDeny` hides.
- **Defense in depth** — a registry guard denies non-face tool execution whenever the *logged* phase is still zen, independent of the live restriction bookkeeping.

The `zen/phase` sequence is invariant-checked (`@huiliyi37/dsh-zen/invariant`): payloads are shape-validated at the durable boundary, a session arms at most once, and promotion never re-logs.

## Model Experience

### Zen-phase first request

#### What the model sees

The first request's tool list is the anchored face plus `zen_anchor`, and the system prompt carries the deployment's `section` text followed by a `Zen-phase callable tools:` line naming the exact face (plus `zen_anchor`) so the model never reaches for tools the face removed. Guidance for those removed tools is gone from the prompt as well, so the inventory line has nothing to contradict.

#### Token effect

The wide face's schemas never enter the first requests, and neither do their `tool:<name>` sections. The `section` text plus the one-line callable-tools inventory are the only additions.

#### KV Cache effect

Promotion changes the tool schema block, so the next request re-fills that prefix once.

### zen_anchor call and result

#### What the model sees

One `generic`-rendered tool: `goal` (one sentence), `landmarks` (2–4 strings), `pass` (`fast | full | loop`), optional `forbidden`. Acceptance returns "Anchor accepted — the full toolset unlocks from your next step…"; rejection returns the probe-first instruction as a tool error. Calling it after the phase has ended (anchor, budget, triage, or `/fast`) resolves as a benign no-op success instead.

#### Token effect

One small call/result pair per session, or two when the first anchor is rejected for missing evidence.

#### KV Cache effect

Append-only; the face change it triggers is the promotion re-fill accounted above.

### Timeout narration

#### What the model sees

When the step budget promotes the session, the notice below joins that step's messages as a plugin-sourced user message.

##### Timeout notice

```markdown
Zen phase ended (step budget reached); the full toolset unlocks from your next step.
```

#### Token effect

One sentence, once, only on timeout promotions.

#### KV Cache effect

Append-only.

### /fast skip

#### What the model sees

Nothing new. Skipped before the first message (the usual case), the first request already carries the full face, exactly like triage; skipped mid-zen, the `zen:policy` section folds and the full schemas appear on the next assembly, with the steered message (if any) arriving as an ordinary user message — no narration is injected.

#### Token effect

None beyond the full face's schemas.

#### KV Cache effect

Mid-zen it is the promotion re-fill accounted above; before the first request there is no prefix to re-fill.

## Known Limitations and Deferred Work

- **No re-entry** — a later "new task" in the same session does not re-arm the phase; re-entry needs evidence that mid-session re-anchoring pays for its prefix re-fill.
- **Triage is a host heuristic** — length/shape only; a sidecar classifier was rejected for the MVP (zero extra requests) and would slot in behind the same predicate.
- **Face width is static per deployment** — the axis that matters is overlapping intent with `bash`, not catalog cardinality. Retrieval (`tool_search`) stays deferred.
- **The anchor's content is not semantically validated** — the host checks structure and evidence, not whether the landmarks are the *right* landmarks; that stays with the model.
- **Section pruning is keyed on names, not prose** — a section that names another plugin's tool in passing, or a family section covering both a live and a hidden tool, still ships its stale sentence. Removing those needs the owning plugin to split the section or condition its text on the face.
