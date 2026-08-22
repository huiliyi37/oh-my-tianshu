# Agent Note: `/next-workflow` 进入 TUI 斜杠菜单

Status: implemented

[English](2026-08-22-next-workflow-tui-slash-menu.md) | 中文

## Problem

TUI 斜杠菜单（`/` 建议与 Tab 补全）的数据源是 TUI 内部的 `SlashCommandRegistry`，而 `/next-workflow` 注册在 host 的 `ctx.commands` 平面。两条平面不相通：命令手动输入可以执行，菜单却不提示它的存在——对一条由 `dsh-base` 在每个 profile 都发货的 harness 命令来说，这是可发现性缺口。

## Decision

`dsh-next-workflow` 向可选服务 `tui.commands`（TUI 为外部插件暴露的注册表）注册一条 `next-workflow` 条目：中文描述 + `[candidates] <objective>` 参数提示。注册经 `ctx.inject(['tui.commands'], …)` 延迟：发货 bundle 顺序（`tui.profile.bundles = [dsh-base, dsh-tui]`）使 base 行先于 tui 叶子行应用，插件应用时该服务尚未提供；inject 纤维在服务发布后注册，非 TUI 装配中保持无害的 pending 纤维，手动输入路径不变。

该条目的 `run` 仍委托回 host 的 `CommandService.execute`，因此 `command/run` 生命周期记录、逐 agent 命令视图与 zen/工具面语义仍归既有 cordis 通道所有。

TUI 现在在每次输入变化前把注册表重投影到输入控制器的提示列表；此前快照只在构造期取一次，会漏掉构造后的注册（如本条）。

## Alternatives considered

**在 apply 时经 `reflect.get` 注册。** 否决（已实证）：组合后的 tui profile 先应用 `dsh-base` 行（含 `next-workflow`），后应用挂载 `tui-runner` 的 bundle 层——apply 时服务尚未提供，发货 profile 里该条目会静默丢失。

**TUI 侧对 `ctx.commands` 做通用桥接。** 否决：枚举需要逐会话 agent，且 host 描述为英文——菜单要么显得过期，要么失去本命令需要的中文措辞。

**只注册提示、不提供执行。** 否决：`SlashCommand` 契约要求 `run`，无 run 的条目会让 `runSlash` 的回退顺序变得隐晦。

**菜单条目直接调用处理器。** 否决：会绕过 cordis 通道的生命周期记录与逐 agent 命令视图；经 `execute` 委托保持单一执行路径。

## Consequences

TUI 用户在 `/` 建议、Tab 补全与参数 ghost 提示中看到带中文描述的 `/next-workflow [candidates] <objective>`；菜单选择与手动输入都经 `CommandService` 执行。TUI 表面保持可选（`reflect.get`，无运行时依赖），headless CLI 行为不变。

覆盖：next-workflow 规格断言注册形状与委托调用；TUI app 规格断言构造后经 `tui.commands` 注册的命令出现在渲染菜单中。
