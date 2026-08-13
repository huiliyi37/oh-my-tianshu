---
name: dsh-doc-standards
description: 'Use when writing, moving, reviewing, or auditing documentation in the deepseek-harness repo — choosing hierarchy and detail, separating tutorials from references, checking tutorial progression, trimming doc slop, responding to a verify-doc-budgets failure, or requests like "improve the docs", "audit the docs", "where should this be documented", or "this doc is too long".'
---

# Applying the DeepSeek Harness Documentation Standard

The contract lives in [docs/AGENTS.md](../../../docs/AGENTS.md). This workflow covers placement, corpus audits, budgets, and validation across Markdown, JSDoc, and code comments. It is guidance, not a script; use [dsh-prose-standard](../dsh-prose-standard/SKILL.md) for required coverage and editorial judgment, and never treat length alone as a defect.

## Sources of truth (read, don't re-summarize)

- [docs/AGENTS.md](../../../docs/AGENTS.md) — hierarchy, tutorial/reference forms, taxonomy, budgets, and slop checklist.
- [.agents/notes/README.md](../../notes/README.md) — when a decision earns an Agent Note, how to file it, and what goes inside one (the header block, per-lifecycle skeleton, and Alternatives-considered mandate, gated by `verify-agent-note-format`); [docs/postmortem/README.md](../../../docs/postmortem/README.md) — when an incident earns a postmortem.
- [docs/i18n/README.md](../../../docs/i18n/README.md) — the bilingual pairing contract; editing either side of a pair obligates the counterpart in the same change.
- Root [AGENTS.md](../../../AGENTS.md) — the standing orders whose budget discipline this skill protects.
- [Archived Agent Notes](../../notes/archived/AGENTS.md) — frozen historical snapshots excluded from editorial maintenance and evolving documentation gates.

## Review structure before prose

Apply the standard's authoring order to every human-facing document in scope. Do not apply this structural pass to Agent Notes. Classify a postmortem as a reference scoped to one incident; preserve the chronological evidence required by its contract without treating chronology as a teaching sequence.

1. Locate the document in the repository and navigation trees. State its own subject and identify its direct children.
2. Set the detail boundary. Keep full detail about the document's subject, summarize direct children by purpose, responsibility, and high-level behavior, and move deeper explanations to their owning descendants with links. Treat test infrastructure as descendant-owned unless it is the document's subject.
3. Classify the document from its intended use, not its path or title. A tutorial must lead through ordered work to an observable outcome; a reference must support lookup within an explicit scope without requiring sequential reading.
4. For a tutorial, privately classify the starting reader and concepts as beginner, intermediate, or advanced. Trace each concept to its prerequisites, reorder premature material, and move optional advanced detail to a later tutorial or reference.
5. Split substantial mixed forms. Keep a small secondary form only behind a clear structural boundary.

Then check constraints that make placement expensive or wrong:

- Paired docs (`pnpm run verify-translation-pairing --list`) cost a zh counterpart update and a `--write` re-record on every edit — prefer an unpaired home for content that will churn.
- Generated catalogs are never hand-edited; if the fact belongs there, change the generator's source.
- Before renaming or moving any doc, grep for inbound references: `verify-md-links` catches Markdown link targets AND `#fragment` anchors onto Markdown files (heading slugs and explicit `<a id>`), and `verify-doc-refs` catches `docs/*.md` citations in TypeScript comments; anchors cited from TypeScript strings still need a manual grep when their output never reaches gate-scanned Markdown (today's three — `scripts/gen-doc-graphs.ts`, `scripts/gen-persistence-catalog.ts`, `packages/typert/generator/src/cordis-catalog.ts` — all render into scanned pages, so the gate catches them via the committed output).
- A move is atomic: remove from the old home, add to the new home, and fix every inbound link in the same change.

## Audit the corpus

After the structural pass, hunt the standard's slop checklist with the cheapest probes first. Verify and fetch the PR's live base, then run `pnpm --silent run change-scope --base <verified-base-ref>` to identify committed and dirty paths before applying semantic judgment. After a retarget or base merge, rerun the report and audit prose introduced by the new base.

1. Measure: `pnpm run verify-doc-budgets --list`, then `git ls-files '*.md' ':(exclude)vendor/**' | xargs wc -w | sort -rn | head -30` to spot unbudgeted outliers.
2. Hunt narrated history: `rg -n "no longer|used to|previously|was moved|renamed" --glob '*.md' --glob '*.ts' --glob '!vendor/**'` and keep only contrasts against a live alternative. Keep the vendor exclusion last so include globs cannot override it.
3. Inspect long comments for reasoning transcripts: control-flow narration, test walkthroughs, proof of obvious branches, review findings, rejected local alternatives, and the same rationale repeated beside sibling methods. Preserve only a non-obvious contract or durable rationale; otherwise delete the comment.
4. Hunt duplication by grepping distinctive phrases. Keep one home and replace other copies with links.
5. Replace hand-written catalogs, test/status inventories, and JSDoc restatements with the authoritative tree, script, or generated reference.
6. In `implemented/` Agent Notes, remove migration plans, acceptance-task checklists, and future-tense spec language. Keep concise verification contracts that identify the behaviors and tiers pinning the shipped decision, plus named coverage gaps.
7. If removing prose changes a promised behavior rather than its explanation, use a proposed Agent Note first (follow [dsh-find-simplifications](../dsh-find-simplifications/SKILL.md)).

Exclude `.agents/notes/archived/` from corpus audits and edits. Active prose may repair, redirect, or delete an inbound link, but never follow an archive-wide cleanup into the frozen target.

Keep every load-bearing rule, preferably as one to three lines plus a link to its rationale. Cut stories, duplicates, status notes, and the path used to derive the rule. Do not create a new explanation merely to relocate disposable reasoning.

## When verify-doc-budgets goes red

Apply the ordered relocate-condense-raise policy in [docs/AGENTS.md](../../../docs/AGENTS.md); this skill only supplies the workflow probes above.

## Validation and PR hygiene

Run at least `pnpm run doc-sync`, `pnpm run lint`, and `git diff --check`; JSDoc changes may regenerate catalogs. If a paired doc changed, follow [dsh-translate-docs](../dsh-translate-docs/SKILL.md) and run `pnpm run verify-translation-pairing --write <pair>`. The PR body should give word deltas, explain any deliberately long exception, and list checks.
