# Agent Note: TUI 会话渲染对标 — presenter 工具卡 + 推理通道

Status: implemented

[English](2026-08-13-tui-presenter-cards-reasoning-lane.md) | 中文

## Problem

三个会话渲染面落后于 Claude Code 基准。已结算的工具输出不可见：`app.ts` `handleStreamEvent` 的 `tool/result` 只喂流利度统计，结果一到 live 进行中卡即消失且 scrollback 无任何落底；`renderToolRows` 只在 attach 时跑一次，且顺序错误（先全部消息、后全部工具卡，不按事件序交错）。harness 的 presenter 契约（`packages/core/tools` 的 `presentCall`/`presentResult` → `diff`/`terminal`/`generic` 卡，fs/bash/git/web 工具已全部实现，Web 面由 apiproxy `viewFor` 消费）在 TUI 一行未消费，只靠嗅探结果文本是否长得像 diff。think 推理则整体被丢：live 路径丢弃 `reasoning-delta`，transcript 折叠丢弃已提交消息里的 `ReasoningBlock`，resume 时还把推理混进流式正文。

## Decision

工具结算与推理现经专门的纯函数层流转，全程软降级地消费 harness 的 presenter 渲染意图：

- **presenter 桥**（`src/adapter/tool-view.ts`）：镜像 apiproxy `viewFor`——经 `ctx.reflect.get` 取可选 `tools` 服务，`JSON.parse` 原始参数，在单个 try/catch 内调 `presentCall`/`presentResult`。服务缺失、工具未注册、参数不可解析、presenter 抛错或返回 `undefined`，一律产出空意图，渲染层回落文本卡；展示层失败绝不中断会话流。
- **卡片渲染器**（`src/format/tool-view-card.ts`）：`renderFileDiff` 经 `structuredPatch`（Myers，±3 上下文）把结构化 `FileDiff` 渲染为 `+`/`−`/上下文/gap 行；`oldText: null` 渲染为纯新增。diff 卡把 >10 行改动折叠为统计行（`N 处修改 (+A −D)`），`expanded` 全量；terminal 卡渲染命令标题 + `cwd` 头 + exit/signal 徽标 + 按工具家族高度折叠输出；`generic` 与其余卡型回落 `formatToolCard` 文本折叠（`generic` 的 `content` 块覆盖模型面文本）。`permission-diff.ts` 改用同一 `renderFileDiff`，审批预览与结算卡共享一种 diff 方言（`+ `/`- ` 前缀带空格）。标题与卡体语汇（`formatToolCardHeader`、`indentToolBody`）与 `formatToolCard` 共用。
- **结算提交**（`app.ts` `tool/result` 分支）：从 transcript 查配对 call，经桥解析意图，渲染后把提交链在 `flushStream()` 之后——流式文本先于其卡片进 scrollback；live 进行中卡标题优先取 `presentCall` 标题（`pendingCallTitles`），缺省回落 `toolArgSummary` 启发式。
- **推理通道**（`src/format/reasoning.ts` + `app.ts`）：`reasoning-delta` 累积进独立缓冲；live 区在流式尾巴上方渲染 shimmer 头行（`✻ 思考中… (Ns)`）+ 尾 3 行暗色斜体。段边界——首个 `text-delta`、`tool/call`、`assistant/message` 或非中止 `turn/end`——把静态头行 + 推理全文（暗色斜体，不走 markdown 管线）整块提交进 scrollback 并清缓冲；中止的 turn 直接丢弃。`compactMode` 两态都只留头行。
- **shimmer 头行**（`src/format/shimmer.ts`，样式源：用户提供的 deep-diving.gif）：tick 驱动（现有 120ms 循环；15 tick 一轮 ≈ 1.8s 对齐 GIF），按显示列做余弦衰减 base → highlight 插值（base = `theme.primary`，highlight = base 向白混 65%），量化 7 档并合并相邻同色段为一个转义。CJK 宽字符按 2 列参与光带定位。16 色轨（hex 不可解析）降级为静态整行着色；落底时头行冻结为静态 dim（GIF 循环的「熄灭」帧——动画物理上不可能存在于已提交文本）。
- **transcript/resume 一致性**（`src/adapter/transcript.ts` + `src/ui/render.ts`）：`TranscriptMessage`/`TranscriptStream` 携带独立 `reasoning` 字段；`TranscriptToolCall` 增加 `seq`/`time`。`renderTranscript` 按 `seq` 交错消息与工具卡，思考块先于正文渲染；resume 路径经同一 presenter 桥解析卡片（presenter 是 args 的纯函数、桥软降级，replay 安全）。

