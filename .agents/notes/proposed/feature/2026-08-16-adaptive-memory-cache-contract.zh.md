# Agent Note: 适应性记忆——意图门控的 STM 快照、append-only LTM 与前缀缓存纪律

Status: proposed

[English](2026-08-16-adaptive-memory-cache-contract.md) | 中文

## Problem

本 harness 目前的记忆是手动工具，不是适应层。`MemoryService`(`packages/memory/memory`)只有 Markdown 存储上的 `save`/`search`/`list`/`delete`,`search()` 是子串扫描；模型必须自己想到调用 `memory_search`，任务开始时没有任何机制准备任务相关记忆。更糟的是，`tool-memory` 把最近 20 条记忆的 digest 作为 system prompt section(order 130）注入，并在每次 `memory_save` 后刷新——每次写记忆都重写请求前缀，使其后整段会话的 provider 前缀缓存作废。

Provider 前缀缓存奖励的是相反的纪律。DeepSeek 的自动磁盘缓存（命中价约为未命中的 2%）要求字节级匹配已持久化的 cache unit;Anthropic 的显式/自动断点和 OpenAI 的自动前缀匹配，都会在第一个变化字节之后全部失效。已测基线（`docs/cache-hit-baseline-20260812.md`,20 轮会话 96.8%）是在**未挂载 memory** 的组合下采集的，digest 的真实破坏从未被量化——而基线自己把 compaction 和动态上下文列为未来最大风险。

两条调研结论框定了设计。第一，长上下文窗口不是记忆替代品：召回随长度渐变劣化（RULER、NoLiMa、OpenAI 自己的 MRCR 57%@128K → 46%@1M)，且每轮重发 1M token transcript 比混合上下文贵 2–3 个数量级。1M 窗口的正确角色是偶尔的全文读者，不是工作循环。第二，注入式检索既是收益也是税：单个"话题相关但答非所问"的 distractor 就可测量地拉低输出（Chroma context-rot)，所以自动注入需要置信度门，模型需要按需通道。

## Proposal

以插件层能力建设适应性记忆，冻结通道契约：**STM（短期记忆）是在意图边界生成的"变更才追加"的快照；LTM（长期记忆）是 append-only 事件日志加物化当前视图；补充读取永远作为工具结果进入会话尾部；原始历史只由 reader subagent 读取；旧快照的清理由 compaction 负责。**

### 通道

- **负 order system prompt 段**：只放跨会话稳定内容。禁止时间戳、随机 id、git 状态、session id、按请求变化的记忆 digest。由 verify 门强制。
- **100–199 order 段**：任务级准静态内容；STM **不**走这里。
- **runtime-context 追加通道**(`ctx.systemPrompt.context()`，经 `RuntimeContextProjection` 的"变更才追加"语义）:STM 快照、环境变化提醒、动态任务上下文。内容变化的贡献追加一个新快照节点，绝不在前缀中段编辑历史。追加要付一次增量 prefill——是**零前缀失效**，不是零成本。
- **工具结果尾部**:`memory_search` 结果与 reader subagent 的蒸馏。

### STM 契约

- 由规范式（canonicalized）形态渲染：key 与 entry 顺序稳定，不含易变字段（时间戳、随机 id、访问计数）。字节相同的重渲染 ⇒ 不追加（`renderSTM(x)` 确定；`renderSTM(访问计数不同的x)` 与 `renderSTM(x)` 相等）。
- 只在意图边界刷新，由 `intentKey` + 主题分区记忆版本 + 环境纪元门控——普通追问保持 STM 字节不变。
- 携带**候选范围索引**而非全库目录：当前意图相关条目加安全/用户约束条目，每条一行（`id | 主题 | 一句摘要 | 2–5 个关键词`)，有 token 预算。
- STM 缓存按 session + intentKey 键控；检索结果缓存按 workspace + 规范化 query + scope + topicVersion + retrieverVersion 键控、跨会话共享（排除在取用侧做，不进缓存键）。workspace 域共享；user/private 域隔离；session 域不跨会话。

### LTM 契约

