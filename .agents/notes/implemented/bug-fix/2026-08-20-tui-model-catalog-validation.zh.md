# Agent Note: /model 目录校验——拼写错误不再切换

Status: implemented

[English](2026-08-20-tui-model-catalog-validation.md) | 中文

## Problem

`/model <text>` 此前接受任意字符串并直接落盘为默认选择 + 热切目标：拼错的模型 id（`deepseek-v4-pr`）、未注册的 provider、畸形路由（`a/b/c`）都会"切换成功"，直到下一次 agent 步进才在派发层炸掉。竞品（Claude Code、Codex、Gemini CLI）的手动切换都会对照已知目录校验并给出就近建议。

## Decision

在 TUI 命令层校验（`packages/tui/tui/src/commands/registry.ts`）：别名展开之后、`saveSelection` 之前，经 `ctx.reflect.get('llm', false)` 以最小 `LlmCatalogFacet` 读取 llm 目录。llm 的 `listModels` 目录在契约上是 **advisory**——不在目录不得变成请求拒绝——因此策略分级：

- provider 未知（`listProviders()` 无此路由）：权威事实，请求注定派发失败——硬拒绝并列出已注册 provider。
- provider 已知、目录非空、模型在目录外：adapter 通告了封闭清单——硬拒绝并给至多三条就近建议（大小写不敏感精确 → 前缀 → 子串；永不自动纠错）。
- provider 已知、目录为空或通告失败：无法证伪——放行。
- llm 服务未装配：跳过校验（维持原行为）。

畸形形状（`a/b/c`、空段）回用法提示；一切拒绝都不切换并点名当前仍在用的选择。spark 别名在 `deepseek-spark` 未注册时现在响亮失败，不再静默保存死路由。

## Alternatives considered

**放进 `dsh-agent-default-model` 服务层校验。** 否决：目录按 llm 契约是 advisory，服务层硬规则会误伤合法接受目录外 id 的 adapter（OpenAI 兼容代理）；对标竞品的 UX 属于 TUI 便利层。

**警告但仍切换。** 否决：没有修掉报告的问题——拼错依然成为生效选择。

**编辑距离模糊建议。** 否决：前缀/子串已覆盖观察到的拼错（截断 id、缺后缀），零新依赖。

## Consequences

错误的 `/model` 输入现在在命令行即失败并给出可操作提示，而不是拖到下一次模型请求。空目录保持放行，OpenAI 兼容部署不受影响。无参 picker 路径不变（只列目录项，天然安全）。

## Testing

- `packages/tui/tui/tests/commands.spec.ts`——新增 6 个 `/model` 用例：未知 provider 拒绝（列出已注册路由）、目录外模型拒绝并就近建议、空目录放行（advisory）、裸模型名按当前 provider 目录校验、畸形 `a/b/c` 用法提示、spark 别名在 provider 未注册时响亮拒绝。既有用例全部无 llm facet 运行，零改动通过。

## Related

- [TUI 模型热切](../feature/2026-08-11-tui-model-hot-swap.md)——拥有本校验所守护的 saveSelection + switchLiveModel 路径。
