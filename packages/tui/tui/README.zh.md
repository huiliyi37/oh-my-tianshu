# dsh-tui

[English](README.md) | 中文

交互式终端 UI：`oh-my-tianshu --profile` 的 TUI 层，经 bundle patch 骑在 dsh-base 之上（稳定插件 id `tui-runner`）。渲染核心移植自天枢（Tianshu）终端引擎（Apache-2.0，逐文件溯源见 [SOURCE-MAP.md](SOURCE-MAP.md)），代理状态一律经 session 事件与投影总线到达——引擎是纯展示层，不含 agent 逻辑。

## 装配

```yaml
# cordis.yml（examples/tui 是可运行样例；bundle patch 自动插入同一行）
- id: tui-runner
  name: '@huiliyi37/dsh-tui'
```

发货 bundle patch（cordis.patch.yml）在 `tui-runner` 之外还挂载：spark-anchors、视觉桥，以及天枢侧能力 roster——fs-snapshot（`/rewind` 文件回退）、memory 服务与记忆工具、跨会话查询工具、evidence-gate、zen（锚定初始 face 相位；布防期间顶边状态栏显示 `禅` 徽章）、agent-router 与 agent-presets（`default: standard`；shipped 只读根由 `composeProfile` 注入）。

`TuiRunnerConfig`（全部可选）：

| 字段 | 语义 |
|---|---|
| `stdin` / `stdout` | 流注入（测试替身）；缺省 process 全局流 |
| `initialSessionId` | 启动即切入的会话；缺省新建 |
| `editorKey` | 外部编辑器触发键（Phase 6.4）；缺省 `ctrl_o` |
| `vimEnabled` | Vim 键位（Phase 6.5）；缺省 `false` |
| `vision` | 主控模型识图能力与视觉桥状态（图片附件气泡提示数据源：`supportsVision` / `bridgeEnabled` / `bridgeSource`）；由装配方按 vision-bridge 插件配置派生——装配方未派生时，`bridgeEnabled` 经插件 apply 时 provide 的 `visionBridge` 服务自动探测 |
| `workflowHistoryLimit` | `/workflow` 面板已结算 run 缓存条数上限，超限 drop-oldest；正整数，缺省 `50` |
| `lsp` | LSP 诊断桥：`enabled`（缺省 `true`）/ `timeoutMs`（缺省 `2000`）。agent 触碰文件时按扩展名懒启动语言 server 拉取诊断，展示于工具卡徽标与 `/lsp` 面板。纯展示——不写会话事件、不注册任何模型面 |

**输入框剪贴板与图片粘贴**（移植自 opencode-tui 输入面）：`Ctrl+V` 读系统剪贴板图片（无图 fallback 剪贴板文本）；右键/终端菜单粘贴先识别剪贴板图片（命中则附图并吞掉图片字节乱码），粘贴内容像图片路径时加载为附件；附件以 `📎 N images` 标记显示在输入行上方，提交后在用户气泡下方以终端内联图形渲染（kitty / iTerm2）。vim yank / `Alt+W` 选区复制经 OSC52 写系统剪贴板。用户气泡携带识图提示——图片直发 / 经识图桥转描述 / 未发送（无识图桥）。