- **Append-only 事件日志**：所有观察、证据、矛盾都保留，永不覆盖。
- **物化当前视图**：派生的、可重建的、可更新的——每条事实携带 `validFrom`/`validTo`、`confidence`、回指 session 日志事件的 `sourceRefs`、`supersedes`，以及 `status: active | superseded | uncertain`。检索和 STM 读视图；日志保留为审计轨迹（invalidate-don't-delete，与 Graphiti 双时效窗口同构）。
- 新经验只在成功信号（测试通过/任务验证器）之后才晋升；未经验证的原始反思不晋升（Voyager 的教训）。

### 检索

- **双通道**:harness 驱动的 pre-step 检索（高置信时省一次往返）+ 模型驱动的 `memory_search`（模型自己发现缺口时的兜底）。`memory_search` 增加 `excludeIds`(STM 已加载的 id）与结果预算。
- 自动通道上的**置信度门**：高置信注入条目正文；中置信只注入索引行；低置信不注入——模型保留工具。阈值是 Config 默认值，在真实任务集上调参，不是冻结数字。
- **规则型兜底提醒**（追加式，绝不改 system prompt)：工具调用触及 STM 索引外的实体/路径、未解释的错误码、高风险动作时，向尾部追加一条"`memory_search` 可能有帮助"的提醒。
- **原始历史**（模式 C）只由 reader subagent 读取，返回固定蒸馏形态（`answer` / 带 sessionId + eventSeqs + 短引用的 `evidence[]` / `uncertainties` / `confidence`，约 1–2k token)。transcript 原文不进主上下文。
- 每个 intent 的搜索次数、单条结果 token、每轮记忆 token 总量都由 Config 限界。

### 意图状态

`{ intentId, intentKey, startedAtTurn, lastReviewedTurn, entities, topicVersions }`。STM 在以下情况刷新：intentKey 变化、相关主题版本变化、环境纪元变化、泄压阀触发（N 轮未重评估、出现新实体/路径/服务/错误码）。评估是启发式优先（新目标动词、新实体、新路径、新工具域、新错误码）；只有边界确实模糊时才咨询强模型——记忆路径默认不产生额外模型请求。

### 缓存纪律与指标

- 工具和 system prompt 在会话内字节稳定；effort/模型等旋钮只在阶段边界切换（与缓存断点天然对齐）；易变标量永不进前缀。
- 旧 STM 快照的删除由 compaction 经既有 replacement-surface 语义负责（被清除的 seq 允许重投影——即当前 `RuntimeContextProjection` 的行为）。
- 指标按阶段记录，不只看总体命中率：`promptTokens`、`cacheReadTokens`、`cacheWriteTokens`(provider 报告时）、`intentId`、`stmVersion`、`memorySearchCount`、`compactionGeneration`、`toolSchemaHash`、`systemPromptHash`。检索过程事件 **log-only**；只有 STM 快照和工具结果进入模型可见面（model-visible ⟺ logged 不变量）。
- 1M 上下文 reader 是冷路径：大语料的意图初始化、全文审计、长轨迹归纳、后台巩固。它永不参与每轮决策。

### 打包

新包 `packages/memory/adaptive-memory` 拥有意图状态、pre-step 检索和 STM 上下文贡献，挂 `agent/pre-step`——**不改 `agent-loop`**。`tool-memory` 瘦身为两个工具加静态能力说明（移除动态 digest;memory 目前不在出厂组合里，所以这是零回归）。结构化 LTM 存储在阶段二落在 `ctx.storageDomain`(SQLite/FTS，复用 `session-query` 设施）上；向量检索是后续可选 provider，走 `packages/search/semantic-index`。

### 阶段

- **阶段一——缓存安全骨架**：移除动态 digest;STM 走追加通道（intentKey/版本门控 + 规范式渲染）;`memory_search` 加 `excludeIds` 与预算；分阶段缓存指标；A–E 基线组。
- **阶段二——检索**:SQLite/FTS 结构化 LTM;BM25 + 实体 + 时间过滤；候选索引；置信度门；主题分区版本；带 `supersedes` 的物化视图。
- **阶段三——巩固**：成功门后的经验抽取；reader subagent；冲突检测与淘汰；可选向量。

## Alternatives considered

**原地替换 STM（"只保留最新节点")。** 否决：编辑前缀中段的消息会使其后整段历史缓存作废。"变更才追加"只付一次增量 prefill；旧节点清理搭 compaction 的便车，反正它要重写前缀。

**STM 走 system-prompt section。** 对 STM 否决（每次刷新从该 section 起重写前缀）;100–199 段保留给任务级准静态内容。runtime-context 追加通道提供零前缀失效的变更激活快照。

**STM 内置全库索引。** 否决：无界索引会变成另一种全文注入。候选范围、有预算的索引遵循 repo map 的教训——挂载内容必须经排序和限界，永不是目录。

**纯 ADD-only LTM、矛盾留给检索时消解（mem0 2026 方向）。** 否决作为唯一机制：没有强时序排序时模型会采样到旧事实（"PostgreSQL" vs "Neon Postgres")。事件日志 + 物化视图既保留 append-only 证据，又让当前事实确定性可检索；视图始终可从日志重建。

