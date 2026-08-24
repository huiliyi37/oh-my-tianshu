# 外部 Harness 工作流调研与本仓库工作流分析：OpenAI Codex、Claude Code 与 Tianshu Harness SDK

中文（如需英文对照版可后续按仓库双语约定补齐）。调研日期：2026 年；方法：外部信息来自官方文档 web 检索（来源见文末），本仓库分析以仓库内文档与源码为准。本次为纯只读调研 + 本报告新增，未改动 `packages/`、`agent-loop`、`cordis.yml` 或任何现有代码与配置，未执行任何 git push。

## 1. 结论摘要

- **三方同构**：Codex、Claude Code 与本仓库对"harness"的定义一致——围绕模型的管理层：工具调用循环、上下文管理、权限/沙箱门控、会话状态持久化、人审批接缝。差异在扩展面的开放程度与状态权威的设计。
- **Codex 把 harness 当产品内核卖**：开源 harness 同时驱动 App/CLI/IDE，对外暴露三层集成（`codex exec` 脚本化、官方 SDK、app-server 协议嵌入）；安全模型是「沙箱模式 × 审批策略」二维正交。
- **Claude Code 把 harness 定义为"模型周围的执行环境"**（官方词汇表：agentic harness = tools + context management + execution environment）；扩展面最宽：hooks、subagents、skills、plugins、MCP、agent teams。
- **本仓库的差异化定位是"可组装 harness 的 SDK"**：一切皆插件（vendored Cordis，255 个包），agent-loop 本身也是插件；会话日志是唯一权威且强制「Model-visible ⟺ logged」不变量；能力接缝用 Service Definition / Provider / Consumer 三角色刻画。
- **本仓库已内置与两家外部产品的双向互通**：`hooks-claude`/`hooks-codex` 把外部 shell-hook 协议翻译到本仓库的类型化拦截点；`subagent-codex`/`subagent-claude-code` 把整轮工作委托给外部产品执行。
- **提示词统计**（口径见 §7）：仓库内静态提示词载体共约 **57 个文件**——14 个 `AGENTS.md` 工作区指令文件（439 行）、10 个技能文件（901 行 / ≈88.5 KB）、约 20 个含内嵌指令模板的 TS 源文件（其中 33 个源文件引用 `ctx.systemPrompt`）、30 个模型可见工具描述所在的 `tool-*` 包、4 处示例配置内嵌 persona。注意：本仓库提示词是每步动态装配的（有序 section + 工具 schema + 变量），静态载体数 ≠ 运行时提示词条数。

## 2. OpenAI Codex 的工作流

### 2.1 定位与总体架构

