# @deepseek-ai/dsh-evidence-gate

English | [中文](README.zh.md)

The evidence gate — RED→GREEN discipline for bugfix tasks (a port of Tianshu's minimal evidence-gate core, incrementally trimmed).

## Mechanics

- **Evidence gate (L1 edit gate)**: while a high bugfix obligation still has no RED reproduction, the first edit to a target source file is blocked (returning the shortest action + a **precise probe suggestion**: a concrete test file path and expected outcome); writing tests/scratch probes is exempt; one obligation blocks only once (once latch — a resend passes).
- **The three RED rules**: a failed test + target association → records `red:` evidence; passed needs a prior RED to count as satisfied (pass-without-red is not evidence); blocked verification ≠ proven.
- **TDD gate**: ≥3 consecutive edits without verification → suggest (default) or block (`{ tddMode: 'enforce' }`).
- **L2 final gate**: task wrap-up — the first unresolved high → `continue_once` + a probe suggestion; after `markContinued` → `honest_blocked` + disclosure of the unresolved list.
- **Verification accounting**: automatically detects test commands and results from `session/event` tool/call→tool/result pairs (zero test-framework coupling; command-text heuristics).
- **Native edit-tool adaptation**: `str_replace_editor` (dsh-native, `@deepseek-ai/dsh-tool-str-replace-editor`) — the write operations `create/str_replace/insert` are intercepted while the `view` read operation passes; Tianshu-style tools (edit_file/write_file/hash_edit/apply_patch) are also supported.

## Assembly

```ts
declare const ctx: any
export {}
// cordis.yml 或宿主装配（需 tools 服务与编辑工具；fs 由 base 提供）
plugins: ['@deepseek-ai/dsh-evidence-gate']

// 任务边界（宿主在任务开始处调用）
ctx.evidence.createObligation({
  family: 'bugfix',
  risk: 'high',
  claim: '修复 X 崩溃',
  targets: ['src/foo.ts'],
})
// 新任务开始时作废未决义务
ctx.evidence.supersedeAll()
// final 判定：continue_once（带探针建议）→ 续轮开始时 markContinued
const final = ctx.evidence.evaluateFinal()
if (final.verdict === 'continue_once' && final.nextAction) {
  // 注入续轮动作后：
  ctx.evidence.markContinued(final.nextAction.obligationId)
}
```

Real assembly example: `examples/headless-agent` (fixtures/cli.cordis.yml + driver task-boundary wiring + evidence-gate.e2e.ts end to end).

## Service surface

`ctx.evidence` (EvidenceService):

| Method | Semantics |
|---|---|
| `createObligation(input)` | Creates an obligation (idempotent upsert) |
| `supersedeAll()` | Task boundary: supersedes unresolved obligations |
| `unresolvedHigh()` | Unresolved high-risk obligations (display/escalation) |
| `evaluateFinal()` | Final verdict (continue_once with a probe / honest_blocked with disclosure) |
| `markContinued(id)` | Registers the final continuation turn (once latch) |

## Configuration

```ts
declare const ctx: any
declare const apply: (ctx: any, config: Record<string, unknown>) => void
export {}
apply(ctx, {
  enabled: true,        // 编辑门开关（默认 true）
  tddMode: 'suggest',   // 'suggest'（默认）| 'enforce'
  tddThreshold: 3,      // TDD 门编辑阈值
})
```

## Modules

- `obligation.ts` — pure state machine (the three RED rules, upsert, supersede, target association)
- `tracker.ts` — stateful wrapper (L1 edit gate, once latch, edit/verification counting, probe suggestions, final once latch)
- `verification.ts` — verification detection (command-text heuristics)
- `tdd-gate.ts` — TDD-gate pure functions
- `probe-candidates.ts` — probe candidate generation (RED-first, budget/cooldown)
- `probe-suggest.ts` — precise probe suggestions (verified-command downgrade, test-path generation)
- `index.ts` — Cordis plugin wiring (dual-path guard registration + session/event accounting + service surface)
- `invariant.ts` — runtime-invariant companion (empty install; obligations are in-memory)

## Verification

```sh
pnpm vitest run packages/guard/evidence-gate/tests/                     # 包级 77 测试
npx vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/evidence-gate.e2e.ts  # 真实装配 4 测试
```

## Model Experience

### Edit-gate rejection (conditional)

#### What the model sees

While every gate passes the guard adds nothing. When an edit tool call is blocked, the call does not execute and the model receives the rejection reason as that call's tool result: the RED-gate message is data-dependent (`tracker.buildRedGateMessage` names the blocked file, the open high-risk bugfix obligation, and a concrete probe suggestion), while enforce-mode TDD blocking returns the stable literal below.

##### TDD enforce-mode rejection

```markdown
Edit blocked by TDD gate: 连续编辑无验证（≥threshold 次）——先写一个失败的测试（RED）再改源码：run_tests 或测试命令应先失败（=RED），再实现通过（=GREEN）。
```

#### Token effect

Zero tokens while the gate passes. Each rejection adds one bounded tool-result message (reason text only); the once-latch releases the same obligation after a single block, so repeated rejections for one obligation do not accumulate.

#### KV Cache effect

Append-only; a rejection arrives as an ordinary tool result after the reusable request prefix and does not invalidate existing entries.

## Known Limitations and Deferred Work

- **Verification detection is command-text heuristics** — `detectVerification` recognizes test runs by command/output text patterns; a custom test entry point (a script name matching no pattern) is never accounted as evidence, and its obligation stays open.
- **The edit-tool allowlist is a closed set** — only `str_replace_editor`/`edit_file`/`write_file`/`hash_edit`/`apply_patch` are intercepted; files written directly through bash bypass the edit gate (the same blind spot as the dsh-fs-snapshot snapshot layer).
- **Obligations are in-memory** — a process restart clears obligations and evidence; persisted accounting (rebuilding by replaying session events) is deferred work.
- **The final gate depends on host wiring** — the host must call `evaluateFinal`/`markContinued` at task boundaries; without that wiring the L2 verdict never takes effect (the L1 edit gate still works).
