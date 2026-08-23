# opencode-tui（天枢 TUI）全程中文思考与稳定心流机制调研

[English](opencode-tui-chinese-thinking-flow.md) | 中文

本调研文档以外部上游仓库 `opencode-tui`（npm 包名 `tianshu-tui`，CLI 命令 `rivet`，本地路径 `/Users/banxia/app/deepseek-tui/opencode-tui`，调研快照为 v3.5.1、提交 `199eef069`）为对象，拆解其「模型全程中文思考」与「稳定心流」两套机制的证据、设计与工程取舍，并对照本仓库 tianshu-public（下文简称「本仓库」）给出差距清单与分级优先级建议。 文中「上游」路径均为相对上游仓库根目录的相对路径（如 `src/prompt/static.ts:4-8` 表示行号区间）；「本仓库」路径均相对本仓库根目录。 本调研不改动任何代码，也不将上游内容拷入本仓库，仅新增本文档。

## 调研范围与方法

调研聚焦两点：全程中文思考（模型在整个会话中稳定使用中文推理与作答）与稳定心流（长会话中模型持续推进、不漂移、不失控、上下文不撞墙）。 方法为只读检视上游真实文件：系统提示词与 prompt 装配（`src/prompt/`）、wire 层 API 客户端（`src/api/openai-client.ts`）、配置 schema（`src/config/schema.ts`）、运行时钩子（`src/agent/hooks/`、`src/agent/create-runtime-hooks.ts`）、压缩与缓存（`src/compact/`、`src/cache/`、`src/context/`）、README 与设计文档（`README.md`、`CLAUDE.md`、`docs/architecture-overview.md`、`docs/compaction-tuning.md`）。 核心功能只做概述铺垫；对上游子智能体、星域、桌面端等外围能力不展开。

## 上游核心功能概述

上游是面向 DeepSeek V4 前缀缓存（prefix cache）深度优化的全功能编程智能体运行时：`package.json:4` 自述为 `Terminal coding agent optimized for DeepSeek V4 prefix cache`，要求 Node.js ≥ 24（`package.json:23-25`），TypeScript strict，纯 ANSI TUI（`src/tui/engine/`）加 Tauri 桌面端、VS Code/Cursor 插件，三端经 `src/server/` sidecar 驱动同一内核（`CLAUDE.md:13-16`）。

`docs/architecture-overview.md:49-71` 给出六层架构：Layer 0 多端表面（TUI/桌面/插件/headless/sidecar HTTP-SSE）→ Layer 1 agent loop（`src/agent/loop.ts` → turn orchestration → 工具执行 → 交付，含五阶段 RuntimeHookPipeline）→ Layer 2 上下文与认知（`src/context/`、`src/memory/`：CognitiveLedger、ClaimStore、Stigmergy、PressureMonitor 等）→ Layer 3 prompt 与压缩（`src/prompt/`、`src/compact/`、`src/cache/`）→ Layer 4 工具与仓库情报（`src/tools/`、`src/repo/`、`src/search/`、`src/lsp/`）→ Layer 5 模型接入（多 provider 自适应路由、worker 路由、识图桥）→ Layer 6 数据（SQLite 会话存储、`cache-log.jsonl`、`sensorium.jsonl` 遥测）。

`README.md:312-316` 归纳三大架构支柱：认知虚拟机 CVM（模型动作经 preTurn / afterPerception / postTool / postTurn / postSession 五阶段的 60+ 个条件装配 Hook 过滤纠正，默认会话激活约 18+）、生物启发式信息素记忆 Stigmergy（行为足迹以指数衰减信号映射在代码文件上）、前缀缓存优化（冻结前缀 + 字节稳定 appendix，长会话稳态命中率 95–99%）。 `README.md:318-328` 给出工程质量指标：CLI 源码约 20.8 万行、测试约 19.8 万行（node:test 13,000+ 用例），测试 : 源码 ≈ 1 : 1。 核心特性（`README.md:330-550`）包括：前缀缓存引擎、API 成本控制、子智能体编排（类型化 work order、批量调度、团队编排）、50 工具 preset 分档、目标驱动的自动续跑（`/goal`）、Plan Mode（写锁 + 计划审批）、星域系统（16 套可切换认知纪律）、倒带 Rewind、会话交接与恢复 Handoff & Resume、委员会 Council、Skills 系统、跨会话知识、MCP。

## 全程中文思考机制

上游没有把「中文思考」做成一个开关，而是把它拆成四层锚定，每一层对抗一种不同的语言漂移诱因：identity 层定基调，wire 层把基调钉进每次 API 请求，token 层在工具结果尾部持续供给中文身份刺激，dosage 层在单轮大量英文注入时兜底纠偏。 四层共同的前提是**字节稳定**：所有锚定手段都不重写已发送的历史消息，只追加在请求尾部或工具结果尾部，因此不破坏前缀缓存。

