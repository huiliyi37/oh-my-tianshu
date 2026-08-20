# 变更日志

[English](CHANGELOG.md) | 中文

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
