# Agent Note: 给没有 TUI 注册表的命令适配器提供宿主 `/remember` 与 `/memory`

Status: implemented

[English](2026-08-18-command-memory.md) | 中文

## Problem

[`/remember` 与 `/memory` 活在 TUI 的私有注册表里](2026-08-17-tui-bundle-tianshu-capability-roster.md)。Web 斜杠菜单渲染的是 `ctx.commands`，这两个名字在那里不会出现。TUI 条目不能复用：它们经终端通道 echo，裸 `/memory` 打开交互 overlay。[STM](2026-08-18-adaptive-memory-stm.md) 与 [深度召回](2026-08-18-tool-memory-recall.md) 面向模型，并不给人一条宿主命令去写入或删除已存条目。

## Decision

`@huiliyi37/dsh-command-memory` 带着 input hint 把这两个命令注册到 `ctx.commands`。每次调用记录执行器所属的纯日志事件对 `command/run` / `command/done`。插件只注入 `commands`，并在处理器执行时通过 `ctx.reflect.get('memory', false)` 对照本地 `MemoryFacet`（`save` / `list` / `delete`）解析 `memory`。服务缺席时以 `⚠ memory 服务不可用（未加载 memory 插件）` 结算；用法与成功字符串保持 TUI 的中文措辞。

裸 `/memory` 列出 `- <id>: <text>`，空白折叠，上限 80 字符。发货 Web bundle 挂 Markdown `memory` 服务和本插件。`dsh-base` 与 TUI bundle 不挂。TUI 保留自己的私有条目。本次改动里 Web 不挂 `dsh-tool-memory` 或 `dsh-adaptive-memory`。

## Alternatives considered

**像 `github/dev` 那样挂进 `dsh-base` 但不挂 memory 服务。** 否决：base 保持上游对齐主干。每个 profile 里只会回答不可用文本的命令是死目录行。缺私有注册表的表层是 Web。

**挂进 TUI bundle，或替换 TUI 注册表条目。** 否决：TUI 已经拥有 `/remember` 与 `/memory`，包括记忆浏览器 overlay。第二次注册会冲突。

**把 `memory` 做成必需服务。** 否决：没有该服务的组合会装不上，命令从发现里消失。处理器时解析让目录保持诚实，只多一条不可用文本分支。

## Consequences

Web 用户可以通过 TUI 绕过的同一宿主注册表保存、列出和删除项目记忆。未挂 `dsh-memory` 的组合得到稳定的不可用回答，而不是静默跳过。发货 Web 路径还没有面向模型的消费方；已保存的 Markdown 条目先落盘，直到宿主再加 `dsh-tool-memory` 或 `dsh-adaptive-memory`。覆盖：`packages/memory/command-memory/tests/*.spec.ts`（保存 / 列表 / 删除 / 用法 / 不可用文本 / HMR 卸载 / Loader 组合 / 空 invariant 伴侣）。
