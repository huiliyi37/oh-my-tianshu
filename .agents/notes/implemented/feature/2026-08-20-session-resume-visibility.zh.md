# Agent Note：会话恢复可见性链路

Status: implemented

[English](2026-08-20-session-resume-visibility.md) | 中文

## 问题

会话恢复没有任何用户可见信号：冷启动静默新建、恢复回放静默、崩溃修复把合成闭合事件写进模型上下文却零提示、命令行无法按 id 指定会话。发现 → 选择 → 恢复 → 结果 的每一环都不可见。

## 决策

TUI 与 CLI 现在让全链路可见（路线图 docs/dsh-session-resume-roadmap.zh.md，Phase 1–3）：

- 冷启动在欢迎区渲染可恢复会话编号列表（标题 · 年龄 · cwd）；欢迎阶段内数字键 1–9 直达对应会话。阶段在列表渲染后开始，在首次输入字符、会话切换或提交时结束——之后数字键永不劫持打字。冷启动默认（新建 vs 自动恢复）保持新建：路线图的决策点后置，列表只补可见性。
- 恢复挂载输出横幅（标题 · 最后活动 · cwd）与回放末尾的「上次进行到此处」分隔；新会话两者都不渲染。
- 崩溃修复告知以持久化的 `turn/end { reason: { kind: 'interrupted' } }` 标记为权威信号：repair.ts 是唯一生产者、loop 永不发出，且 closers 永远追加在日志尾部，因此只看**最后一个** turn/end——修复后用户又完成了新回合（尾部非 interrupted）就不再提示，标记永久留在日志也不会让之后的恢复误报「上次被中断」。不新增会话事件、不触碰持久化/loop 写路径。
- `dsh tui --session <id>` 与 `dsh run --session <id> "task"` 恢复指定会话（tui 经 cmdlineArgs 转发、headless 走 resume 工厂）；未知 id fails loud 并给恢复指引，headless 绝不静默回退新建。
- `/resume [id]` 与 Ctrl+S、欢迎页列表共享 listSessions 数据源；会话选择器行改用可恢复摘要（替代裸 UUID）。chrome 段会话 tab 栏（数据源含全部持久化会话的短 id tab，2.3 起常显）经产品评审后移除：无意义 hex 挤占界面，带标题的切换面（/resume、Ctrl+S、欢迎页列表）已覆盖；Ctrl+X 与 Alt+数字跳转随之移除，已挂载的 side conversation 仍在 live 区会话行（renderSessionTabs，≥2 个 mounted 会话）显示。
- 损坏的 JSONL 工件（空文件或头部不可解析）以 version -1 占位 header 保留在列表中，id 从目录名解码；列表/选择器/欢迎页标注「不可恢复」，loadHistory 上抛加载失败而非返回空日志。zstd 头帧损坏维持 fails loud（不变）。占位与同 id 有效工件无论遍历次序一律让位（占位独立收集，绝不挤占 duplicate 检测）。选中损坏行时切换在提交任何状态**之前**预检失败并回显「会话工件损坏」——应用不进入半切换状态，全部按键路径（数字键/Ctrl+S/Alt+数字/Ctrl+X/picker）失败统一回显；自动选择路径（Ctrl+S、无参 /resume、tab 栏）跳过损坏行，可见性由列表/选择器/欢迎页承载。
- 版本不符错误携带可操作指引（升级或隔离会话根目录）。
- 随机贴士池仅在存在可恢复会话且首屏列表隐藏时加入恢复条目；列表可见时 Ctrl+S tip 行去掉年龄摘要。
- 中断的 assistant 消息渲染「⚠ 输出被中断」角标；无 tool/call 配对的 TOOL_NOT_STARTED 孤儿结果渲染「未开始执行」卡片而非被丢弃。
- 配置驱动恢复路径在固定 sessionId 无工件、降级新建时输出 info 日志，可区分「已新建」与「已恢复」（后者经 agent/session-start source=resume 呈现）。

文案决策：路线图要求新增恢复文案走双语对；本仓 i18n 配对契约管辖的是文档，而 TUI 的既定约定是单一中文界面语言（仅 USAGE_TEXT 内联双语）。新增文案遵循 TUI 约定；本工作更新的每份文档都是已核验的双语对。

## 备选方案

- **为崩溃修复信号新增会话事件**对比落地的持久 `turn/end { kind: 'interrupted' }` 标记。新事件要加词汇、在持久化加载路径加发射机制、并同步 architecture 文档面——而日志已携带该事实；repair.ts 是标记的唯一生产者且类型文档钉死这一点，尾部标记以零写路径改动给出同一信号。
- **顶栏加当前会话短 id/标题段**对比先落地后移除的 chrome 会话 tab 行。tab 行把全部持久化会话列成短 id——顶栏段只会缩小而不会消除噪音；带标题的切换面（/resume、Ctrl+S、欢迎列表）回答同一问题，故产品评审选择整体移除而非搬迁。
- **冷启动默认恢复最近会话**对比落地的保持新建默认。路线图把该产品决策后置；编号列表只补可见性、不改默认行为，决策落定时改动仍可逆。

## 代价与收益

买到：发现 → 选择 → 恢复 → 结果链的每一环都有可见信号（冷启动编号列表、恢复横幅、历史结束分隔、崩溃告知、损坏行标注、版本错误指引）；失败绝不留下半切换的应用；尾部标记语义让之后的恢复不再有陈旧崩溃误报。

代价：TUI 文案按本仓 TUI 约定保持单语中文（仅 USAGE_TEXT 内联双语），新增界面不随文档语料库本地化；损坏工件保留为「不可恢复」行而不清理（设计上取可见性不取卫生）；冷启动默认仍是新建——有历史的用户需主动恢复。

## 验证

- 纯投影：formatRestorablePickerList、损坏行格式、wasCrashRepaired（尾部标记语义）、中断 transcript 行、孤儿工具行（restore-session / transcript / render specs）。
- 应用层：欢迎列表 + 数字键 + 阶段退出、恢复横幅/分隔/崩溃告知、--session attach（已知/未知/损坏 id）、选择器摘要行、tab 栏移除回归（无短 id tab 行，Ctrl+X/Alt+数字回归输入行）、tips 动态、切换失败安全（损坏行/恢复被拒不提交半切换状态、Ctrl+S 跳过损坏行）（app.spec）。
- 后端：JSONL list 保留损坏工件为 version -1 并解码 id（含同 id 占位与有效工件的次序无关让位、占位去重）；coordinator 版本错误带指引（jsonl.spec / coordinator-contract）。
- CLI：run/tui --session 解析与转发（args.spec）、headless resume 工厂 + 未知 id 指引（headless.spec）。
- agent-loop：配置驱动降级输出信号日志（config-session-id.spec）。
