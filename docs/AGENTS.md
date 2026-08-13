# AGENTS.md — The documentation standard

This file defines document structure, Markdown tiers, writing rules, and `verify-doc-budgets` ceilings. Use [dsh-doc-standards](../.agents/skills/dsh-doc-standards/SKILL.md) for placement and validation, and [dsh-prose-standard](../.agents/skills/dsh-prose-standard/SKILL.md) for required coverage and editorial judgment; the [doc-tiers Agent Note](../.agents/notes/implemented/process/2026-07-04-doc-tiers-and-budgets.md) owns rationale.

## Document structure

These rules apply to human-facing documentation; [Agent Notes](../.agents/notes/README.md) remain outside their scope. A [postmortem](postmortem/README.md) is an incident-scoped reference; chronology records evidence, not a teaching sequence. A document's subject and tree position fix its scope: describe its own subject at appropriate detail, describe direct children only by purpose, responsibility, and high-level behavior, and link to the owning descendant for lower-level detail. Document type does not widen that scope. A reference may be exhaustive only about its own subject. Testing mechanisms, fixtures, and harnesses belong at the lowest owning level; higher documents link there.

Classify every in-scope document as a tutorial or reference. A tutorial follows an ordered path to an outcome and introduces only what each step needs. A reference defines a lookup scope and describes current behavior without depending on a teaching sequence. Separate substantial tutorial and reference content; use a clear structural boundary when either part is small.

Before writing a tutorial, privately classify the reader's starting knowledge and each concept as beginner, intermediate, or advanced. Establish prerequisites before dependent concepts, increase difficulty gradually, and move unnecessary advanced material to a later tutorial or reference.

Author in this order: locate the document in the tree; set its permitted detail; choose tutorial or reference; for a tutorial, order concepts by prerequisite and difficulty; relocate descendant-owned detail; replace lower-level explanations with links to their owners.

## The tier taxonomy: one home per fact

Each fact has one home: the tier whose job it is. Elsewhere, link to that home.

