# @huiliyi37/dsh-zen

English | [中文](README.zh.md)

The zen phase is a built-in agent-lifecycle phase, not a skill: a fresh top-level session's first steps run on a minimal anchored tool face — the official DeepSeek evaluation recipe (`bash`, `str_replace_editor`, `todo_write`) plus the agent-scoped `zen_anchor` — while a `zen:policy` prompt section directs the model to anchor the task: restate the goal, verify a landmark with a read-only probe, then call `zen_anchor`. A host-verified predicate promotes the session to the full face; the model's own claim of readiness is never trusted. Decision record: [the zen-phase Agent Note](../../../.agents/notes/implemented/architecture/2026-08-17-zen-phase-engineering-paradigm.md). After promotion the TUI parent catalog hides stacks that compete with `bash` for the same intent (`promoteDeny`).

Ablation grounding (Phase 0, 5-arm, real DeepSeek API, [report](../../../examples/headless-agent/zen-ablation-report.md), [results](../../../examples/headless-agent/zen-ablation-results.json)): the 2-tool minimal face eliminated wasted tool calls entirely (0 vs 3.0 per task on the 35-schema face) at 39% of the wide face's tokens, while zen guidance on a wide face made things worse — the face reduction is the active ingredient, which is why the phase physically shrinks the face instead of asking nicely. Remaining waste on a real product face is intent overlap with `bash`, not schema count.

## Config

```yaml
- id: zen
  name: '@huiliyi37/dsh-zen'
  config:
    section: |                    # REQUIRED; the zen:policy guidance text
      Zen phase — the toolset is reduced while you anchor the task. …
    face: [bash, str_replace_editor, todo_write]  # default; global tools visible while zen
    promoteDeny: []               # default; names hidden after promotion (TUI ships BASH_OVERLAP_TOOLS)
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

`resolveConfig` fails loud at plugin load on a blank `section`, unknown keys, an empty/duplicated `face`, a `face` naming `zen_anchor`, a `promoteDeny` that repeats a `face` name, or non-positive budgets. A `face` or `promoteDeny` naming an unregistered global tool fails at `agent/created` — synchronous listener failure vetoes publication, so a misconfigured deployment cannot silently run unrestricted. The TUI patch sets `face: [bash, str_replace_editor, todo_write, subagent]`, `promoteDeny` to `BASH_OVERLAP_TOOLS` (`edit`, `file_info`, `git`, `glob`, `grep`, `read`, `write`), and `diet.maxDescriptionChars: 80`.

## Phase mechanics

- **Arming** — at `agent/created` (before the driver and the first assembly) the plugin registers `zen_anchor` on the agent scope, installs `ctx.tools.restrict({ allow: face })`, and logs `zen/phase {phase: 'zen', reason: 'arm'}`. The first `request/header` therefore already carries the anchored face: model-visible ⟺ logged holds with no extra bookkeeping.
- **Subagents never arm** — a session with `header.parentSession` keeps its dispatcher-owned tool profile; the dispatch prompt is already its anchor.
- **Resume and fork fold the log** — `foldZenPhase` (last `zen/phase` wins) decides whether to reinstall the zen allow-list or the promoted face (`promoteDeny`, or unrestricted when that list is empty); there is no live mirror to drift.
- **Promotion** — one of three host predicates logs `zen/phase {phase: 'full', reason}`, lifts the zen allow-list, and installs `restrict({ deny: promoteDeny })` when that list is non-empty:
  - `anchor` — the model calls `zen_anchor` with a non-empty goal, 2–4 landmarks, and a pass level, and (under `requireEvidence`) the log already holds ≥1 successful non-bookkeeping tool result; a bare anchor is rejected back to the model with the probe-first instruction.
  - `timeout` — the step budget ran out. Promotion fires on the budget's final step and the unlock is visible on the following assembly; a plugin-sourced notice tells the model.
  - `triage` — the first user message is trivially short (≤ `maxChars`, single-line, text-only), so the phase is skipped before the first request ever assembles.
- **After promotion** the `zen:policy` section folds to empty and `zen_anchor` stays registered but returns an error if called — crossing the boundary changes only the restriction, mirroring plan mode's stable-catalog rule. Overlapping plugins remain registered so a subagent role can still allow `grep`/`read`/`glob`.
- **Defense in depth** — a registry guard denies non-face tool execution whenever the *logged* phase is still zen, independent of the live restriction bookkeeping.

The `zen/phase` sequence is invariant-checked (`@huiliyi37/dsh-zen/invariant`): payloads are shape-validated at the durable boundary, a session arms at most once, and promotion never re-logs.

## Model Experience

### Zen-phase first request

#### What the model sees

The first request's tool list is the anchored face plus `zen_anchor`, and the system prompt carries the deployment's `section` text. Nothing else changes.

#### Token effect

The wide face's schemas never enter the first requests: in the ablation the minimal face averaged 561 tokens per task against 1446 on the wide face. The `section` text is the only addition.

#### KV Cache effect

Promotion changes the tool schema block, so the next request re-fills that prefix once. Phase 0 measured 561 tokens/task on the minimal face against 1446 on the wide face (in+out). DeepSeek flash list prices used here are $0.27/MTok uncached input and $0.07/MTok cache read; do not treat the ablation harness's `firstStepInputTokens` as prefix size.

### zen_anchor call and result

#### What the model sees

One `generic`-rendered tool: `goal` (one sentence), `landmarks` (2–4 strings), `pass` (`fast | full | loop`), optional `forbidden`. Acceptance returns "Anchor accepted — the full toolset unlocks from your next step…"; rejection returns the probe-first instruction as a tool error.

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

## Known Limitations and Deferred Work

- **No re-entry** — a later "new task" in the same session does not re-arm the phase; re-entry needs evidence that mid-session re-anchoring pays for its prefix re-fill.
- **Triage is a host heuristic** — length/shape only; a sidecar classifier was rejected for the MVP (zero extra requests) and would slot in behind the same predicate.
- **Face width is static per deployment** — the axis that matters is overlapping intent with `bash`, not catalog cardinality. Retrieval (`tool_search`) stays deferred.
- **The anchor's content is not semantically validated** — the host checks structure and evidence, not whether the landmarks are the *right* landmarks; that stays with the model.