## Testing

- 新 spec：`tool-view.spec.ts`（桥的全部降级路径 + meta 透传）、`tool-view-card.spec.ts`（diff 修改/新建/折叠/展开/紧凑/多文件；terminal 徽标/cwd/折叠/空输出；generic 覆盖与回落）、`reasoning.spec.ts`（两态、紧凑、截断）、`shimmer.spec.ts`（确定性、周期回绕、光带出场帧、CJK 定位、命名色降级）。
- `render.spec.ts` 断言 seq 交错（文本 → 卡 → 文本）、思考块先于正文、`resolveViews` 注入 presenter；`adapter-transcript.spec.ts` 断言流式与已提交折叠的 reasoning/text 分离。
- `app.spec.ts` 集成：`tool/result` → scrollback 出现结算卡且流式文本在前；mock `tools` 服务经 presenter 接线渲染结构化 diff 卡；`reasoning-delta` → live 可见、首个 `text-delta` 触发全文落底；中止 turn 丢弃缓冲。tui 全套绿（`env -u DEEPSEEK_API_KEY`；footer `API ✗` 用例读真实环境）。`tsc` host 面零错误。

## Files

- `packages/tui/tui/src/adapter/tool-view.ts`（新）、`src/format/tool-view-card.ts`（新）、`src/format/reasoning.ts`（新）、`src/format/shimmer.ts`（新）
- `src/ui/app.ts`（结算提交、推理通道、进行中标题）、`src/ui/render.ts`（seq 交错 + presenter 卡）、`src/adapter/transcript.ts`（reasoning/text 分离、工具 seq/time）
- `src/format/tool-card.ts`（共享标题/卡体/动词导出、live 标题覆盖）、`src/format/permission-diff.ts`（共享 `renderFileDiff`）、`src/format/tool-meta.ts`（`parseToolArguments` 归一）、`src/engine/ansi.ts`（导出 `hexToRgb`）
- `packages/tui/tui/package.json` + `tsconfig.json`（dsh-tools peer/dev 依赖 + 项目引用）

## Alternatives considered

**继续嗅探结果文本判断 diff 形状** — 否决：harness 已按工具声明渲染意图；文本嗅探会误判，无法携带结构化 `FileDiff`（新旧文本），也没有 exit code 与 cwd 的通道。

**推理走 markdown 管线渲染** — 否决：推理是模型的草稿流；流式期 markdown 重排会打碎不完整语法，且每帧重排代价高。暗色斜体原文与 Claude Code 观感一致且更便宜。

**scrollback 里也做思考头行动画** — 否决（物理不可能）：scrollback 是已提交文本。落底时头行冻结为静态 dim 行，恰与 GIF 循环的「熄灭」帧一致。

**本批就做 search/read/web 结构化卡** — 推迟：generic 文本折叠已可接受地覆盖；presenter 覆盖面与折叠语汇稳定后二批跟进。

**shimmer 硬编码 GIF 原蓝色** — 否决：颜色从 `theme.primary` 派生以保持各主题一致性；默认主题本就落在 GIF 色系附近。

## Consequences

- 工具结果与推理全文现持久于 scrollback，对齐 Claude Code；scrollback 体量相应增长，`compactMode` 把推理压到单头行作为泄压阀。
- 审批预览与结算 diff 卡共享一个渲染器，diff 方言一次性变更（`+ text` 带空格）；旧 `+text` 断言随行为一并更新。
- presenter 失败刻意不可见（软降级、不写日志）：presenter 坏了表现为普通文本卡。排查需借助 Web 面或单测——这是「展示层永不破坏会话流」的既定代价。
- resume/attach 与 live 流式经同一条桥、同一 seq 交错渲染，attach 顺序分叉这一类 bug 被整体消除。
