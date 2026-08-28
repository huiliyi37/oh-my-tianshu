# dsh-tui

[English](README.md) | 中文

交互式终端 UI：`oh-my-tianshu --profile` 的 TUI 层，经 bundle patch 骑在 dsh-base 之上（稳定插件 id `tui-runner`）。渲染核心移植自天枢（Tianshu）终端引擎（Apache-2.0，逐文件溯源见 [SOURCE-MAP.md](SOURCE-MAP.md)），代理状态一律经 session 事件与投影总线到达——引擎是纯展示层，不含 agent 逻辑。

## 装配

```yaml
# cordis.yml（examples/tui 是可运行样例；bundle patch 自动插入同一行）
- id: tui-runner
  name: '@huiliyi37/dsh-tui'
```

发货 bundle patch（cordis.patch.yml）在 `tui-runner` 之外还挂载：spark-anchors、视觉桥，以及天枢侧能力 roster——fs-snapshot（`/rewind` 文件回退）、memory 服务与记忆工具（含 `memory_deep_recall`）、跨会话查询工具、evidence-gate、zen（锚定初始 face 相位；布防期间顶边状态栏显示 `禅` 徽章；禅 `face` 不含 `memory_deep_recall`）、agent-router（turn-end 影子决策——只记录不派发，标准起步）与 agent-presets（`default: standard`；shipped 只读根由 `composeProfile` 注入）。patch 同时禁用 standard 预设在 agent 面重复提供的 21 行 dsh-base 行（shell/fs/skill/goal/plan/compaction/delegation/todo/web 各行与 `workspace-context`）：同一插件被两层注册会在全局唯一的提供方名上相撞，并使工具与提示词段双重注册。base 独有面（`tool-git`、`tool-str-replace-editor`、test/file-info/semantic-search 工具）保持全局，预设会话经作用域链照常可见。

`TuiRunnerConfig`（全部可选）：

| 字段 | 语义 |
|---|---|
| `stdin` / `stdout` | 流注入（测试替身）；缺省 process 全局流 |
| `initialSessionId` | 启动即切入的会话；缺省恢复最近 live 会话，否则新建（`dsh tui --session <id>` 从命令行设置） |
| `editorKey` | 外部编辑器触发键（Phase 6.4）；缺省 `ctrl_o` |
| `vimEnabled` | Vim 键位（Phase 6.5）；缺省 `false` |
| `welcomeAnimation` | 启动欢迎策略：`auto`（缺省）与 `off` 都在终端能承载时提交所选档的静态狐狸；其他值在插件加载时失败 |
| `vision` | 主控模型识图能力与视觉桥状态（图片附件气泡提示数据源：`supportsVision` / `bridgeEnabled` / `bridgeSource`）；由装配方按 vision-bridge 插件配置派生——装配方未派生时，`bridgeEnabled` 经插件 apply 时 provide 的 `visionBridge` 服务自动探测 |
| `workflowHistoryLimit` | `/workflow` 面板已结算 run 缓存条数上限，超限 drop-oldest；正整数，缺省 `50` |
| `lsp` | LSP 诊断桥：`enabled`（缺省 `true`）/ `timeoutMs`（缺省 `2000`）。agent 触碰文件时按扩展名懒启动语言 server 拉取诊断，展示于工具卡徽标与 `/lsp` 面板。纯展示——不写会话事件、不注册任何模型面 |

## 启动欢迎

启动欢迎以 Oh My Tianshu 作为产品身份。支持彩色与窄半块字形的终端在 `Oh My Tianshu >` 与 `< Harness >` 旁放置 nearest-neighbor 休息档坐姿狐狸：80–104 列使用 `28×30` 狐狸（`28×15` 单元格）；105 列且行数足够时使用 `36×38` 狐狸。标题留在狐狸右侧，间距比原先的平级行更宽。其后是所选模型、有效 effort、cwd 与版本。放不下 `28×15` 狐狸加 chrome 的视口，以及无色或全宽块字形终端，以同一身份与元数据的文本形式呈现。

