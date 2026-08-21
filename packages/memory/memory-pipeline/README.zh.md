# @huiliyi37/dsh-memory-pipeline

[English](README.md) | 中文

`memory` 服务之上的自动记忆管线：启动**回填扫描** + 可选的**全局整合**，补齐 `dsh-memory-consolidate`（活会话 disposal 即时抽取）与 `dsh-adaptive-memory`（STM 注入）留下的闭环——进程在 disposal 前死掉的历史会话在后续启动时被补抽，累积的 auto 条目被去重合并为 canonical 事实。全部是请求路径之外的后台作业；插件**缺省关闭**（`enabled: false`）。

## 行为

- **触发** — 首个根会话启动（`agent/session-start` 且 header 无 `parentSession`；与 `dsh-memory-consolidate` 相同的谱系判定，fork 与子代理会话一律不触发）经 `startDelayMs`（缺省 30 秒）防抖后调度一次扫描。`rescanIntervalMs > 0` 时宿主存活期间周期重扫。作业注册到 `ctx.tasks`（kind `memory-pipeline`，`/tasks` 可见可取消）；tasks 服务未装配时降级为内联后台执行（log-only 提示）。
- **回填扫描** — `SessionPersistence.list()` 轻量枚举持久会话；元数据过滤丢弃派生会话、他工作区会话（header `cwd` 必须等于 `workspaceCwd`，缺省取进程 cwd）、台账终态会话（`ok`/`expired`）、超过 `maxRetriesPerSession` 的失败会话。入围短名单（`scanLimit` 封顶）经 `inspect()`（不可变逻辑视图，不发布恢复）读取，先做时间窗检查（处理前须闲置 `minIdleHours`；距最后事件超过 `maxAgeDays` 即终态过期），再过 `dsh-memory-consolidate` 的成功门，用其抽取器提取——缺省启发式，或 LLM（`extractor: 'llm'`，加载时要求 `llmProvider`/`llmModel` 成对）。候选落 `global` scope、`source: 'auto'`、携带溯源（`sourceRefs` = sessionId + 事件 seq），按会话封顶。每个会话至多处理**一次**（`ok` 终态）；失败记 `failed` 并退避重试。
- **全局整合** — 某次扫描新增候选达到 `phase2MinNewEntries` 后，一次有界 LLM 调用对 `global` scope 的重复/近重复 auto 条目分组产出合并计划；每组保存一条 canonical 条目并删除被吸收 id（对照输入快照校验，幻觉 id 在任何写入前 fail loud）。解析失败在任何写入前放弃并保留 pending 计数等下次触发。退役节奏仍归 `dsh-memory-consolidate` 的 `retireStale` 所有。
- **台账** — 机器态存于 `ledgerPath`（缺省 `<cwd>/.dsh/memory/pipeline/ledger.json`，与记忆库同根）：带版本的 JSON，tmp + rename 原子写，持有逐会话水位线/结论、按作业种类的租约与 phase2 计数。租约是建议性跨进程协调，过期可接管；单进程假设与记忆库自身边界一致。损坏或未来版本的台账拒绝加载，绝不猜测修复。

全部阈值是经校验的 Config 字段（schema 缺省）；误配置（路由半对、倒置时间窗、负数上限）加载即 fail loud。全部决策 log-only——不触碰请求路径，不贡献 prompt 结构。

## Model Experience

### 间接——仅管线写入

#### What the model sees

管线运行时模型什么也看不到：扫描在任何活 turn 之外运行，只经记忆服务写入。抽取内容稍后经消费面到达模型（`memory_search` 工具结果、`dsh-adaptive-memory` 的 STM 快照）。

#### Token effect

无直接影响；消费方按各自预算渲染召回条目。可选 LLM 调用（抽取、整合）是有界离线请求（`llmMaxInputChars` / `llmMaxOutputTokens`，`llmEffort` 缺省 `off`），从不触碰活的请求路径。

#### KV Cache effect

不贡献 prompt 结构。管线产物只经消费通道进入模型可见面，绝不编辑请求前缀。

## Known Limitations and Deferred Work

- **每会话一次性** — 记为 `ok` 的会话即使之后继续增长也不会再处理；活会话抽取归 `dsh-memory-consolidate`，但跨宿主重启持续变化的会话只会被抽到最后一次重启前的形态。
- **整合丢失溯源** — 被吸收条目被删除，其 source refs 不会带入 canonical 条目（`MemoryEntry` 接缝不暴露结构化字段）；SQLite provider 留 tombstone 事件作审计链，Markdown 删除不可恢复。
- **租约仅为建议性** — 同一工作区的两个并发宿主本就不被记忆库支持；租约协调的是礼貌邻居，不是敌意并发。
- **根目录手工对齐** — 以自定义根挂载 memory provider 的宿主必须把 `ledgerPath`/`workspaceCwd` 对齐；接缝不暴露 provider 根目录。
