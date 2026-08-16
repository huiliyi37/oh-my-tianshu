# Agent Note: Web `/remember` and `/memory` commands over the host registry

Status: implemented

[English](2026-08-17-web-remember-memory-commands.md) | 中文

## Problem

`/remember` 与 `/memory` 此前只存在于 TUI 的私有命令注册表（`packages/tui/tui/src/commands/registry.ts`），因此渲染宿主 `ctx.commands` 目录的 Web 斜杠菜单完全无法保存或查看项目记忆。TUI 的条目无法复用：它们经终端自己的通道回显，且裸 `/memory` 会打开交互式终端浏览器——这两者都不存在于宿主命令适配器之后。

memory 服务被刻意设计为可选：所有发布组合都未装配 `@huiliyi37/dsh-memory`，但命令仍应可被发现，并且在那种组合下必须诚实地失败。

## Decision

新的宿主插件包 `@huiliyi37/dsh-command-memory`（`packages/memory/command-memory`）通过 `ctx.commands` 注册这两个命令并附带 `input` 提示，因此每个命令适配器（Web 菜单及未来的接口）都能发现并执行它们，且每次调用都会记录执行器所属的纯日志事件对 `command/run` / `command/done`。该插件只注入 `commands`，从不静态导入 `dsh-memory`，而是在处理器执行时通过 `ctx.reflect.get('memory', false)` 对照本地声明的最小 `MemoryFacet`（save/list/delete）解析服务。服务缺席时，两个命令都以 `⚠ memory 服务不可用（未加载 memory 插件）` 结算；用法行与保存/删除成功文案保持 TUI 的原文中文措辞。

裸 `/memory` 以确定性纯文本列出条目（`- <id>: <text>`，空白折叠，80 字符截断并补 `…`），取代 TUI 的浏览器，因为命令适配器没有交互界面。发布的 `dsh` 基础配置挂载该插件但不挂载 memory 服务，Web fixture 的目录与执行分支精确镜像该组合。

## Alternatives considered

- **直接注入 `memory`**——会使插件在每个未装配该服务的组合中无法加载，并将命令从发现中隐藏；动态 facet 用一个不可用文本分支保持了目录的诚实。
- **把 TUI 注册表条目搬进两个接口共享的包**——TUI 注册表的 echo/run 形态及其记忆浏览器依赖是终端专属的；宿主命令契约（带类型的 `CommandResult`、生命周期事件）才是共享层，因此只有文案保持逐字一致。
- **把列表渲染为结构化的命令卡片负载**——`CommandResult` 只有 `kind` + text；为单个命令发明更丰富的负载会在出现第二个消费方之前扩大 wire 契约。

## Consequences

Web 用户可以通过 TUI 所绕过的同一个宿主注册表保存、列出和删除记忆，未装配 `dsh-memory` 的组合会得到稳定且可测试的不可用回答。代价是最小 facet 形状的重复（TUI 与宿主包各自声明）以及两个并行命令实现——其用户可见文案须靠约定保持对齐；若出现第三个接口，把 facet 提升为共享类型包就值得重新考虑。