### 第一层 identity：中文身份与思考契约

系统提示词的静态底座 `src/prompt/static.ts` 以中文撰写整个 `<identity>` 块，并在第 7 行明确写入思考语言契约：「当被问到"你是什么"时——你来自天枢星域，当前在某域推进任务。你以中文思考和回复。」 该底座还包括 `<beliefs>`（`static.ts:10-16`）、`<stance>`（`static.ts:18-20`）、`<rules>`（`static.ts:22-96`）等章节，全部用中文书写——提示词本身的语言就是第一层锚定。 子智能体提示词同样带中文契约，上游测试 `src/prompt/__tests__/static-subagent.test.ts:247` 直接断言生成提示词匹配「你以中文思考和回复」，说明这是被测试钉住的契约而非顺带文案。

本仓库对照：`packages/core/system-prompt/README.md` 说明本仓库 system prompt 由有序 section + 工具 schema + 变量装配，`deployment:persona` 是唯一配置级提示词片段，可以写中文，但 SDK 未内置任何语言契约，也没有对 persona 语言做任何校验或测试。

### 第二层 wire：系统后缀与 DeepSeek 保活思考协议

上游在每次 API 请求的系统消息尾部追加一句中文思考指令，`src/api/openai-client.ts:358-359` 注释为 `Stable suffix appended to system message for Chinese thinking (computed once, cache-safe)`：

```text
请在内部思考链中使用中文进行推理。不要在回复中输出你的推理过程，只输出最终答案或工具调用。
```

生成条件见 `openai-client.ts:379-385`：仅当配置同时满足 `preservedThinkingProtocol` 与 `thinking === 'enabled'` 才追加；后缀在 client 构造时一次性计算，此后不变——字节稳定是显式设计目标，避免破坏前缀缓存。

「全程」思考的关键在 DeepSeek 保活思考协议（preserved-thinking protocol）。`openai-client.ts:420-453` 的 reasoning_content 处理规则：保活协议模型（DeepSeek/MiMo）在工具调用轮**回传** `reasoning_content`，纯文本轮剥离；独立推理模型（GLM）始终剥离；思考关闭时始终剥离。 回传保证了模型每个工具轮都能接续上一轮的思考链，而不是每轮重新从零推理。 字节稳定性还细化到字段缺失场景：`openai-client.ts:430-436` 对「本应有 reasoning_content 却缺失的工具轮」补空字符串 `reasoning_content: ''`——缺失与存在会改变 wire 字节并在下一个 user 边界击碎前缀缓存（注释引用修复提交 `8396ac51`）。 剥离后 DeepSeek 要求 assistant 消息必须有 `content` 或 `tool_calls`，`openai-client.ts:446-452` 补齐空 `content`。

配置面见 `src/config/schema.ts:13-25`：`thinkingBlock`（`enabled`/`adaptive`/`none`）、`thinkingBudgetField`（`budget_tokens`）、`preservedThinkingProtocol`（注释原文：`echo reasoning_content on tool turns`）；`schema.ts:157-193` 另有 `thinking` 默认 `enabled`、`thinkingStallTimeoutMs`（思考停顿超时）、`slowThinking` 显式慢思考覆盖，以及思考模式下不注入 temperature 的规则（多数推理服务端拒绝调温）。

本仓库对照：`packages/llm/llm-deepseek/src/serialize.ts:1-6` 已实现 reasoning_content 回放（工具轮必回传），`packages/llm/llm-deepseek/src/translate.ts:21-31` 已解析流式 reasoning delta——保活协议本身已对齐。 缺口在语言侧：本仓库没有任何「内部思考链使用中文」的 wire 级指令，也没有对应配置键与字节稳定约束测试。

### 第三层 token：星签名（star signature）

上游对抗「训练锁定」（training-lock）：模型见到 `bash`、`grep`、`git` 等原生态工具名时，容易滑回训练语料主导的英文风格。 `src/agent/star-signature.ts:1-15` 记录设计（思路 E）：不重命名工具（会破坏 function calling）、不修改 prompt（前缀缓存安全）、在 token 级工作。 实现是给每个工具结果尾部追加中文星名签名，格式 `── 星名（工具名）`，如 `── 执令（bash）`、`── 寻迹（grep）`、`── 史官（git）`、`── 观象（read_file）`、`── 织造（edit_file）`、`── 巡天（glob/repo_map/web_search）`、`── 试炼（run_tests）`、`── 分星（delegate_task）`、`── 铭刻（recall/todo）`（`star-signature.ts:17-58`）。 `src/agent/tool-pipeline.ts:808` 取签名并在所有 `tool_result.content` 尾部拼接（如 `:953`、`:999`、`:2019`）——模型每轮处理的每个工具结果，最后一个 token 都是中文星名关联而非裸 shell 输出。 该设计刻意选择「token 级而不是 prompt 级」，持续制造中文身份节奏而不占用提示词权重。

