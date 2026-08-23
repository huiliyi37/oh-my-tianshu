# Agent Note: 提示词段落随工具面收窄，武装容忍未填满的注册表

Status: implemented

[English](2026-08-23-zen-section-pruning-deferred-arming.md) | 中文

## 问题

zen 阶段的两个相关缺陷——最初随被回退的 `5e5804baec` 一并发货，此次在不带该提交工具面收窄的前提下恢复（见[回退 note](2026-08-23-zen-face-narrowing-reverted.md)）。

收窄工具 face 时系统提示词原封不动，于是 harness 发出的请求自己跟自己打架。工具插件把自己的指引注册成工具旁边的 `tool:<name>` 段落，而 `read` 的段落写的是：「Use the read tool — not shell commands like cat — to inspect text files.」TUI 的 `promoteDeny` 在晋升后把 `read` 从父级 face 上拿掉。于是每个晋升后的请求都在命令模型去调一个根本跑不了的工具，同时禁掉它仅剩的那个替代品。在一段已记录的会话里，模型在 zen 阶段调了两次 `read`（guard 用锁定工具的消息作答），晋升之后又调了两次——这时 `restrict({ deny })` 已经把 `read` 从作用域的视野里彻底移除，派发返回 `unknown tool "read"`，而这条消息没有点名任何替代品，所以晋升后的失败在模型看来比 zen 阶段那次*更糟*。四次失败调用，全部由提示词挑起。这个阶段本就知道有这个隐患，而它当初的回应是再加一段文字——`Zen-phase callable tools:` 清单行——清单赢不了跟祈使句的争论。

其二，`tools.restrict()` 拿当时已注册的工具校验名字，而 `agent/created` 跑在注入了服务的插件之前——`tool-bash` 等 bash 执行器、`tool-fs-search` 等 `subprocess` 要等服务落位才注册工具（一次探测观察到约 350 ms 的差）。在这个窗口内武装或晋升，会以 `tools.restrict() names unknown global tools …` 否决 agent 创建：一次启动竞态而非配置错误，决定了一个会话能不能挂上。

## 决策

**每次组装都会丢弃这样的 `tool:<name>` 段落：它点名的工具不在本次组装自己的工具列表里。**这条规则以组装为准，而不以任何配置为准，因此一个过滤器就同时覆盖 zen 允许列表、`promoteDeny` 和 subagent 工具过滤，也不必在拒绝列表旁边另外维护一份名单。`packages/guard/zen/src/tool-sections.ts` 里的 `stripUnbackedToolSections` 是那个纯函数；`ZenPhaseService` 把它装在 `system-prompt/assemble` 上，从 `assembled.tools` 取可见的名字，并通过 `ctx.tools.get` 检验是否已注册。后缀没有点名任何已注册工具的段落，记录的是一个家族——`tool:tasks` 覆盖 `task_output`、`task_kill` 和 `task_list`——这类段落予以保留：只有拥有它的插件才知道剩下的工具是否还撑得住那段文字。

**武装能容忍尚未填满的注册表。**`armRestrict` 只在注册表当下已有的配置名字子集上安装限制——严格窄于配置值，不漏工具——并把余下部分记为 install 上的 `pending` 债务。`completeArm` 在首个 per-agent seam（`agent/inbox/inserted`，以及对不经 inbox 就直接走到步骤的会话再加 `agent/pre-step`）把整份列表重新武装，因此首次组装就已携带补全的 face，`request/header` 仍是忠实记录。到那时仍无人注册的名字是配置错误，经 `agent/pre-step` 瀑布大声失败——失败从创建否决改成了步骤拒绝，旧的 `assertPromoteDenyRegistered` 创建时检查随之删除。发货的 face 组合不变：TUI 保持 `face: [bash, str_replace_editor, todo_write, subagent]` 与 `promoteDeny: BASH_OVERLAP_TOOLS`。

锚定拒绝消息点名部署自己的 face，而不是固定示例 `bash ls / cat / git status`——部署的 face 一旦不含 `bash`，那个示例就会变成过滤器所要清除的同款悬空推荐。

