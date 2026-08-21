# Agent Note：自动记忆管线（回填扫描 + 全局整合）

Status: implemented

[English](2026-08-21-memory-auto-pipeline.md) | 中文

## Problem

`dsh-memory-consolidate` 只在活宿主内的会话 dispose 时抽取经验：进程在 disposal 前被杀——或插件未挂载期间结束的任何会话——永远进不了 LTM；而且没有任何东西回访累积的 `auto` 条目做跨会话去重。OpenAI 的 Codex 用两阶段记忆管线解决了这两件事（启动时 stage-1 作业从 state DB 认领过期 rollout；全局整合作业合并其输出）。天枢没有 state DB，而且这个闭环已经有一半在自己手里。

## Decision

`@huiliyi37/dsh-memory-pipeline` 以按需后台插件的形式补上缺失的两相，全部走既有接缝：

- **回填扫描**挂在首个根会话启动（防抖；可选周期重扫）：`SessionPersistence.list()` → 元数据过滤（谱系、工作区 cwd、台账状态）→ 封顶的 `inspect()` 读取 → consolidate 的成功门与抽取器（复用其导出实现；经 apply 第三参可注入）→ `memory.save(source: 'auto', sourceRefs)` → 会话水位线记入与记忆库同根的 JSON 台账（`<cwd>/.dsh/memory/pipeline/ledger.json`，带版本，原子 rename）。每个会话至多处理一次；失败按重试次数退避；闲置会话复查；过期会话终态。
- **全局整合**在某次扫描新增 ≥ `phase2MinNewEntries` 后运行：一次有界 LLM 调用对重复 `auto` 条目分组；每组保存一条 canonical 条目并删除被吸收 id（对照输入快照校验）。解析失败在任何写入前放弃。
- 作业注册到 `ctx.tasks`（kind `memory-pipeline`），未挂载时降级内联执行；一切决策 log-only，请求路径零接触。

跨进程协调是台账里的建议性租约加过期接管——不是 state-DB 式认领协议——因为记忆库自身已假设每工作区单写者；台账只是延伸同一边界，而不是发明接缝本就兑现不了的更强承诺。误配置加载即 fail loud（路由半对无论启用态都拒绝；`'llm'` 的路由要求只在启用态生效，缺省关闭的配置保持可装配）。不进任何发货组合，与 [STM 快照 Note](2026-08-18-adaptive-memory-stm.md) 拒绝未校准产品默认的立场一致。

## Alternatives considered

**照搬 Codex 的 state-DB 认领协议。** 拒绝：那会在记忆库旁边引入第二个持久存储；文件台账继承记忆库自身的单进程假设，而不是发明一个接缝本来就无法兑现的更强保证。

**保留溯源的合并。** 现阶段拒绝：`MemoryEntry` 不暴露结构化字段，canonical 条目无法携带被吸收条目的 source refs，除非拓宽接缝；SQLite 的 tombstone 事件保留了审计链，Markdown provider 本就没有历史可丢。

**重处理增长过的会话。** 拒绝：活会话 disposal 归 `dsh-memory-consolidate`；对增长过的日志重新抽取会在 LLM 路径上产生重复候选——同内容幂等在那里并不成立。

## Consequences

选择接入的宿主获得：历史会话的防崩溃记忆覆盖 + 去重后的长期事实，请求路径零开销，作业在 `/tasks` 可见可取消。管线从不调用 `retireStale`——退役节奏仍归 `dsh-memory-consolidate` 所有。覆盖：`packages/memory/memory-pipeline/tests/*.spec.ts`（台账加载/租约语义、资格窗口、失败退避、探针式冲突标记、整合解析/应用守卫、fail-loud 配置矩阵、经 JSONL 持久化 + Markdown 库的真装配回填及幂等二次运行）。
