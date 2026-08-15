# Agent Note: 托管 verify 工作流与 main 分支触发修正

Status: implemented

[English](2026-08-16-hosted-verify-ci.md) | 中文

## Problem

两个缺口让红灯状态落上 `main`：继承来的 `ci.yml` 的 push 触发只盯 `master`（分叉后默认分支已是 `main`，从未触发），且其 PR 泳道指向自建 runner 池，离开原组织不保证存在。另外，包级 `tsc -b` 构建不检查 `tests/`，过包级检查的改动仍可能悄悄打破仓级 `typecheck` 门，直到有人推送时才暴露。

## Decision

新增 `.github/workflows/verify.yml`——标准托管 runner（`ubuntu-latest`，Node `22.19` + `24`）上的最小严谨闭环：不可变安装、仓级 `typecheck`、全量单测 `test`、`build`，随每次推送 main 与每个 PR 运行。它刻意不复制企业级 `ci.yml` 的拓扑，只依赖到处存在的基础设施。同一改动把继承的 `ci.yml` 里 `master` 的 push 触发与 master 门控任务改指 `main`，使其自身的 push 泳道恢复可触发（自建池 PR 泳道不动——基础设施决策仍归 failover runbook）。

## Alternatives considered

- **只把 ci.yml 的 `master` 改成 `main`**：PR 泳道仍依赖 `dshubuntu-*` / `vm-backup` 池，无法验证本仓可用——永远排队中的检查不如没有。
- **在托管 runner 上复制完整企业矩阵**：覆盖率/消费者/Wine 泳道要吃大缓存与长时长，托管复制是容量决策而非正确性决策。
- **等 runner 盘点结论再做**：闭环的价值是即时的（第一天就挡住红灯），且与后续任何池拓扑兼容。

## Consequences

每次推送与 PR 现在都有托管结论覆盖实际拦截本地推送的三道门（typecheck/test/build）;`ci.yml` 里 master 时代的 push 任务在 `main` 上恢复生效。企业级泳道（覆盖率、消费者、Wine）保持原触发，不属于本闭环。若全量 `pnpm run test` 基线带有间歇失败，它们会在这里成为全仓可见信号，而不是只在某台机器上知道。

## Testing

- 工作流语法对照既有 workflow 文件做过结构评审；闭环的三步（`pnpm run typecheck`、`pnpm run test`、`pnpm run build`）在引入本工作流的提交上各自本地跑绿。