本仓库对照：检索 `packages/` 未发现 star-signature / 星签名等价物（负向检索：`grep -r "star-signature\|starSignature\|星签名" packages/` 无匹配）。 本仓库有精神相近但目标不同的机制：`packages/guard/zen/README.md` 的 zen phase 用最小锚定工具面约束开局；`packages/guard/task-card/README.md` 把首条用户消息改写为结构化任务卡。

### 第四层 dosage：语言锚定 hook 与 advisory 通道

身份与 token 级锚定会被单轮大量英文内容稀释。 `src/agent/hooks/language-anchor-hook.ts:4-27` 记录了事故背景（2026-07-02 复盘 `4e1aaa21`）：一次 50KB 英文源码倾倒把 GLM 的推理语言翻成英文，并解锁了 RL「训练模式」式的枚举 CoT。 该 hook 在 postTool 阶段统计单轮累计工具输出：非 CJK 主导字符超过阈值（默认 15,000，`language-anchor-hook.ts:36`）且 CJK 字符占比低于下限（默认 0.05，`:37`）时，经 AdvisoryBus 投递一条中文 system-reminder 重新锚定（`language-anchor-hook.ts:46-48`：「语言锚定：本轮已注入大量非中文内容……继续用中文推理与作答；保持结论先行、要点收敛」）。 该 hook 声明 tier `priority=0.52`，高于 lossy-observation（0.48）与 edit-tool-advisory（0.5），理由是「身份漂移会自我强化（英文推理自我增强）」；每轮最多投递一条（`language-anchor-hook.ts:21-25`）。

承载通道是 AdvisoryBus（`src/agent/advisory-bus.ts`）：统一五条独立纠偏通道为单一 `<星域-advisory>` 汇聚器（`:4-11`）；三档 tier——constitutional（永不被截断）/ operational / informational（每轮最多 3 条，operational 优先）（`:14-16`）；同 key 去重；priority 0–1 归一化排序（`:66-70`）；投递通道三选一：`bus`（附录块，下个请求可见）、`system-reminder`（追加进消息流，模型必读，只追加尾部不重写历史——缓存安全）、`status`（仅 TUI 状态区）（`:56-64`）。 每条 advisory 可携带 `expect` 行为谓词（`tool_appears`/`verify_attempted`/`file_touched`/`pattern_absent`/`course_changed`），postTurn 由 advisory-readback-hook 对照 turn 级工具事件核销，产出 adopted/ignored 账本，作为习惯化对抗与降频的数据地基（`advisory-bus.ts:21-54`）。

本仓库对照：检索 `packages/` 未发现 CJK 占比检测或语言锚定 hook（负向检索：`grep -r "cjkRatio\|CJK_RE\|languageAnchor" packages/` 无匹配；`packages/memory/memory-sqlite/src/fts.ts` 的 CJK 匹配是全文索引分词，与语言锚定无关）。 本仓库的 guard 家族（`packages/guard/`：doom-loop-guard、repeat-tool-guard、evidence-gate、intent-bridge、task-card、timeout-policy、zen）是独立插件各自注入提醒，没有统一的优先级总线、三档 tier、去重与 expect 核销账本。

### 配套：推理锚点与中文输出纪律

- 推理锚点补偿：wire 层截断 reasoning_content 尾部 N token 之外的前段（节省 token 并保缓存），被截掉部分里「已排除的路径」若不补偿，模型会走回头路（SAT conflict clause 类比）。`src/agent/reasoning-anchors.ts:1-12` 从完整推理提取锚点句，经 `<excluded-paths>` 块回灌；恢复路径（resume/loadOai）后全量重建（`:41-54`）。
- 中文输出纪律散布在各侧路：识图桥 `src/agent/vision-service.ts:15,22` 用「请用中文分析这张图片/请用中文精确处理」；风险简述 `src/agent/risk-explain.ts:61` 要求「用中文简述」；审查协调 `src/agent/review-coordinator-deps.ts:366` 要求「回复语言: 中文。所有发现、摘要、risks 均用中文撰写」；欢迎助手 `src/server/greeting-route.ts:117` 中文问候。
- 上下文注入协议配套：`src/prompt/static.ts:80-82` 的 `<rule name="context-update-protocol">` 规定带 seq 的 `<context-update>` 块按覆盖语义累积，配合增量 appendix 保持模型对状态的稳定认知。

## 稳定心流机制

### 前缀缓存引擎（冰镜三区）

