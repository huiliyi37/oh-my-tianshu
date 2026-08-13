# Agent Note: dsh evidence-gate minimal kernel port (S1–S6 overview)

Status: implemented

English | [中文](2026-08-11-evidence-gate-port.zh.md)

## Problem

dsh has no mechanism that makes an agent earn its edits: nothing records what a change claims, nothing accounts a test run against that claim, and nothing blocks an edit whose claim carries no evidence. The port source is the Tianshu (opencode-tui) evidence-gate system, which is the possibly-redundant full version of exactly that mechanism, and dsh has neither Tianshu's turn-step-producer task boundary nor its worker structures to hang it on. The design constraint is incremental minimalism: take only the leanest capability and strengthen it while experimenting.

## Decision

### S1 evidence-gate kernel
- **New package** `packages/guard/evidence-gate/` (guard group, same group as tdd-gate/probe candidates) — an independent boundary that does not pollute core.
- **The edit gate goes through `tools.guard()`** (monotonic; rejects by returning a reason) rather than the `tools/pre-execute` waterfall — nobody can overturn a guard (pre-execute can be overridden by other listeners), and it carries the execution arguments.
- **Verification accounting rides the `session/event` tool/call→tool/result pairing** (an in-memory callId→bash command map + output-text heuristics) — zero new event types, zero test-framework coupling (the command text recognizes vitest/pytest/node --test/npm test).
- **Obligation creation goes through an explicit service surface** (`ctx.evidence.createObligation`) — dsh has no Tianshu turn-step-producer task boundary, so the host calls it at task start; `supersedeAll()` voids pending obligations.
- **The three RED rules match Tianshu** (the semantics of evidence-obligation.ts:341-387): blocked → attempt only; failed + related → record `red:`; passed needs a prior RED to become satisfied (pass-without-red is not evidence); `blocked ≠ satisfied` (being blocked is not a death sentence).
- **The once latch prevents deadlock**: one obligation blocks an edit only once; an identical resend passes.

### S2 TDD gate
- **Defaults to suggest** (no hard block); only `{ tddMode: 'enforce' }` intercepts — the same trade-off as Tianshu's `RIVET_TDD_GATE=enforce`.
- The tracker holds an edit count (`trackFileModified`) plus a verification count (reset after `applyVerification` accounting); after a verification the edit count clears to zero.

### S3 probe candidates
- `probe-candidates.ts` pure functions: surviving hypotheses (candidate/inconclusive) → targeted_test with `expect: 'fail'` (RED first); already-probed ones are skipped; budget ≤3 degrades to grep; cooldown (uninformative ≥2) skips; `recordProbeFeedback` closes the feedback loop.

### S4 precise suggestions + L2 final gate
- `probe-suggest.ts`: a concrete next step for the agent — a `tests/<同名>.spec.ts` test path + an expected failure; **a verified command already containing the target → degrade to grep** (avoids a duplicate targeted_test); the interception message appends a `建议探针:` line.
- `evaluateFinal` in full (the Tianshu once latch): the first time pending high → `continue_once` + a probe-suggestion nextAction; after `markContinued` → `honest_blocked` + pending-list disclosure (`{id, claim}`).

### S5 real assembly
- **examples/headless-agent** mounts evidence-gate: `fixtures/cli.cordis.yml` adds the plugin + the driver wires the task boundary (creates obligations/supersedes when `DSH_EVIDENCE_DEMO=1`).
- **Key discovery: dsh's native edit tool is `str_replace_editor`** (`@huiliyi37/dsh-tool-str-replace-editor`, arguments `{command: view|create|str_replace|insert, path}`), not Tianshu's edit_file — initially searching by the Tianshu tool name (`grep name: 'edit_file'`, zero hits) misled S5 into the "dsh has no edit tool" conclusion.

### S6 native-tool end-to-end + two real-assembly fixes
- **EDIT_TOOLS adapts to str_replace_editor** (listed first, native first): `command === 'view'` read operations pass; create/str_replace/insert write operations are intercepted (extracting the `path` field); the Tianshu-style tools stay for host compatibility.
- **Guard registration timing (the 4th injection problem exposed by real assembly)**: when the top-level plugin applies, the tools service may not be loaded yet, so `reflect.get('tools', false)` returns undefined early → the guard is **silently unregistered** (the S5 e2e could not distinguish "guard registered but bash not in EDIT_TOOLS" from "guard not registered" — the str_replace_editor experiment exposed it). Fix: **dual-path registration** — a synchronous reflect.get fallback (provide is already ready in test environments) + `ctx.inject(['tools'])` waiting for real-assembly readiness (the same guard function reference; the Set deduplicates naturally).
- **invariant companion**: the new package missing `src/invariant.ts` tripped the repository's test-invariants gate (the root cause of 13 all-failing tests, not a logic problem); added it (an empty install + explanation — obligations are in-memory state with no durable relationship).
- **Mock infinite loop**: the headless mock LLM's edit mode must sit in the first turn (it stops retrying once a tool-result exists), otherwise it retries forever after interception.
- **fs-local duplicate registration**: before adding fs-local to the headless fixtures, check the root cordis.yml first — base already includes it (`service "fs" has been registered`); only the missing str-replace-editor was added.