最终欢迎最多追加三行可恢复会话与一条已选 `Tip:`。`auto` 与 `off` 都立即提交该静态狐狸，没有开场时间线。effort 查找有界并回退到 `auto`，装饰性元数据不能阻塞启动。

会话挂载阶段的恢复历史——恢复横幅、回放的 transcript 与恢复分隔符——直接写入并位于欢迎之前。挂载完成且欢迎取得启动所有权之后，attach 先结算规范终态欢迎再接受输入；首次输入、粘贴、命令行初始提示词、resize，或后续 scrollback 提交，都保持该已结算块与挂起动作顺序。终块经仅追加提交路径进入 scrollback 一次，resize 永不擦除已提交历史。自动密钥设置仅在非输入结算后打开，而输入会取消挂起的 overlay。欢迎页纯展示，不增加模型可见输入、会话事件、持久化行为或 agent-loop 行为。[狐狸欢迎 Agent Note](../../../.agents/notes/implemented/feature/2026-08-22-tui-fox-welcome.md) 拥有品牌层级、结算顺序与运行时资产边界；[狐狸欢迎清晰度](../../../.agents/notes/implemented/feature/2026-08-23-tui-fox-welcome-clarity.md) 拥有两档投影、折行与静态挂载；[坐姿狐狸欢迎](../../../.agents/notes/implemented/feature/2026-08-25-tui-sitting-fox-welcome.md) 拥有坐姿抠图、等比例档高与 splash 文案。

**输入框剪贴板与图片粘贴**（移植自 opencode-tui 输入面）：`Ctrl+V` 读系统剪贴板图片（无图 fallback 剪贴板文本）；右键/终端菜单粘贴先识别剪贴板图片（命中则附图并吞掉图片字节乱码），粘贴内容像图片路径时加载为附件；编辑期间，最后一张附件以真彩半块字符缩略图（纯 ANSI 文本，任意终端可用）渲染在 `📎 N images` 计数行上方，提交后图片在用户气泡下方以终端内联图形渲染（kitty / iTerm2），终端无图形协议时回退为同样的半块渲染。vim yank / `Alt+W` 选区复制经 OSC52 写系统剪贴板。用户气泡携带识图提示——图片直发 / 经识图桥转描述 / 未发送（无识图桥）。