**每轮自动检索注入。** 否决：distractor 税（context-rot 证据）加每次刷新一次 cache write。置信度门加模型驱动工具通道以零两种代价达到同等覆盖。

**1M 窗口当工作上下文。** 否决：实测召回悬崖（MRCR、Graphwalks）加每轮 2–3 个数量级的成本。大窗口做读者和审计者，不做循环。

**在 `agent-loop` 内实现投影。** 否决：plugins-not-loop-changes。现有 `RuntimeContextProjection` 已为任何 `ctx.systemPrompt.context()` 贡献提供"变更才追加 + compaction 后重投影"语义；新包只需要拥有"STM 内容何时变化"。

## Acceptance criteria

- **基线组（A–E)**，用 `examples/headless-agent/baseline-probe.mts` 测量并在 request-cache e2e 中断言：**A** 不挂 memory——保持 96.8% 基线；**B** 挂载现有 digest——量化其真实损失；**C** STM 刷新——一次有界增量成本，允许；**D** STM 刷新后 `cacheReadTokens` 仍覆盖刷新前前缀（不得跌向零——以此区分正常增量 prefill 与错误的全历史重写）;**E** `memory_search` 后已有前缀继续命中。
- **单元测试**:`renderSTM` 确定性；相同输入不产生投影；易变字段反例（访问计数不同渲染相同）。
- **Verify 门**：负 order 段不含易变标量；工具 schema 哈希会话内稳定；STM 不经 `systemPrompt.section()` 注入；STM 只经追加投影进入 surface;`memory_search` 支持 `excludeIds`；检索事件 log-only。
- 所有预算/阈值都是带 schema 默认值的插件 Config 字段。
- 按测试政策为装配后的记忆面提供 keyless 快照覆盖；双语文档随各阶段同步落地。

## Risks

- **阶段一–二纯 BM25 召回可能不够**；向量 provider 是推迟而非取消，`semantic-index` 现成可承载。
- **intentKey 启发式可能失准**——太粘会让 STM 挨饿，太跳会损失缓存。泄压阀和主题版本限界损害；每个旋钮都是 Config 字段，待真实任务调参。
- **DeepSeek cache unit 语义**：公共前缀在 provider 持久化成 unit 之前不保证命中，冷启动读作 miss 是正常现象——不要误判为布局失败。指标按阶段拆分（而非只看总体）正是为了区分这两者。
- **置信度阈值未校准**（初始默认值是占位）；在真实任务集上调参是阶段二的收尾工作。
- **memory 默认不挂载**，阶段一的改动在组合显式挂载前不可见——A/B/C 组必须刻意挂载，digest 移除的收益也只对挂载它的组合生效。

## 阶段一实现纪要

骨架落地时与上文设计不一致的事实：