上游把「心流稳定」的第一性约束定在**字节稳定**上：DeepSeek 对缓存未命中按命中的至多 50 倍计费，提示词引擎围绕前缀缓存友好重构（`README.md:316`、`:332-343`）。 `src/prompt/engine.ts` 把系统提示词切成三区：`frozenBase`（会话内冻结的静态底座）、`volatileBlock`（动态区）、跨回合增量 `appendixDelta`（`engine.ts:134-142`）。 工程约束见 `docs/architecture-overview.md:75-86`：appendix 块必须字节稳定，量化在渲染层做；压缩历史重写只在用户边界（`turn===0`）；frozen 快照 commit 不得依赖可被 `invalidateFreshCache()` 清空的守卫；`stream()` 对 request 的变换必须 copy-on-write（防侧路重入双写）。

配套机制（`README.md:336-340`）：冻结前缀——系统提示词 + 工具定义 + 稳定上下文会话开始时冻结，会话内不重写；增量附录——动态上下文以跨回合 diff 追加块注入，回合间增量约 200 字节 vs 全量重写约 5KB；read-ref 去重——未变化文件的重复读取返回紧凑引用；缓存感知压缩——压缩保留前 2 条消息作为缓存锚点；resume 缓存继承——会话冻结快照在每个 user 边界 + shutdown 落盘，resume 时读回喂给新引擎，避免从字节 0 全 miss。 `README.md:343-354` 给出诊断与碎裂排查：`/debug cache`、`cache-log.jsonl` 逐轮命中、`RIVET_DEBUG_TELEMETRY=1` 全量遥测。

本仓库对照：`packages/llm/cache-diagnostic/README.md:5-6` 已移植上游缓存遥测（源自上游 `src/prompt/fingerprint.ts`、`src/prompt/cache-diagnostic.ts`、`src/agent/context.ts` 的 TurnCacheSnapshot）——**观测**已对齐。 缺口在**纪律**：本仓库 system prompt 每 step 重新 assemble 且允许 `system-prompt/assemble` waterfall 监听器改写（`packages/core/system-prompt/README.md`），没有 frozen-prefix 不变式、字节稳定契约或 resume 快照继承机制（负向检索 `grep -r "frozenSnapshot\|frozen-prefix" packages/` 无相关匹配）。

### 上下文分层与增量附录

上游把上下文建模为带稳定性分级的分层系统。 `src/prompt/context-layer.ts:34-48` 定义 13 个 ContextLayerId（system、tools、session-memory、historical-lessons、working-set、recent-raw-turns、current-request、project-instructions、git-status、tool-history、task-progress、behavior-mirror、decisions），`:49-51` 定义三档稳定性 `stable`/`stable-volatile`/`dynamic`，`:74-88` 定义固定层序；每层带 digest 指纹与 token 估计（`:53-66`），支撑「哪些层变了、哪些层可以冻结」的判定。 `src/prompt/engine.ts:115-196` 进一步细分：volatile 层内建「最新轮 volatile」与「稳定 volatile」两类；appendix 带 seq 与基线；frozen 快照按 user 消息内容 key 维护取用索引（`frozenUserMerged`/`frozenFetchIndex`，`:158-162`）。

本仓库对照：本仓库已有分层精神（有序 section、replay-aware tokenMeter、workspace-context），但没有显式的稳定性分级、层指纹与冻结快照持久化。

### 压缩五级阶梯与成本感知策略

压缩（compaction）是稳定心流与成本的交汇点，上游的策略是「能不压就不压，压就压得划算」。 `CLAUDE.md:69` 钉住五级阶梯：会话分裂 → maybeCompact → T9 质量压缩 → 陈旧轮压缩 → 堆驱动微压缩，命中即止；压缩历史重写只在 `turn===0`（用户边界），turn 中途只置 pending 标志延迟到 turn 0；1M 窗口跳过/延迟一切重写；`shouldDelayCompact` 在缓存健康时不压。 `docs/compaction-tuning.md:52` 记录 12 秒 debounce 的 run 后后台压缩，把同步全量压缩的延迟挪出下一轮关键路径。

成本感知策略在 `src/compact/compaction-profile.ts:4-21`：两条正交经济轴决定 reclaim 下限——计费轴（按 token 计费的 provider 为缓存未命中重填付真金白银，重写必须回收足够多才划算；订阅制 provider 只付延迟）与缓存轴（exact-prefix 持久缓存被任何历史重写摧毁；partial/none 缓存损失小）。 产出 `minReclaimTokens` 绝对下限与 `minReclaimRatio` 相对下限（`compaction-profile.ts:51-54`），action 词汇表 `none/stale-round/micro/partial-llm/full-llm/session-split/checkpoint`（`:26-33`）。 压缩路由到廉价模型：`docs/compaction-tuning.md:9-25` 与 `src/config/schema.ts:552-564` 的 `compact.model`（默认 `deepseek-v4-flash`）+ `compact.provider`——压缩是一次性无工具总结任务，用主力模型既费 token，又会因压缩请求前缀与主对话不同而挤掉主对话的热前缀缓存；独立 provider/client = 独立服务端缓存。 `src/config/schema.ts:542-577` 还定义比例制策略（ratio-based policy，取代旧 `autoThreshold`）与 T9 质量压缩阈值：按 token 计费 provider 0.55、订阅制 0.45、订阅制天花板 0.6（`:569-575`）；应急路径（会话分裂、95% 天花板）不受 `enabled` 开关约束（`:542-545`）。

