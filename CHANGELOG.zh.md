# 变更日志

[English](CHANGELOG.md) | 中文

## 2026-08-29 — 0.7.0

0.7.0 收束 Web 追平计划、回流两路上游（官方 harness alpha.1 与兄弟仓 opencode-tui），并端到端落地子代理模型路由弧——自 0.6.0 发布以来 21 个提交。

### Web 追平（P2④）

Web 面追平 TUI：审批卡新增 `[a] 本会话总是允许`（常设授权背书）、`session.rewind` 驱动轨迹栏回退控制、损坏会话在列表中标注并带 spark 别名、`/model` 角色 pin 获得设置行。

### 上游 alpha.1 回流（第一浪）

`FIRST_PARTY_SECTION_ORDER` 把全部一手提示词 section 落位集中到稀疏表（相邻差 ≥10）并按名字确定性决胜——三对此前依赖注册序的 section 落位转为确定。JSONL 日志对 `sourceEventSeqs` 做区间编码（上游语料实测存储 −14.1%，读写双向向后兼容）。刻意延后并写明依赖清单：SQLite 压缩栈（schema 19）、子代理授权层的 Web 卡片、fail-closed 事件词汇。

### TUI 交互回流（dsh-tui rc.25）

完成事件终端 BEL 响铃（唯一能到达 SSH 会话的完成提醒；`/bell` 切换）。agent 运行期间的输入进本地队列（`⏳` 行、↑ 取回、turn/end 按序投递、打断保留队列）。Ctrl+Enter 是 cancel-and-send——带 `keepInbox` 打断，落定后草稿插队直发。自定义主题加载时做 WCAG 对比度警告（fail-open），`NO_COLOR` 获规范支持。Ctrl+R 成为历史搜索别名。

### 子代理模型路由弧

模型可以把一次委派路由到精确的 provider/model/effort：Host 自有的 `subagent-model-selection` 设置段（默认关、精确路由 allowlist）、首次委派时落一次的 log-only 会话策略事件、委派工具上由策略把关的 `provider`+`model`+`reasoning_effort` 字段、前缀稳定的 `list_subagent_models` 发现工具、执行器侧强制，以及终结 accepted-then-ignored 路由配置的 `agentOptions` 能力位（进程内 provider `true`；`acp`/`dsh-sdk` 在 SDK 传输实现前 `false`）。TUI `/config` 新增「子代理模型」类目：开关、逐条路由移除、provider→model picker、⚡ 一键推荐（flash → deepseek → 目录首个模型）、失效路由的活目录 ⚠ 警告，以及每会话一次的 `/subagents` nudge。`/model` 在选中行调档位（`</>`）并把模型+档位一次持久化。fork 委派保持不启用选择，以保留继承前缀的 KV Cache 复用。

### 错误终态恢复

回合以 `error` 收尾时输出失败摘要与一行分类「下一步」（认证 → `/key`、额度 → 等待或轻量档、5xx → 换供应商、上下文超限 → `/compact`、网络 → `/doctor`），最近一条真实用户消息回填输入轨（不覆盖已有草稿；底料在成功与打断时清空），`/doctor` 尾部附排障指针。

### 卫生

新增必选 `agentOptions` 字段后全仓清扫能力位字面量（16 处），清掉三处超长行与七处存量非空断言，生成目录/关系图/type-equiv 块重新同步（390+390），三份前格式 Agent Note 重构入标准骨架，examples 配置的上游名残留改回本仓域。

## 2026-08-22 — 0.4.0

0.4.0 落地单专家路由灰度地基、自动记忆管线、多供应商视觉链，以及 TUI 的配置/密钥/预览三个面——自 0.3.0 起 127 个提交。

### agent-router：单专家 Auto 灰度（Phase 1–4）

每个非 zen 的合格 turn-end 都落一条全量决策账本（`router/decision`，self 与 delegate 一视同仁，品牌化 `decisionId` + 完整指标输入）——任一会话日志可重建合格 turn 分母、self/delegate 比例与每条决策的证据。闭合的观察窗口归账为 `router/evaluation`（recovered / persisted / inconclusive；窗口不越过更晚的决策，会话尾部窗口在终结时收尾）。两道确定性晋升关卡——shadow readiness 与 canary health——以 log-only 的 `router/gate` 记录判定与 veto 理由；模式切换始终由人完成。子代理 seam 新增 `runBudget`（步数 + 墙钟，进程内强制，以可区分的 `budget-exhausted` 终态收敛）；auto 派发要求装配级显式 canary 上限（单飞锁、累计帽、合格 turn 冷却），缺失即 fail loud。完成的子代理返回有界结构化 finding（闭合判别 schema、父边界一次性净化），综合节逐字引用进 adopt/reject 闭环。发货 TUI 保持 shadow——晋升等待 ≥30 条真实 shadow 决策。