- **评估挂载点是 `system-prompt/assemble`，不是 `agent/pre-step`。** 具体 loop 先 claim 本轮 inbox 消息，随即组装 prompt 并投影运行时上下文，之后才派发 pre-step——挂在 pre-step 的评估永远赶不上当前 step 的快照。assemble 瀑布是投影之前最早的插件点；监听器评估门控并改写返回的（权威）assembly 里的 `memory:stm` 条目。
- **intent 检测滞后一轮。** 当前轮用户消息在 assembly 前已被 claim，门控要到下一轮的评估才能看到改换目标的消息；引入新 intent 的那一轮仍带着旧 intent 的 STM 运行。已记入包 README 的 Known Limitations。
- **评估节奏是每轮一次**（按会话跟踪），不是每 step 一次，`memory/cache-hit`/`memory/cache-miss` 的日志量以轮数为界。
- **tool-memory 的 digest 保留为调试开关**（`digest`，schema 缺省关），供缓存对比臂使用，而非删除整套机制；静态指引 section 是默认形态。
- **A–E 基线臂与 request-cache e2e 不在阶段一的代码交付内**；随单独跟踪的 baseline probe 工作落地。

## 阶段一验收（2026-08-16）

A–E 验收面以"就绪待跑"形态落地；数字于次日（2026-08-17，真实 DeepSeek provider）采集：**A 96.8%（参照复现）· B 90.7%(digest 损失 −6.1 个百分点，未缓存输入约为 A 的 3–4 倍，每次 digest 刷新尖峰 3–5k token)· C 96.7%(STM，在 A 的噪声内；刷新增量 195–588 token)· D/E 3/3 通过**——逐轮数据见 `docs/cache-hit-baseline-adaptive-memory-20260816.md`。harness 事实：

- **臂 A/B/C**：`examples/headless-agent/baseline-probe.mts` 新增 `arm` 参数（A：不挂 memory，缺省；B：挂 `dsh-memory` + `dsh-tool-memory` 且 `digest: true`；C：再加 `dsh-adaptive-memory`）。B/C 在会话前预置两条任务相关条目，并在第 5/10/15 轮后再写入一条——B 经 `memory_save` 工具（触发被测的 digest 刷新），C 直接写 store（触发 STM `topic-version` 刷新）。无 key 时探针打印 `skipped` 并以 0 退出；B/C 的组合接线（插件挂载、轮间写入、逐轮循环）已做 keyless 冒烟验证。结果待有 key 的机器采集后写入 `docs/cache-hit-baseline-adaptive-memory-20260816.md`。
- **臂 D/E**：key-gated 真实 API 断言，落在 `packages/memory/adaptive-memory/tests/request-cache.e2e.ts`——记忆包同侧的 e2e，因为 `cacheReadTokens` 只有真实 provider 上报，且 `agent-loop` 不应依赖记忆包。D 断言 STM 刷新后的请求仍覆盖刷新前 prompt 的 ≥90%（并先断言 `memory/cache-miss` 原因序列，覆盖检查不为空转）；E 断言 `memory_search` 工具调用前后的同等覆盖。两者无 key 自动跳过；同文件的 keyless ScriptedAdapter 接线冒烟验证组合并通过。
- **注册缺口已补**：`packages/memory` 组此前不在 `tsconfig.base.json` 的两条 paths 通配里，测试经构建产物 `lib/` 而非 `src` 解析记忆包；两条通配现已包含该组。

## 阶段二a 实现纪要

结构化存储（`packages/memory/memory-sqlite`）落地时与上文设计不一致的事实：

