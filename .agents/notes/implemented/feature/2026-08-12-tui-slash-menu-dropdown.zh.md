# Agent Note: TUI slash 命令下拉菜单（grok slash_dropdown 移植）

Status: implemented

[English](2026-08-12-tui-slash-menu-dropdown.md) | 中文

## Problem

slash 命令提示只有一行内联文本（`slash.hint()` 输出 `命令: /a /b …`），无列表、无选择、无滚动；Tab 只补全 `@` 文件路径，命令补全未接线（`slashSelectedIdx` 是死字段）。用户反馈「/ 不展示命令列表，也不能上下滚动命令」，要求参考 grok-build（xai-grok-pager）的 slash_dropdown 设计。

## Decision

按 grok `slash_dropdown.rs` + `SlashController` + `prompt.rs` 键路由移植适配（阶段 1：核心下拉菜单）：

- **匹配数据源**（`engine/input-controller.ts`）：`refreshSlash(value)` 在 InputLine onChange 统一入口驱动——以 `/` 开头且有匹配时打开菜单（孤立 `/` 显示全量列表），否则关闭；匹配 = 前缀优先 + 子串兜底（注册顺序稳定）；`moveSlashSelection`（↑↓ 环绕）/ `scrollSlashSelection`（PageUp/Down clamp）在菜单关闭时 no-op；query 不变时 `carrySelection` 按命令名保持选中。复用已注入的 `slashCommands`（`SlashHintEntry { name, description, argsHint }`），registry 不改。
- **纯函数渲染**（新 `format/slash-menu.ts`）：`formatSlashMenu` 输出 label 列对齐 + 描述截断的行；选中行 `❯` 前缀 + primary + bold（主题无背景槽，用前缀标记替代 bg 高亮——C4 概念稿已记录该约束）；`maxRows`（默认 8）滚动窗口保持选中可见，超出追加「↑↓ 还有 N 项」；ascii 降级（`❯`→`>`、`↑↓`→`^v`）；宽度守恒（极端窄宽 <4 列退化为截断前缀行）。
- **app.ts 接线**：renderLive 菜单打开时渲染列表（替换一行 hint，hint 保留为菜单关闭时的兜底）；handleKey 在历史导航前拦截（grok 键路由对齐，Ctrl+P/N 已被命令面板/新会话占用，用 ↑↓ + PageUp/Down）：↑↓ 移动、PageUp/Down 翻页、Tab 接受补全、Enter 接受并提交（输入已是完整命令名时直接提交且**清空输入行**——对齐 InputLine 正常提交路径的 clearAfterSubmit，否则命令文本残留导致后续输入拼出 `/cmd/xxx` 无效命令）、Esc 关闭。
- **有参数命令**（argsHint 存在）：Tab/Enter 补全到 `cmd ` 留参数位；参数建议（链式补全）留待下一批。

## Verification

- 新 `tests/slash-menu.spec.ts` 14 用例：形态/对齐/选中着色/argsHint/滚动窗口（首尾选中平移）/maxRows 自定义/ascii/极端窄宽/宽度守恒。
- `tests/input-controller.spec.ts` +10：open/close/前缀子串排序/孤立 `/` 全量/carry 保持与回退/移动环绕/滚动 clamp/关闭时 no-op。
- `tests/app.spec.ts` +5 接线：`/` 渲染列表 + ↓ 移动、↑ 环绕到最后项（含外部插件命令 /density）、Tab 补全关闭菜单、Enter 提交且输入行清空、Esc 关闭。
- 回归修复：菜单提交路径不清空输入行曾导致 `/status` 用例失败（第二次输入拼成 `/status/status` 面板无法关闭）——补 `setValue('')` 并加断言。
- TUI 全量 **1382 passed / 2 todo**（77 文件）；`tsc --noEmit` 0 错误；oxlint 0 错误；verify-export-jsdoc 通过；新改文件覆盖率 100%（不可达防御分支按仓库惯例 `v8 ignore` 注明）。

## Files

