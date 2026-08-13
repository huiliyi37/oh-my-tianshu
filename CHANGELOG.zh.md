# 变更日志

[English](CHANGELOG.md) | 中文

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
