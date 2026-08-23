# Agent Note: Zen phase — an anchored first-face lifecycle paradigm

Status: implemented

English | [中文](2026-08-17-zen-phase-engineering-paradigm.zh.md)

## Problem

Models degrade on the first turns of a task when the first request already carries the full deployment surface: tool selection quality drops as the candidate set grows (external evidence puts the knee near ~20 tools, hardest on small models), wasted calls land on plausible-but-wrong tools, and the schema block dominates first-request tokens. DeepSeek's own published evaluation harness runs a 2-tool minimal face (`bash` + `str_replace_editor`) — the product ships ~35 schemas. Skills that ask the model to "think first" (J-Space, deep-brainstorm) are model-side discipline: they cannot shrink the candidate set, cannot be enforced, and are invisible to the host when ignored. The user's framing: the first round needs a *zen mode* — an engineering paradigm in the harness, not another skill.

## Decision

The zen phase is a built-in agent-lifecycle phase owned by `packages/guard/zen` (`@huiliyi37/dsh-zen`, ctx key `zen`), mounted in the TUI bundle patch:

- **Anchored first face.** At `agent/created` — the veto-capable seam before the driver and first assembly — a fresh top-level session gets `ctx.tools.restrict({ allow: face })` with the official-evaluation-recipe default (`bash`, `str_replace_editor`, `todo_write`) plus an agent-scoped `zen_anchor` tool, and logs `zen/phase {'zen', 'arm'}`. `request/header` already logs every face the model sees, so model-visible ⟺ logged holds for free.
- **Host-verified promotion, never self-claimed.** Three predicates promote to the full face: a validated `zen_anchor` call (non-empty goal, 2–4 landmarks, pass level, and — by default — ≥1 successful non-bookkeeping tool result already in the log), a step-budget timeout with an injected narration, or first-message triage (trivially short single-line prompts skip the phase before the first request). Promotion appends `zen/phase {'full', reason}` first, then lifts the zen allow-list (and installs `promoteDeny` when that list is set; TUI ships `BASH_OVERLAP_TOOLS`); the section text folds to empty from the log, so resume/fork reconstruct the face with no live mirror.
- **Fail loud on misconfiguration.** Config validation throws at plugin load; a face or `promoteDeny` naming a tool nothing registers fails loud through the `agent/pre-step` waterfall — arming at `agent/created` takes the subset of names the registry already carries, because plugins awaiting an injected service register later and the front door can reach the seam first ([the deferred-arming note](../bug-fix/2026-08-23-zen-section-pruning-deferred-arming.md)); the discovered constraint that `agent/session-start` listener errors are *contained* by the loop still rules that seam out.
- **Defense in depth.** A `ctx.tools.guard` denies non-face execution whenever the *folded log* still says zen, independent of the live restrict bookkeeping; the `zen/phase` sequence itself is invariant-checked (shape at the durable boundary, arm-at-most-once, no re-log after full).
- **Orthogonal composition.** Presets choose the session's roster (which tools exist), zen phases the roster's exposure over time, plan mode gates mutations by permission, skills remain model-side discipline. Subagent sessions (`header.parentSession` set) never arm — their dispatch prompt is the anchor and routers own their profiles.

## Research fragments pool (5 scouts, condensed)