- `packages/tui/tui/src/format/slash-menu.ts`（新）：`formatSlashMenu` + `SLASH_MENU_MAX_ROWS` + `SlashMenuItem`
- `packages/tui/tui/src/engine/input-controller.ts`：`SlashMenuState` + refresh/move/scroll/close/carry + 私有 suggestMatches
- `packages/tui/tui/src/ui/app.ts`：InputLine onChange 接线、handleKey 菜单拦截、renderLive 菜单渲染、`acceptSlashCompletion`
- `packages/tui/tui/SOURCE-MAP.md`：登记 `src/format/slash-menu.ts`（new）
- `docs/dsh-tui-视觉概念稿-c4.md`：决策记录第 9 节
- 测试：`slash-menu.spec.ts`（新）、`input-controller.spec.ts`、`app.spec.ts`

## Alternatives considered

**registry.suggest 做匹配**——否决：匹配逻辑放 engine 层（复用已注入的 `slashCommands`），registry 保持命令注册单一职责，避免 engine→commands 反向依赖。

**菜单渲染走 overlay-engine 浮动面板（grok chrome 面板）**——否决：live 区行渲染与现有 slash hint 同机制，零 overlay 生命周期成本；浮动面板留待视觉验收后按需升级。

**Ctrl+P/N 移动选择（grok 原键位）**——否决：ctrl_p 已被命令面板占用、ctrl_n 已被欢迎页「新会话」占用（C4 决策），用 ↑↓ + PageUp/Down。

## Consequences

- 输入以 `/` 开头即弹出列表（孤立 `/` 显示全量），一行 hint 只在无匹配时兜底——slash 交互从"提示"升级为"选择"。
- 菜单打开时 ↑↓ 劫持历史导航、Esc 劫持——与 grok 同语义（菜单优先），vim/历史用户需先 Esc 关闭。
- 阶段 2 待办：参数建议链式补全（argsHint 已有数据）、MRU 排序、mid-text slash token 高亮、输入行 ghost text（需 InputLine 扩展）。

## 阶段 2 追加（2026-08-12）：MRU 排序 / 参数占位 ghost / 输入行 ghost 预览

### Decision

- **MRU 最近使用优先**：`InputController.slashMru`（上限 `SLASH_MRU_MAX`=10，`recordSlashUse` 去重前移）；`suggestMatches` 在孤立 `/` 全量列表与匹配组内按 MRU 稳定排序（未使用 0 分）。`app.ts` 在 `runSlash` 命令执行成功后记录。
- **参数占位 ghost**：输入完整命令名 + 尾空格（`/theme `）且命令带 `argsHint` → `refreshSlash` 保持菜单打开（matches 只含该命令），`slashGhostText` 返回 argsHint 作输入行 ghost（`/theme ` + dim `<name>`）；Enter 提交完整输入行（trim 由 handleSubmit 承担）。
- **输入行 ghost 预览**：`InputLine.setGhost(text | null)`（幂等，纯渲染状态不触发 onChange）；`displayLinesWithCaret` 在光标行 █ 右侧以 ANSI dim（`\x1B[2m`）渲染 ghost（激活条件：光标在值末尾且无选区——选区行含 ANSI 高亮，列≠字符位置，插入会错位）；wrap 路径（maxWidth）在光标行按 `cursorCol + 1`（█ 后）插入并截断到行宽。`app.ts` renderLive 每帧 `setGhost(slashGhostText())`：菜单选中命令时预览补全剩余（`/th` → `eme`）。

### 不做

mid-text slash token 高亮：需改 InputLine 核心渲染（wrap/选区/IME 光标坐标耦合），当前命令均在行首输入，价值低——留待真实终端验收后评估。

### Verification

- 新 `tests/input-line.spec.ts` 8 用例：dim 渲染/清除/光标非末尾不显示/空值/选区不显示/wrap 插入/wrap 截断/不触发 onChange。
- `tests/input-controller.spec.ts` +9：MRU 去重前移、截断上限、全量排序、组内排序；参数模式进入/无 argsHint 不进入/非完整名不进入/继续输入退出。
- `tests/app.spec.ts` +4：ghost dim 预览、参数模式 Enter 提交、MRU 接线（/density 执行后排第一）；另补 PageUp/Down 翻页用例与 Esc 关闭用例（lone ESC 80ms 超时等待，此前为假阳性）。
- 回归修复：Esc 用例此前未等待 80ms 超时是假阳性（断言空字符串通过）；补等待后真实覆盖菜单关闭路径。
- TUI 全量 **1402 passed / 2 todo**（78 文件，连跑两次 + coverage 模式稳定）；`tsc --noEmit` 0 错误；oxlint 0 错误；coverage gate 0 ERROR（app.ts 100%）。

