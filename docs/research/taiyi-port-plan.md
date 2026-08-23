# Taiyi verse backflow plan: porting the taiyi persona to the dsh side

English | [中文](taiyi-port-plan.zh.md)

This plan builds on [opencode-tui (Tianshu TUI): a study of its end-to-end Chinese thinking and stable-flow mechanisms](opencode-tui-chinese-thinking-flow.md), bringing the portable parts of the upstream Tianshu TUI "Taiyi star domain" experiment back into this repository, tianshu-public (hereafter dsh). This document is a plan and contains no implementation; implementation proceeds as separate changes, and before implementing, each acceptance clause in this plan must be checked off one by one.

## Background and scope

Taiyi is the upstream's adversarial prompt experiment domain: the prompt states no development or engineering concept, instead using cosmic-origin imagery to guide the order of things, to examine whether the model retains its engineering capability under an adversarial training mechanism (the upstream domain comment at `src/agent/star-domain-data.ts:627-686` records in full the experiment's intent and the seven-version iteration history). Upstream's measured conclusion: under the minimal toolset (the taiyi 16-tool evaluation preset), after seven prompt iterations Taiyi shows no degradation of engineering capability and remains excellent. This plan ports only three things: the **verse itself** (the current seventh-version verse at `star-domain-data.ts:687-750`), the **verse-writing methodology** (imagery-generation behavior and the discipline against engineering drift), and the **verification method** (A/B reproduction of "no engineering-capability degradation"). Explicitly not ported: upstream-private mechanisms such as the tool surface and tool-name mapping, star-domain routing and keywords, courageThreshold, domain-voice, and uiPersona/glyph — the Taiyi experiment's 16-tool preset is an experimental condition, not an asset (TAIYI_EXCLUDES at `src/tools/tool-preset.ts:161-186` is referenced only as background, not mapped).

## Goals

1. Add an opt-in taiyi agent preset on the dsh side, whose persona text is the Taiyi verse; it sets no default and enters no default path.
2. Freeze the "imagery-generation behavior" writing discipline into verse-level anti-drift assertions, so the verse cannot be engineered back by later maintainers.
3. Provide a repeatable A/B verification method that reproduces "no engineering-capability degradation" on dsh's own runnable examples.

## Assets and sources

