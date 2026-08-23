# Agent Note：Codex harness 对标——剩余增强与融合候选清单

Status: proposed

[English](2026-08-22-codex-harness-enhancement-candidates.md) | 中文

## 问题

对 OpenAI Codex（`codex-rs`，外部检出，2026-08-21 克隆；下文所有 `codex-rs/…` 路径均为指向该检出的时间点快照引用，非本仓链接）做了一轮只读对标，产出针对本 fork 现有能力面的增强/融合候选清单——这份分析若没有可查的归宿，就会随时间散佚成零碎记忆。同一分析中的[自动记忆管线](../../implemented/feature/2026-08-21-memory-auto-pipeline.md)已单独落地（`85461be679`）；剩余项需要一份可决策的记录。

## 提案

本笔记把选定剩余项收录为可决策目录，按成本与收益分级。收录是候选盘点，不构成实施承诺；每项采纳时经自己的笔记落地。早期两项 P0 候选——带域名策略的沙箱网络代理（Codex `network-proxy`）与前缀命令策略 DSL（Codex `execpolicy`，Starlark）——不在本记录内，待另行评估。

## P0——模型侧上下文工具（小成本大收益）

**`get_context_remaining` + `new_context_window`。** 模型可查询剩余上下文预算、并在不摘要历史的情况下直接重开新窗口（`codex-rs/core/src/tools/handlers/get_context_remaining.rs`、`new_context_window.rs`）。天枢的 `dsh-token-meter` 已有重放感知的压力投影，但没有面向模型的暴露面。落地形态：两个小工具包，消费 token-meter 投影，注册到 `ctx.tools`。

## P1——交互与生态面

- **`tool_search` + deferred tools。** MCP 目录爆炸时只挂 `tool_search`，其余工具按需取回（"Search query for deferred tools"，`tools/src/tool_search_spec.rs`）。skill 族有渐进披露，工具面没有——每接入一个 MCP 服务，这个缺口就宽一分。
- **`request_permissions`。** 模型运行中主动请求提权，经策略变换层归一化（`sandboxing::policy_transforms::normalize_additional_permissions`）。天枢的提权只在用户侧（Shift+Tab 切档），模型没有发起通道。需要在天枢 sandbox 接缝上做对应的权限归一化层。
- **`view_image`。** 让模型读磁盘任意图片文件——闭合截图→自查的验证回路。`vision-ask` 只覆盖用户上传图；agent 自己生成的图它看不到。可复用 vision-ask 的注册表与视觉模型路由。
- **插件发现/安装流。** `list_available_plugins_to_install` / `request_plugin_install` 加 TUI 的 npm 注册表浏览。天枢装插件只有手动 `plugin add`。
- **外部 agent 迁移器。** 从 Claude Code 与 Cursor 导入 config/hooks/memory/sessions/subagents/plugins 的整套迁移（`external-agent-migration`）。获客漏斗型功能；现有 `hooks-claude` 兼容插件是现成地基。

## P2——平台扩展

- **Windows 沙箱**（`windows-sandbox-rs` + windows proxy ingress）。沙箱族目前只有 bwrap/Landlock/Seatbelt（支持 Termux，无 Windows 收敛）。
- **App-server 常驻守护**。常驻后台服务暴露 MCP 兼容的稳定 RPC 面——thread/start·resume·fork·list、turn/start·steer·interrupt、config 读写、model/list、模糊文件搜索会话（`codex-rs/docs/codex_mcp_interface.md`）。编辑器扩展生态的地基；本仓有 ACP/Web host，但没有"常驻 daemon + 版本化 RPC"形态。
- **云端任务委派** + scrollable diff 审查 UI（`cloud-tasks/src/`）。
- **feature 分级开关。** 特性分为 UnderDevelopment / Experimental / stable，配 `/experimental` 菜单（`features`）——实验行为的安全发布通道。
- **OS 钥匙串凭据存储**（`keyring-store`）。`credentials-local` 目前是文件态。

## 小件打磨（低成本可摘）

- **apply_patch 受限语法**——约束补丁格式解码的 `.lark` 语法（`handlers/apply_patch.lark`）。
- **TUI 细节**：表格检测、OSC 8 终端超链接、终端调色板探测、tooltips、motion 动画、带转录预览的 resume picker、自更新提示流（`codex-rs/tui/src/`）。
- **Rollout 尾部扫描**——反向 JSONL 扫描器，给大文件会话 resume 提速。
- **小工具三件**：sleep / current_time / wait_for_environment。

## 顺序与依赖

P0 先行（两个小工具，零接缝改动）。P1 各项独立可并行；每挂一个 MCP 服务，`tool_search` 就更紧迫一分，而 `view_image` 趁 vision-ask 注册表还新鲜时最便宜。P2 需要工程之外的产品决策（Windows 沙箱范围、daemon 协议归属、云端后端选型）。小件跟随触碰同一区域的 PR 顺路落地。

## 备选方案

### 为什么不把网络代理与 execpolicy DSL 也一并评估？

两者都触碰 sandbox 接缝的信任边界，各自值得独立的威胁建模；混进一份大目录会把这份分量埋进 UI 打磨项之间。它们留在本记录之外，待另行评估。

### 为什么现在只做目录、不逐项立提案？

每项的采纳决策需要各自的证据（消费者需求、接缝契合、快照），而多数项目前没有消费者提出要求。目录以极低成本保住对标的发现；提升一项意味着写它自己的笔记，而不是从一份会过时的检出里重新推导。

## 验收标准

每个采纳项按仓库规约独立成包/插件落地——opt-in 挂载、经校验的 Config 字段、证据匹配证据面（单元 + 真装配 e2e，模型可见输出用 keyless 快照）、双语 README 对、以及标记该条目落地 commit 的独立 Agent Note。本目录笔记本身永远不作为实施记录。

## 风险

- `codex-rs/…` 引用是指向外部检出的时间点快照；随 Codex 演进会过时，它们标示的是想法的出处，不是稳定 API。
- 目录容易引来照单全收：条目的存在只表示"见过并记录"，绝不表示"想要"——采纳仍需要消费者或明确的产品决策。
- 各项可能与期间独立落地的能力重复；采纳一项永远从当前代码树出发，而不是从本文字出发。
