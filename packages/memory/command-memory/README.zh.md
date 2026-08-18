# @huiliyi37/dsh-command-memory

[English](README.md) | 中文

基于可选的 [`memory` 服务](../memory/README.md)提供面向用户的 `/remember` 与 `/memory` 命令。设计约定：[Agent Note](../../../.agents/notes/implemented/feature/2026-08-18-command-memory.md)。该插件通过 [`ctx.commands`](../../interaction/commands/README.md) 注册这两个命令，因此组合中的每个命令适配器——包括 Web 斜杠菜单——都能发现并执行它们，无需模型轮次。TUI 拥有自己的注册表条目，不挂载本插件。

memory 服务是可选的：插件只注入 `commands`，并在处理器执行时通过 `ctx.reflect.get('memory', false)` 解析 `memory`。未装配 memory 插件的组合仍会列出这两个命令；此时每次调用都以下方的不可用文本结算，因此命令发现不会对未挂载的后端撒谎。

## 命令约定

| 输入 | 结果 |
|---|---|
| `/remember <text>` | 保存一条 global 作用域、来源为 user 的条目，然后返回 `已保存记忆: <id>`。 |
| `/remember`（空输入） | `用法: /remember <text>`：不保存任何内容。 |
| `/memory` | 列出全部条目，每行一条 `- <id>: <text>`；存储为空时返回 `暂无记忆`。 |
| `/memory delete <id>` | 删除该条目，然后返回 `已删除记忆: <id>`（id 不存在时是服务的幂等空操作）。 |
| `/memory delete`（缺 id） | `用法: /memory delete <id>`。 |
| `/memory <其他内容>` | `用法: /memory [delete <id>]`。 |
| 任一命令，但未装配 memory 插件 | `⚠ memory 服务不可用（未加载 memory 插件）`。 |

列表输出是纯文本，面向没有浏览器界面的命令适配器：每条条目内的空白字符折叠为单个空格，超过 80 字符的文本以 `…` 截断，使命令卡片内容保持确定。每次完成的调用都会记录执行器所属的纯日志事件对 `command/run` / `command/done`；两者都不进入模型历史。

## 组合

生产方只注入 `commands`。挂载命令注册表、本插件，以及可选的 memory 服务：

```yaml
- id: commands
  name: '@huiliyi37/dsh-commands'
- id: memory
  name: '@huiliyi37/dsh-memory'
- id: command-memory
  name: '@huiliyi37/dsh-command-memory'
```

发货 Web bundle 挂 Markdown memory 服务和本插件。`dsh-base` 与 TUI bundle 不挂；TUI 把 `/remember` 与 `/memory` 留在自己的私有注册表里。发货 Web bundle 不挂 `dsh-tool-memory` 或 `dsh-adaptive-memory`，因此已保存条目先落盘，直到宿主再加消费方。

## 模型体验

### 用户 `/remember` 与 `/memory` 控制

#### 模型看到什么

斜杠输入与直接结果绝不会进入模型请求。已保存的条目只有在记忆消费方——`dsh-tool-memory` 的 `memory_save` / `memory_search` 工具或 `dsh-adaptive-memory` 的 STM 快照——注入时才会进入后续请求。

#### Token 影响

命令生命周期不会增加模型 token：`command/run` / `command/done` 事件对是纯日志，保存的 Markdown 条目驻留在 `.dsh/memory/global.md` 中，直到某个消费方渲染它。

#### KV Cache 影响

命令发现与簿记不会影响缓存。保存或删除的条目只会通过上述消费方界面、按它们各自的缓存规则改变后续请求的前缀。

## 已知限制与暂缓事项

- **纯文本列表**：裸 `/memory` 每行打印一条 `- <id>: <text>`，空白折叠且上限 80 字符；TUI 的交互式记忆浏览器没有命令适配器对应物。
- **仅限 global 作用域**：`/remember` 始终以 `scope: 'global'` 且无标签保存，与 TUI 命令一致；其他作用域仍是编程接口 `memory.save()` 的路径。
- **删除无确认**：`/memory delete <id>` 立即生效；由于服务的删除是幂等的，未知 id 也以成功结算。
- **发货 Web 没有模型消费方**：`/remember` 写入 `.dsh/memory/global.md`；Web 模型只有在宿主再挂 `dsh-tool-memory` 或 `dsh-adaptive-memory` 之后才会看到该条目。