## Not-ported list (staying minimal)

The L3 worker delivery gate, CMV (behavior-mirror is dead code on the Tianshu side), prediction-error (depends on sensorium), virtue-signals (its only impact is destructive-gate copy), and Tianshu's heavyweight turn-orchestrator/worker structures.

## Key verification facts

- Package-level end-to-end (integration.spec, a real cordis Context + real event objects, no mocked middle layers): create → edit blocked (the message contains the probe suggestion) → test failed records red → edit passes → passed → satisfied → final allow.
- **Real-assembly e2e** (evidence-gate.e2e.ts, a real Loader subprocess + a mock LLM): `str_replace_editor create` is blocked by the L1 gate (the tool/result isError text contains evidence gate); the no-obligation path is not falsely blocked; the keyless-smoke baseline shows no regression.
- Problems corrected by tests: the blocked accounting state (attempted, not open), unrelated failed runs not being accounted, extractResultText argument misalignment, the once latch conflicting with multi-command test expectations (avoided with independent obligations), and skipping too-short stems ('a') to prevent false matches.
- **The Cordis 4 injection proxy now has three instances** (the T4 task pane `17e5129`, /compact, evidence-gate tools): optional-service property access throws "without inject" → `ctx.reflect.get(name, false)`; **service-readiness timing problems are declared with `ctx.inject([...])`** (same as tui-runner).

## Verification commands

```sh
pnpm vitest run packages/guard/evidence-gate/tests/                     # 7 文件 77 测试全绿
npx vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/evidence-gate.e2e.ts  # 4 测试全绿（真实装配）
npx oxlint packages/guard/evidence-gate/                                # 0 错误
npx tsc -p packages/guard/evidence-gate/tsconfig.json                   # 0 错误
```

## Alternatives considered

**The `tools/pre-execute` waterfall for the edit gate.** Rejected: other listeners can override a pre-execute decision, while a guard is monotonic and nobody can overturn it, and the guard also carries the execution arguments the gate needs to extract a path.

**New event types (or a test-framework integration) for verification accounting.** Rejected: pairing tool/call→tool/result on the existing `session/event` stream costs zero new event types and zero test-framework coupling, with the command text recognizing vitest/pytest/node --test/npm test.

**A Tianshu-style turn-step-producer boundary for obligation creation.** Rejected: dsh has no such boundary, so obligations are created through the explicit `ctx.evidence.createObligation` service surface that the host calls at task start, with `supersedeAll()` voiding what is still pending.

**Enforcing the TDD gate by default.** Rejected: the gate defaults to suggest and only `{ tddMode: 'enforce' }` intercepts — the same trade-off Tianshu makes with `RIVET_TDD_GATE=enforce`.

**Blocking every edit while an obligation is pending.** Rejected as a deadlock: the once latch blocks a given obligation's edit exactly once, and an identical resend passes.

**Treating a passing test as evidence on its own.** Rejected: a passed run only satisfies an obligation that already recorded a RED, because pass-without-red is not evidence; symmetrically, `blocked` records an attempt and never counts as satisfied.

**Single-path guard registration.** Rejected in both directions: a synchronous `reflect.get('tools', false)` alone returns undefined and silently skips registration when real assembly has not loaded the tools service yet, while `ctx.inject(['tools'])` alone drops the test environment where provide is already ready. Both paths register the same guard function reference and the Set deduplicates naturally.

**Keeping only Tianshu's edit_file tool names in EDIT_TOOLS.** Rejected: dsh's native edit tool is `str_replace_editor`, which is listed first, while the Tianshu-style names stay only for host compatibility.

## Consequences

The kernel buys an independent boundary that leaves core untouched, adds no event types, and couples to no test framework, and it is pinned end-to-end at two levels: a package integration suite on a real Context, and a real-assembly e2e through a Loader subprocess with the native `str_replace_editor`. What incremental minimalism costs is coverage: the L3 worker delivery gate, CMV, prediction-error, and virtue-signals are absent, so the discipline stops at edits and the final gate and never reaches worker delivery.

The lean choices carry their own limits. Accounting is heuristic — it recognizes verification from command and output text, so a runner it does not recognize is not accounted; the once latch trades strictness for deadlock-freedom, since an identical resend passes; and the TDD gate suggests instead of blocking unless a host opts into enforce. Guard registration needs both a synchronous fallback and an `ctx.inject(['tools'])` path because a single path is silently wrong in one of the two environments, and the package carries an empty invariant companion because obligations are in-memory state with no durable relationship to assert.
