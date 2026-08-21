# Agent Note: 上游 v0.1.1-rc.1 后续移植——投影分离、blank 默认刷新、subagent 头部切换器

Status: proposed

[English](2026-08-21-upstream-rc1-followup-ports.md) | 中文

## 问题

[v0.1.1-rc.1 移植](../../implemented/feature/2026-08-21-upstream-v0.1.1-rc.1-port.md)落地了凭证/授权链、视觉模型与运行时修复、Web client 波次，并有意推迟了三个移植无法机械进行的项。每一项都有真实的用户价值与已知的本地分叉；缺的是已定案的适配计划。

1. **session-projection state/view 分离。** 上游（`4c421ec882`、`9127d7e8b7`、`327b86d2ea`，设计 note `2026-08-19-session-projection-state-and-client-views`）把可合并扩展的 `SessionProjectionStateMap`（宿主 fold 状态，缓存行播种 fold 前经 `stateSchema` 校验）从既有的 `SessionProjectionMap`（client 值，`wire.viewSchema`/`wire.view`）中分离，所有单元统一 checkpoint（`persist` 选项删除），并新增 `stateOf(session, key)` 供宿主读取。本仓库仍运行在分离前的形状：一张表承担两种角色，`schema` 只校验 `view` 输出，缓存行恢复时**不校验** state——今天一行损坏的缓存就能播种 fold。
2. **permission blank 会话默认刷新。** ~~上游 `35778ec2ff`~~——**已撤销：上游在 rc.2 整体 revert 了 PR #2608**（`7ce85283b5`），`origin` 字段、blank 复用刷新与 `reuseWorkspaceBlank` 一并移除。本地保留已移植的 (a) 半（preset 本地化文案）作为有意的本地优势——上游 revert 只是因为它与 (b) 同捆，文案本地化本身不依赖 (b)。除非上游以重新设计的 (b) 回归，此项不再移植。
3. **subagent 头部切换器。** 上游 `de572dd910` + 评审修复 `5f7ac9183e`：新槽位 `conversation.session.header.lineage` 让面包屑切换器（`SubagentHeaderLineage.tsx`，约 800 行，含目录下拉）整体替换纯标题，支持兄妹/子代导航。本地 `ConversationSession.tsx:72-90` 是改动前的面包屑（仅标题按钮、无 lineage 槽），`ui-subagent` 只有目录动作与只读作曲器。

## 方案

### 项 1——投影分离：先预研，再定范围

这是唯一对本地已分叉的消费面动 seam 契约的项，因此以限时预研运行，产出是带具体步骤清单的 go/no-go。预研必须从本地代码树回答三个问题：

- **本地注册的单元里哪些是 host-only？** 枚举每个 `ProjectionDefinition`（subagent timing、subagent list identity、plan、todos、goal、session-stats、token-meter、permission、session-title），标记是否有 web client 读它的值。答案决定 `wire` 面的规模，并找出今天是否在误把内部状态送出。
- **本地缓存恢复路径与 `stateVersion` 如何交互？** `session-projection-cache` 目前信任存储行；预研要定位 `stateSchema` 校验的插入点，以及全量回退重建的代价。
- **同进程里谁在读投影状态？** TUI 的 `projectionCache`（todos/plan/goal/subagent）是同进程消费方；分离后它必须走 `stateOf` 等价读取，不付 wire 序列化成本。

若答案显示消费面与上游接近，按 rc.1 终态移植三个提交：引入 `SessionProjectionStateMap` + `stateSchema`，各单元 fold 状态迁入，快照只出 `SessionProjectionMap`，删除本地对应的 `persist` 面，`session-projection-cache` 恢复改为先校验再播种。若分叉是结构性的，回退范围只做恢复校验半面（stateSchema + 播种前校验）——拿到健壮性修复而不动契约。

### 项 2——blank 会话默认刷新：已撤销

上游在 rc.2 整体 revert 了 PR #2608（`7ce85283b5` + 快照同步 `32f3c09c26`）：`permission/preset` 的 `origin` 字段、`refreshDefaultForReuse` 与 `reuseWorkspaceBlank` 已从上游树移除。本地保留 rc.1 波次已发布的 (a) 文案本地化（它不依赖被 revert 的机制）。若上游以重新设计的刷新回归，按新设计重新评估，而非 rc.1 终态。

### 项 3——subagent 头部切换器（移植 `de572dd910` + `5f7ac9183e`）

两步协同：`ui-conversation` 增加 `conversation.session.header.lineage` 槽位，`ConversationSession` 面包屑学会让位于它（本地文件正处于上游改动前形状，diff 接近可直接应用）；`ui-subagent` 整体引入 `SubagentHeaderLineage.tsx`，适配 `@deepseek-ai`→`@huiliyi37` scope、本地 slot-catalog 与 locale 文案。评审修复提交的 trigger-ref 判空与不可见收起行为随主体一并落地，不作后续补丁。

### 顺序与依赖

项 3 → 项 1（项 2 已撤销）。项 3 加新表面、不动契约；项 1 放最后，因为其预研若发现共享投影消费方，可能重排其他工作。两者都不阻塞挂起的 llm-pi-ai 登录半面（`auth.ts`/`login.ts`）——后者等用户并行的 pi-ai vision 工作先落定。

## 否决的替代方案

**三项都随主波次机械移植。** 当时否决，现在维持：项 1 动 seam 契约，项 2 跨三包且带改名映射，项 3 是新能力——各自需要波次批量给不了的专门适配。

**整个跳过投影分离。** 否决：缓存恢复不校验是真实的健壮性缺口，宿主状态进入 wire payload 是正确性泄漏；即便预研结论是 no-go，也保留恢复校验的回退范围。

**采用上游的中间方案（`syncBlankSessionsToDefault`）。** 否决：上游自己在同一发布内取代了它；终态严格更简单。

## 验收标准

- 项 1（预研）：三个问题的书面答案 + go/no-go；go 时每个投影单元携带 `stateSchema`，损坏缓存行在播种前被拒（有测试证明损坏行回退到日志重建），快照只含 `SessionProjectionMap` 键，session-projection/-cache/subagent/plan/todo/goal 各套件保持绿。
- 项 3：带 subagent 血缘的会话在头部渲染切换器，兄妹/子代导航经下拉工作，无血缘会话显示不变的面包屑；ui-conversation 与 ui-subagent 的 client spec 绿，README 双语更新并重录。
- 每个落地项：`tsc -b` host+client 干净、oxlint 零新增、配对重录、implemented note 随同一变更归档。

## 风险

- **项 1 可能发现本地消费面比预估离上游更远**——TUI 在宿主侧读投影而 web client 读 wire 形状；若今天两者经同一张表交错，分离的爆炸半径会变大。预研先行的形态把损失封顶在时间盒内。
- **Wire 兼容**：快照收窄到 `SessionProjectionMap` 会改变 web client 的所得；任何静默依赖 host-only 键的 client 会在运行时而非编译时崩。枚举问题正为此而设。
- **项 3 与 TUI 自有表面重叠**：TUI 已用自己的方式展示委派树；web 切换器绝不能成为血缘的第二事实来源——它只渲染既有委派投影，别无其他。
- **项 2 的撤销是记录在案的，不是悄悄放弃**：保留 (a) 文案本地化是有意的分叉——上游的 revert 把 (a) 与 (b) 同捆撤回，未来上游若重新落地文案，应与本地副本去重，而非再次套用。