- **存储是独立 SQLite 数据库，不走 `ctx.storageDomain`。** 打包一节草拟的是"落在 `ctx.storageDomain` 上（SQLite/FTS，复用 `session-query` 设施）"。`storageDomain` 是类型化 KV 抽象，没有 FTS5 和 join，所以 provider 打开专用数据库（缺省 `<root>/.dsh/memory/ltm.sqlite`），打开/校验纪律仿 `session-query-sqlite`（application id、owner-only 建库、WAL）。旧 schema 版本 fail loud 拒绝而非原地重置——本存储是主存储，不是派生索引。
- **`@huiliyi37/dsh-memory` 的 seam 扩展。** `save` 接受可选结构化字段（`kind`/`topic`/`entities`/`confidence`/`fact`/`sourceRefs`）；`search` 接受 `entities`/`topic` 精确过滤并返回带可选归一化 `score` 的 `MemorySearchResult`；`topicVersions()` 是可选能力，消费方以 `typeof memory.topicVersions === 'function'` 探测（Markdown provider 不实现）。非结构化保存以条目 id 派生 `subject`，带 id 更新与结构化同对写入共享同一条 supersede 路径。
- **事件种类新增 `tombstone`**（契约列的是 fact/experience/observation），让 `delete` 与 markdown 移除能如实记日志而不冒充 observation；`facts` 新增 `source` 列，物化视图无需 join 日志即可渲染 `MemoryEntry.source`。
- **事实标识是两级**：`facts.version_id` 是每版本的主键，`supersedes` 指向它；`facts.id` 是消费方持有的稳定逻辑条目 id——STM 的 `excludeIds` 在 supersede 之后仍然有效。
- **时序有效性是硬排序，不只是权重。** 检索先按状态分层（active > uncertain > superseded），再按归一化 score 降序（`relevance = -bm25/(1 + -bm25)`，`score = relevance × statusWeight`，权重 1.0/0.6/0.3）；否则纯 BM25 量值可能把被取代版本排到当前事实之前。
- **CJK 召回用二元组分词**（索引与查询两侧同做）：unicode61 把整段 CJK 连续字符切成单 token，不做补偿会让中文条目的召回相比阶段一的子串匹配倒退。
- **Markdown 共存是导入式**：Phase-1 文件仍是人类可编辑源，每个操作前按内容哈希重导入；经 API 落 tombstone 的条目在文件未变时不复活。
- **置信度门、候选索引与兜底提醒不在本次交付**——随阶段二b 接线落地；发布组合均不挂载 `memory-sqlite`。

## 阶段二b 实现纪要

接线（`packages/memory/adaptive-memory`）落地时与上文设计不一致的事实：

- **能力探测驱动两条检索路径。** 每次评估探测 `typeof memory.topicVersions === 'function'`（`asStructuredMemory`）：sqlite provider 走结构化路径——以 intent 锚点文本为 query 的 BM25 `search`（global + 会话 scope），有实体时追加一次合取语义的实体过滤 `search`，再从 `list` 钉入 `alwaysIncludeTags` 约束条目；Markdown provider 保持阶段一 fallback 不变。score 仍按结果逐个探测，无 score 的命中按"钉入或丢弃"降级，不会破坏门。
- **门控签名不是契约字面写的"候选的 topic 版本"，而是全部检索命中的。** 只跟踪注入候选的 topic 会漏掉一种情况：low 层条目内容变更后新得分跨过阈值。签名覆盖注入 id + 全部检索命中 id（含被门拦下的）+ 这些命中覆盖的 topic 版本。任何检索命中都未触及的 topic 发生写入不触发刷新；`topic-version` miss 后逐字节不变的重渲染不追加快照（投影比较保留文本），所以刷新决策不必然产生新快照。
- **置信度阈值是占位值，且有一个已知的校准陷阱。** 小语料上 BM25 归一化得分趋零（N≈1 时 IDF 退化），0.82/0.55 缺省在调参前几乎不注入任何内容；组合测试因此放低阈值，门层级映射用假 provider 单测而非真实 BM25 数字。
- **候选索引以全文块形式升级，不是新增 section。** 高置信层条目渲染为 `- 短id | topic（全文）` + 缩进正文，仍在同一个 `memory:stm` 贡献里；放不进预算的正文块降级为索引行而不是丢弃，候选仍受同一 `stmTokenBudget`/`maxEntries` 约束。
- **提醒走第二个 context 贡献（`memory:reminder`），不做 inbox 注入。** 观察 `tools/result`（对冻结结果的 contained observation）不触碰执行管线；提醒文本经与 STM 相同的 append-on-change 投影进入模型可见面——每次变化恰好投影一次、由 context-snapshot 机制落日志——触发决策本身记 log-only 的 `memory/reminder` 事件。预算按轮/按 intent 滚动（缺省 1/3）；intent 切换在下一次评估时清空挂起提醒文本。
- **提醒启发式刻意从简**：「未覆盖」= 对当前 STM 快照文本的子串判定；错误码来自 `error.info.code` 加结果文本里的 `E[A-Z]{3,}` 形 token（成功结果也算——失败的 grep 会以成功结果打印 ENOENT）；`memory_search`/`memory_save` 永不触发。

