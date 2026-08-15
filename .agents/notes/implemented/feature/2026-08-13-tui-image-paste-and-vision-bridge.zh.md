# Agent Note: TUI 图片粘贴/剪贴板与视觉桥（opencode-tui 移植）

Status: implemented

[English](2026-08-13-tui-image-paste-and-vision-bridge.md) | 中文

## Problem

TUI 输入框移植了引擎原语（InputLine 图片状态机、term-image 编码、image-attach 加载、OSC52 输出）却从未接线：`app.ts` 把 `onPaste` 当纯文本处理、无 Ctrl+V、丢弃 `onSubmit` 的 `images` 参数、从不 drain `takeClipboardOut`、不渲染 `📎` 标记；`clipboard-image.ts`（系统剪贴板读图）整文件缺失。opencode-tui 的输入面——粘贴图片/图片路径/剪贴板文本 fallback/OSC52 复制/终端内联图片渲染/识图状态提示——实际完全缺失。

## Decision

把 opencode-tui 输入面及其模型侧图片路径移植进 dsh 接缝：

- **`engine/clipboard-image.ts`**（新文件，Apache-2.0 移植）：平台 shell 系统剪贴板读图（macOS osascript + sips TIFF→PNG、Linux wl-paste/xclip、Windows PowerShell），带可注入 `setClipboardReader` 测试接缝；另有 `readTextFromClipboard`（pbpaste/wl-paste/xclip/Get-Clipboard）与 `FOCUS_DEBOUNCE_MS` overlay 返回焦点防抖。上游 `@mariozechner/clipboard` native 路径**移除**（dsh 未声明该依赖；死动态导入只会添噪音——git 历史保留可重新采纳）。
- **`app.ts` 接线**：`onPaste` 先尝试剪贴板图片（命中则附图并吞掉图片字节乱码），再图片路径识别（`looksLikeImagePath` + `loadImageAttachment`），最后普通文本；Ctrl+V → `handleCtrlV`（焦点防抖 → 剪贴板图片 → 文本 fallback）；每次 `inputLine.handleKey` 后 drain `takeClipboardOut` 到 OSC52；live 区在输入行上方渲染 `imageSummary()`（`📎 N images`）；`handleSubmit(text, images)` 规范化图片（`normalizeSubmitImages`）、空文本补 `📎 图片消息`、经 `commitUserPrompt` 渲染用户气泡并经 `adapter.send.followup(text, images)` 转发图片。
- **终端图片渲染**：`commitUserPrompt` 同步渲染气泡，随后异步 prepare（`prepareTermImageForCommit`）并在同一写窗口协议（清 live 区 → `writeRaw` → 重绘）内追加 kitty/iTerm2 图形序列。本地转码毫秒级、先于任何网络往返的 assistant 输出，图片实际落在所属气泡下方；dsh 没有 opencode 的 enqueueMainCommit 队列，与流式提交的残余竞态窗口被接受并记录。
- **模型侧**：`ImageBlock`（`{ type: 'image', dataUrl, mime? }`）加入 merge-extensible `ContentBlockMap`；`llm-deepseek` 把用户 image block 序列化为 OpenAI 风格 `image_url` content parts；agent loop 本就原样透传 `UserMessage` content（`session.deriveMessages()`），图片无需改 loop 即达 wire。compact 把图片 block 过滤为文本（不进摘要）——接受的语义。
- **视觉桥**（新插件 `packages/context/vision-bridge`）：主控不识图（`primarySupportsVision: false`）且配置视觉模型（`provider`/`model`）时，`agent/pre-step` 把含图用户消息替换为 `[图片描述]\n<描述>\n\n<原文>`——描述由 `describeImages` 生成（`purpose: 'vision-description'` 的 llm 调用，prompt 按 UI/报错关键词在通用结构与 OCR 级精确转写间自动选择）。桥失败/空输出降级为可见 `[图片桥接失败]`/`[图片桥接提示]` 文本；整轮绝不 failed。**Model-visible ⟺ logged**：描述落 session 事件；原图从未到达 text-only 主控、也不落入 session 日志。可选 `fallback` 视觉模型（`{ provider, model }`）在主视觉模型 error/aborted（5xx/超时）时兜底重试一次；`describeImages` 在发起调用前校验图片 data URL（格式 + 载荷长度）。`visionAutoBridge: true` 使 `provider`/`model` 可选：调用期遍历已注册 provider 的 advisory catalog，取第一个 `supportsVision: true` 的模型（经 `LlmModelInfo.supportsVision`）——对齐 opencode-tui 的 `visionModel.fallback` / `visionAutoBridge` / data URL 校验。
- **TUI 识图提示**：`setVisionInfo` + 气泡三态（图片直发 / 经识图桥转描述 / 未发送——无桥时）。主控不识图且无桥时，TUI 提交**不带图**（气泡已警告）——「未发送」态在提交边界强制，不留给模型层。装配方未注入 `vision` 配置时，TUI 经本插件 apply 时 provide 的 `visionBridge` 探测服务自动判定桥可用性（`TuiApp.resolveVisionBridge`；服务存在即桥可用，随插件卸载释放）。

