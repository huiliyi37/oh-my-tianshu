# @huiliyi37/dsh-agent-definitions

[English](README.md) | 中文

Agent 角色定义（`ctx.agentDefinitions`）：subagent 启动请求输入的命名组合——persona 正文、工具 allow 名单、模型路由、沙箱收窄——从扁平 markdown 文件发现，外加一条承载内置只读 `explore` 角色的运行时注册缝。角色不是提供方：提供方选择仍由委派工具的部署配置决定，面向模型的 Consumer（[`dsh-tool-subagent`](../tool-subagent/README.md)）把选中的角色合并进一次委派请求。

## 角色文件

角色文件是扁平的 `<name>.md` 文档——没有目录包形式——由 YAML frontmatter 和成为子 agent persona 的 markdown 正文组成：

```markdown
---
name: reviewer
description: Read-only code review citing file:line evidence.
tools:
  - grep
  - read
  - glob
model: fast-model
---

You are a code-review subagent. ...
```

`name`（kebab-case）和 `description` 必填——description 驱动委派路由，必须说明何时选择该角色。`tools` 是作为子 agent 全局工具限制应用的 allow 名单（未知名称会通过 `tools.restrict()` 让委派响亮失败）；`model` 覆盖子 agent 的 `agentOptions.model`。无效文件会被跳过并记录警告，绝不会使发现失败。

发现按分级目录扫描，同名时较低级别获胜：项目 `.dsh/agents`（100）与 `.agents/agents`（200）、`customAgentDirs`（300）、用户 `~/.dsh/agents`（400）与 `~/.agents/agents`（500），以及配置的 `bundledAgentDir`（600）。运行时注册位于第 250 级。挂载了 `ctx.fs` 服务时读取经该服务进行（bundled 根目录直接读宿主机），chokidar 监听加首方 `fs/observed` 变更通知使按 cwd 缓存的目录失效。

## 运行时注册与内置 explore 角色

`ctx.agentDefinitions.register()` 从代码安装角色——这是部署与测试用来注册随产品发布角色的接缝。它承载着内置 `explore` 角色：只读探索 persona、`grep`/`read`/`glob`/`semantic_search`/`bash` allow 名单，以及作为 durable `sandbox/mode` 委派覆写追加到子 agent 日志的 `read-only` 沙箱收窄。该收窄要求委派提供方具备 `sandboxMode` 能力（进程内 `spawn`/`fork` 提供方具备），并且因为它记录在子 agent 日志而非描述符上，冷恢复后仍然有效。`builtinExplore: false` 可省略该注册。

## 配置

| 键 | 含义 |
|---|---|
| `includeDefaultRoots` | 在 custom 目录两侧包含项目与用户目录，默认 `true`。 |
| `dshHome` | Harness 配置根目录；默认为 `$DSH_HOME` 或 `~/.dsh`。 |
| `agentsHome` | 共享 agent 配置根目录；默认为 `$DSH_AGENTS_HOME` 或 `~/.agents`。 |
| `customAgentDirs` | 在项目目录之后、用户目录之前扫描的额外目录。 |
| `bundledAgentDir` | 最低优先级的安装器角色目录；按可信宿主机读取。 |
| `builtinExplore` | 注册内置只读 `explore` 角色，默认 `true`。 |
| `collectCacheMaxEntries` | 内存中保留的按 cwd 完整目录上限，默认 `128`。 |
| `watch` | 监听宿主机本地目录的目录变化，默认 `true`。 |
| `watchUsePolling` | Chokidar 使用轮询而非原生文件系统事件，默认 `false`。 |
| `watchStabilityThresholdMs` | 角色文件变更需稳定多少毫秒后才被观察，默认 `200`。 |
| `watchPollIntervalMs` | Chokidar 稳定性或轮询探测的间隔毫秒数，默认 `100`。 |
| `watchMaxProjects` | 保持监听的 distinct 项目根目录上限，默认 `128`。 |
| `watchFollowSymlinks` | 被监听的符号链接跟随到目标文件，默认 `true`。 |

## 模型体验

间接地通过 `dsh-tool-subagent` 体现：它把该目录渲染为 durable `<available_agents>` 消息，并把所选角色的正文合并进子 agent 的 persona。

#### KV Cache 影响

无直接提示词影响。目录发布由该 Consumer 拥有；角色编辑会使本服务的发现缓存失效，是否重发会话消息由 Consumer 的 digest 决定。

## 已知限制与暂缓事项

- **角色无法移除子 agent 作用域工具**——`tools` allow 名单经由 `tools.restrict()` 生效，只塑造全局注册，因此 `report` 等作用域贡献在任何角色下都会保留；裁剪它们需要感知角色的 continuable-setup 贡献。
- **没有 `.claude/agents` 兼容源**——外部角色目录经 `customAgentDirs` 挂载；专门的兼容读取器被有意推迟。
- **markdown 角色无法请求沙箱收窄**——`sandbox: 'read-only'` 只能经运行时注册到达；frontmatter 没有对应字段。
- **角色正文按 persona 插值**——正文成为严格 `{{var}}` 插值下的 `deployment:persona` 段落，因此角色文件中的字面 `{{…}}` 文本会让子 agent 的首次请求以提示词变量错误失败。