本仓库对照：`packages/compact/compact-basic/src/summarizer.ts:30-32,114-116` 已实现前缀缓存复用的压缩（回放会话前缀 + 压缩指令作为最后一条 user 消息，复用 provider 热前缀），另有 `compact-tool-result-prune` 做无模型的结果裁剪。 缺口：本仓库没有五级阶梯、turn-0 边界协调器、成本感知 reclaim 下限（billing × cache 轴）、按 provider 分档的比例策略，也没有压缩专用廉价模型路由（负向检索未见等价配置键）。

### CVM 运行时钩子与 AdvisoryBus

稳定心流的「干预层」是 CVM：`docs/architecture-overview.md:70-73` 说明约 60+ hook 模块按 deps/环境变量门控条件装配，默认会话实际激活约 18+；常驻基线含 perception、signal-consumer、kick、vigor、theta、stigmergy、radio；advisory 类 hook 经 AdvisoryBus 注入 system-reminder，**不重写** frozenBase/volatileBlock。 五阶段真实调用点钉在 `CLAUDE.md:30-37`：preTurn / afterPerception → `turn-perception.ts`，postTool → `tool-execution.ts`（每个工具执行后），runCompaction → `turn-orchestrator.ts`（postTool 后、postTurn 前）。 `src/agent/create-runtime-hooks.ts` 是装配目录（节选）：preTurn 的 intent-anchor（长自治 run 意图锚定，`:725`）、turn-budget（maxTurns 危险区，`:747`）、reasoning-spiral guard（单轮推理螺旋，`:820`）、spec-verify gate（`:898`）；postTool 的 lossy-observation（截断输出纪律，`:597`）、dead-end detector（同一文件反复 edit→verify-fail，`:676`）、probe-discipline（`:688`）、script-iteration（`:695`）、batch-convergence（`:706`）、regression-bisect 断路器（`:713`）；postTurn 的 self-verify（`:547`）、typecheck-reminder（`:904`）、todo-reminder（`:911`）、wrapup-anxiety guard（收尾焦虑话术 × 实测 ctxRatio，`:862`）、advisory-readback（`:760`）；postSession 的 essence-gate（知识准入闸，缺省 fail-closed 不写，`:457`）、recall 健康账本（`:463`）、dream/skill-distill（`:442`）。

本仓库对照：本仓库的 Cordis 事件系统与 `packages/guard/` 家族在机制上等价于「每 guard 一个插件」形态，已有 doom-loop-guard、repeat-tool-guard、evidence-gate、timeout-policy 等具体 guard。 缺口：没有统一的优先级总线（三档 tier、0–1 priority、同 key 去重、每轮条数上限）、没有 expect 谓词与 adopted/ignored 核销账本、没有把「提醒→行为→降频」闭环数据化；部分 guard 场景（wrapup 焦虑、推理螺旋、intent 锚定、压缩失忆）在本仓库无对应物。

### 会话级心流设施

- 目标驱动自动续跑：`/goal` 启动 GoalTracker，与回合循环、doom-loop 检测、交付门禁集成（`README.md:397-404`）；目标完成由独立 judge 验证，`src/config/schema.ts:522-532` 定义 `goal.judge.enabled`（默认 true，独立核验自称完成）、`maxRuns`（默认 3，防拒收循环）、`browser`（Phase 2 浏览器验证，默认 false）。
- Plan Mode：进入后写操作被锁，调研 → 结构化计划写入 `.rivet/plans/<slug>.md` → `/plan-approve` 审批 → 分波执行 → `/plan-close` 核销（`README.md:406-431`）。
- 会话交接与恢复：`/handoff` 生成固定五章节交接文档（任务目标/已完成/当前卡点/下一步/坑，每条带 `file:line` 证据与验证命令），turn 完成后归档为 `<id>.handoff.md`；上下文占用 ≥50% 时提醒交接；`--resume` 时交接文档自动注入、冻结前缀继承、写证据修复（preflight 合成被中断的 orphan tool result）、模型亲和（resume 换回原会话模型以复用 per-model 缓存命名空间）（`README.md:471-497`）。
- 倒带 Rewind：双击 ESC 选择任一过往用户消息，将会话干净倒带到该点（`README.md:467-469`）。
- 权限检查点：Auto 模式可设每 N 轮暂停同步进度摘要（改了哪些文件/token 用量），确认后继续（`README.md:265,295`）；approval 五档（`src/config/schema.ts:362`），`maxTurns` 默认 200（`:370`），`crossSessionEnabled` 默认 true（`:416`）。
- 缓存热度预测：`src/cache/session-warmth.ts:10-22` 的 SessionWarmthTracker 以最后一次 API 调用距今时间（TTL 默认 1 小时）预测 cold/hot 缓存温度，供压缩/恢复决策使用。