### 记忆：自动管线

`dsh-memory-pipeline` 回填历史：闲置扫描持久化的历史会话，经租约与台账工作流提取候选（`sourceRefs` 溯源去重、逐会话终态、重试上限），达可配阈值后进入跨会话全局整合阶段。sqlite 记忆面在条目上返回 `sourceRefs`；Markdown 存储按设计不携带来源。

### 多供应商与视觉

`dsh-llm-pi-ai` 增加 pi-ai 认证面（凭据存储、环境上下文适配器、提供方登录流）与模型条目的图片输入声明。内置路由：OpenRouter `stealth/ox-alpha`（1M 上下文、视觉）与官方支持视觉的 `deepseek-v4-flash-vision-exp`。上游 rc.2 统一图片管线分两组落地——规范化附件与请求版本 seam；视觉描述撞输出上限时自动续写一次（缺省预算 1024 → 2048）。

### TUI

`/key` 是多供应商密钥向导（供应商选择 → 掩码输入 → 实时探测 → 热保存），`/config` 是基于热生效 seam 的交互式双栏编辑面板，图片发送获得像素级预览：编辑期间的真彩半块字符缩略图（任意终端可用），无图形协议终端在用户气泡下回退同样的半块渲染。输入历史跨会话持久化（↑/↓），`Alt+Backspace` 移除末张附件，超限剪贴板图片走预算管线，subagent/workflow/后台活动收敛为统一封顶活动带。`/model vision|secondary|subagent` 经新的 `model-roles` seam pin 角色模型并带各消费者回退链；路由键按首个斜杠分割，含斜杠模型 id 不再截断。

### token 效率

tool-bash 系列落地：成功输出折叠尾部与失败错误行精选（P1）、git log/diff 与测试运行的语义压缩（P2）、read 引用去重与环境失败标准化诊断（P3）。

### 上游与平台

上游 v0.1.1-rc.1 波次（凭证记录与授权链、web client 修复、subagent/sandbox/turn 错误的运行时修复）与 rc.2 图片管线。`$DSH_HOME` 缺省独立为 `~/.dsh-tianshu` 并提供 `migrate-home` 迁移。host 面 typecheck 门全仓归零。

## 2026-08-19 — 0.3.0

0.3.0 是 2026-08-12 TUI 落地之后的第一个产品切口。新的顶层 TUI 会话从禅相位起步，首条消息可改写成任务卡或经意图对齐桥澄清，测试运行与 JSON-in-content 工具调用各有专用插件，活区对工具、子代理与后台任务使用同一套卡片语言。

### 禅相位（`dsh-zen`）

新的顶层会话前几步跑在最小锚定工具面上——DeepSeek 评测配方（`bash`、`str_replace_editor`、`todo_write`）加上代理作用域的 `zen_anchor`——直到宿主验证的谓词晋升到完整工具面（`d0345e66`）。晋升条件是 `zen_anchor`（目标 + 地标 + 证据）、步数预算超时，或对极短首条消息的分流跳过；模型自称就绪不被采信。晋升后 TUI 隐藏与 `bash` 抢同一意图的栈（`promoteDeny`）并裁剪工具描述（`c9b3641a`）。子代理会话不进入禅相位。意图对齐桥的对齐会话以已晋升状态播种，避免再次进入禅相位。

### 任务卡与意图对齐桥

`dsh-task-card` 把会话的首条用户消息改写成结构化任务卡（`# title`、目标 / 约束 / 验收、标记下的原文逐字保留），经一次有界 LLM 调用，失败则回退语义模板（`1dcaac77`、`387f940c`）。`dsh-intent-bridge` 拆分新会话：低成本对齐模型在专用会话里多轮澄清，然后 `finalize_alignment` 把任务卡交给全新主会话，主会话不继承对齐上下文（`b4af3a63`、`08d0dbcf`）。主会话跟随父会话的 cwd 与当前 `/model` 选择（含 reasoning effort）（`545cf209`、`a9ea3806`）。发货 TUI 装配两者；产品对齐路由走 DeepSeek flash（`5de8be64`）。

