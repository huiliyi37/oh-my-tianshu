# Agent Note：基于文件的自定义命令

Status: implemented

[English](2026-08-23-file-based-custom-commands.md) | 中文

## 问题

Tianshu 的每条人类命令都通过[命令注册表](../../../../packages/interaction/commands/README.md)由代码注册，用户不写插件就无法扩展产品面。Claude Code 的 `.claude/commands/*.md` 约定是它最强的交互杠杆：用户和项目放置 Markdown 文件，即成为一等斜杠命令，文件正文就是提示模板。[`/next-workflow` 先例](../../../../packages/workflow/next-workflow/README.md)展示了成品命令注册到 `ctx.commands` 并进入 TUI 斜杠菜单，但没有任何机制把用户编写的文件载入该注册表。

## 决策

新包 `@huiliyi37/dsh-command-files`，位于 `packages/interaction/command-files/`，加载用户与项目编写的命令文件，并按照[插件命令注册契约](../../implemented/feature/2026-07-19-plugin-command-registration.md)把每个文件注册为人类命令。挂载为 opt-in，出厂默认不包含该包。

### 文件布局与命名

加载器扫描 `<resolveDshHome()>/commands/**/*.md`（用户层，缺省 `~/.dsh-tianshu/commands`）与 `.dsh/commands/**/*.md`（项目层），两者均可经 `Config` 覆盖，先合并用户文件、后合并项目文件。命令名是小写文件名 stem、嵌套目录层级用 `-` 拍平（`git/log.md` 变为 `git-log`），且必须满足注册表文法 `/^[a-z][a-z0-9_-]*$/u`——数字或下划线开头的 stem 在装载时 fail loud。同一层内的重名在装载时 fail loud。注册表自身无法在同层内遮蔽（同名注册直接抛错），因此跨层碰撞由加载器自行去重：先收集用户条目、项目条目覆盖，只注册胜者——同名时项目文件确定性地遮蔽用户文件。

### 文件格式

每个文件以 YAML frontmatter 块开头，随后是模板正文：

- `description`（必填）——命令面板展示的单行描述。
- `images`（布尔，默认 `false`）——调用是否可携带编辑器图片附件，与注册表的 `input.images` 声明对齐。

正文是提示模板。`$ARGUMENTS` 展开为命令名之后的完整原始输入（从不 trim）；`$1` 到 `$9` 展开为按空白切分的位置参数，缺席的位置参数原样保留。其他任何 `$x` 序列原样透传，空模板在执行时结算为错误、不 steer。

### 派发

每个文件注册一条命令，其 handler 渲染模板后以 `createUserMessage` 包裹渲染文本 steer 接收 agent。注册表自身的 `command/run`/`command/done` 生命周期审计该次调用，steer 的消息即模型可见内容——model-visible ⟺ logged 经 steer 路径成立。注册表的图片强制机制在 handler 运行前拒绝非声明命令携带附件，声明命令则收到冻结块并自行决定用法。

### 注册生命周期

加载器在插件装载时扫描，并把发现的每条命令注册到 `ctx.commands`（注册表内置自清理 effect，由 HMR 测试证明）。TUI 斜杠菜单的数据源是 `tui.commands` facet 而非 `ctx.commands`，因此加载器在该 facet 被组合时也注入它，并为每条命令注册一个调用 `ctx.commands.execute` 的转发壳——正是 [`/next-workflow` 的模式](../../../../packages/workflow/next-workflow/README.md)。无文件监听：新增或编辑命令文件重启后生效（见 README 已知局限）。

### 作用域

命令文件全局注册。agent 级命令文件推迟：subagent 与路由拥有自己的档案，文件驱动的 per-agent 遮蔽会在没有明确消费者的情况下增加第二事实源。

## 备选方案

### 为什么不只做 TUI 级命令文件？

在 `packages/tui` 内加载文件只能触达终端面，而注册表本就让一次注册服务于所有命令适配器，包括 Web 客户端。harness 级加载器成本相同，且不损失任何面。

### 为什么不做可执行的 JS/TS 命令文件？

Claude Code 的命令文件是无为模板。装载期执行用户代码等于授予任意进程访问，还拖入模块加载、热重载与信任决策；模板让能力保持惰性且可审计。

### 为什么不复用 skill 加载器？

skill 是模型侧的渐进式指令披露，命令是带 `command/run`/`command/done` 生命周期的人类派发面。两个面差异大到共用加载器会同时扭曲两份契约。

## 后果

- 真实 Loader 组合测试引导测试专用 `cordis.yml`，钉住完整路径：发现、项目遮蔽用户、经 `ctx.commands.execute` 的执行、`command/run`/`command/done` 对、steer 的用户消息、以及 TUI facet 镜像。失败用例逐一证明响亮：非法派生名、缺失 description、空模板、同层重名各有测试。
- keyless PTY 快照延后；模板渲染由单测经真实注册表路径逐字钉住。
- 首版无文件监听：用户重启加载新命令文件，命令面板列表缓解发现摩擦。
- 模板输出成为用户消息；这与直接键入该消息的信任度一致，frontmatter 让附件准入保持显式。
- 拍平的 `-` 命名可能碰撞（`a-b.md` 与 `a/b.md`）；同层重复检查 fail loud，而不是静默遮蔽。
