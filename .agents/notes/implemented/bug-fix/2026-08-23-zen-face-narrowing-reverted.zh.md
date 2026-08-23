# Agent Note: 禅工具面收窄与其提示词裁剪整体回退

Status: implemented

[English](2026-08-23-zen-face-narrowing-reverted.md) | 中文

## 问题

一次会话向 TUI 的模型可见面发出三项耦合改动，又在一小时内把三项全部回退——因为它们所依据的证据看不见它们弄坏的那条依赖。

三项改动是：一个 `system-prompt/assemble` 过滤器，丢弃所有其工具不在本次组装 face 上的 `tool:<name>` 段落；一次延迟武装的改写，让 `tools.restrict()` 容忍尚未填满的工具注册表；以及一次工具缩减，通过停用九个插件行并把禅 face 收窄为 `[bash, read]`，把 TUI 晋升后的工具面从 32 件降到 16 件。

缩减的依据是一份调用频次普查：在 116 个已记录的会话里，那九个被停用的行合计零次调用。这份普查回答的是「模型会调用哪些工具」，却被当成回答了「这套部署可以拿掉哪些工具」——那是另一个问题，有另一种失败模式。

## 决策

三项改动在 `34f605fad5` 中全部回退。TUI patch 回到 `[bash, str_replace_editor, todo_write, subagent]` 的禅 face 配 `promoteDeny: [edit, file_info, git, glob, grep, read, write]`，九个插件行重新挂载，`packages/guard/zen/src/tool-sections.ts` 删除。

缩减被回退，是因为它弄坏了一条任何调用统计都照不到的委派路径。[`agent-definitions`](../../../../packages/subagent/agent-definitions/src/index.ts) 里内置的 `verify` 子代理角色声明 `tools: ['grep', 'read', 'glob', 'repo_graph', 'bash']`，而 `repo_graph` 由 `@huiliyi37/dsh-tool-meridian` 注册——正是被停用的行之一。那个包自己的约定写着：部署缺少其中任一名字会「fails the delegation loud through `tools.restrict()`」，所以每一次 `verify` 委派都会抛错。这个缺陷始终没在使用中暴露，因为它存活期间跑过的会话只委派给了 `explore`，而后者的允许列表点名的是 `semantic_search`——它是被拒绝而非被卸载，因此仍然注册着。

父代理从不调用的工具照样可能承重：子代理角色的允许列表、路由档位、guard 包里硬编码的工具名，都经由不在父代理日志里留下任何调用的路径触达工具。调用统计度量的是父代理的行为，对其余每一个消费方都保持沉默。

段落过滤器与延迟武装是被连带回退的，不是因为它们自身的是非。它们作为一个整体被退回，是因为回退是针对已发货的那次提交提出的，而两者都没有记录在案的缺陷。两者已于 2026-08-23 在不带缩减的前提下取回——见[提示词段落随工具面收窄，武装容忍未填满的注册表](2026-08-23-zen-section-pruning-deferred-arming.md)。

## 度量实际显示了什么

促成回退的抱怨是：这次改动碎了前缀缓存并抬高了成本。对会话库的仪器化重放不支持这个判断。

日志位于 `~/.omts/sessions`，而不是第一轮排查所看的 `~/.dsh-tianshu/sessions` 树；那里的 114 个会话文件产出 88 个可用会话、其中 85 个是 DeepSeek。按能识别生效配置的系统提示词大小给主会话分组，改动前的 DeepSeek 队列命中率为 99.7%（1239 步中 5 步重定价）、99.4%（1146 步中 7 步）、98.1%（142 步中 1 步）；改动后唯一那个 DeepSeek 主会话是 98.0%（84 步中 1 步）。改动后的会话落在既有区间之内，而它唯一那次重定价来自计划模式切换，不是工具面变化。

仪器真正查实的那个发现与本次改动无关，单独记录在[计划模式重定价缓存前缀](../../proposed/bug-fix/2026-08-23-plan-mode-reprices-the-cached-prefix.md)。

## 考虑过的替代方案

**只恢复 `tool-meridian`，其余八行继续停用。**这是针对已知缺陷的最小修复，也是最先提出的方案。它落败是因为缺陷并不专属于那一行：普查看不见任何允许列表、路由或硬编码依赖，所以那套漏掉 `repo_graph` 的推理仍然在支撑另外八项移除。只修调查恰好走到的那一处，等于把方法本身留在原地。

**保留缩减，另加一道门断言每个内置角色的允许列表都仍在挂载。**机械检查能覆盖这一类问题，而且它仍是未来任何缩减该配的伴生件。它在此处落败是因为这道门还没写、缩减剩下的收益是省 token 而非能力，而在安全门还停留在设想阶段时先发货收窄的工具面，把顺序颠倒了。

**保留段落过滤器与延迟武装，只回退缩减。**就事论事这是站得住的——两者都针对有记录的缺陷，也都不依赖缩减。它落败于「还原回改之前的版本」这条明确指令，以及一个事实：部分回退会留下一条提交信息，描述的工作只有一部分还在。取回它们只需一次 cherry-pick。

## 后果

`verify` 角色恢复正常，模型晋升后的工具面回到 32 件，包括 `repo_graph`、`semantic_search`、记忆类工具与会话查询类工具。

回退也把一个已知崩溃带了回来，该崩溃已由[取回改动](2026-08-23-zen-section-pruning-deferred-arming.md)关闭。`tools.restrict()` 按它运行那一刻已注册的工具校验名字，而 TUI 的前门在注入了服务的插件——bash 执行器背后的 `tool-bash`、`subprocess` 背后的 `tool-fs-search`——完成注册之前就抵达了 `agent/created`。一次探针运行观察到 `bash`、`glob`、`grep` 比 `str_replace_editor` 与 `read` 晚约 350 毫秒到达。`glob` 与 `grep` 回到 `promoteDeny` 之后，晋升因此可能以 `tools.restrict() names unknown global tools "glob", "grep"` 失败——这正是当初促成延迟武装那项工作的那次失败。取回后的武装只取注册表已有的子集，并在首个 per-agent seam 补齐整份列表，竞态因此不再能否决会话。

悬空指引的缺陷也一并回来，并由同一改动关闭：晋升后的工具面拒绝 `edit`、`write`、`glob`、`grep`、`git`，而它们的 `tool:<name>` 段落仍留在组装里，于是提示词继续让模型优先用 `read` 而不是 `cat`、用 `glob` 而不是 shell `find`、用 `grep` 而不是 `rg`，而这些工具一个都调不到。现在每次组装都会丢弃工具不在本次组装 face 上的 `tool:<name>` 段落。

`agent-router` 保留它 `run_tests` 与 `related_tests` 的 `VERIFICATION_TOOLS` 集合；`tool-run-tests` 重新挂载后这两件可调用，因此验证缺口信号是有意义的，而不是恒为真。

未来任何缩减都需要一件读消费方而非读调用的仪器：子代理允许列表、路由档位、guard 包里硬编码的工具名，并配一道门——挂载中的角色点名了未挂载的工具时失败。
