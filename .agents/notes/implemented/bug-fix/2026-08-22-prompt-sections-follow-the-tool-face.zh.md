# Agent Note: 组装后的提示词绝不宣传 face 之外的工具

Status: implemented

[English](2026-08-22-prompt-sections-follow-the-tool-face.md) | 中文

## 问题

收窄工具 face 时系统提示词原封不动，于是 harness 发出的请求自己跟自己打架。工具插件把自己的指引注册成工具旁边的 `tool:<name>` 段落，而 `read` 的段落写的是：「Use the read tool — not shell commands like cat — to inspect text files.」TUI 的 `promoteDeny` 把 `read` 从父级 face 上拿掉了。于是每个晋升后的请求都在命令模型去调一个根本跑不了的工具，同时禁掉它仅剩的那个替代品。

模型的行为没有错，却照样输了。在一次真实会话里，它在 zen 阶段调了两次 `read`（guard 用锁定工具的消息作答），晋升之后又调了两次——这时 `restrict({ deny })` 已经把 `read` 从作用域的视野里彻底移除，派发返回 `unknown tool "read"`，而这条消息没有点名任何替代品，所以晋升后的失败在模型看来比 zen 阶段那次*更糟*。直到这时它才退回 `str_replace_editor` 的 view 命令。四次失败调用，全部由提示词挑起。

这个矛盾不是偶然。那次会话最后一条 `request/header` 里，face 带着 32 个工具，`read`、`write`、`edit`、`grep`、`glob`、`git` 一个都不在其中；而同一请求的系统提示词却在六个段落里花掉约 388 个 token，点名的正是这些工具——其中三段是连 shell 路径也一并禁掉的祈使句（`not shell commands like cat`、`not shell find`、`not shell grep or rg`）。zen 阶段还要更糟：5 个工具的 face，旁边配着教 `memory_search`、`memory_save`、`memory_deep_recall`、ralph 和 goal 工具的文字。

这个阶段本就知道有这个隐患，而它当初的回应是再加一段文字：在策略段落后面追加一行 `Zen-phase callable tools:` 清单，本意是不让模型去够 face 已经拿掉的工具。清单赢不了跟祈使句的争论，事实也确实没赢。

## 决策

每次组装都会丢弃这样的 `tool:<name>` 段落：它点名的工具不在本次组装自己的工具列表里。这条规则以组装为准，而不以任何配置为准，因此一个过滤器就同时覆盖 zen 允许列表、`promoteDeny` 和 subagent 工具过滤，也不必在拒绝列表旁边另外维护一份名单。`packages/guard/zen/src/tool-sections.ts` 里的 `stripUnbackedToolSections` 是那个纯函数；`ZenPhaseService` 把它装在 `system-prompt/assemble` 上，从 `assembled.tools` 取可见的名字，并通过 `ctx.tools.get` 检验是否已注册。

后缀没有点名任何已注册工具的段落，记录的是一个家族——`tool:tasks` 覆盖 `task_output`、`task_kill` 和 `task_list`——这类段落予以保留。只有拥有它的插件才知道剩下的工具是否还撑得住那段文字，所以过滤器拒绝去猜。

zen face 改成了 `[bash, read]`——既能发现又能验证的最小组合。`read` 正是出厂的 `tool:read` 段落让模型优先于 `cat` 使用的那个工具，因此提示词与 face 从第一次请求起就在读文件这条路径上一致，而不是互相顶撞；`bash` 覆盖其余一切只读查证（`ls`、`git status`、`rg`），且不必再加一份 schema。两者都不写盘，于是「锚定之前不做修改」从一条模型可以无视的指令，变成 face 本身的性质。`read` 因此退出 `promoteDeny`，这也是 `resolveConfig` 的硬性要求——同一个名字同时出现在两份列表里，会在插件加载时失败。

锚定拒绝消息点名的是部署自己的 face，而不是固定示例 `bash ls / cat / git status`；否则 `bash` 一离开 face，那个示例马上就会变成下一条悬空推荐。

晋升后的 TUI face 是 15 个工具：这套部署注册的 23 个，减去 `promoteDeny` 里的八个。九个插件行采用不挂载而非拒绝，因为不挂载会把插件的提示词段落和启动开销一起带走，而 `promoteDeny` 只是把工具从父级目录里藏起来。三个 TUI 自有行就地写上 `disabled: true`（`tool-memory`、`tool-session-query`、`tool-memory-recall`）；六个 base 自有行按 id 覆写停用（`tool-run-tests`、`tool-workflow`、`tool-ralph`、`tool-subagent-fork`、`tool-meridian`、`tool-skill`）。`interrupt_agent` 与 `semantic_search` 走拒绝而不是不挂载，因为它们各自要么与一个留下来的工具共用插件，要么仍要通过 subagent 允许列表触达。

这个组合是量出来的，不是猜出来的：在 116 个已记录的会话里，十五个不挂载的工具合计零次调用，两个被拒绝的工具合计两次。

## 考虑过的替代方案

