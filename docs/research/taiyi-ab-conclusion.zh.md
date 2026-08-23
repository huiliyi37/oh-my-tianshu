# 太一 A/B 复现结论：deepseek-v4-flash 下词本体不降级

[English](taiyi-ab-conclusion.md) | 中文

本记录是《[太一词回流计划](taiyi-port-plan.md)》第 3 步「跑 A/B 并记录结论」的产出，回答「太一词本体叠加到 dsh 标准工具面后，工程能力是否降级」——在 deepseek-v4-flash 上的本次实测答案是不降级。

## 方法

- 复用 `examples/headless-agent` 的真实组装（真实 DeepSeek adapter + 真实 bash/todo 工具）。对照组 = 标准 coding persona；实验组 = 太一词全文，从 `apps/cli/config/agent-presets/taiyi/agent.cordis.yml` 单轨读取，不复刻。
- 任务集 2 个客观可复现任务，两组同一任务集：`fix-add`（修 `add.js` 让 `node add.test.js` 通过）、`implement-triple`（补缺失的 `triple` 让 `node math.test.js` 通过）。
- 判据：`node <test>` 退出码为 0 且输出含 `PASS`，且测试文件逐字节未改（防止改测试冒充修 bug）。
- 每格 N=1（smoke 级复现，非统计结论）。

## 结果（deepseek-v4-flash · deepseek-official · 2026-08-23）

| 任务 | 组 | 通过 | input / output tokens | 用时 |
|---|---|---|---|---|
| fix-add | 对照 | 通过 | 1702 / 356 | 5.3s |
| fix-add | 太一 | 通过 | 2882 / 309 | 4.6s |
| implement-triple | 对照 | 通过 | 1621 / 399 | 4.7s |
| implement-triple | 太一 | 通过 | 440 / 470 | 5.1s |

四个用例全部通过：太一在任务通过率与交付闭环上均未降级，最终报告如实汇报改动与验证结果，测试文件均未被改动。

## 如实记录与边界

- 结论仅特定于 deepseek-v4-flash（deepseek-official provider）与本次运行；其他模型/版本不预设同样结论。
- 本复现只搬上游「词本体」，不含上游 volatileBlock 动态段与 16 件最小工具档，因此「不降级」不等于对上游完整太一实验的复现。
- token 列为 harness 口径（inputTokens 已扣除 cache-read），长静态词前缀倾向于走缓存，不作为受控对比依据。

## 产出物

- 可重复跑法：`examples/headless-agent/taiyi-ab.mts`。
- 四份 transcript 快照与汇总：`examples/headless-agent/taiyi-ab/`。