本仓库对照：goal 子系统（`packages/goal/`：goal / goal-session / tool-goal / command-goal）与 plan 包已存在，但 goal-session 是同会话续跑驱动（`packages/goal/goal-session/README.md`），检索 `packages/goal/` 未见独立完成 judge；会话恢复走事件溯源回放（`packages/core/session/`），没有交接文档闭环（负向检索 `grep -r "handoff" packages/` 无会话交接语义匹配）；rewind 在 TUI 已有 overlay（`packages/tui/tui/tests/rewind-overlay.spec.ts`）；permission 检查点与 session warmth 未见对应物。

### 跨会话知识

`README.md:528-536`：`.rivet/knowledge/memory.jsonl` 存项目规则、调试启发式、架构约定；`.rivet/sessions/<slug>/<id>/pheromones.json` 存会话内信息素；`agent.crossSessionEnabled` 总开关。 写入侧有 essence-gate（postSession 知识准入闸，缺省不装配 = fail-closed 无写入，`create-runtime-hooks.ts:135,457`）与召回健康账本（postSession 聚合空召回率/引用率落盘，`:463`）。 信息素（Stigmergy）是「行为足迹直接映射在代码文件上，随时间衰减」的会话内空间记忆，区别于静态 MEMORY.md（`README.md:315`）。

本仓库对照：本仓库已有信息素等价物 `packages/guard/pheromone/README.md`（文件级 stigmergy store，指数衰减信号，7 天半衰期默认）与记忆家族（`packages/memory/`：memory、adaptive-memory、memory-consolidate、memory-pipeline、memory-sqlite、tool-memory-recall）。 缺口：缺 essence-gate 式 fail-closed 知识准入闸与召回健康账本（空召回率/引用率的聚合反馈闭环）。

## Harness 工程要点

### 六层架构与多端共享内核

上游的 harness 形态是「单内核多表面」：TUI、Tauri 桌面端、VS Code/Cursor 插件都经 `src/server/` sidecar 驱动同一 agent 内核（`CLAUDE.md:13-16`），headless 模式 `rivet -p` 供脚本集成（`README.md:130-158`）。 agent loop 主路径在 `CLAUDE.md:30-37` 钉死：`main.ts → AgentLoop（agent/loop.ts）→ RuntimeHookPipeline`，hook 执行器纯分阶段 + 错误隔离（任一 hook 抛错只走 onError，不中断 turn）。 工具注册表 `createDefaultToolRegistry` 维护 kernel budget ≤ 26，超出触发认知过载退化（`docs/architecture-overview.md:88-98`）；preset 分档装配（minimal 29 / frontend 30 / full 50 / taiyi 16，`README.md:376-394`）。

本仓库对照：本仓库 harness 是 vendored Cordis 的插件化形态（`docs/architecture.md`：everything is a plugin，包括 loop），事件即扩展 API，会话事件可持久化重放；形态不同但工程纪律相近（错误隔离、注册即 effect、模型可见 ⟺ 日志）。 本仓库没有 kernel budget 概念（工具面按 zen 阶段与 restrict 管理），也没有多端共享 sidecar（`packages/api/`、`packages/client/` 是另一套集成形态）。

### 模型接入与自适应路由

上游多 provider（DeepSeek/DeepSeek Spark/Claude/GLM/Codex/MiniMax/MiMo，`README.md:164-177`），会话内 `/model` 切换；worker 路由按 profile（capable/cheap）给子智能体配不同模型（`README.md:242-254`）；子智能体编排按 profile 通过率 + 延迟评分自适应选模（`README.md:370-374`）。 成本控制（`README.md:356-364`）：默认 reasoningEffort 降级（V4 Pro max→high，Flash max→medium，显式配置受 `reasoningFloor` 保护）；effort 路由默认开启（低复杂度 + 高置信度例行轮自动降一档，从不升档）；doom-loop 自动收束注入更严格 output-style 约束。 视觉桥（`README.md:207-240`）：主控不支持看图时配 `agent.visionModel` 桥接，备用桥 fallback、自动选桥默认关（隐私决策）、图片走对话尾部追加不打断前缀缓存。

本仓库对照：`packages/llm/` 有适配器注册与 `reasoningEffort` 请求头状态（`packages/llm/llm/src/call-config.ts`）、`packages/core/model-roles/` 有 vision/secondary/subagent 角色钉选、`packages/guard/agent-router/` 有 MoE 路由。 缺口：无「按任务复杂度自动降档、从不升档、显式 max 即下限」的 effort 路由；无按 profile 通过率+延迟的自适应 worker 路由（本仓库 subagent 走命名委托 provider 与 workflow 脚本）；无 thinkingStallTimeout（负向检索 `grep -r "thinkingStall" packages/` 无匹配）。