- **Quantitative** — tool-selection accuracy knees as the candidate set grows and collapses hardest on small models; retrieval-restricted subsets recovered 13.6%→43% in external benchmarks ([RAG-MCP / Writer–Anthropic write-up](https://tianpan.co/blog/2026-04-19-over-tooled-agent-problem)); DeepSeek's official coding evaluation uses the 2-tool minimal recipe this phase adopts as its default face.
- **Counter-evidence absorbed into the design** — "always plan first" is falsified (benefit crosses over at 3–6 step tasks) → triage skip; visible-but-denied tools produce spin incidents → physical face reduction, not soft permission; "the model says it anchored" is gameable → tool call + host validation as the predicate; promotion refills the schema prefix once, so caching is no argument against a single promotion.
- **Prior art** — Anthropic Tool Search (defer-loading tool schemas), Claude Code plan mode (permission axis with a reviewed exit), OpenAI `allowed_tools` (per-request subset). OpenMythos is a loop-depth transformer replica; only its structural metaphor (resident core face / phase signal / frozen-input re-injection) carries over.
- **Neuroscience mapping (naming, not mechanism)** — anchored face ≈ thalamic gating (filter before cortex); zen guidance ≈ task-set pre-pulse; promotion ≈ DMN→task-positive switch; anchor structure ≈ landmark-first spatial encoding with a 4±1 chunk budget.
- **Seam survey** — `ctx.tools.restrict()` aligns all four exposure surfaces (wire/lookup/execute/SDK) and `request/header` change-logging makes every face auditable; `agent/created` is the only pre-first-assembly seam whose listener failure vetoes; pre-step runs after assembly, so its effects land next step.

## Alternatives considered

- **Permission axis (visible but denied)** — extinct: does not reduce first-request interference, and external spin incidents show it is not a substitute; its two salvageable features (guard backstop, explicit unlock tool) are folded in.
- **Retrieval axis (`tool_search` meta-tool + on-demand schema append)** — deferred: the remaining disease is overlapping intent with `bash`, not catalog cardinality, so a count-gated retrieval axis is the wrong next step.
- **Sidecar triage model** — rejected for the MVP: a host heuristic costs zero extra requests; the predicate boundary admits a classifier later without redesign.
- **Skill-only zen (J-Space/OpenMythos as SKILL.md)** — rejected as the primary mechanism: unenforceable, invisible to the host, and guidance without face reduction is counterproductive.
- **Arming at `agent/session-start`** — rejected after discovering its listeners are error-contained: a misconfigured face would silently skip the phase instead of failing creation.

## Consequences

- Fresh top-level sessions spend their first steps on ≤4 schemas + anchor instead of ~35, at the cost of one schema-prefix re-fill per promoted session and one anchor round-trip on multi-step tasks.
- The phase is deployment policy, fully config-owned (`section`, `face`, `timeoutSteps`, `requireEvidence`, `triage`, `faceSelection`, `diet`, `promoteDeny`, `enabled`) — a bundle that wants the old behavior sets `enabled: false`.
- New durable event `zen/phase` joins the session vocabulary; consumers fold it (last-wins) rather than mirroring state.
- The TUI's wired tool surface (memory, session-query, vision) hides during the zen phase of every fresh session; the triage heuristic and step budget bound how long.
- The TUI top status bar renders a `禅` badge while the phase is armed (`zenPhaseLabel` over the logged `zen/phase` fold in `preset-surface.ts`; it disappears on promotion or compaction prune), and the shipped defaults encode the official minimal recipe + `todo_write` + `subagent`, a 4-step budget, and curated `promoteDeny`. Retrieval stays deferred because the axis is overlap, not count.

## Testing

- `packages/guard/zen/tests/zen.spec.ts` — config fail-loud table, fold semantics, evidence predicate.
- `packages/guard/zen/tests/integration.spec.ts` — scripted-model loop runs: first-header face snapshot, anchor/timeout/triage promotions with header change assertions, bare-anchor rejection, denial during zen, misconfiguration failing loud at pre-step, subagent exclusion, armed/promoted seed folds, `enabled: false`.
- `packages/guard/zen/tests/invariant.spec.ts` — payload shape and sequence invariants, live and on late registration.
- `packages/tui/tui/tests/bundle-patch.spec.ts` — the TUI patch mounts the `zen` row with a non-empty section, `face` including `subagent`, `promoteDeny` equal to `BASH_OVERLAP_TOOLS`, and diet.

## Related

- [TUI tianshu capability roster](../feature/2026-08-17-tui-bundle-tianshu-capability-roster.md) — the wiring wave this phase ships with.
- [Repeat-tool-guard](../../archived/feature/2026-07-08-repeat-tool-guard.md) — the guard-family advisory tier this package's enforcing phase sits beside.
