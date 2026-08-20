# Agent Note: 发货 TUI 对齐路由是 DeepSeek flash

Status: implemented

[English](2026-08-19-intent-bridge-shipped-align-flash.md) | 中文

## 问题

TUI bundle 曾把意图桥装配为 `alignProvider: minimax` / `alignModel: MiniMax-M3`。`llm-pi-ai` 以休眠状态挂载：在出现 `llm-pi-ai:` settings profile 之前，`minimax` 路由不会注册，而该 profile 需要自己的 key。首次运行的用户只有 `DEEPSEEK_API_KEY`。对齐 tab 仍会打开，首条请求失败（`MISSING_CREDENTIAL` 或无适配器），错误路径把原文交给主会话——任务不被阻塞，但首次对齐并没有真正跑起来。

## 决策

发货 TUI 的 `cordis.patch.yml` 把意图桥两条路由都设为 `deepseek-official` / `deepseek-v4-flash`——与 `agent-default-model` 同一套出厂适配器和 key。MiniMax（或任何其它）对齐路由仍是同一行上的部署 overlay，前提是所选适配器已经存活。对齐不跟随 `/model`：exec override 仍然跟随，因此把执行模型切到 pro 时，澄清仍走 flash。

两条会话的拆分不变：对齐会话 seed 为禅已完成，工具面只有 `finalize_alignment`；全新主会话接收任务卡并 arm 禅。见[意图对齐桥 Agent Note](2026-08-18-intent-bridge.md)。

## 备选方案否决

- **首次运行就要求 MiniMax key（TUI `/config` 写入路径）。** 否决：第一条提示之前多一把付费 key。Web 设置 → 模型已经能添加目录提供方；那条面仍是选择 MiniMax 的方式。
- **对齐跟随当前 `/model` 选择。** 本次否决：用户把执行切到 pro 时澄清也会走 pro。对齐应跟踪非默认路由时，用 overlay。
- **保持 MiniMax 为发货默认，依赖错误兜底。** 否决：第一个 tab 标题是「意图对齐」且首轮报错；兜底是恢复，不是上手。
- **在 `/model` 旁边做用户可见的对齐路由设置。** 延后：profile `cordis.patch.yml` 已是部署覆写面；settings 字段是后续产品面，不是解开首次运行的前提。

## 后果

- 首次运行的 TUI 对齐与 `/model` 共用 DeepSeek key；开新会话不需要 `llm-pi-ai` profile。
- 便宜的 MiniMax 拆分是可选：overlay 对齐对，并加上 pi-ai profile 与 key（Web 模型页或 `settings.yaml`）。
- `/model` 为 `deepseek-spark` 的用户仍在 `deepseek-official` flash 上对齐（同一把 key，不同路由）。
- Headless 快照夹具仍可把 `minimax` 当作双适配器测试路由；那不是发货 TUI 默认。

## 测试

- `packages/tui/tui/tests/bundle-patch.spec.ts` 把 `alignProvider` / `alignModel` / `execProvider` / `execModel` 钉在 `deepseek-official` / `deepseek-v4-flash`。

## 相关

- [意图对齐桥](2026-08-18-intent-bridge.md) — 会话拆分、交接与禅 seed。
- [配置模型](../../../../docs/user/guide/providers.md) — 部署如何添加 pi-ai 目录路由和 key。