| Asset | Upstream source | Handling |
|---|---|---|
| The verse itself (current seventh version) | `src/agent/star-domain-data.ts:687-750` (the taiyi entry: the full systemPromptSuffix + the short volatileBlock version + the five seed sentences) | Port the full systemPromptSuffix text into the persona text as the main body, in a single copy |
| Version archive | `docs/3.0/太一-词-历代存档.md:12-17` (the genealogy table) | Build no parallel archive; on the dsh side git history carries the traceback duty, and the upstream archive collects only superseded versions (per the file's own frontmatter statement) |
| Verse-writing methodology | `docs/3.0/太一-词-历代存档.md:21-28` (the fourth-version revision notes) | Turn into a verse-level assertion checklist (see "Anti-drift assertions") |
| Guard-test precedent | `docs/3.0/太一-词-历代存档.md:42-43` (five rules became six; "must contain criterion/counterexample" reversed to "must not contain") | Turn into dsh verse-level invariant tests |
| Injection-path lesson | `src/agent/star-domain-data.ts:665-668` (the fifth version wrote the "yin-yang" passage into systemPromptSuffix with zero effect; the sixth moved it back to volatileBlock) | The dsh persona is a single-track injection (the single `deployment:persona` section), which naturally avoids the dual-track pitfall; the plan mandates that the full verse text be stored in exactly one place and mounted in exactly one place |

## Landing design

- Add a new `apps/cli/config/agent-presets/taiyi/` directory: `preset.yml` + `agent.cordis.yml`, following the preset contract in `packages/preset/README.md` (one `agent.cordis.yml` per directory; the directory listing is the roster, alongside the existing code/cordis/minimal/standard).
- `agent.cordis.yml` mounts the `@huiliyi37/dsh-persona` row (`packages/preset/persona/README.md`), with `text` = the full Taiyi verse.
- persona config values: `complete: false` (default) — the verse stacks on top of the harness identity and tool guidance, aligning with the upstream volatileBlock's semantics of "domain-verse injection freezes the prefix without replacing the base"; `includeRuntimeContext: true` (default) — runtime context is injected as usual, so the Taiyi experiment does not change context supply on the dsh side.
- Tool surface: **zero change**. Write no restrict/allow-list; when the taiyi preset is mounted, tools follow the preset's existing configuration, and Taiyi, by virtue of the port, imposes no requirements on dsh's tool surface.
- Default behavior: the new preset appears only in the roster; it does not enter the default preset, the deployment persona, or any automatic-selection path, and it takes effect only when a user mounts it explicitly.

## Anti-drift assertions

The Taiyi verse is an adversarial prompt against the training corpus; its drift direction is being "engineered back" (the pathology in the fourth-version revision notes: the criterion/counterexample grid and Chinese-English mixing). The assertions are pinned by verse-level invariant tests, and every change to the verse must update the assertions in the same change:

- contains the five seed sentences verbatim (「天得一以清，地得一以宁。你得一是以为君子。君子者，譬如行远必自迩，登高必自卑。万物负阴而抱阳，冲气以为和。」).
- does not contain the "criterion:"/"counterexample:" engineering grid (the same assertion as the upstream's guard test).
- does not contain a mixed Chinese-English terminology list (the upstream v3's mixed spellings like `green test`/`red test`; the list is finalized during implementation and goes into the assertion file).
- single-track verse text: only one persona text exists in the repo, with no parallel long and short copies.
- must not contain an engineering-concept word list: at implementation time, finalize a forbidden-word list (direct engineering terms such as API/token/tool) — this is the experiment's design constraint itself, and the list is maintained in the same file as the assertions.

## Verification method (A/B)

- Control group: the existing default persona (the deployment persona or the standard/minimal preset).
- Experiment group: the taiyi persona.
- Task set: reuse dsh's existing real runnable examples (testing policy requires key behavior to be carried by a runnable example), choose a set of tasks covering multi-module read/write, testing, and delivery closure, and use the same task set for both groups.
- Criteria: pass rate, transcript artifact quality, and delivery-closure completeness (against the upstream's "yin-yang" passage lesson: walking away once it is green does not count as complete; closing the yin side does).
- Outputs: two transcript snapshots + one brief comparison-conclusion record (a document, merged under the bilingual-pair contract).
- Record faithfully: Taiyi's conclusion was measured on specific models and versions; when the dsh-side reproduction diverges from upstream, do not presuppose a conclusion; the measured result governs.

## Landing steps and acceptance

1. Land the preset skeleton + the full verse. Acceptance: mount the taiyi preset and run a runnable example once; the transcript snapshot contains the full verse.
2. Land the verse-level invariant tests. Acceptance: prove each assertion's rejection path once (per the repo convention, every new acceptance path must reject an invalid case).
3. Run the A/B and record the conclusion. Acceptance: the comparison record document + both snapshot sets are in place.
4. Close out and gate. Acceptance: taiyi enters no default path; new documents merge under the bilingual-pair contract and pass the pairing gate; the git working tree adds only the files listed in this plan; nothing is pushed.

## Risks and gating

- Verse drift: pinned by the anti-drift assertions; any change that "engineers the verse back" must pass the assertions first.
- Model dependence: an adversarial prompt's effect depends on the model and version; the dsh-side conclusion is governed by the reproduced measurement, and the upstream conclusion is not cited as a default fact.
- Default-ification risk: taiyi is an experimental asset, and opt-in is a hard constraint; making it a default in the future requires a separate decision through the Agent Note process, and is out of scope for this plan.
- Snapshot maintenance: every change to the verse updates the transcript snapshot and the assertions in the same change, so the verse and the evidence never decouple.
