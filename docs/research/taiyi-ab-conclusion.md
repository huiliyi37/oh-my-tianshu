# Taiyi A/B reproduction conclusion: no capability degradation on deepseek-v4-flash

English | [中文](taiyi-ab-conclusion.zh.md)

This record is the output of step 3 ("run A/B and record the conclusion") of the [Taiyi verse backflow plan](taiyi-port-plan.md). It answers whether stacking the Taiyi word on top of dsh's standard tool surface degrades engineering capability — on deepseek-v4-flash, this run's answer is no.

## Method

- Reused the real `examples/headless-agent` assembly (real DeepSeek adapter + real bash/todo tools). Control group = the standard coding persona; experimental group = the full Taiyi word, read single-track from `apps/cli/config/agent-presets/taiyi/agent.cordis.yml`, never duplicated.
- Task set: 2 objectively reproducible tasks, the same set for both groups — `fix-add` (fix `add.js` so `node add.test.js` passes) and `implement-triple` (add the missing `triple` so `node math.test.js` passes).
- Criterion: `node <test>` exits 0 with `PASS` in output, and the test file is byte-identical (so neutering the test cannot masquerade as fixing the bug).
- N=1 per cell (smoke-level reproduction, not a statistical claim).

## Results (deepseek-v4-flash · deepseek-official · 2026-08-23)

| Task | Group | Pass | input / output tokens | Duration |
|---|---|---|---|---|
| fix-add | control | pass | 1702 / 356 | 5.3s |
| fix-add | taiyi | pass | 2882 / 309 | 4.6s |
| implement-triple | control | pass | 1621 / 399 | 4.7s |
| implement-triple | taiyi | pass | 440 / 470 | 5.1s |

All four cases pass: taiyi shows no degradation in task pass rate or delivery closure, and its final reports state the change and verification truthfully; the test files were never modified.

## Honest recording and bounds

- The conclusion is specific to deepseek-v4-flash (deepseek-official provider) and this run; no other model or version is presumed to behave the same.
- This reproduction ports only the upstream "verse body", not the upstream volatileBlock dynamic section nor the 16-tool minimal preset, so "no degradation" is not a reproduction of the full upstream Taiyi experiment.
- Token columns use the harness's accounting (inputTokens already excludes cache-read), and the long static verse prefix tends to be cache-read rather than counted — not a controlled comparison basis.

## Artifacts

- Reusable runner: `examples/headless-agent/taiyi-ab.mts`.
- Four transcript snapshots plus summary: `examples/headless-agent/taiyi-ab/`.