Codex 的 App、CLI、IDE 扩展只是同一底层系统的几种用法；真正可复用的是开源的 [Codex harness](https://github.com/openai/codex)。官方对其职责的表述：帮助模型收集上下文、推理任务、使用工具、在配置边界内运行、请求审批、跨回合推进工作；具体包括管理会话状态、流式执行、工具使用、执行沙箱与审批策略、跨回合携带工作状态（[Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)）。

官方强调 harness 设计本身显著影响效果：在 ARC-AGI-3 上，保留推理（retained reasoning）+ 上下文压缩把 GPT-5.6 Sol 的得分从 13.3% 提升到 38.3%，同时输出 token 减少 6 倍。架构分层为：应用拥有界面、业务上下文与同意（approval）；Codex app-server 提供 agent loop 与沙箱执行；应用自有数据通过 MCP 工具接入。

### 2.2 集成层与运行形态

| 形态 | 适用场景 | 关键机制 |
|---|---|---|
| CLI TUI | 人机交互主入口 | Auto 预设启动（版本控制目录推荐 workspace-write + on-request） |
| [`codex exec`](https://developers.openai.com/codex/non-interactive-mode) | CI / 管道 / 后台任务 | 有界工作流 + 结构化输出；`--json` 输出 JSONL 事件流：`thread.started`、`turn.started`、`turn.completed`、`turn.failed`、`item.*`、`error`；item 类型含代理消息、推理、命令执行、文件变更、MCP 工具调用、web 搜索、计划更新 |
| [官方 SDK](https://developers.openai.com/blog/codex-as-a-platform) | 程序化启动/恢复/流式任务 | 直接编程接口 |
| app-server | 产品内嵌 agent | 连接本地 Codex 进程；线程（thread）创建/恢复、回合启动、事件流、中断、暴露工具、审批处理；协议含 `model/list`、thread 生命周期、goal 管理等 |

### 2.3 配置与信任模型

配置读取自多层（[Config basics](https://developers.openai.com/codex/local-config)），优先级从高到低：CLI flags / `-c` 覆盖 → 项目 `.codex/config.toml`（自项目根向 cwd 就近优先，仅受信任项目加载）→ profile 文件（`--profile` 选择）→ 用户 `~/.codex/config.toml` → 系统 `/etc/codex/config.toml` → 内置默认值。企业托管可用 `requirements.toml` 强约束（如禁止 `approval_policy = "never"`）。项目标记为不受信任时跳过全部项目层（含项目本地 hooks 与 rules）。

### 2.4 安全模型：沙箱 × 审批（[Agent approvals & security](https://developers.openai.com/codex/sandbox)）

两个正交层次：

- **Sandbox mode**（技术上能做什么）：`read-only` / `workspace-write` / `danger-full-access`；CLI/IDE 用 OS 级机制（macOS Seatbelt、Linux Landlock/seccomp 一类）执行；workspace-write 下网络默认关闭（`[sandbox_workspace_write] network_access = true` 显式开启）。
- **Approval policy**（何时必须问人）：`untrusted` / `on-request` / `never`，另有 granular 策略可分项控制 sandbox 升权、execpolicy 规则、MCP elicitation、`request_permissions`、skill 脚本审批。

默认建议：版本控制目录 → Auto（workspace-write + on-request）；非版本控制目录 → read-only。可写根内的受保护路径递归只读：`.git`、`.agents`、`.codex`。云端形态为隔离容器两阶段运行：setup 阶段可联网装依赖，agent 阶段默认离线，secrets 仅 setup 阶段可见。

### 2.5 记忆与上下文

项目指令采用 `AGENTS.md` 约定（用户/项目分层）；行为规则可用 execpolicy `.rules` 文件表达（可用 `--ignore-rules` 跳过）；压缩与保留推理是 harness 层能力而非模型能力。

## 3. Anthropic Claude Code 的工作流

### 3.1 官方定义

[词汇表](https://code.claude.com/docs/en/glossary)：**Agentic harness** = "把语言模型变成能干活的编码代理的工具、上下文管理与执行环境。Claude Code 是 harness，Claude 是其中的模型。Harness 供给文件访问、shell 执行、权限门控、记忆加载，以及把动作串成环的循环。" **Agentic loop** = "收集上下文 → 采取行动 → 验证结果，循环直至完成；每次工具调用的返回信息喂给下一步；用户随时可打断重定向；hooks、skills、MCP 等扩展点都挂在这个循环的具体阶段上。"（[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)）

### 3.2 工具面与执行环境

内置工具五类：文件操作、搜索、执行（shell/测试/git）、Web、代码智能（类型错误、跳转定义，需插件），外加编排类（spawn 子代理、向用户提问等）。执行环境三种：Local（默认，全量本机访问）、Cloud（Anthropic 托管 VM 或自托管）、Remote Control（浏览器遥控本机）；终端/桌面/IDE/web/Slack/GitHub Actions 多界面共享同一 agentic loop。

### 3.3 权限模式与检查点

- 权限四模式（Shift+Tab 切换）：**Auto**（后台分类器审查并拦截高风险动作，Pro/Max/Team 交互式会话默认）、**Manual**（改文件和跑命令都先问）、**Accept edits**（自动接受编辑与常见文件系统命令）、**Plan**（只探索与提计划，不改源码）。`.claude/settings.json` 可按 managed-org → 项目 → 个人分级放行具体命令。
- 检查点：编辑前对文件做快照，Esc Esc 回滚；独立于 git，恢复时跳过符号/硬链接文件；远端副作用（数据库/API/部署）不在检查点覆盖范围，由权限模式管。

### 3.4 会话与状态

对话以明文 JSONL 写入 `~/.claude/projects/`，支撑回溯（rewinding）、resume 与 fork（`--fork-session` / `/branch` 复制历史到新 id，原会话不动）。会话绑定目录，配 git worktree 可并行多会话。Auto memory：MEMORY.md 前 200 行或 25KB 每次会话自动载入；CLAUDE.md 分层承载持久指令。

### 3.5 上下文窗口管理

接近上限时自动压缩：先清旧工具输出，再总结对话；单文件/输出过大导致反复膨胀时有 thrashing 保护（停止自动压缩并报错）。`/context` 查看占用；CLAUDE.md 的 "Compact Instructions" 段控制压缩保留倾向。MCP 工具定义默认延迟加载（tool search 按需取 schema）；skills 渐进披露（开场只见描述，正文用时才载入）；子代理跑在独立上下文窗口，可选 fork 当前对话，结束后只回传总结。

### 3.6 扩展机制

| 机制 | 载体 | 要点 |
|---|---|---|
| [Hooks](https://code.claude.com/docs/en/hooks) | shell 命令挂生命周期点 | `PreToolUse`、`PostToolUse`、`UserPromptSubmit`、`PermissionRequest`、`SessionStart`、`SessionEnd`、`PreCompact`、`Stop`、`SubagentStop`、`Notification`、`Setup` 等 |
| [Subagents](https://code.claude.com/docs/en/sub-agents) | `.claude/agents/*.md`（YAML frontmatter + 正文即系统提示词） | 字段含 name/description/tools/disallowedTools/model/permissionMode/mcpServers/hooks/maxTurns/skills/initialPrompt/memory/effort/background/isolation；作用域 managed > 项目 > 用户 > 插件；亦可供 agent teams 引用 |
| [Skills](https://code.claude.com/docs/en/skills) | SKILL.md | frontmatter：name/description/disable-model-invocation/allowed-tools 等；渐进披露控上下文成本 |
| Plugins / MCP | 打包分发 skills+hooks+subagents+MCP servers | 外部服务经 MCP 接入 |

## 4. Codex 与 Claude Code 对比

| 维度 | OpenAI Codex | Claude Code |
|---|---|---|
| harness 定位 | 开源的"agent 发动机"，App/CLI/IDE 共用底座，可整体嵌入第三方产品 | 围绕 Claude 模型的终端代理；harness 是模型的执行环境 |
| 循环模型 | thread → turn → item（命令/文件变更/MCP 调用/计划更新） | gather context → take action → verify results 三阶段循环，扩展点挂阶段 |
| 集成协议 | `codex exec` JSONL 事件流、SDK、app-server 协议（threads/goals/approvals） | Agent SDK、hooks 协议、ACP、GitHub Actions；桌面/IDE/web 多界面 |
| 状态持久化 | 会话状态由 harness 管理，app-server 可读存量 thread/turns | JSONL 明文转录于 `~/.claude/projects/`，resume/fork/worktree 并行 |
| 安全模型 | 二维正交：sandbox_mode × approval_policy（+granular 分项）；OS 级沙箱；受保护路径 `.git/.agents/.codex` | 权限四模式（Auto 分类器/Manual/Accept edits/Plan）+ 设置分级允许清单 + 文件检查点 |
| 指令记忆 | `AGENTS.md` + execpolicy rules + 企业 requirements.toml | `CLAUDE.md` 分层 + auto memory（MEMORY.md）+ Compact Instructions |
| 上下文工程 | retained reasoning + compaction 为一级能力（ARC-AGI-3 提升 25pp） | 先清旧工具输出再总结的自动压缩；MCP 工具延迟加载；skills 渐进披露；子代理独立窗口 |
| 扩展面 | MCP 工具、profiles、granular 审批、skill 审批项 | hooks/subagents/skills/plugins/MCP/agent teams，作用域体系更细 |

## 5. 本仓库（Tianshu Harness SDK）的工作流

### 5.1 总体架构：vendored Cordis 上的一切皆插件

本仓库是基于 vendored Cordis 的插件式 agent harness：**everything is a plugin, including the loop**（[docs/architecture.md](../architecture.md)）。Cordis context 即 harness；包通过 `ctx.effect()` / `ctx.on()` / `ctx.waterfall()` 贡献服务、类型化事件与可释放注册。仓库共 255 个 `package.json` 包（`@huiliyi37/dsh-*`），按组索引于 [packages/README.md](../../packages/README.md)：core（API 主干）、llm、bash/pty/subprocess/sandbox/fs/git/lsp（进程与文件能力族）、skill、compact、context、subagent、tasks、workflow、goal、plan、preset、guard、hooks、mcp、session、memory、api、typert、client/tui 等。

### 5.2 默认服务与能力接缝

默认主干服务：`ctx.sessions`（内存中事件溯源会话）、`ctx.systemPrompt`（有序提示词段 + 工具 schema + 变量）、`ctx.tools`（工具注册表与执行流水线）、`ctx.agents`（活体 agent 与委派创建）、`ctx.agentLoop`（具体驱动器）、`ctx.agentDefaultModel` / `ctx.modelRoles`。

能力接缝（capability seam）= 可替换的能力，由 **Service Definition / Service provider / Consumer** 三角色构成，三角色齐备才算完整接缝（[glossary](../glossary.md)）：`ctx.llm`、`ctx.bash`、`ctx.subprocess`、`ctx.pty`、`ctx.sandbox`（bwrap/Landlock/Seatbelt 后端，argv 包装 + per-call policy）、`ctx.fs`、`ctx.lsp`、`ctx.skills`、`ctx.web`、`ctx.compact`、`ctx.subagents`、`ctx.planMode`、`ctx.tasks`、`ctx.workflows`、`ctx.goals`、`ctx.sessionPersistence`（JSONL zstd 校验和默认 / SQLite 同契约）、`ctx.sessionQuery`、`ctx.settings`、`ctx.credentials` 等；全景图见自动生成的 [capability-seams.md](../capability-seams.md)。`packages/mcp/mcp-client` 把外部 MCP server 的工具注册到 `ctx.tools`，对应外部的 MCP 生态。

### 5.3 Agent Loop：turn/step 流水线

会话 append-only；**turn** 认领一条排队 follow-up 并等待前序 checkpoint；**step** = 一次模型请求 + 其工具执行。创建/恢复先获取未发布的 `SessionPreparation` 私有装配，就绪后才发布 session 与 agent。每步流水线（摘自 architecture.md 的 Turn Flow）：

```text
claim 输入批次 -> agent/pre-step -> step/start
  -> 装配有序 prompt sections + tool schemas -> 快照派生消息
  -> agent/request 解析适配器默认值 -> request/header 落日志 -> llm/stream（冻结）
  -> assistant/chunk -> assistant/message
  -> 按 ctx.tools.executionMode 调度工具（exclusive 屏障 / parallel 滚动池 ≤ maxParallelToolCalls）
     tool/call -> tools/pre-execute -> 并发 tools/execute -> 有序 post-execute -> tool/result
  -> step/end -> 工具欠一次请求或 inbox 非空则续步；否则 turn-stopping 复查后 turn/end
```

关键机制：`inject()` 排队非唤醒 next-step 上下文，由 `followup()` / `steer()` 唤醒；剪枝先于摘要，溢出重试要求持久进展；适配器 `retryPolicy` 约束常规重试；失败边界上 `agent/request-error` 可授权同步重试冻结提示词，取消优先于一切恢复；`aborted` 取消与 `disposed` 遣散区分对待。队列、转向、重试、取消的机制细节归 [agent-loop README](../../packages/core/agent-loop/README.md) 所有（1726 行源码，6 个模块）。

### 5.4 状态：会话日志唯一权威

会话日志是唯一权威事实源：`deriveMessages()` 投影模型历史，原始 `assistant/chunk` 保留 replay 保真；fork、resume、转录渲染、遥测、持久化均从该流派生。核心不变量 **Model-visible ⟺ logged**：凡进入模型请求的内容必可从会话日志重构（`request/header` 标记适配器默认值，`dsh-agent-loop/invariant` 经 `ctx.invariants` 断言可重构性）。这是本仓库相对两家外部产品最明确的强保证——外部产品的转录用于 resume/fork，但未把"可重构每个请求"上升为被断言的不变量。

### 5.5 生命周期事件与拦截语义

事件即服务扩展 API：session 事件是持久日志事实（`session/event`）；agent 事件携带活体 Agent（inbox、step、status、request、continuation）；capability 事件在不引入 loop 依赖的情况下挂接策略与适配器。Waterfall 是 around-middleware：监听者必须 `next()` 委托，不调用即短路接管。新行为的去处是文档化的扩展点表（加 provider / 加工具 / 加 bash 后端 / 拦截请求工具回合 / 注入上下文 / UI 集成 / 日志回卷 / fork 会话等约 20 条），loop 改动必须同步 architecture.md。

### 5.6 与外部产品的互通设计

本仓库不仅"对标"外部 harness，还把它们当作可组合的外部能力：

- **Hook 桥**：`packages/hooks/` 含共享线协议库 `hook-protocol` 与 `hooks-claude`、`hooks-codex` 两个桥插件——把 Claude Code / Codex 的外部 shell-hook 协议忠实翻译到本仓库的类型化拦截点；"原生 hook"就是这些拦截点上的普通 Cordis 插件。
- **Subagent 提供者族**：`packages/subagent/` 下 inprocess / fork（已完成回合前缀分叉）/ spawn（全新）/ acp（子进程 ACP）/ **codex / claude-code**（把自包含一轮委托给外部产品执行）/ dsh-sdk 七种提供者 + 委派工具三件套（tool-subagent / control / report）。
- **前端门**：ACP 自动化服务器、JSON-RPC front door（可引导外部 `cordis.yml`）、Web GUI host/client、TUI——对应外部产品的多界面形态。
- **人协作面**：`interaction/` 组集中承载审批、权限、命令、ask-user，即外部的 approval/permission seam 在本仓库的对应物是插件面而非 loop 内建。

## 6. 外部 ↔ 本仓库对照

| 外部概念 | Codex 实现 | Claude Code 实现 | 本仓库实现 |
|---|---|---|---|
| agent loop | harness 内核 thread→turn→item | agentic loop 三阶段 | `dsh-agent-loop` 插件驱动 turn/step，`agent/*` 类型化事件 |
| 项目指令文件 | `AGENTS.md` + `.rules` | `CLAUDE.md` 分层 + MEMORY.md | `dsh-workspace-context` 加载 `AGENTS.md`/`CLAUDE.md`（含 `.local` 覆盖）+ 用户全局 `$DSH_HOME/AGENTS.md` |
| 权限/审批 | sandbox_mode × approval_policy | 四种 permission mode + 允许清单 | `interaction/` 人协作面 + `ctx.sandbox`（argv 包装、per-call policy）+ `fs/*` 策略事件 |
| 上下文压缩 | retained reasoning + compaction | 先清旧工具输出再总结 + thrash 保护 | `ctx.compact`（摘要）+ `tool-result-prune`（免模型剪枝）+ `token-meter` 压力观测 |
| 技能 | skill 审批项（granular） | SKILL.md 渐进披露 | `ctx.skills` 注册表：`{项目根}/.agents/skills` + 用户 `~/.agents/skills` 双层扫描 |
| 子代理 | cloud 任务/exec | `.claude/agents/*.md` + agent teams | `ctx.subagents` 七提供者（含 fork/inprocess/ACP/Codex/Claude Code 委派） |
| hooks | granular 审批中的 hook 类目 + 外部协议 | 11+ shell-hook 生命周期点 | 类型化拦截点为原生面；`hook-protocol` + `hooks-claude`/`hooks-codex` 桥兼容外部 shell hook |
| MCP | MCP 工具调用进 item 流 | MCP server + tool search 延迟加载 | `mcp-client` 把外部 server 工具注册到 `ctx.tools` |
| 嵌入协议 | app-server（threads/goals/approvals） | Agent SDK / ACP | `api/gateway`（TypeRT RPC）+ `acp/` + `jsonrpc-agent` + Python SDK |
| 会话状态 | harness 管理状态、可读存量 thread | JSONL 转录 + checkpoint 快照 | 会话日志唯一权威 + Model-visible ⟺ logged 断言不变量 + JSONL(zstd)/SQLite 后端 |
| 配置信任分层 | config.toml 六层优先级 + 受信项目 + requirements.toml | settings 分级 managed>project>local | `cordis.yml` 组合 + overlay + `ctx.settings` 命名空间 + preset bundle；misconfiguration fails loud |

对照结论：三家在"循环 + 状态 + 门控 + 扩展"四个轴上同构；本仓库的独特取舍是把**扩展面全部插件化并给出三角色接缝契约**、把**日志权威上升为被断言的不变量**、以及**把竞品（Codex/Claude Code）本身实现为可插拔的子代理提供者与 hook 方言**。

## 7. Agent 提示词统计

### 7.1 统计口径

本仓库的"提示词"不是单一静态文本，而是每步动态装配的结果：`dsh-system-prompt` 按 order 合并各插件贡献的 section（如 `deployment:persona` order 0、工具指引、守卫提醒）+ 模型可见工具 schema + 变量，未知引用直接 fail 该 turn。因此统计对象是**静态提示词载体**，分五类：

- **A 工作区指令文件**：运行时由 `dsh-workspace-context` 加载进请求上下文的 `AGENTS.md` / `CLAUDE.md`（含 `.local` 覆盖约定）。排除测试快照 fixture（4 个）与符号链接别名（5 个 `CLAUDE.md` → `AGENTS.md`，不重复计数）。
- **B 技能提示词**：`.agents/skills/**/SKILL.md`，渐进披露——描述常驻、正文按需载入。
- **C 代码内嵌指令模板**：TS 源码（src，非测试）中以模板字符串形式进入模型请求的多行指令文本，按特征标记（"You are"/"Do not"/"IMPORTANT:"/"MUST NOT"）枚举，人工归类去伪。
- **D 模型可见工具描述**：`tool-*` 包注册的工具 schema `description` 文本（模型选工具的直接依据），以包为单位计。
- **E 配置内嵌 persona**：示例 `cordis.yml` 的 `persona:` 字段与 `DSH_SYSTEM_PROMPT` 兜底。

### 7.2 数量与分布

| 类别 | 载体数 | 规模 | 说明 |
|---|---|---|---|
| A 工作区指令 | **14 个真实 `AGENTS.md`** | **439 行** | 根 102 / docs 75 / packages/client 107 / native/landlock-run 50 / packages 27 / examples 20 / website 13 / notes-implemented 13 / notes 7 / archived 7 / vendor 7 / packages/web 5 / .github 3 / scripts 3；另 5 个 `CLAUDE.md` 符链接别名；运行时还会加载仓库外的用户全局 `~/.dsh-tianshu/AGENTS.md` |
| B 技能提示词 | **10 个 SKILL.md** | **901 行 / 88,477 B** | 最大 find-simplifications 146 行，最小 code-review 49 行；均为 `dsh-*` 工程流程技能 |
| C 代码内嵌模板 | **约 20 个 src 文件命中**（其中 33 个源文件引用 `ctx.systemPrompt`） | 未逐字节测（分散在模板字面量中） | 代表：compaction 摘要指令（compact-basic summarizer）、后台任务追踪提醒 section（tool-tasks，order 106）、重复调用守卫提醒（repeat-tool-guard）、ralph 新工人提示（tool-ralph）、跨会话快照不可信包装说明（session-reference）、memory-recall 指引、web fetch/search 指引、fs/bash/git/lsp 工具指引、zen/intent-bridge/agent-router 守卫文案 |
| D 工具描述 | **30 个 `tool-*` 包** | 每工具一段 description | ask-user/bash/persistent-bash/cordis/file-info/fs/fs-search/git/goal/json-repair/lsp/memory/memory-recall/meridian/pty/pwsh/pwsh-persistent/ralph/run-tests/semantic-search/session-query/skill/str-replace-editor/subagent×3/tasks/todo/web/workflow |
| E 配置 persona | **4 处示例配置** | 各数行至十余行 | acp-agent、headless-agent、tui 的 `persona: |` 块；jsonrpc-agent 的 `'You are a coding agent.'` 环境变量兜底 |

合计静态载体约 **57 个文件 / 约 1340 行 markdown 指令 + 技能正文**（A+B 直接可测：24 文件、1340 行、≈97 KB），外加 C/D/E 三类分散在源码与配置中的模型可见文本。

### 7.3 口径局限

- C 类靠特征标记枚举，短提醒（一两句话的 additionalContext）可能漏计；33 个 `ctx.systemPrompt` 引用文件中含少量类型/校验文件（如 types.ts、invariant.ts），非全部贡献正文。
- D 类以包为单位；一个包可能注册多个工具，未逐一数工具实例。
- 测试 fixture（4 个快照 `AGENTS.md`、`examples/*/tests/fixtures/**`）与 `.agents/notes/` 过程笔记不计入——前者非真实运行输入，后者是开发过程文档而非运行时提示词。
- 动态视角：同一仓库不同 preset/cordis.yml 组合下，实际进入请求的 section 集合不同；如需精确到"某次运行的提示词全文"，应以会话日志的 request/header 重构为准（这正是 §5.4 不变量的用途）。

## 8. 参考来源

外部（web 检索，2026 年抓取）：

- Codex 平台总览：[Codex as a platform: build on the open agent harness](https://developers.openai.com/blog/codex-as-a-platform)
- Codex 配置：[Config basics](https://developers.openai.com/codex/local-config)
- Codex 安全：[Agent approvals & security](https://developers.openai.com/codex/sandbox)
- Codex 非交互模式：[Non-interactive mode](https://developers.openai.com/codex/non-interactive-mode)
- Codex app-server 协议：[app-server](https://developers.openai.com/codex/app-server)
- Claude Code 架构：[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)、[Glossary](https://code.claude.com/docs/en/glossary)
- Claude Code 扩展：[Hooks](https://code.claude.com/docs/en/hooks)、[Subagents](https://code.claude.com/docs/en/sub-agents)、[Skills](https://code.claude.com/docs/en/skills)

仓库内（本次只读分析）：

- [docs/architecture.md](../architecture.md)、[docs/capability-seams.md](../capability-seams.md)、[docs/glossary.md](../glossary.md)、[packages/README.md](../../packages/README.md)
- [packages/hooks/README.md](../../packages/hooks/README.md)、[packages/subagent/](../../packages/subagent/)、[packages/mcp/README.md](../../packages/mcp/README.md)
- [packages/core/system-prompt/src/index.ts](../../packages/core/system-prompt/src/index.ts)、[packages/context/workspace-context/src/](../../packages/context/workspace-context/src/)、[packages/skill/skill-local/src/index.ts](../../packages/skill/skill-local/src/index.ts)、[packages/core/agent-loop/src/](../../packages/core/agent-loop/src/)
- 提示词统计原始数据：根及各级 `AGENTS.md`、`.agents/skills/*/SKILL.md`、`examples/*/cordis.yml`
