# Agent Note：基于文件的自定义命令

Status: proposed

[English](2026-08-23-file-based-custom-commands.md) | 中文

## 问题

Tianshu 的每条人类命令都通过[命令注册表](../../../../packages/interaction/commands/README.md)由代码注册，用户不写插件就无法扩展产品面。Claude Code 的 `.claude/commands/*.md` 约定是它最强的交互杠杆：用户和项目放置 Markdown 文件，即成为一等斜杠命令，文件正文就是提示模板。[`/next-workflow` 先例](../../../../packages/workflow/next-workflow/README.md)展示了成品命令注册到 `ctx.commands` 并进入 TUI 斜杠菜单，但没有任何机制把用户编写的文件载入该注册表。

## 提案

新包 `@huiliyi37/dsh-command-files`，位于 `packages/interaction/command-files/`，加载用户与项目编写的命令文件，并按照[插件命令注册契约](../../implemented/feature/2026-07-19-plugin-command-registration.md)把每个文件注册为人类命令。挂载为 opt-in，出厂默认不包含该包。

### 文件布局与命名

加载器扫描 `$DSH_HOME/commands/**/*.md`（用户层）和 `.dsh/commands/**/*.md`（项目层），先合并用户文件、后合并项目文件。命令名是小写文件名 stem，嵌套目录层级用 `-` 拍平（`git/log.md` 变为 `git-log`），因为 `parseCommand` 只接受小写字母开头、随后是字母、数字、`_` 和 `-`。数字开头的 stem 在装载时 fail loud。同一层内的重名在装载时 fail loud；同名时项目文件确定性地遮蔽用户文件。

### 文件格式

每个文件以 YAML frontmatter 块开头，随后是模板正文：

- `description`（必填）——命令面板展示的单行描述。
- `images`（布尔，默认 `false`）——调用是否可携带编辑器图片附件，与注册表的 `input.images` 声明对齐。

正文是提示模板。`$ARGUMENTS` 展开为命令名之后的完整原始输入；`$1` 到 `$9` 展开为按空白切分的位置参数。未定义的 `$x` 序列原样透传，空模板在执行时报错。

### 派发

每个文件注册一条命令，其 handler 渲染模板后以 `createUserMessage` 包裹渲染文本 steer 接收 agent，与 [`/plan` 使用的 steer 模式](../../../../packages/plan/plan-mode/README.md)相同。无参数时模板原样发送；有参数时应用展开。handler 返回成功回显，`recordInput` 保持默认 `true`，因此 `command/run` 审计原始输入，而展开后的消息成为本包所有的模型可见内容。注册表的图片强制机制已经拒绝非声明命令携带附件，声明命令则收到冻结块并自行决定用法。

### 注册生命周期

加载器在插件装载时扫描，并把发现的每条命令注册到 `ctx.commands`；`commands/change` 观察者刷新活跃适配器。TUI 只消费自己的 `tui.commands` facet、从不消费 `ctx.commands`，因此加载器在该 facet 被组合时也注入它，并为每条命令注册一个调用 `ctx.commands.execute` 的转发壳——正是 [`/next-workflow` 的模式](../../../../packages/workflow/next-workflow/README.md)。文件监听与重扫推迟（见下文风险）。

### 作用域

命令文件全局注册。agent 级命令文件推迟：subagent 与路由拥有自己的档案，文件驱动的 per-agent 遮蔽会在没有明确消费者的情况下增加第二事实源。

## 备选方案

### 为什么不只做 TUI 级命令文件？

在 `packages/tui` 内加载文件只能触达终端面，而注册表本就让一次注册服务于所有命令适配器，包括 Web 客户端。harness 级加载器成本相同，且不损失任何面。

### 为什么不用可执行的 JS/TS 命令文件？

Claude Code 的命令文件是惰性模板。执行用户编写的代码会在装载时授予任意进程访问权，并引入模块加载、热重载与信任决策；模板保持能力的惰性与可审计性。

### 为什么不复用 skill 加载器？

skill 是面向模型侧的渐进式指令披露，命令则是带 `command/run`/`command/done` 生命周期的人类派发面。两面差异足够大，共用加载器会扭曲两份契约。

## 验收标准

- 真实装配 e2e 启动一份测试专用 `cordis.yml` fixture，挂载该包与一个命令文件，驱动该命令，并断言 `command/run`/`command/done` 对、审计载荷以及 handler steer 出的模型可见 `user/message`。
- keyless 快照锁定模板渲染，覆盖 `$ARGUMENTS`、`$1` 到 `$9`，以及未定义 `$x` 的原样透传。
- 失败路径证明响亮：同层重复 stem、缺失 description、空模板分别在测试中 fail。
- HMR 安全测试销毁插件 fiber 并观察到命令移除。
- 双语 README 对与包 invariant（已注册命令名等于所发现文件集）随包交付；本笔记随落地提交移入 `implemented/`。

## 风险

- 首版不做文件监听：用户重启才能载入新命令文件，命令面板列表缓解发现摩擦。
- 模板输出会成为用户消息；这与直接输入消息的信任级别一致，frontmatter 让附件准入保持显式。
- `-` 拍平命名可能冲突（`a-b.md` 对 `a/b.md`）；重名检查 fail loud 而非静默遮蔽。

## 实现修订（2026-08-23）

已在工作区实现为 `packages/interaction/command-files`，含以下经代码核查的修正：

- 注册中心无法在同层内遮蔽——同名注册直接抛错（`scope/src/store.ts`）。去重改由 loader 自行完成：先收集用户层条目、项目层覆盖，仅注册胜者。
- `/next-workflow` 先例实为双注册：TUI 斜杠菜单的数据源是 `tui.commands` facet 而非 `ctx.commands`。loader 将发现的每个命令镜像进 `tui.commands`。
- 注册中心命令名首字符必须是字母（`/^[a-z][a-z0-9_-]*$/u`），数字/下划线开头的 stem 在加载期 fail loud。
- `$DSH_HOME` 默认解析为 `~/.dsh-tianshu`；两个命令目录是其与 `.dsh/` 下的新约定。
- keyless PTY 快照延后；模板渲染由单测逐字钉住。