### 记忆族

`dsh-tool-memory-recall` 在发货 TUI 的完整工具面上增加 `memory_deep_recall`（禅相位不含）：只读进程内 reader 子代理蒸馏 session-query 命中，原始转录不进入主上下文（`256fa609`）。发货 Web 的 `/remember` 与 `/memory` 由 `dsh-command-memory` 拥有（`a46dcb56`）；TUI 保留私有注册表，不挂该插件。`dsh-memory-sqlite`、`dsh-adaptive-memory`、`dsh-memory-consolidate` 已上树，不进任何发货组合（`635ce8e7`、`7482e836`）。`tool-memory` 的 digest 注入默认关闭（`dc5e12a5`）。

### 测试运行器、JSON 修复、doom-loop 守卫

`dsh-tool-run-tests` 在 `ctx.tools` 上注册 `run_tests` 与 `related_tests`，并接入 `dsh-base`（`45e7d2ab`）。`run_tests` 经 bash 缝执行并做框架探测；evidence-gate 对显式 `command` 原样归账，仅有 `path` 时记为 `run_tests <paths…>`，裸调用记为 `run_tests`。`related_tests` 在目标解析出会话 cwd 时失败即报（`94e30c0e`）。`dsh-tool-json-repair` 包装 `llm/stream`：整块文本恰好是带工具 `name` 的单个 JSON 对象时，重放为 tool-call 流，使 DeepSeek 的 JSON-in-content 响应能真正执行（`45e7d2ab`）。`dsh-doom-loop-guard` 与 repeat-tool-guard 并列，对交替调用对、同一路径连续失败编辑、以及输出不变的失败测试运行注入建议提醒（`45e7d2ab`、`b256a630`）。

### TUI 活区与委派

进程类活区行共用一套卡片语言：进行中 `⠋`、成功 `›`、失败 `✗`、正文行 `⎿`（`10558e6d`）。`/subagents` 树携带子代理运行态（活动、token、工具次数、耗时、终态词），`/subagents kill` 可终止仍可续的后代（`288b4095`）。输入：vim 双 Esc 不再误开 rewind；Ctrl+C 提示写明退出进程；CSI u Esc 可打断；长文本输入保持响应（`0049197e`、`3b3e5942`、`b67e8f4f`）。

### 上游 rc.7 回移植

`node-pty` 1.2.0-beta.15（`865810e5`）；max-tokens 回放信封对齐（`ae694c20`）；Safari 输入框换行恢复（`bc4e7a25`）；大历史分页不再用会撑爆栈的参数展开（`041577ae`）。

### 其他

Meridian 磁盘库改为 `dsh-meridian.db`，不再与同一 cwd 下的天枢 schema-2 数据库冲突（`3e37f191`）。

## 2026-08-12 — 2026-08-09 基线快照以来的 222 个提交

基线快照 `snapshots/20260809T140917Z` 之后共有 222 个提交（2026-08-10 至 2026-08-12）。本版本在 SDK 插件骨架上新增了完整终端 UI、验证门、代码智能与会话持久化能力。

### 终端 UI（`dsh-tui`）

从天枢（opencode-tui）渲染核心移植并适配 dsh 接缝的完整 TUI 前端（`1b38b2d` 落地可运行 `examples/tui`）。输入：slash 命令注册表 + grok 风格下拉菜单——模糊前缀匹配、↑↓/PageUp-Down 选择、Tab 接受、Enter 提交、MRU 排序、输入行 ghost 预览（`3fe76db`、`b45ff36`）；`@`-路径 Tab 补全与 `@`-mention 展开；vim 模式；外部编辑器（Ctrl+O）；历史搜索（Ctrl+F）；`/model` 热切当前会话。对话流：markdown 渲染、工具族着色/计时、并行工具组折叠、流利度策略、turn 状态行、顶部栏（cwd/分支/模型）、C4 概念稿三行底部区（输入行 → footer → metrics）（`c4760b9`）；subagent 运行以 spinner 行呈现、终态落为 ✓/✗/◌ scrollback 条目（`8c3586e`）。命令：`/session /fork /branch /model /theme /clear /compact /steer /status /config /skills /subagents /workflow /tasks /goal /memory /rewind /btw /doctor /mcp /density` 及 `/permission` 预设切换。交互：内联审批 + 统一 diff 预览、结构化提问、plan/auto 模式循环、`/rewind` 两阶段回滚、键位表/命令面板 overlay。架构：C4 拆分提取控制器（approval/question/session）、glance metrics O(1) 化、性能监测、5 域投影总线驱动面板。