**输入键。** 忙碌时 Esc 与 Ctrl+C 打断当前回合（`⏹ 已取消`）；2 秒窗口内再按一次 Ctrl+C 即退出进程（即使回合仍标为忙碌）。空闲 Esc 不退出；双击 Esc 打开 rewind（只列出用户检查点；列表上 Esc 或 Ctrl+C 关闭；选粒度时 Esc 返回列表），vim 开启时除外，改走 `/rewind`。空闲第一次 Ctrl+C 布防 2 秒窗口（非空行先清草稿，Ctrl+Z 可恢复）；第二次即退出进程。输入轨上方的提示写明再按即离开进程。Kitty 键盘协议 flag 1 把 Ctrl+字母编成 CSI u（Ctrl+C 为 `CSI 99;5u`），输入解码把它映射到与传统 C0 字节相同的 `ctrl_*` 名。`Ctrl+J`、Alt+Enter、以及行尾 `\`+Enter 插入换行。终端发出 Kitty/xterm 增强键时（attach 打开协议 flag 1），Shift+Enter 切换粘滞换行模式；开启后 Enter 插入换行，再按 Shift+Enter 退出该模式。bracketed paste 整段插入；满 100 行或 10000 字的粘贴收纳为 `[paste #N +M lines]`，提交时展开（阈值以下保持原文可编辑）。输入视窗最多约占终端高度三分之一（3–16 行），超出时显示 `… 上 N 行` / `… 下 N 行`；↑↓ 按软折行移动，PageUp/PageDown 翻页。会话 tab 标签剥掉 `session-` 前缀。

**完成响铃**（`/bell`）：子代理、工作流运行或后台任务结算时向 stdout 写终端 BEL（`\x07`）——本地终端响铃/闪屏，隔着 SSH 同样可达（远程会话下唯一能到达用户本机的完成提醒）。环境含 `DSH_TUI_SKIP_NOTIFY`、`VITEST` 或 `CI` 时静默；`bellEnabled` 偏好关闭时静默（`/bell` 切换并持久化到 `~/.dsh-tui/prefs.json`）；写失败静默——响铃是装饰性提醒，永不承载正确性。

**输入区信息密度**（`/info`）：循环三档——`full`（输入框顶栏身份与 metrics 段、footer 提示行全显，缺省）/ `compact`（保留 model/effort 身份段与 API/git 标记，隐 metrics 段）/ `off`（顶栏与 footer 全关，动态区让出两行）。档位持久化到 `~/.dsh-tui/prefs.json`：与官方宿主插件同文件共享，合并写只覆盖本包建模的 key、原样保留对方设置。

**会话渲染面**（对标 Claude Code）：已结算工具卡在 `tool/result` 时实时提交进 scrollback，经软降级桥（`adapter/tool-view.ts`）消费 harness 的 presenter 渲染意图（`presentCall`/`presentResult`）——`diff` 结果渲染结构化红绿文件 diff（与审批预览共享 `renderFileDiff`），`terminal` 结果渲染命令标题 + cwd + exit/signal 徽标，其余回落文本折叠卡。think 推理通道流式期在 live 区渲染 shimmer 头行（`✻ 思考中…`，tick 驱动光带扫过，16 色终端静态降级）+ 暗色尾巴，段结束时以折叠头行落底进 scrollback（`✻ 思考 (3.2s) · 12 行`）——正文默认收起（对标竞品），`Ctrl+O` 在 live 区按需展开查看（scrollback append-only，展开不重复落底；中止的 turn 丢弃缓冲；紧凑模式只留头行）。resume/attach 经同一条桥重放，消息与工具卡按事件 seq 交错——live 与恢复转录渲染完全一致。

**全屏转录查看器**（`/scroll`，T5）：对已提交 scrollback 的只读翻页器——屏幕上确切的记录（命令回显、steer 标记、/btw 折叠答案、工具卡），经预留的 `scrollback-transcript.ts` API 解析为消息块。↑/↓ j/k 单行滚动，PageUp/PageDown（Ctrl+U/D）半屏，home/end（g/G）跳顶/底，`[`/`]` 上一/下一轮（user 消息边界，循环），`/` 进搜索——字符累积 query 实时跳首个匹配，`n`/`N`/Enter 循环匹配，Esc 清 query 保持打开，再 Esc 或 Ctrl+C 关闭。打开时取快照（流式提交不推送进已打开的查看器）；1000 行环形缓冲封顶命中时顶栏显示截断提示。

**待办紧凑面板**（`/todos`）：消费 `todos` 会话投影（`todo/write` 全量快照）渲染一行摘要卡——`📋 待办 ✓完成 ⏳进行 □待办 · 当前进行项`；`/todos all` 展开封顶明细（缺省 6 行，超出折叠为 `└ …(+N)`），再按一次收起。投影在 `turn/start` 被清成 null（清单随回合开始重置），面板改读「保留快照」——只吸收非空投影值，已显示的清单跨回合黏滞、不随回合边界闪烁消失；null 仅在会话从未写入时出现（渲染「尚无待办」空态），空数组渲染「全部完成 ✓」完成态（两种空语义可区分）。显隐是会话内 UI 状态：默认隐藏、`/clear` 随清屏收起、重开会话不保留。与 `/status` 的完整 checklist 任务段、`/tasks` 窗格同源不同呈现——完整清单仍在 `/status`。

**LSP 诊断**（移植自天枢 LSP 栈）：agent 触碰文件时，桥按扩展名懒启动语言 server（typescript 经 `npx -y` 默认可用；pyright/gopls/rust-analyzer/clangd/jdtls 按 PATH 探测）拉取诊断——live 工具卡标题带 `⚠ N错 M警` 徽标，`/lsp` 面板按文件分组展示。诊断只进 TUI 本地展示缓存：不写会话事件、不注册任何模型面，dispose 时 kill 全部 server。装配了 `getDiagnostics` 形状的外部服务（`provide('lsp')`，如 dsh-lsp 伴生插件）时直接消费、与模型工具面共享 server 集；官方 `ctx.lsp` seam 经 `query(getDiagnostics)` 操作适配，官方操作落地前恒空。

**会话恢复可见性**（session-resume）：冷启动在欢迎区渲染可恢复会话编号列表（标题 · 年龄 · cwd）——欢迎阶段（任意输入字符即结束）内按数字键 1–9 直达对应会话，`ctrl+s` 恢复最近的其他可恢复会话，`/resume [id]` 无参恢复最近可恢复、带参切换指定会话。恢复挂载时输出横幅（标题 · 最后活动 · cwd）与回放末尾的「上次进行到此处」分隔；日志最后一个 turn/end 仍是崩溃修复闭合标记时追加「上次运行被中断」提示（其后又有正常完成的回合即不再提示）。`dsh tui --session <id>` 与 `dsh run --session <id> "task"` 从命令行恢复指定会话；未知或损坏 id fails loud 并给出指引。损坏的持久化工件保留在列表中并标注「不可恢复」而非消失——选中损坏行在任何切换状态提交之前失败。会话切换统一走 `/resume`、`ctrl+s` 与欢迎页列表（均带标题）；原 chrome 段会话 tab 栏已移除——它把全部持久化会话列成短 id 挤占界面。已挂载的 side conversation 仍在 live 区会话行显示。

**API Key 设置**（`/key`，别名 `/login`）：先开供应商选择（可配置供应商目录，默认供应商 ● 置首、密钥已解析的条目带 ` ✓`），再进掩码输入对话框——对所选供应商的端点探测 key（`401/403` 拒存，网络错误允许强存），经 `credentials` 服务落盘（`$DSH_HOME/.credentials.yaml`，0600）——解析按请求进行，保存即生效、无需重启。落盘引用取 profile 的 `apiKeyEnv`（出厂 `openrouter` 路由带 `OPENROUTER_API_KEY`），未声明则按路由派生（`anthropic → ANTHROPIC_API_KEY`）；pi-ai 路由尚无 profile 时保存后补写最小 profile，路由即时注册、`/model` 立即可选。llm 目录缺席时降级为 DeepSeek 直开。交互启动时默认供应商缺 key 会自动打开一次（Esc 跳过）；进程环境同名变量优先于文件层，对话框给出说明而不写入。

**设置面板**（`/config`）：交互式双栏 framed overlay（左类目右字段，对标竞品 `/config` 的交互词汇）。四类目：模型（默认模型、推理档位、三角色 pin——Enter 打开与命令同一套选择器）、权限（预设切换，走 `/permission` 同一写路径）、凭据（各供应商 key 状态；Enter 直接进入该供应商的 `/key` 对话框）、概览（只读的已解析 settings 命名空间与脱敏标记）。编辑即时生效——所有写面（角色 pin、默认模型选择、权限 apply、凭据 set）都热生效，因此刻意不做草稿/脏块/保存机制；编辑器关闭后面板回到原字段回开。

**模型角色 pin**（`/model vision|secondary|subagent`）：三个消费模型的角色——视觉（图片描述）、副模型（会话标题、compact 摘要）、子代理（委派会话）——可各自 pin 到独立的 `provider/model` 路由。无第三参时打开选择器，首行「跟随默认（清除 pin）」即 unpin；直参 `provider/model` 走与主模型 `/model` 相同的目录校验（未知 provider 与目录外拼写硬拒绝并给就近建议；vision 角色 pin 到 `supportsVision: false` 的目录条目时警告但放行——目录只是 advisory）。pin 经 `model-roles` 设置段（用户层）持久化，热生效、无需重启；未 pin 的角色按各消费者自己的回退链走。`/config` 面板的「模型」类目提供同样的 pin 编辑字段；未装配 `modelRoles` 服务时角色子命令 fails loud 报不可用。

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
