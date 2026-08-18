# @huiliyi37/dsh-command-memory

English | [中文](README.zh.md)

Human-facing `/remember` and `/memory` commands over the optional [`memory` service](../memory/README.md). Design contract: [Agent Note](../../../.agents/notes/implemented/feature/2026-08-18-command-memory.md). The plugin registers both commands through [`ctx.commands`](../../interaction/commands/README.md), so every composed command adapter — including the Web slash menu — discovers and executes them without a model turn. The TUI owns its own registry entries and does not mount this plugin.

The memory service is optional: the plugin injects only `commands` and resolves `memory` at handler time through `ctx.reflect.get('memory', false)`. A composition without the memory plugin still lists both commands; every invocation then settles with the unavailable text below, so discovery never lies about a backend that is not mounted.

## Command contract

| Input | Result |
|---|---|
| `/remember <text>` | Save one global-scope, user-sourced entry, then `已保存记忆: <id>`. |
| `/remember` (empty input) | `用法: /remember <text>` — nothing is saved. |
| `/memory` | Every entry, one `- <id>: <text>` line each; `暂无记忆` when the store is empty. |
| `/memory delete <id>` | Delete that entry, then `已删除记忆: <id>` (a missing id is the service's idempotent no-op). |
| `/memory delete` (no id) | `用法: /memory delete <id>`. |
| `/memory <anything else>` | `用法: /memory [delete <id>]`. |
| either command, no memory plugin mounted | `⚠ memory 服务不可用（未加载 memory 插件）`. |

The list output is plain text for command adapters without a browser surface: whitespace in each entry is flattened to single spaces and text longer than 80 characters is truncated with `…`, keeping the card deterministic. Every resolved invocation records the executor-owned log-only pair `command/run` / `command/done`; neither event joins model history.

## Composition

The producer injects `commands` only. Mount the command registry, this plugin, and optionally the memory service:

```yaml
- id: commands
  name: '@huiliyi37/dsh-commands'
- id: memory
  name: '@huiliyi37/dsh-memory'
- id: command-memory
  name: '@huiliyi37/dsh-command-memory'
```

The shipped Web bundle mounts the Markdown memory service and this plugin. `dsh-base` and the TUI bundle do not; the TUI keeps `/remember` and `/memory` in its private registry. The shipped Web bundle does not mount `dsh-tool-memory` or `dsh-adaptive-memory`, so a saved entry stays on disk until a host adds a consumer.

## Model Experience

### Human `/remember` and `/memory` control

#### What the model sees

The slash input and the direct result never enter a model request. A saved entry reaches a later request only when a memory consumer — `memory_save` / `memory_search` from `dsh-tool-memory` or the STM snapshot from `dsh-adaptive-memory` — injects it.

#### Token effect

The command lifecycle adds no model tokens: the `command/run` / `command/done` pair is log-only, and the saved Markdown entry sits in `.dsh/memory/global.md` until a consumer renders it.

#### KV Cache effect

Discovery and command bookkeeping do not affect the cache. A saved or deleted entry changes later request prefixes only through the consumer surfaces named above, under their own cache rules.

## Known Limitations and Deferred Work

- **Plain-text listing** — bare `/memory` prints one `- <id>: <text>` line per entry with flattened whitespace and an 80-character cap; the TUI's interactive memory browser has no command-adapter counterpart.
- **Global scope only** — `/remember` always saves `scope: 'global'` with no tags, mirroring the TUI command; other scopes remain the programmatic `memory.save()` path.
- **No delete confirmation** — `/memory delete <id>` applies immediately and an unknown id settles as success because the service's delete is idempotent.
- **Shipped Web has no model consumer** — `/remember` writes `.dsh/memory/global.md`; the Web model sees that entry only after a host mounts `dsh-tool-memory` or `dsh-adaptive-memory`.
