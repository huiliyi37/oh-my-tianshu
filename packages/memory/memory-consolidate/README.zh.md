# @huiliyi37/dsh-memory-consolidate

[English](README.md) | 中文

会话结束时的记忆巩固（adaptive-memory Agent Note 的阶段三）。当会话离开存储——`session/disposed`，终态生命周期信号（`session/flush` 是每请求的持久性检查点，不是任务结束）——插件先在事件日志上评估启发式**成功门控**，通过后才把候选经验抽取进结构化 LTM。门控级别：`standard`（缺省——至少完成一轮，且最后一轮没有未消解的工具错误或可观察的测试失败）或 `strict`（对全会话做同样的检查）。两个抽取器实现 `ExperienceExtractor` 接口（也是 apply 的第三个参数）：缺省的**启发式**抽取器（零模型调用：显式记忆信号——正文可解析为 `key: value` / `subject is value` / `主体是值` 时附结构化 `stated` 三元组、用户纠正、错误→消解对、决策陈述）与 **LLM** 抽取器（`extractor: 'llm'`，阶段三b——会话结束后一次有界结构化请求，不在请求路径上），后者产出**会话摘要条目**（`observation`，topic `session-summary`，3–6 句：任务是什么、做了什么、结果、关键文件——「之前大概做了什么」的答案）、模型质量的事实/经验候选，以及可选的**做法条目**（`experience`，topic `procedure`：名称 + 适用时机 + 有序步骤）。LLM 抽取失败（无路由、无 llm 服务、超时、输出校验失败）回退启发式并记 log-only 提示。不走模型时，保守的启发式变体仍会沉淀做法——但只来自显式编码了方法的用户纠正（`instead` / `应该` / `改用`）。做法是带溯源的建议，不是自动执行的 playbook；`proceduresEnabled` 在两条路径上统一门控。门控未通过的会话只记录 `failure-pattern` 经验条目——每个未消解失败一条，绝不混入成功事实。

候选以 `source: 'auto'` 落入 `global` scope，并带溯源信息（`sourceRefs` = sessionId + 事件 seq），每会话限量（`maxCandidatesPerSession`，缺省 8）。**冲突处理**：单次巩固内两个同 (subject, predicate)、不同 value 的候选没有明确的 supersede 次序，因此存活的事实经 store 的可选 `markUncertain` 能力标记为 `uncertain`（以 `typeof === 'function'` 探测，绝不假设其存在）；跨会话冲突走 store 的普通 supersede 路径。**退役**：每次巩固后，store 的可选 `retireStale` 能力退役超过 `supersededRetentionDays`（缺省 30）的 superseded 版本，以及连续 `unusedConsolidations`（缺省 8）次巩固未被检索命中的事实——退役事实离开检索与 `list`；事件日志保持 append-only。巩固失败仅记日志（`ctx.logger`），绝不破坏会话拆除；subagent 子会话缺省跳过（`consolidateChildSessions`）。全部阈值都是带 schema 缺省值、经校验的 Config 字段（见生成的配置目录）。发布组合均不挂载本插件。

## Model Experience

### Indirect — 仅巩固写入

#### What the model sees

巩固时刻没有任何可见内容：本 pass 在会话 disposed 之后运行，其决策仅记日志（会话日志此时已关闭，决策去向是 `ctx.logger` 而非会话事件）。抽取的事实只在之后经消费方到达模型（`memory_search` 工具结果、`dsh-adaptive-memory` 的 STM 快照）。

#### Token effect

无直接成本；消费方按各自预算渲染召回条目。可选的 LLM 抽取（`extractor: 'llm'`）是会话结束时的一次有界请求——输入是受 `llmMaxInputChars` 限制的转写，输出受 `llmMaxOutputTokens`（缺省 2000）限制，`llmEffort` 缺省为 `off`（推理模型不会把输出预算烧在思考 token 上），绝不触碰在线请求路径。

#### KV Cache effect

不贡献 prompt 结构。巩固产物只经 append-on-change 的 STM 通道或工具结果尾部进入模型可见面，绝不改写请求前缀。

## Known Limitations and Deferred Work

- **做法质量取决于模型路由**——`extractor: 'llm'` 时，摘要/候选/做法的质量跟随配置的（或会话的）模型路由；启发式路径刻意保守（做法只来自编码了方法的用户纠正）。向量检索仍然推迟。
- **LLM 抽取是一次尽力调用**——不重试；任何失败都会对该会话回退启发式抽取器，丢失的是模型质量的细节，确定性候选绝不丢失。
- **仅 global scope**——巩固候选一律落入 `global`；按 scope 的巩固策略推迟到有消费方需要为止。
- **resume 时全日志重评估**——恢复的会话在每次 disposal 时对完整日志重跑门控与抽取；store 的同内容幂等让重复写入零成本，但启发式每次都会全量重扫。