**输入面：剪贴板与图片粘贴**（opencode-tui 输入面移植，`c1951fb`）：`Ctrl+V` 读系统剪贴板图片（无图 fallback 剪贴板文本）；右键/终端菜单粘贴先识别剪贴板图片（命中则附图并吞掉图片字节乱码），粘贴内容像图片路径时加载为附件；vim yank / `Alt+W` 选区复制经 OSC52 写系统剪贴板；附件以 `📎 N images` 标记显示在输入行上方，提交后在用户气泡下方以终端内联图形渲染（kitty / iTerm2）。用户气泡携带识图提示——图片直发 / 经识图桥转描述 / 未发送（无识图桥）。

### 验证门（`dsh-evidence-gate`）与路由（`dsh-agent-router`）

`dsh-evidence-gate` 强制执行 RED-first 验证：义务状态机、编辑/验证计数、TDD 门（`enforce` 模式）、探针建议 + 冷却、L2 终审门（`1db1b35`、`604d500`、`4b450f0`、`61bacba`），原生接入 `str_replace_editor` 与 headless-agent 装配。`dsh-agent-router` 依据回合历史预测步骤失败并路由工作——含验证子代理调度与按 profile 工具限制——带真实回合 e2e 覆盖（`d458e36`、`5f63ea2`、`7651b95`）。

### 代码智能与检索

`dsh-semantic-index`（BM25 + salience/RRF/向量融合、增量更新）与 `semantic_search` 工具（`26fe3c3`、`98613eb`、`3090d3e`）；`dsh-meridian` 代码索引——node:sqlite schema、TS/Python/Go 三语言 tree-sitter 解析器、graph/impact/flow 查询、行为信号、后台回填——以 `repo_graph` 与 `<codebase-index>` 摘要暴露（`2c954b0`–`c5f4253`）；`dsh-pheromone` 文件级信息素 + 原子 JSON 持久化（`68855eb`），经 `file_info` 与 read 工具 `focus` 语义上屏（`9f9bb98`、`e410eab`）。

### 会话持久化

`Session.truncate` 回卷事件日志并重置派生状态（`62d1e76`）；持久化后端新增 `deleteFrom` 与 truncate 协调器，回滚跨重载存活（`e4a057e`）；`dsh-fs-snapshot` 移植 opencode-tui FileHistory（trackEdit/rewindToBoundary）并在写入工具执行前快照（`277657e`、`c6764f5`）。

### 记忆

`dsh-memory`（MemoryService + Markdown 文件后端、非 git 兜底）与 `tool-memory`（`memory_save`/`memory_search` + 记忆摘要注入）提供跨会话召回（`0a09830`、`4ba2d00`）。

### 模型与工程

`dsh-llm-deepseek` 新增 spark 推理尾部截断（`d17b414`）——wire 层保留尾部 N token 回传（flash 300 / pro 需显式开启），与 `dsh-spark-anchors` 排除路径锚点补偿成对上线（`3bcae85`、`f336a60`），并提供 `/model spark-flash|spark-pro` 一键切换（`360adc3`）；`lint-budgets` 对类型感知 lint 债逐文件只降不升（`3c82af2`）；文档收束——doc-typecheck 清零、i18n 配对强制、C5 Claude Code 对标记录（`617ffac`）、AGENTS.md 词预算 relocation。

**图片消息与视觉桥**（`d6be933`、`bda91b1`）：`image` ContentBlock 加入 merge-extensible 内容词汇，`dsh-llm-deepseek` 把用户图片 block 序列化为 OpenAI 风格 `image_url` content parts——用户图片端到端可达 wire（剪贴板 → 输入行 → 会话 → 模型请求）。`dsh-vision-bridge`（新 `context/` 插件）覆盖 text-only 主控：`agent/pre-step` 时经独立视觉模型描述图片附件（`purpose: 'vision-description'`，prompt 按 UI/报错关键词在通用结构与 OCR 级精确转写间自动选择），描述作为 plugin-source user message 注入——Model-visible ⟺ logged，桥失败降级为可见提示而非整轮 failed。