### 工程质量与可观测性

上游 13,000+ node:test 用例、测试 : 源码 ≈ 1 : 1、`tsc` strict + `noUncheckedIndexedAccess`（`README.md:318-328`）；typecheck 是跨进程共享缓存的提交前硬门禁（`CLAUDE.md:24-25`）；`structure:check` 架构守卫测试（`package.json:57`）。 可观测性：`cache-log.jsonl` 逐轮缓存命中、`sensorium.jsonl` 全量遥测、会话 `.jsonl` 事件流、`rivet logs` 数据根入口（`README.md:820-864`）；错误诊断经 advisory 的 diagnosis 条目自动注入模型可见流（`src/prompt/static.ts` 错误诊断规则）。 本仓库对照：本仓库有等量级的门禁体系（测试、快照、doc-sync、invariants、`test:coverage` 即 CI 门禁）；遥测侧 `packages/llm/cache-diagnostic/` 已移植；「错误诊断 → 模型可见 advisory」的自动注入在本仓库无对应物。

## 本仓库对照与差距清单

### 已对齐（无需重复造轮子）

| 上游机制 | 本仓库现状 | 证据 |
|---|---|---|
| DeepSeek 保活思考协议（reasoning_content 回传） | 已实现 | `packages/llm/llm-deepseek/src/serialize.ts:1-6,126-151` |
| 推理尾部截断 + 排除锚点回灌 | 已实现（spark 截断 + excluded-claims 锚点） | `packages/llm/llm-deepseek/src/spark.ts:3-14` |
| 前缀缓存观测与未命中归因 | 已移植 | `packages/llm/cache-diagnostic/README.md:5-6` |
| 压缩复用热前缀 | 已实现 | `packages/compact/compact-basic/src/summarizer.ts:30-32,114-116` |
| doom-loop / 重复工具 / RED→GREEN 门禁 | 已实现 | `packages/guard/doom-loop-guard/README.md`、`repeat-tool-guard/README.md`、`evidence-gate/README.md` |
| 开局收敛（最小工具面 + 锚定 + 任务卡 + 意图澄清） | 已实现且更有 SDK 特色 | `packages/guard/zen/README.md`、`packages/guard/task-card/README.md`、`packages/guard/intent-bridge/README.md` |
| goal 状态与同会话续跑 | 已实现 | `packages/goal/README.md`、`packages/goal/goal-session/README.md` |
| 文件级信息素记忆 | 已实现 | `packages/guard/pheromone/README.md` |
| 跨会话记忆（保存/检索/整合/管道/SQLite FTS） | 已实现 | `packages/memory/` |

### 差距清单（按优先级）

| 优先级 | 差距 | 上游证据 | 本仓库现状（负向检索口径：`packages/` 全量 `.ts` 检索无匹配） |
|---|---|---|---|
| 高 | 中文思考契约：identity 层「以中文思考和回复」契约 + 测试钉住 | `src/prompt/static.ts:4-8`、`src/prompt/__tests__/static-subagent.test.ts:247` | `deployment:persona` 可写中文但 SDK 无契约、无校验（`packages/core/system-prompt/README.md`） |
| 高 | wire 层中文思考后缀（字节稳定、保活协议门控） | `src/api/openai-client.ts:358-359,379-385` | 无对应实现与配置键 |
| 高 | 语言漂移检测与纠偏（CJK 占比阈值 + system-reminder 重锚定） | `src/agent/hooks/language-anchor-hook.ts:4-48` | 无（检索 `cjkRatio`/`CJK_RE`/`languageAnchor` 无匹配） |
| 高 | token 级星签名（工具结果尾部中文身份锚） | `src/agent/star-signature.ts:17-74`、`src/agent/tool-pipeline.ts:808` | 无（检索 `star-signature`/`starSignature` 无匹配） |
| 高 | frozen-prefix 纪律：冻结前缀不变式 + 字节稳定契约 + resume 快照继承 | `src/prompt/engine.ts:134-162`、`docs/architecture-overview.md:75-86`、`README.md:340` | system prompt 每 step 重新 assemble、waterfall 可改写，无冻结不变式；resume 走事件回放，无快照继承 |
| 中 | AdvisoryBus：三档 tier、0–1 priority、同 key 去重、每轮条数上限、expect 谓词 + adopted/ignored 核销账本 | `src/agent/advisory-bus.ts:14-70` | guard 插件各自注入，无统一总线与核销闭环 |
| 中 | 压缩五级阶梯 + turn-0 边界协调 + 成本感知 reclaim 下限（billing × cache 轴）+ 压缩专用廉价模型路由 | `CLAUDE.md:69`、`src/compact/compaction-profile.ts:4-55`、`src/config/schema.ts:552-577` | `compact-basic` 摘要压缩 + `compact-tool-result-prune` 裁剪，无阶梯/边界协调/成本策略/专用路由 |
| 中 | 交接文档闭环（五章节 handoff + 自动注入 + 写证据修复 + 模型亲和） | `README.md:471-497` | 无（检索 `handoff` 无会话交接语义匹配）；会话恢复依赖事件回放 |
| 中 | 上下文分层稳定性分级与层指纹（stable/stable-volatile/dynamic + digest） | `src/prompt/context-layer.ts:34-88` | 有序 section 无稳定性分级与指纹 |
| 低 | goal 独立完成 judge（maxRuns 防拒收循环） | `src/config/schema.ts:522-532` | `packages/goal/` 检索 `judge` 无匹配 |
| 低 | thinking stall 超时与 trickle 预算 | `src/config/schema.ts:157-193` | 无（检索 `thinkingStall` 无匹配） |
| 低 | effort 自动路由（低复杂度例行轮自动降档、从不升档、显式 max 即下限） | `README.md:360-361` | 有 `reasoningEffort` 状态，无自动路由（`packages/llm/llm/src/call-config.ts`） |
| 低 | session warmth 缓存温度预测（TTL 判定 cold/hot） | `src/cache/session-warmth.ts:10-22` | 无（检索 `warmth`/`sessionWarmth` 无相关匹配） |
| 低 | essence-gate 知识准入闸 + 召回健康账本（空召回率/引用率聚合反馈） | `src/agent/create-runtime-hooks.ts:457-463` | 记忆写入侧无 fail-closed 准入闸与召回效果账本 |
| 低 | 权限 Auto 模式每 N 轮检查点 | `README.md:265,295` | `packages/sandbox/` 检索 `checkpoint` 无匹配 |