| Tier | Job | Does NOT belong there |
|---|---|---|
| Root `AGENTS.md` | Standing orders: rules an agent needs in context in every session, one to three lines each, linking its home | Stories, worked examples, situational procedures, anything restated from a linked home |
| Subtree `AGENTS.md` (`packages/`, `examples/`, `docs/`, `.agents/notes/`) | Orders specific to that subtree | Repo-wide rules the root file already carries |
| [architecture.md](architecture.md) | System map: services, loop, capability seams, extension points — read before changing `packages/` | Type shapes (→ subsystems), per-package detail (→ package READMEs), decision rationale (→ Agent Notes), implementation-status annotations |
| [subsystems/](subsystems/README.md) | One reference page per subsystem: type shapes, semantics, and the generated Cordis surface | Behavior narration (→ architecture.md) |
| [Agent Notes](../.agents/notes/README.md) | Active decision records: the why, what-was-given-up, and verification contract; `implemented/` notes describe shipped reality in present tense | Migration plans, acceptance-task checklists, fixture walkthroughs, and spec-speak ("should…") once the decision has shipped; archived notes are frozen history, never current authority |
| [postmortem/](postmortem/README.md) | Incident stories — the only tier where war-story narrative belongs | — |
| [cookbook/](cookbook/adding-a-package.md) | Step-by-step how-tos with numbered verify steps | Design rationale (→ the Agent Note each guide links) |
| [user/](user/index.md) | Product-facing guides published by the documentation website | Generated reference tables, contributor procedures, decision history |
| Package README | The per-package contract: config, semantics, limitations, extension points, and [Model Experience](cookbook/adding-a-package.md#4-write-the-package-readme) | JSDoc restatement, generated-catalog restatement (event/tool tables), other packages' concerns |
| [development.md](development.md) | First-stop contributor onboarding: local setup, daily workflow, and CI shape at summary level; a bilingual pair under the [i18n contract](i18n/README.md) | Runtime/version rationale (→ Agent Notes), gate-by-gate enumerations that drift from `package.json` scripts |
| Generated reference: the per-page `cordis-surface` regions in [subsystems/](subsystems/README.md), the [Cordis core API + inherited tier](cordis-api/context.md), [tool-catalog](tool-catalog.md), [config-catalog](config-catalog.md), [persistence-catalog](persistence-catalog.md), [module-graph.md](module-graph.md) | Exhaustive English sources regenerated from source and freshness-gated; reviewed Chinese counterparts follow the [pairing workflow](i18n/README.md#scope-and-exclusions) | Hand edits to generated English sources or regions; Chinese counterparts update through pairing only |
| Skills (`.agents/skills/`) | Reusable workflows and specialized decision standards | Product and runtime contracts (→ docs or source) |

Placement: bugs → postmortems; rationale → Agent Notes; procedures → cookbooks; type shapes → subsystems; package contracts → READMEs; standing orders → root `AGENTS.md` with a rationale link.

## Writing rules

- **Document current state, not change history.** Avoid "previously/now/no longer", PRs, commits, and stack positions in durable prose; name the live mechanism. Put change stories in commits, PRs, Agent Notes, or postmortems.
- **Every non-trivial change includes at least one Agent Note in the same PR.** Update the owning note or add one; only mechanical/local edits are exempt ([scope](../.agents/notes/README.md#when-to-write-one)).
- **One physical line per paragraph** (`verify-md-wrap`): use editor soft-wrap. Code blocks, tables, and list structure keep their formatting; code comments stay under the linter's column limit.
- **Fenced `ts` blocks must compile** (`doc-typecheck`); a pasted type declaration and its original JSDoc use ` ```ts type-equiv `, while a body-stripped public class declaration uses ` ```ts public-api `; register either in the manifest so neither can drift ([mechanics](development.md#documenting-types-verbatim-ts-type-equiv)).
- **The owning [subsystems page](subsystems/README.md) updates in the same change** that reshapes a documented type. `verify-type-equiv` catches drifted pastes, not never-documented new types; a type is documented on its declaring package group's page ([page scoping](../.agents/notes/implemented/process/2026-08-03-package-anchored-subsystem-pages.md)).
- **Bilingual pairs update together**: editing either side obligates the counterpart and a re-record in the same change ([i18n contract](i18n/README.md)).
- **Comments and JSDoc state complete contracts, not reasoning transcripts.** Preserve behavior, timing, modality, exceptions, consequences, and non-obvious orientation; delete narration, test walkthroughs, review analysis, and code restatement. Keep the local contract and link its rationale. Use [dsh-prose-standard](../.agents/skills/dsh-prose-standard/SKILL.md) for details.
- Write directly: name actors and facts plainly ([decision](../.agents/notes/implemented/process/2026-08-09-concrete-prose-names-actors-and-recorded-facts.md)). Reserve `seam` for the defined capability; avoid metaphorical "gate", "vocabulary", and "surface".

## Wordcount Budgets

[scripts/doc-budgets.manifest.json](../scripts/doc-budgets.manifest.json) sets standing-doc ceilings; `pnpm run verify-doc-budgets` rejects excess or missing files.

When the gate goes red:

1. **Relocate** content that belongs in another tier; leave a one-line link if needed.
2. **Condense** content that belongs here but can be shorter.
3. **Raise** the ceiling only when the words truly need the space; justify the manifest diff in the PR. A too-low ceiling is a budget bug.

Ceilings are guardrails, not reduction targets. At or below target, retain at least 5% headroom; above target, freeze the ceiling until relocation or condensation brings the document under target. Lower a ceiling only when the contract still has room, and raise it when content would otherwise be deleted. Targets: root `AGENTS.md` ≤ 1,600 words; `architecture.md` ≤ 1,800; subtree `AGENTS.md` ≤ 600, except `packages/AGENTS.md` ≤ 650 and this file ≤ 1,250; `packages/README.md` ≤ 600. Review governs unbudgeted tiers.

## The slop checklist

Hunt these in any doc; the [dsh-doc-standards](../.agents/skills/dsh-doc-standards/SKILL.md) skill runs this list as an audit:

- The same rule stated in more than one home. Grep a distinctive phrase; keep one home, convert the rest to links.
- Narrated history or war stories: "previously", "now", "no longer", "used to", "renamed", "was moved", PRs, or commits. State the current fact; link an Agent Note or postmortem when needed.
- Implementation-status annotations in prose or diagrams ("implemented!", "future: …"). Status rots; the repo layout and package manifests carry it.
- Hand-restated catalogs, JSDoc, or inventories of tests, packages, and status when source or a generator is authoritative.
- Reasoning transcripts: step-by-step implementation narration, proof of obvious branches, test walkthroughs, or rejected local alternatives. Keep the resulting contract or durable rationale; delete the path used to derive it.
- Rationale repeated beside sibling methods instead of once at the owning capability or helper.
- Paragraph walls: one paragraph carrying several rules and parenthetical asides. Split it, or demote the detail to the linked home.
- Emphasis inflation: bold, CAPS, or "critically" everywhere means nothing stands out. Reserve emphasis for the clause that changes behavior.
- Spec-speak in `implemented/` Agent Notes: "should", migration plans, acceptance checklists. An implemented Agent Note describes what is, per the [implemented-note instructions](../.agents/notes/implemented/AGENTS.md).

## Cross-reference with machine-checkable links, never free prose

Link repository references with relative Markdown paths, never bare filenames or Agent Note numbers. `verify-md-links` rejects missing targets and dead `#fragment` anchors ([rationale](../.agents/notes/implemented/process/2026-06-18-markdown-cross-link-lint.md)).
