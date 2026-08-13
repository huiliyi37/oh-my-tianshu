# Agent Note: Approval diff preview (C2 item 1) — an inline diff builds the trust blind approval breaks

Status: implemented

English | [中文](2026-08-11-tui-approval-diff-preview.zh.md)

## Problem

The DSH TUI approval prompt is a bare 「⚠ 允许执行 X？[y/N]」 (allow running X?), so a user approves an edit without seeing what it changes — a trust breakpoint. grok-build's approval modal shows no diff either, because it renders the diff only after execution; DSH's single-agent scenario has no "look after execution" slack, since a wrong approval has already executed by then.

## Decision

Going against grok's way, the approval prompt renders an inline diff above the y/N line.

1. **Diff generation**: `createTwoFilesPatch` from the `diff` npm package produces the unified diff directly, and the existing `formatDiff` (src/format/diff.ts, a Tianshu port) renders its coloring, gutter, and truncation.
2. **Data path**: the `approval/request` event carries `callId` (user-approval `ApprovalRequest.callId`, src/index.ts L167 — always present at runtime; the TUI-local type `PendingApprovalRequest` now declares it) → transcript `view.tools.findLast(t => t.callId)` → `tool.arguments` (the raw argument JSON) → `formatPermissionDiff`.
3. **Argument shapes**: `str_replace_editor`'s `str_replace` uses `old_str`/`new_str` (verified against tool-str-replace-editor/src/index.ts L444-446); `create` uses `file_text` and yields a first-4-lines preview, because a new file has no old side; `edit_file` (old_string/new_string) and `write_file` are supported for compatibility. view/insert, non-edit tools, and argument-parse failure yield null, so nothing renders.
4. **A hard 12-line cap**: keys are locked during approval (only y/N/Esc/Ctrl+C), so the diff must be fully visible without paging — `formatDiff({ maxLines: 12 })`.
5. **SOURCE-MAP scope**: permission-diff.ts is an original module whose file header declares the grok reference and the formatDiff reuse, not a Tianshu port, so it sits outside the SOURCE-MAP mapping scope and SOURCE-MAP carries no entry for it.

## Verification facts

- `tests/permission-diff.spec.ts` 7 cases (str_replace diff contains @@/-/+, identical strings → null, create first-4-lines preview, view/insert null, non-edit tool null, JSON parse failure null, a large diff truncated to ≤15 lines) RED→GREEN, 7/7.
- `tests/app.spec.ts` gains an integration case (inject a tool/call event before attach → transcript replay fold → the handler carries callId → the render contains -old/+new and the y/N prompt); the approval describe is 4/4, app.spec.ts overall 69/69.
- Types: a scratch project checking just the 4 files reports 0 errors (the renderBatcher TS2564 that tsc reports is a parallel session's uncommitted change; HEAD has no such field; not introduced by this task).
- Dependency: `pnpm --filter @deepseek-ai/dsh-tui add diff` (v9.0.0; `diff` ships its own libesm/index.d.ts types, no @types/diff).

## Files

- `packages/tui/tui/src/format/permission-diff.ts` (new, original): formatPermissionDiff
- `packages/tui/tui/src/ui/app.ts`: PendingApprovalRequest.callId + rendering the diff block + imports (formatPermissionDiff, CallId from dsh-llm)
- `packages/tui/tui/tests/permission-diff.spec.ts` (new)
- `packages/tui/tui/tests/app.spec.ts`: the approval-diff integration case
- `packages/tui/tui/package.json`: +diff@^9.0.0
- `docs/dsh-tui-与grok的功能对比-c2.md`: item 1 marked ✅

## Alternatives considered

**grok's stance — no diff in the approval modal** — rejected. grok renders the diff after execution, which is enough when the run can be reviewed afterwards; in DSH's single-agent flow the wrong approval has already executed by the time that diff appears, so the diff has to sit above the y/N line instead.

**Hand-written `diffLines` coloring** — rejected. The C2 draft proposed colouring `diffLines` output by hand; `createTwoFilesPatch` plus the existing `formatDiff`, which already owns coloring, gutters, and truncation, covers it through horizontal reuse, so no second diff renderer exists.

**A pageable diff instead of a hard cap** — rejected. Keys are locked during approval, so a diff that needed paging would be unreachable; a 12-line cap keeps the whole preview on screen.

## Consequences

- Approving an edit now shows the concrete old/new lines first, and the price is the 12-line window: a change larger than it is cut off by formatDiff's truncation marker, so the reviewer sees the head of the change rather than all of it.
- Only edit-shaped arguments produce a preview (`str_replace_editor` str_replace/create, `edit_file`, `write_file`); view/insert, non-edit tools, and arguments that fail to parse keep the bare prompt.
- `callId` is optional on user-approval's request and whether every interception path (fs-policy and the like) carries it has not been verified one by one; when it is absent the prompt degrades to no diff without breaking the approval flow.
- One runtime dependency enters the TUI package, `diff@^9.0.0`, which is the price of not hand-rolling an LCS diff.
- Evidence stops at the package tests: the inline diff on one real edit approval in the assembled `dsh --profile tui` is unverified.