**把这条不变量修在 `core/system-prompt` 而不是 zen 里。**「一次组装不得宣传自己并不携带的工具」这条规则是提示词注册表的性质，放在 core 的过滤器还能覆盖那些不挂载 zen 也要收窄的部署。否决它是因为影响面太大：`tool:` 前缀是个没有任何 core 类型声明的约定，而 `assemble()` 里的无条件过滤会一次性改掉每个部署的提示词。zen 才是拥有 face 收窄的那个包，而且它本就挂在 waterfall（瀑布式事件）上。如果哪天出现第二个不带 zen 的 face 收窄消费方，这个过滤器再往下沉。

**保留这些段落，再补更多反向文字。**`Zen-phase callable tools:` 那一行做的正是这件事，而四次失败调用就是它效果的度量。宽 face 上的指引替代不了更小的目录；往上一层同样成立：用指引去顶撞指引，替代不了把错的那段指引删掉。

**把官方评测配方（`bash`、`str_replace_editor`、`todo_write`）留作 zen face。**这是此前发货的默认值。它败在一致性这条论证上：`str_replace_editor` 是个能写盘的编辑器，而这个 face 的全部意义就在于锚定之前什么都写不了，于是策略段落「任何修改之前」的说法只能靠模型自觉而不是靠目录本身。`todo_write` 同样换不来锚定证据——证据门排除簿记类调用——所以它占着一个锚定这一步花不出去的 schema 位。

**face 取 `[read, write]`。**提出的理由是：这是贴合模型实际取用习惯的最小组合。否决原因是系统提示词里没有目录清单——已对照一条真实 header 核实过——因此一个没有 `glob`、`grep`、`bash` 的 face，让新建会话无从发现哪些路径存在。对猜出来的路径调 `read` 会失败，失败的调用不算锚定证据，而唯一能可靠成功的工具会是 `write`。这个阶段会退化成把四步预算烧完，然后走自动超时晋升。

**九行全走 `promoteDeny`，而不是不挂载。**拒绝会让插件为 subagent 角色保持注册，这也正是仍有两个工具走这条路的原因。但把它当作通用答案，就要为一个没人调用的工具付插件的启动开销——在这次改动之前，还得连它的提示词段落一起留着。

## 测试

- `packages/guard/zen/tests/zen.spec.ts`——`stripUnbackedToolSections` 的三种情形：已注册但不在 face 上的工具被丢弃，face 上带齐了每个有段落记录的工具时段落一个不删，不点名任何工具的家族后缀予以保留。
- `packages/guard/zen/tests/integration.spec.ts`——脚本化循环注册 `tool:probe`、`tool:hammer` 和 `tool:family`，随后断言 hammer 的指引在 zen 阶段请求（允许列表收窄）和晋升后请求（`promoteDeny` 收窄）里都不出现，而注册目录中仍然有 `hammer`。让过滤器失效，这个测试会在 zen 阶段那条断言上失败。
- `packages/tui/tui/tests/bundle-patch.spec.ts`——zen 行的 face、由 `BASH_OVERLAP_TOOLS` 派生的 `promoteDeny`、两者互不相交、三个就地停用，以及六个按 id 的覆写。每个覆写都对照 base patch 校验 id/name 配对是否仍然存活，因为 `applyEntryPatches` 匹配不到时只 warn：否则 base 改名会无声地把一个已丢弃的行重新挂回来。

## 后果

- 被 face 藏起来的工具不再花任何提示词 token，因此隐藏一个工具是一次完整的操作，而不再只做了一半。
- TUI 的第一次请求携带三份 schema 和它们的三个段落；晋升后的 face 携带 18 个。此前的形态是 5 个工具的 zen face 与 32 个的晋升 face，而两者旁边配着的指引文字，讲的都是这两个 face 都不持有的工具。
- 剪除以名字为准，不以语义为准。顺带提到别家插件工具的段落，仍会带着它那句陈旧的话发出去——ralph 段落里关于 goal 工具的建议，比不挂载的 `tool-goal` 活得更久——而同时覆盖一个存活工具和一个隐藏工具的家族段落，会把隐藏那个的文字留下来。要堵上这些，需要拥有段落的插件把段落拆开，或者让文字随 face 变化。
- `agent-router` 的 `verificationGap` 再也看不见验证了：它的 `VERIFICATION_TOOLS` 集合只装了 `run_tests` 和 `related_tests`，两者都由已不挂载的 `tool-run-tests` 注册，因此任何变更操作都会被读成缺口。影响是有界的——只是一条温和提醒，只在 subagent 结果挂起时出现，而且 TUI 让路由跑在影子模式——真正的修法是识别经 `bash` 跑出来的验证，正如 `doom-loop-guard` 的测试空转探测器已经在做的那样。声明处的一条 TODO 记下了这件事。
- 恢复任何一项被丢弃的能力，都只是在记录了它为何离开的那一行上改一行。

## 相关

- [zen 阶段 Agent Note](../architecture/2026-08-17-zen-phase-engineering-paradigm.md) 拥有阶段本身；本篇拥有提示词一致性不变量与发货的 face 组合。