**输入键。** 忙碌时 Esc 与 Ctrl+C 打断当前回合（`⏹ 已取消`）；2 秒窗口内再按一次 Ctrl+C 即退出（即使回合仍标为忙碌）。空闲 Esc 不退出。空输入行需连按两次 Ctrl+C 才退出；非空输入行清草稿。Kitty 键盘协议 flag 1 把 Ctrl+字母编成 CSI u（Ctrl+C 为 `CSI 99;5u`），输入解码把它映射到与传统 C0 字节相同的 `ctrl_*` 名。`Ctrl+J`、Alt+Enter、以及行尾 `\`+Enter 插入换行。终端发出 Kitty/xterm 增强键时（attach 打开协议 flag 1），Shift+Enter 切换粘滞换行模式；开启后 Enter 插入换行，再按 Shift+Enter 退出该模式。bracketed paste 整段插入；满 100 行或 10000 字的粘贴收纳为 `[paste #N +M lines]`，提交时展开（阈值以下保持原文可编辑）。输入视窗最多约占终端高度三分之一（3–16 行），超出时显示 `… 上 N 行` / `… 下 N 行`；↑↓ 按软折行移动，PageUp/PageDown 翻页。会话 tab 标签剥掉 `session-` 前缀。

**会话渲染面**（对标 Claude Code）：已结算工具卡在 `tool/result` 时实时提交进 scrollback，经软降级桥（`adapter/tool-view.ts`）消费 harness 的 presenter 渲染意图（`presentCall`/`presentResult`）——`diff` 结果渲染结构化红绿文件 diff（与审批预览共享 `renderFileDiff`），`terminal` 结果渲染命令标题 + cwd + exit/signal 徽标，其余回落文本折叠卡。think 推理通道流式期在 live 区渲染 shimmer 头行（`✻ 思考中…`，tick 驱动光带扫过，16 色终端静态降级）+ 暗色尾巴，段结束时以折叠头行落底进 scrollback（`✻ 思考 (3.2s) · 12 行`）——正文默认收起（对标竞品），`Ctrl+O` 在 live 区按需展开查看（scrollback append-only，展开不重复落底；中止的 turn 丢弃缓冲；紧凑模式只留头行）。resume/attach 经同一条桥重放，消息与工具卡按事件 seq 交错——live 与恢复转录渲染完全一致。

**LSP 诊断**（移植自天枢 LSP 栈）：agent 触碰文件时，桥按扩展名懒启动语言 server（typescript 经 `npx -y` 默认可用；pyright/gopls/rust-analyzer/clangd/jdtls 按 PATH 探测）拉取诊断——live 工具卡标题带 `⚠ N错 M警` 徽标，`/lsp` 面板按文件分组展示。诊断只进 TUI 本地展示缓存：不写会话事件、不注册任何模型面，dispose 时 kill 全部 server。装配了 `getDiagnostics` 形状的外部服务（`provide('lsp')`，如 dsh-lsp 伴生插件）时直接消费、与模型工具面共享 server 集；官方 `ctx.lsp` seam 经 `query(getDiagnostics)` 操作适配，官方操作落地前恒空。

依赖服务：`sessions`/`agents`/`agentDefaultModel` 必需；`goals`/`subagents`/`agentPresets` 可选——未装配时 `/goal` 命令、委派树面板与 `/preset` 命令降级（fails loud 报不可用，不静默吞）。`/session list` 标题 fold 官方 `session/title` 事件（dsh-base 已装配）。TUI 同时注册 `userInteraction` provider（终端内答题）并订阅 `approval/request`（挂起审批卡片）。

## 分层

- `src/engine/` — 终端渲染引擎（live 区 / scrollback 提交 / 输入行 / 图片 / 性能监视），移植层
- `src/ui/app.ts` — TuiApp 装配与会话挂载（挂起审批/提问、面板显隐、slash 分发、rewind overlay）
- `src/adapter/` — dsh 会话/agent 服务到 `TuiPort` 的适配（引擎只认 port，不认 ctx）
- 面板投影（`projectXxxPanel`）是纯函数；挂起态状态机已提取为 controller（`src/controllers/`，见 docs/tui-controllers.md），[C4 拆分方案](../../../docs/dsh-tui-拆分方案-c4.md) 持续把 app.ts 拆薄

## 验证

```sh
NO_COLOR=1 pnpm vitest run packages/tui/tui/tests/
```

## Model Experience

None, as the TUI renders logged session events and forwards ordinary user input; it registers no prompt, tool, or context surface.

#### KV Cache effect

None directly; user input submitted through the TUI becomes ordinary logged messages whose request effects belong to the session and loop packages.

## Known Limitations and Deferred Work

- **LSP 需要本地语言 server** — 诊断依赖按扩展名安装的语言 server（typescript 经 `npx -y` 视为可用；pyright/gopls/rust-analyzer/clangd/jdtls 需在 PATH）。官方 `ctx.lsp` seam（`dsh-lsp`）当前未暴露 `getDiagnostics` 操作，装配官方 seam 时会被探测到但诊断恒空，待官方落地该操作后自动生效；无任何 `lsp` 服务时内置桥自行 spawn。
- **图片追问为可选启用** — ask_image 工具与会话图片注册表已移植为独立插件 `dsh-vision-ask`，视觉模型必填（`model`/`baseUrl`/`apiKeyEnv`），因此组合中默认注释掉；视觉桥（`dsh-vision-bridge`）覆盖提交时一次性描述路径，同角度重复描述仍会重调视觉模型（无描述缓存）。
- **app.ts 单体（约 2.2k 行）** — 挂起态状态机已 controller 化（question/approval），渲染组合与键仲裁仍在 app.ts；C4 拆分方案（面板段纯函数化）继续推进。dispose 已释放 interaction/taskDone/taskSurface/subagent/workflow disposer，切会话结算挂起审批/提问（fail-closed）。
- **engine I/O 文件覆盖率豁免** — input-line/live-engine 等终端边界文件在 vitest.config.ts 的覆盖率豁免清单中（`TODO(tui)` 注释），随真实组合测试线成熟逐步消化。
- **孤儿 controller 已收敛** — `engine/stream-render-controller.ts` 与 `engine/tool-group-controller.ts` 与 app.ts 内联逻辑逐 case 对比后语义不等（StreamRender 缺 tool/call·tool/result·turn/end 的 fluency 处理；ToolGroup 缺 compact 参数），按 C4 Wave 3 判据删除提取（保留 app.ts 内联）。底层原语（StreamRenderer/BlockStreamWriter/formatToolCard/format-tool-group）保留且有独立测试。
- **用户级 TTY 验收受阻** — 代理沙箱无法驱动真实终端做人工验收；行为证据以单测与真实组合测试为准。
- **投影模型部分接线** — turn-summary 与 summary-state 已由 App 主体驱动（turn 结束摘要行；`/compact` 直读 summary-state），activity-status/activity-store 已带 spec 落地为纯 fold 但尚无驱动方（仅 fluency 链消费 `ActivityPhase` 类型）；设计中的 cache-telemetry/cache-panel-source/history-replay/adapter-projections 未落地。现状记录在 [docs/projection-layer.md](docs/projection-layer.md)。