## Verification

- `tests/clipboard-image.spec.ts`（12）：reader 注入（返回/空/抛错）、darwin osascript PNG + TIFF→sips、linux wl-paste/xclip + JPEG、win32 PowerShell、全失败 → null。
- `tests/app.spec.ts` +12 接线：Ctrl+V 图/文本、onPaste 吞图、图片路径附图（真实临时 PNG）、路径加载失败警告、Alt+W OSC52 drain、提交带图 UserMessage 形状、空文本+图占位、vision 三态气泡。
- `tests/vision-service.spec.ts`（18）+ `tests/prestep.spec.ts`（8）：prompt 模式选择、describeImages 请求契约（image block + purpose）、error/max-tokens 降级、data URL 校验（非 data / 不支持格式 / 载荷过短）、fallback 重试（主错误 → 备用成功；双错 → 抛错）、visionAutoBridge（自动选首个 supportsVision 模型 / 无识图模型 → NO_ADAPTER）、Config 必填/可选（schema 层 provider/model 可选、apply 层未开自动桥 fail-loud；fallback 可选且给出时内部必填）、pre-step 替换 / 主控识图直发 / 纯文本透传 / 空描述与报错降级 / enabled=false。
- `llm-deepseek/tests/serialize.spec.ts` +2：用户 image block → `image_url` parts（含与不含文本）。
- TUI 全套 1470+ 通过；`tsc -b` host 0 错误；verify-source-budgets 的 app.ts 上限 2251→2538（input-line 基线即超 1331 预算，非本次引入）。

## Files

- `packages/tui/tui/src/engine/clipboard-image.ts`（新移植）+ `SOURCE-MAP.md` 条目
- `packages/tui/tui/src/ui/app.ts`（+292）、`src/adapter/send.ts`（followup images）、`src/index.ts`（TuiRunnerConfig.vision）
- `packages/llm/llm/src/types.ts`（ImageBlock）、`packages/llm/llm-deepseek/src/types.ts` + `serialize.ts`（image_url parts）、`GenerateOptions.purpose` 加 `'vision-description'`
- `packages/context/vision-bridge/`（新插件：src/index.ts、src/invariant.ts、README 三件套、tests；apply 时 provide `visionBridge` 探测服务）

## Alternatives considered

### 桥做进 agent-loop 而非插件

改写 `agent-loop` 内联描述图片会把第二个模型路由与视觉策略耦合进 loop。`agent/pre-step` waterfall 是既有扩展点（spark-anchors 先例）：桥是稳定表面上 opt-in 插件，缺席零成本。

### 保留上游 native 剪贴板依赖

`@mariozechner/clipboard` 在 dsh 未声明；动态导入未声明的可选依赖是死代码（knip 会标记）。shell 链（macOS osascript）覆盖同一路径；真实消费者需要时可从 opencode-tui 源码恢复。

### TUI 侧过滤图片 vs 模型侧丢弃

无视觉桥时在模型层丢图需要 loop 级策略，且会把模型从未见过的图写进日志。在 TUI 提交边界过滤（气泡已警告「图片未发送」）保持会话日志真实：从未到达模型的输入不进日志。

### 完整移植 vision-service（ask_image / registry / 缓存）

opencode-tui 的 vision-service 还含 image registry、描述缓存与 `ask_image` 反复追问工具。那是输入框范围之外的第二张 agent 工具面；延后（见 Deferred）并记入 Known Limitations。

## Consequences

- TUI 输入框在粘贴/复制/图片预览上对齐 opencode-tui 输入面；图片消息端到端流动（剪贴板 → 输入行 → 会话 → wire → 视觉模型或主控），Model-visible ⟺ logged 不变量保持。
- `app.ts` 增长（+292，预算上调至 2538）；C4 controller 化方向继续。
- 视觉能力是**配置而非能力查找**：`primarySupportsVision` 与 TUI `vision` 提示由装配方同源设置；llm service 尚无 vision 能力声明。
- DeepSeek 对 `image_url` 的 wire 支持已实现但**本次未对真实支持视觉的 DeepSeek 模型做 e2e 验证**（未跑带 key 的真实 API 测试）；若 API 拒绝 image parts，serialize 降级为文本标记、视觉桥成为唯一识图路径——届时应在此记录 adapter 的 `supportsVision` 事实。

## Deferred

- `ask_image` 工具、imageRegistry、视觉描述缓存（同角度重复追问零调用）、Settings 识图模型面板——opencode-tui vision-service 的剩余面。
- llm provider 视觉能力声明（将取代 `primarySupportsVision` 配置）。