## 考虑过的替代方案

**把这条不变量修在 `core/system-prompt` 而不是 zen 里。**「一次组装不得宣传自己并不携带的工具」是提示词注册表的性质，放在 core 的过滤器还能覆盖那些不挂载 zen 也要收窄的部署。否决它是因为影响面太大：`tool:` 前缀是个没有任何 core 类型声明的约定，而 `assemble()` 里的无条件过滤会一次性改掉每个部署的提示词。zen 才是拥有 face 收窄的那个包，且本就挂在瀑布上；如果哪天出现第二个不带 zen 的 face 收窄消费方，这个过滤器再往下沉。

**保留这些段落，再补更多反向文字。**`Zen-phase callable tools:` 那一行做的正是这件事，而四次失败调用就是它效果的度量。用指引去顶撞指引，替代不了把错的那段指引删掉。

**保留创建时否决（此前的武装方式）。**在 `agent/created` 同步抛错能让创建大声失败——对真正的配置错误这是正确的形状，对尚未填满的注册表则是错误的：否决分不清拼错的 face 和仍在等服务的插件，于是一次竞态就能否决合法会话。让前门改为等待每个工具插件注入的服务，会把会话创建耦合进插件内部；武装注册表已有的子集不需要这种耦合——它严格窄于配置值，而且只要日志仍是 zen，guard 依旧锁住 face 之外的工具。

**懒补全、永不失败。**等注册表落定后无声地放宽到配置值，会把真正的配置错误永远藏起来。保留 pending 债务代价极低，而 pre-step 失败损失的只是这个会话而不是进程，所以「大声」什么也不亏。

## 测试

- `packages/guard/zen/tests/zen.spec.ts`——`stripUnbackedToolSections` 的三种情形：已注册但不在 face 上的工具被丢弃；face 上带齐了每个有段落记录的工具时段落一个不删；不点名任何工具的家族后缀予以保留。
- `packages/guard/zen/tests/integration.spec.ts`——脚本化循环注册 `tool:probe`、`tool:hammer` 和 `tool:family`，随后断言 hammer 的指引在 zen 阶段请求（允许列表收窄）和晋升后请求（`promoteDeny` 收窄）里都不出现，而注册目录中仍然有 `hammer`；晚注册的 face 工具完整地抵达第一条 `request/header`；face 含永不注册的名字时请求从未抵达模型（pre-step 瀑布持续拒绝）；`promoteDeny` 含未注册名字时在 `/fast` 安装拒绝列表的那一刻大声失败。

## 后果

- 被 face 藏起来的工具不再花任何提示词 token：隐藏一个工具是一次完整的操作，而不再只做了一半。桥接默认路径同样受益——对齐会话经 resume 分支携带 `promoteDeny`，它的组装同样裁剪这些段落。
- 剪除以名字为准，不以语义为准。顺带提到别家插件工具的段落仍会带着它那句陈旧的话发出去；同时覆盖一个存活工具和一个隐藏工具的家族段落，会把隐藏那个的文字留下来。要堵上这些，需要拥有段落的插件把段落拆开，或者让文字随 face 变化（已记入包 README 的已知限制）。
- 配置错误的失败时机变了：`face` 或 `promoteDeny` 里拼错的名字不再让 `agents.create` 失败，而是经 `agent/pre-step` 瀑布拒绝第一个步骤。会话存在，全程持收窄后的子集，且从未抵达模型。
- 回退 note 恢复的两个缺陷段落（间歇性 `restrict()` 失败与悬空指引）由本次改动关闭；那篇 note 维持回退的工具面收窄继续保持回退。

## 相关

- [zen 阶段 Agent Note](../architecture/2026-08-17-zen-phase-engineering-paradigm.md) 拥有阶段本身。
- [zen 工具面收窄回退](2026-08-23-zen-face-narrowing-reverted.md) 记录了配套工具面收窄为何维持回退，以及未来任何收窄必须满足的度量纪律。
- [直连进禅](../feature/2026-08-22-zen-direct-entry-fast-skip.md) 拥有延迟武装测试所经行的 `/fast` 跳过。
