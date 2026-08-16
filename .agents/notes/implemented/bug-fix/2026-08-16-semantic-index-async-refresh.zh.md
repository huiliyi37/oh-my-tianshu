# Agent Note: 语义索引刷新跑进 prompt 组装，冻结 TUI 提交路径

Status: implemented

[English](2026-08-16-semantic-index-async-refresh.md) | 中文

## Problem

在 TUI 里提交消息后，输入框与 live 区其余内容会消失数秒，spinner 才出现。用真实 `tui` profile 组合（仅禁用 TUI 渲染行，其余照常装载）的探针实测：`agent.followup()` 同步返回耗时 **1242–5107ms**；只禁用 `tool-semantic-search` 后降到 **18.5ms**。机制是：`handleSubmit` 在驱动 agent 前先用 `live.clearForCommit()` 整体擦除 live 区，`followup()` 返回后才重绘；而 `followup()` 的同步前缀（`turn()` → `preStep()` → `systemPrompt.assemble()`）会内联执行每个动态上下文提供者。`semantic:index` 提供者调用 `index.isStale()`，过期时再调 `index.incrementalUpdate()`——在调用者栈上同步完成全工作区走查加逐文件重哈希（本仓库：可见 10,440 个源文件、索引 500 个、快照约 2.4MB），且 30 秒判定 TTL 会在整个会话中反复触发。同一同步管线也运行在 `semantic_search` 工具的 `execute()` 里，回合中途冻结 UI。

## Decision

两层，先根治。

根治在 `dsh-semantic-index`：全部文件系统走查与快照写盘改走 `node:fs/promises`（`rebuild`、陈旧扫描、`incrementalUpdate`、`persistMeta`、`persistVectors`），变异 API 收敛为唯一公开的**单飞**入口 `refresh(): Promise<RefreshOutcome>`（`{ stale, reindexed, removed, fallbackRebuild }`）——并发调用共享同一在途 pass，不再竞态重复扫描；`isStale`/`incrementalUpdate`/`persistMeta` 转为私有；构造期快照加载保持同步（各有一次有界读取，且先于任何异步调用者）。`dsh-tool-semantic-search` 中，`renderIndexSummary` 只渲染内存态（不做陈旧检查——摘要可滞后于磁盘直到下次刷新），`execute()` 改为 `await index.refresh()`，插件 apply 触发后台预热 `refresh()`，让首份摘要接近旧方案的新鲜度且不阻塞任何路径。

防御层在 TUI（`packages/tui/tui/src/ui/app.ts`）：`handleSubmit` 与 `handleSteer` 在提交用户气泡之后、调用 `followup`/`steer` **之前**，同步画一帧（`flushLiveRender()`）——未来驱动前缀里再出现同步阻塞，最多冻结 UI，绝不会再吞掉输入框。不变量：`commitToScrollback` 清除 chrome 之后，只允许出现已画的帧或已完成的驱动。

同一组合修复后实测：`followup()` 同步返回 **43.0 / 6.8 / 2.7ms**（三条提交，首条含工具 schema 组装预热），`tool-semantic-search` 仍装载。

## Alternatives considered

**保留组装期刷新、只加大缓存。** 否决：任何 TTL 窗口都会在会话中反复阻塞，且阻塞时长随工作区规模增长——提供者形态本身才是缺陷。

**把索引工作移入 worker 线程。** 暂否：成本是 IO 等待而非 CPU（阻塞期的 CPU profile 几乎为零 JS 时间），`fs/promises` 即可消除事件循环阻塞，无需引入线程生命周期、序列化或拆除面；≤500 文件的分块/BM25 留在主线程且有界。

**用文件系统 watcher 刷新摘要。** 否决：为一条 diff 注入的 ~1KB 上下文行引入 watcher 生命周期与抖动不值当；挂载预热加每次执行前刷新对该表面足够。

**只修 TUI（先画帧再驱动，不动索引）。** 否决为唯一手段：输入框回来了，但事件循环仍全程冻结——spinner 不动、按键无响应、首 token 延迟照旧——时长等于整次扫描。

## Consequences

prompt 组装不再经由此插件触碰文件系统，`semantic_search` 扫描不再阻塞事件循环（冷工作区首次搜索的墙钟时间仍在，已写入包 README）。`semantic:index` 摘要在两次刷新之间可能滞后于磁盘；runtime-context 内容 diff 仍只在真实变化时注入，前缀缓存字节稳定性不受影响（摘要文本仍是索引状态的纯函数）。索引公开 API 收敛为 `refresh()`/`rebuild()` 加读取面——调用者无法再触达阻塞式扫描。测试覆盖：异步 IO 契约（`refresh()` 前调度的 macrotask 先于其结束运行）、单飞共享、原先经 `isStale` 断言的编辑/新增/删除/回退结果、摘要零 IO 渲染（删光工作区文件也不改变摘要）、以及 TUI 顺序回归（`followup` 触发前 chrome 已画好）。TUI 的先画帧后驱动也让所有其他 pre-step 监听者对未来同步工作获得同一加固。
