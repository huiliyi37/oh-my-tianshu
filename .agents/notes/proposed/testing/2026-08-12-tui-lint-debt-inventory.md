# Agent Note: TUI line type-aware lint debt inventory

Status: proposed

English | [中文](2026-08-12-tui-lint-debt-inventory.zh.md)

## Problem

`pnpm run lint` is red on the working tree with 183 type-aware oxlint errors, all of them from the TUI port line. The debt was invisible until now for a mechanical reason: `lint` is `build:lib:host && lint:contracts-ready`, and the host face failed to compile (`TranscriptView.firstInTurnTime` missing from a `render.spec.ts` fixture), so oxlint never ran. With that compile error fixed the whole backlog surfaced at once. An oxlint `--fix` pass over the repository already cleared 86 further violations mechanically; what remains needs judgment per call site and is the subject of this note.

The debt is concentrated: 74 violations sit in `packages/tui/tui/src`, 109 in `packages/tui/tui/tests`, and exactly one is outside the TUI package (`packages/subagent/subagent/tests/invariant.spec.ts`). Nothing here is a known runtime defect — these are type-safety and contract rules the ported code never had to satisfy upstream, where the lint configuration is different.

## Proposal

Work the backlog by rule family rather than by file, because each family has one adjudication question and mixing them invites inconsistent fixes. In descending count:

**`unbound-method` (42).** Method references passed without binding. In `src/commands/registry.ts` (15) the fix is a design question — the command table stores method references, so it either binds at registration or switches to arrow wrappers. In the specs (27) it is almost always `expect(obj.method)` against a mock, where the rule is noise and the assertion should target the mock handle directly.

**`no-unnecessary-condition` (22).** Guards the types say cannot fire. Each one is a genuine fork: either the type is honest and the guard is dead code (delete it), or the value really can be absent at that boundary and the type is lying (fix the type). `src/mention-parser.ts` (4) and `src/ui/app.ts` (4) are the two clusters worth deciding first.

**`no-floating-promises` (20).** 18 of these are in `tests/commands.spec.ts` alone, one call pattern repeated; a single decision fixes the file. The remaining two (`src/block-stream-writer.ts`, `tests/app.spec.ts`) need per-site review because a dropped rejection in the writer is a real hazard.

**`no-unsafe-*` (27 across member-access/assignment/return/call).** `any` leaking through mock contexts and through `src/adapter/sessions.ts` (10). The adapter cluster is the only one touching product code and should be typed properly; the spec clusters can take a narrow declared shape at the mock boundary.

**`no-unnecessary-type-conversion` (16), `restrict-plus-operands` (11), `no-base-to-string` (5), `no-redundant-type-constituents` (5).** Mechanical. The `restrict-plus-operands` sites in `src/pi/latex-block.ts` and `src/pi/latex-to-unicode.ts` (8 combined) all stem from indexing into a table that returns `string | undefined`; one shared narrowing helper likely retires all eight.

**Remainder (`no-misused-promises` 10, `await-thenable` 3, `require-await` 2, `no-confusing-void-expression` 2, `no-non-null-assertion` 1).** Small enough to sweep last, in one pass.

Reproduce the current inventory with:

```sh
pnpm exec tsx scripts/run-oxlint.ts packages/tui packages/subagent
```

### Inventory by file and rule