### 分级落地建议

- 第一波（中文思考，投入小、见效直接）：在 `dsh-system-prompt` 增加可配置的中文思考契约（persona 模板 + 测试钉住），在 `dsh-llm-deepseek` 增加保活协议门控的中文思考后缀（沿用上游「构造一次、字节稳定」的做法），并给 `dsh-llm` 加配置键（`preservedThinkingProtocol` 已有能力位，补语言后缀即可）。
- 第二波（token 级锚定 + 语言漂移纠偏）：新增一个 guard 插件实现星签名（工具结果尾部中文签名）与语言锚定（CJK 占比统计 + system-reminder 重锚定）；本仓库的 guard 形态天然适合，且不触碰 agent-loop。
- 第三波（心流纪律）：先补 frozen-prefix 观测（cache-diagnostic 已有指纹），再论证是否引入冻结前缀不变式与 resume 快照继承；同时把 AdvisoryBus 的优先级/去重/核销账本抽象为本仓库一个可复用 guard 基础设施（若现有 guard 插件需要）。
- 第四波（压缩与恢复）：在 `dsh-compact` 上论证成本感知 reclaim 下限与专用廉价模型路由（上游的 billing × cache 双轴分析可直接借鉴）；交接文档闭环可作为 goal/plan 之上的独立小功能。
- 明确不建议照搬：星域系统、委员会、CVM 全套 hook（与本仓库 Cordis 插件形态重复建设）；上游 50 工具 preset 与本仓库工具面组织方式不同，按需单项借鉴。

## 附：证据索引

- 上游身份契约：`src/prompt/static.ts:4-8`
- 上游 wire 后缀与保活协议：`src/api/openai-client.ts:358-359,379-385,420-453`
- 上游思考协议配置：`src/config/schema.ts:13-25,157-193`
- 上游星签名：`src/agent/star-signature.ts:1-76`
- 上游语言锚定：`src/agent/hooks/language-anchor-hook.ts:4-48`
- 上游 AdvisoryBus：`src/agent/advisory-bus.ts:4-70`
- 上游压缩阶梯：`CLAUDE.md:69`、`docs/compaction-tuning.md:5-52`
- 上游压缩成本模型：`src/compact/compaction-profile.ts:4-55`
- 上游压缩配置：`src/config/schema.ts:542-577`
- 上游上下文分层：`src/prompt/context-layer.ts:34-88`
- 上游缓存继承与交接：`README.md:332-354,471-497`
- 上游 CVM 钩子目录：`src/agent/create-runtime-hooks.ts`（节选行号见正文）
- 上游工程指标与架构：`README.md:318-328`、`docs/architecture-overview.md:33-120`
- 本仓库已对齐证据：`packages/llm/llm-deepseek/src/serialize.ts`、`src/spark.ts`、`packages/llm/cache-diagnostic/README.md`、`packages/compact/compact-basic/src/summarizer.ts`、`packages/guard/*/README.md`、`packages/goal/README.md`、`packages/memory/`