## 阶段三实现纪要

巩固（`packages/memory/memory-consolidate`、`packages/memory/tool-memory-recall`，以及 `packages/memory/memory-sqlite` 的 store 能力）落地时与上文设计不一致的事实：

- **巩固挂 `session/disposed`，不是 `session/flush`。** flush 是检查点策略持有的每请求持久性检查点；disposed 是每会话一次的终态信号，也是事件日志首次完整的最早时点。本 pass 是 fire-and-forget、失败仅记日志，其决策去向是 `ctx.logger` 而非会话日志——决策时会话已关闭；抽取内容只在此后经自带日志的可见面（STM 快照、工具结果）到达模型，因此 model-visible⟺logged 不变量无需巩固事件也成立。
- **抽取器是插件 `apply` 的第三个参数。** `ExperienceExtractor`（会话日志 → 候选）随默认的确定性 `HeuristicExtractor` 交付——默认路径零模型调用；后续 LLM 抽取器无需改动插件即可挂载。v1 启发式：显式记忆信号（正文可解析为 `key: value` / `subject is value` / `主体是值` 时的结构化 `stated` 三元组）、用户纠正、错误→消解对、决策陈述。
- **成功门控分两级。** `standard`（缺省）要求至少完成一轮，且*最后一轮*没有未消解的工具错误或可观察的测试失败；`strict` 把失败扫描放宽到全会话。同一工具之后出现成功结果即视为该错误已消解；只有调用的名称或参数匹配测试运行器模式时才计为测试失败。门控未通过的会话只记录 `failure-pattern` 经验（每个未消解失败一条），绝不与成功事实混合。
- **冲突 → uncertain 作用于单次 pass 内。** 单次巩固内两个同 (subject, predicate)、不同 value 的候选没有明确的 supersede 次序，存活事实经新增的 `markUncertain` seam 能力标记为 `uncertain`；跨会话冲突保持 store 的普通 supersede，因为时序本身就是明确的取代次序。随之落地的 store 侧语义：uncertain 头计为该对的当前版本，之后的保存将其 supersede——新证据消解不确定性，而不是留下两个当前版本。
- **退役是由巩固驱动的 store 能力，schema v2。** `retireStale` 退役超过调用方给定保留期限的 superseded 版本，以及连续 N 次巩固未被检索命中的 active/uncertain 事实（使用信号是 `used_at_consolidation` 视图列，在 `search` 内刷新——这是对物化视图的写入，绝不写 append-only 日志；巩固计数存在 `meta` 表）。`retired` 事实完全离开 `search` 与 `list`；行与事件保留。
- **reader 是普通的一次性进程内 subagent，不是新 provider。** `memory_deep_recall` 以静态 persona、固定的 `{ answer, evidence, uncertainties, confidence }` 输出 schema、只读工具允许列表（缺省 session-query 只读三件套）和 `maxDepth: 1` 启动配置的 provider（缺省 `spawn`）——该 seam 的 `maxDepth` 是**绝对**委托深度上限（顶层会话的子代理深度为 1），阶段三缺省的 `0` 会拒绝一切启动；2026-08-17 由 next-workflow 的集成测试实时暴露后修正为 `1`（允许 reader、禁止其再委托）。返回结构先经校验并按 Config 预算钳制，再成为工具结果。各项能力（`sessionQuery` 服务、只读工具、provider 及其 `toolFilter`/`outputSchema`/`persona`/`depthLimit`）在执行时探测，缺失以普通的模型可见错误报告。
- **契约的阶段三范围已完整实现**：成功门后的经验抽取、reader subagent、冲突检测与退役全部落地；向量 provider 仍推迟，契约本身就把它标为可选（排期时由 `semantic-index` 承载）。