| File | Rule | Count |
| --- | --- | --- |
| packages/subagent/subagent/tests/invariant.spec.ts | unbound-method | 1 |
| packages/tui/tui/src/adapter/sessions.ts | no-unsafe-assignment | 4 |
| packages/tui/tui/src/adapter/sessions.ts | no-unsafe-call | 2 |
| packages/tui/tui/src/adapter/sessions.ts | no-unsafe-member-access | 3 |
| packages/tui/tui/src/adapter/sessions.ts | no-unsafe-return | 1 |
| packages/tui/tui/src/block-stream-writer.ts | no-floating-promises | 1 |
| packages/tui/tui/src/commands/registry.ts | require-await | 2 |
| packages/tui/tui/src/commands/registry.ts | unbound-method | 15 |
| packages/tui/tui/src/engine/ansi.ts | no-unnecessary-type-conversion | 1 |
| packages/tui/tui/src/engine/input-handler.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/engine/input-line.ts | no-unnecessary-condition | 2 |
| packages/tui/tui/src/engine/metrics-glance-controller.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/engine/overlay-engine.ts | no-redundant-type-constituents | 5 |
| packages/tui/tui/src/engine/overlay-engine.ts | restrict-plus-operands | 2 |
| packages/tui/tui/src/engine/resize-handler.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/engine/write-batcher.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/format/fluency-policy.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/format/markdown.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/format/markdown.ts | restrict-plus-operands | 1 |
| packages/tui/tui/src/format/permission-diff.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/format/rewind-overlay.ts | no-non-null-assertion | 1 |
| packages/tui/tui/src/format/tool-meta.ts | no-base-to-string | 5 |
| packages/tui/tui/src/gutter.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/mention-parser.ts | no-unnecessary-condition | 4 |
| packages/tui/tui/src/pi/latex-block.ts | restrict-plus-operands | 4 |
| packages/tui/tui/src/pi/latex-to-unicode.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/pi/latex-to-unicode.ts | restrict-plus-operands | 4 |
| packages/tui/tui/src/ring-buffer.ts | no-unsafe-assignment | 1 |
| packages/tui/tui/src/term-caps.ts | no-unnecessary-condition | 1 |
| packages/tui/tui/src/ui/app.ts | no-unnecessary-condition | 4 |
| packages/tui/tui/src/ui/render.ts | no-unnecessary-condition | 2 |
| packages/tui/tui/tests/ansi.spec.ts | no-unnecessary-type-conversion | 1 |
| packages/tui/tui/tests/app.spec.ts | no-floating-promises | 1 |
| packages/tui/tui/tests/app.spec.ts | no-misused-promises | 10 |
| packages/tui/tui/tests/app.spec.ts | no-unnecessary-type-conversion | 14 |
| packages/tui/tui/tests/app.spec.ts | no-unsafe-assignment | 5 |
| packages/tui/tui/tests/app.spec.ts | no-unsafe-call | 1 |
| packages/tui/tui/tests/app.spec.ts | no-unsafe-member-access | 9 |
| packages/tui/tui/tests/app.spec.ts | no-unsafe-return | 3 |
| packages/tui/tui/tests/app.spec.ts | unbound-method | 9 |
| packages/tui/tui/tests/batcher-wiring.spec.ts | no-unsafe-return | 1 |
| packages/tui/tui/tests/btw-controller.spec.ts | no-unsafe-assignment | 2 |
| packages/tui/tui/tests/btw-controller.spec.ts | no-unsafe-member-access | 4 |
| packages/tui/tui/tests/btw-controller.spec.ts | unbound-method | 5 |
| packages/tui/tui/tests/commands.spec.ts | no-floating-promises | 18 |
| packages/tui/tui/tests/loader-composition.spec.ts | unbound-method | 1 |
| packages/tui/tui/tests/memory-overlay.spec.ts | await-thenable | 1 |
| packages/tui/tui/tests/mode-cycle.spec.ts | no-unsafe-assignment | 5 |
| packages/tui/tui/tests/mode-cycle.spec.ts | no-unsafe-member-access | 1 |
| packages/tui/tui/tests/overlay-controller.spec.ts | unbound-method | 8 |
| packages/tui/tui/tests/runner.spec.ts | await-thenable | 2 |
| packages/tui/tui/tests/runner.spec.ts | no-confusing-void-expression | 2 |
| packages/tui/tui/tests/runner.spec.ts | unbound-method | 1 |
| packages/tui/tui/tests/session-manager.spec.ts | no-unsafe-return | 1 |
| packages/tui/tui/tests/statusline.spec.ts | unbound-method | 2 |

## Alternatives considered

**Disable the offending rules for `packages/tui/**` in `.oxlintrc.json`.** Rejected: the repository standard is narrow justified exceptions, never a rule switched off across a package. The `no-unnecessary-condition` and `no-unsafe-*` clusters are exactly where the port's type contracts are weakest, so silencing them would freeze the weakness permanently.

**Fix everything in one sweep now, before landing the current convergence work.** Rejected: 183 sites spanning six adjudication questions is not one reviewable change, and half of them touch `app.ts` and `app.spec.ts`, which the C4 split is actively rewriting. Sequencing the sweep after the split avoids resolving the same call sites twice.

**Record the debt as a ratcheting baseline manifest (per-file counts that may only shrink), the way `scripts/source-budgets.manifest.json` caps line counts.** Rejected for now: a ratchet is the right shape once the count is small and stable, but at 183 across in-flight files it would mostly generate manifest churn on every C4 commit. Revisit once the sweep lands.

## Acceptance criteria

`pnpm run lint` exits zero on a clean tree, with no new entries in `.oxlintrc.json` disabling a rule at package scope, and `pnpm exec vitest run packages/tui/tui/tests/` still green.

## Risks

The `no-unnecessary-condition` and `no-unsafe-*` families are the ones where a mechanical fix can silently change behavior: deleting a guard the type calls impossible is correct only if the type is honest at that boundary, and the TUI reads terminal capabilities, environment variables, and model-supplied tool JSON — all boundaries where the repository explicitly does not trust the static type. Each deletion in those two families needs the boundary checked, not just the rule satisfied.