### Files（阶段 2）

- `packages/tui/tui/src/engine/input-line.ts`：`setGhost` + ghost 渲染（两路径）+ `insertGhost` 辅助 + GHOST_DIM 常量
- `packages/tui/tui/src/engine/input-controller.ts`：`slashMru`/`recordSlashUse`/`mruRank`/`SLASH_MRU_MAX` + refreshSlash 参数模式
- `packages/tui/tui/src/ui/app.ts`：runSlash MRU 记录、`slashGhostText`、renderLive setGhost、acceptSlashCompletion 参数模式提交
- 测试：`input-line.spec.ts`（新）、`input-controller.spec.ts`、`app.spec.ts`

## 阶段 3 追加（2026-08-12）：subagent 对话流状态行（grok SubagentBlock 移植）

### Problem

dsh 的 subagent 运行只在委派树面板（/subagents）可见，对话流中无状态反馈；grok 在 scrollback 渲染单行 SubagentBlock（运行 spinner → 终态 ✓/✗/◌）。用户要求把 subagent 对话流渲染做成闭环。

### Decision

按 grok `scrollback/blocks/subagent.rs` 移植，适配 dsh 的 live→scrollback 机制（scrollback append-only，运行态放 live 区）：

- **纯函数**（新 `format/subagent-line.ts`）：`formatSubagentRunning` → `⠋ 子代理 <label>`（braille spinner 帧随 tick，ascii 降级 `*`）；`formatSubagentDone` → 终态单行 `✓/◌/✗ 子代理 <label> · <秒>`——completed → ✓（success 色）；aborted → ◌（muted）；error/max-tokens/refusal 及 merge-extensible 未知 reason → ✗（error 色）带 ` (reason)` 后缀（completed/aborted 无后缀）。宽度守恒（label 截断优先）。
- **接线**（app.ts mountSession）：`subagent/start` → `subagentRuns`（runId → label/startedAt）记录 + renderBatcher；`subagent/end` → 结算耗时、`commitToScrollback` 提交终态行（append）、从集合移除；disposer 并入 subagentDisposer（卸载释放）。**label 尽力取委派树缓存**（可能滞后）→ 回退 id 短哈希（与委派面板同款兜底）。未配对 end（未知 runId）不渲染——跨会话事件免疫。
- **事件契约修正**：TUI 的事件声明原为过时的 `{ parentId, id }`，更新为真实契约 `{ runId, id }` / `{ runId, stopReason }`（dsh-subagent 的 SubagentRunInfo/SubagentRunEndInfo）。
- 不做：Enter/Ctrl+F 打开子会话全屏视图（dsh 无子会话视图概念，留待后续）。

### Verification

- 新 `tests/subagent-line.spec.ts` 10 用例：spinner 帧/tick 缺省回退/ascii/三态终态/reason 后缀/未知 reason 默认/宽度守恒。
- `tests/app.spec.ts` +4 接线：start → live 区运行行（label 取缓存）、end completed → scrollback 终态 + 运行行移除、end error → ✗ + (error)、未配对 end 免疫。既有委派树刷新用例适配多 handler 收集（数组取第一个）。
- TUI 全量 **1416 passed / 2 todo**（79 文件）；`tsc --noEmit` 0 错误；oxlint 0 错误；subagent-line.ts 覆盖率 100%（`tick ?? 0` 的 nullish 兜底经非 ascii+tick 缺省用例覆盖——ascii 三元短路曾使其不可达）。

### Files（阶段 3）

- `packages/tui/tui/src/format/subagent-line.ts`（新）：`formatSubagentRunning` / `formatSubagentDone`
- `packages/tui/tui/src/ui/app.ts`：subagentRuns 字段、start/end 接线、subagentLabel、renderLive 运行行、事件声明修正
- `packages/tui/tui/SOURCE-MAP.md`：登记 `src/format/subagent-line.ts`（new）
- 测试：`subagent-line.spec.ts`（新）、`app.spec.ts`
