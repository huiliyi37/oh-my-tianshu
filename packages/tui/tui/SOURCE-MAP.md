# dsh-tui source map

本包渲染核心移植自天枢（Tianshu，曾用代号 Rivet）终端 UI 引擎，Apache License 2.0：

- 上游：https://github.com/huiliyi37/Tianshu-Tui（`src/tui/` 子树）
- port 时点：本仓提交 `b26ebed`（2026-08-10）自上游 `src/tui` @ `bc2aa2a0c` 移植；上游快照不随仓分发
- 上游版权：Apache License 2.0, Copyright 2025-2026 Tianshu Contributors（许可全文见 `LICENSE`；再分发与修改声明见 `NOTICE`）

状态图例（封闭枚举；`tests/source-map.spec.ts` 校验 src 全覆盖与取值合法，不做同一性核验）：

- `ported` — 自上游对应文件移植，port 后无本地改动。**不主张字节同一性**：上游快照不在仓内，无法机械核验；port 期的 lint 适配若产生差异则该文件归 `modified`。
- `modified` — 移植后为 dsh 接缝适配过；Apache §4(b) 的修改声明集中记录于本表与 `NOTICE`。
- `new` — dsh 原创，非上游作品的一部分（与本包其余部分同按 Apache-2.0 分发）。

## src/ ↔ 上游映射

上游列 `—` 表示无上游对应文件（`new`）。

| Target (this package) | Upstream (Tianshu src/tui/) | Status |
|---|---|---|
| src/activity-status.ts | activity-status.ts | modified |
| src/activity-store.ts | activity-store.ts | modified |
| src/adapter/live.ts | — | new |
| src/adapter/send.ts | — | new |
| src/adapter/sessions.ts | — | new |
| src/adapter/session-title.ts | — | new（/session list 标题面：官方 log-backed session/title 事件 fold → 首条真人消息确定性 fallback → 「新对话」；纯只读，无 API/sidecar） |
| src/adapter/tool-view.ts | — | new（presenter 桥：镜像 apiproxy viewFor 的 presentCall/presentResult 软降级消费） |
| src/adapter/transcript.ts | — | new |
| src/block-stream-writer.ts | block-stream-writer.ts | modified |
| src/box-chars.ts | box-chars.ts | ported |
| src/braille-spinner.ts | braille-spinner.ts | modified |
| src/command-palette.ts | command-palette.ts | modified |
| src/commands/registry.ts | — | new |
| src/completion/file-completer.ts | file-completer.ts | modified（目录重排 src/tui/ → src/completion/；`resolveFileCompletion` Tab 协调入口为 dsh 新增） |
| src/config-panel.ts | — | new（/config 交互式双栏设置面板：framed overlay 控制器 + 渲染器，四类目即时编辑分派） |
| src/controllers/approval-controller.ts | — | new |
| src/controllers/btw-controller.ts | — | new |
| src/controllers/question-controller.ts | — | new |
| src/controllers/session-manager.ts | — | new |
| src/controllers/welcome-intro-controller.ts | — | new（欢迎开场一次性生命周期：冻结启动快照、按 monotonic 时间采样生成帧、幂等 settle/cancel） |
| src/delegation-panel.ts | — | new |
| src/engine/ansi.ts | engine/ansi.ts | modified（新增 DECSCUSR 光标形状常量：稳态竖条 + 默认恢复，overlay 输入光标用） |
| src/engine/clipboard-image.ts | engine/clipboard-image.ts | modified（移除未声明的 @mariozechner/clipboard native 路径，保留 shell 链 + 注入点；readText 注入测试密封化） |
| src/engine/commit-engine.ts | engine/commit-engine.ts | modified |
| src/engine/image-attach.ts | engine/image-attach.ts | modified（三级自适应压缩：1568px 保透明 PNG / JPEG 0.82 → JPEG 0.55 → 1024px+0.55，语义对齐上游 desktop 子树 image-compress.ts 的 compressImageSafe；probeImageSize 头部解析为 dsh 新增；loadClipboardImageAttachment：剪贴板位图走同一预算管线） |
| src/engine/image-preview.ts | — | new（半块字符图片预览：sharp 懒加载解码 + nearest 降采样 + 游程合并的真彩 ▀ 行，任意终端可用的 composer 缩略图与无图形协议终端的气泡回退） |
| src/engine/image-tool.ts | engine/image-tool.ts | modified（新增 resizeJpegCandidates——长边缩放 + JPEG 质量候选链，win32 脚本含 EncoderParameter 质量参数；语义对齐上游 desktop 子树 image-compress.ts；resize 链 sips 显式 -s format png） |
| src/engine/input-controller.ts | engine/input-controller.ts | modified（类型内联；`tabComplete` Tab 补全状态机驱动） |
| src/engine/input-handler.ts | engine/input-handler.ts | modified |
| src/engine/input-history-store.ts | — | new（输入历史持久化：$DSH_HOME/input-history.json、0600 原子写、串行排队、坏档降级为空） |
| src/engine/input-line.ts | engine/input-line.ts | modified（多行 ↑↓ 导航 grapheme 列保持——CJK/emoji 跨行不拆簇，上游 dfe8b6f41 同步） |
| src/engine/live-engine.ts | engine/live-engine.ts | modified |
| src/engine/metrics-glance-controller.ts | engine/metrics-glance-controller.ts | modified |
| src/engine/overlay-controller.ts | engine/overlay-controller.ts | modified |
| src/engine/overlay-engine.ts | engine/overlay-engine.ts | modified（OverlayRenderer 可选 caret 钩子——输入类 overlay 硬件光标 + DECSCUSR 稳态竖条；caret 写移出空 diff 短路） |
| src/engine/perf-monitor.ts | engine/perf-monitor.ts | modified |
| src/engine/resize-handler.ts | engine/resize-handler.ts | ported |
| src/engine/stream-renderer.ts | engine/stream-renderer.ts | modified |
| src/engine/term-image.ts | engine/term-image.ts | modified |
| src/engine/write-batcher.ts | engine/write-batcher.ts | ported |
| src/external-editor.ts | external-editor.ts | modified |
| src/fluency-hook.ts | fluency-hook.ts | modified |
| src/picker.ts | — | new（#31 交互式选择器：纯状态机 + 渲染 + 控制器，overlay 契约） |
| src/preset-surface.ts | — | new（preset 展示面纯投影：resolvePresetId/wireToolNames/阶段标签，日志事实） |
| src/format/activity-labels.ts | format/activity-labels.ts | modified |
| src/format/approval-card.ts | — | new（审批卡：圆角轨 + diff 体 + y/n/a/esc 键位，纯渲染） |
| src/format/btw-panel.ts | — | new |
| src/format/bg-block.ts | — | new（omp 风格表面底色块：单行/多行垫底色补到整宽，纯渲染） |
| src/format/chrome-colors.ts | — | new（输入轨/footer 雾蓝 chrome token，对齐 dsh-cc-tui Gentle Mist Blue） |
| src/format/collapsed-bash.ts | format/collapsed-bash.ts | modified |
| src/format/diff.ts | format/diff.ts | modified |
| src/format/doctor-report.ts | — | new |
| src/format/lsp-diagnostics.ts | — | new（诊断展示纯函数：工具卡徽标 + /lsp 面板段，severity 语义色） |
| src/format/export.ts | — | new（/export 会话导出：事件日志 → Markdown 转录，纯渲染） |
| src/format/fox-frames.ts | — | new（由欢迎狐狸 sprite sheet 确定性生成的调色板、八帧索引数据与尺寸常量；运行时无资产 I/O） |
| src/format/fox.ts | — | new（欢迎狐狸生成帧的 ANSI 半块渲染器：truecolor、xterm-256 与 ANSI16 分档，零色深或全宽块字符终端降级为空） |
| src/format/fluency-policy.ts | fluency-policy.ts | modified（目录重排：上游根 → src/format/） |
| src/format/activity-band.ts | — | new（CC 对标统一活动带：subagent/workflow/后台任务活跃项折叠 + 高度封顶固定带渲染，纯函数层） |
| src/format/glance-bar.ts | format/glance-bar.ts | modified |
| src/format/hidden-lines.ts | format/hidden-lines.ts | ported |
| src/format/history-search-overlay.ts | — | new |
| src/format/input-frame.ts | — | new（输入轨：上下圆角横线 ╭─╮/╰─╯，左右不封，纯渲染） |
| src/format/keymap-panel.ts | — | new |
| src/format/live-card.ts | — | new（活区共享卡片 chrome：⠋/›/✗/? 状态形 + ⎿ 正文前缀，工具卡/委派树/后台任务行共用，纯渲染） |
| src/format/markdown.ts | format/markdown.ts | modified |
| src/format/memory-overlay.ts | — | new |
| src/format/permission-diff.ts | format/permission-diff.ts | modified |
| src/format/prompt-footer.ts | — | new（C4 概念稿底部 footer：模式徽标 + 快捷键提示，纯渲染） |
| src/format/pricing.ts | — | new（模型 → $/MTok 定价表 + estimateCost：缓存读/写分项计价，未知模型不猜价，纯函数） |
| src/format/reasoning.ts | — | new（think 推理两态渲染：live shimmer 头行 + 尾巴、结算全文块，纯渲染） |
| src/format/session-cost.ts | — | new（/cost 会话成本汇总：usage 按模型分桶累计 + 报告渲染，纯函数） |
| src/format/rewind-overlay.ts | — | new |
| src/format/separator.ts | separator.ts | modified（目录重排：上游根 → src/format/） |
| src/format/shimmer.ts | — | new（光带扫过动画：tick 驱动逐字符插值，样式源用户提供的 deep-diving.gif） |
| src/format/slash-menu.ts | — | new（grok slash_dropdown 移植：slash 命令下拉菜单，纯渲染） |
| src/format/subagent-line.ts | — | new（grok SubagentBlock 移植：subagent 对话流状态行，纯渲染） |
| src/format/spinner-status.ts | format/spinner-status.ts | modified |
| src/format/steer-message.ts | — | new |
| src/format/task-panel.ts | — | new |
| src/format/todos-panel.ts | — | new（/todos 紧凑待办面板：保留快照 → 摘要卡/封顶明细，纯函数层） |
| src/format/tool-card.ts | format/tool-card.ts | modified |
| src/format/tool-family.ts | tool-family.ts | modified（目录重排：上游根 → src/format/） |
| src/format/tool-group.ts | — | new |
| src/format/tool-view-card.ts | — | new（presenter 结算卡：diff/terminal 结构化渲染 + generic 回落；renderFileDiff 与审批预览共用） |
| src/format/tool-meta.ts | — | new |
| src/format/top-status-bar.ts | — | new（omp 风格顶边段式状态栏：嵌入输入框顶轨，纯渲染） |
| src/format/turn-summary.ts | turn-summary.ts | modified（上游单文件拆为模型+渲染，此为渲染半；模型半见 src/turn-summary.ts） |
| src/format/turn-status.ts | — | new（C4 概念稿 turn_status：spinner/◆ + 阶段文本，纯渲染） |
| src/format/user-message.ts | format/user-message.ts | modified |
| src/format/welcome.ts | format/welcome.ts | modified |
| src/gutter.ts | gutter.ts | ported |
| src/index.ts | — | new |
| src/invariant.ts | — | new |
| src/live-tail-cap.ts | live-tail-cap.ts | modified |
| src/lsp/lsp-bridge.ts | — | new（LSP 诊断桥：懒生命周期 + 展示层诊断缓存；扩展名不支持/server 未安装一次标记；per-file 合并与冷却） |
| src/lsp/manager.ts | lsp/manager.ts | modified（initialize 与进程早夭竞速——rpc.request 无超时，进程死掉时 pending 请求永不 settle；其余保持 ported 语义：didOpen/changeFile/getFileDiagnostics，pull 优先 + publishDiagnostics 缓存） |
| src/lsp/multi-manager.ts | lsp/multi-manager.ts | modified（spawn 简化：弃上游 spawnHidden/resolve-node-cli 桌面 bundle 适配，用 node:child_process spawn 直连；win32 经 ComSpec /d /c 派发 .cmd langserver + windowsHide） |
| src/lsp/rpc.ts | lsp/rpc.ts | ported（JSON-RPC over stdio：Content-Length 帧编解码 + 请求/通知分发） |
| src/lsp/server-registry.ts | lsp/server-registry.ts | ported（语言 → server 映射：typescript 经 npx / pyright / gopls / rust-analyzer / clangd / jdtls + which 探测） |
| src/mention-expand.ts | — | new |
| src/mention-parser.ts | mention-parser.ts | modified |
| src/model-roles.ts | — | new（/model 角色子命令纯函数层：角色保留字解析、角色 picker 条目构建、pin/unpin/识图警告文案；registry 与 app 共用） |
| src/pi/latex-block.ts | pi/latex-block.ts | modified |
| src/pi/latex-to-unicode.ts | pi/latex-to-unicode.ts | modified |
| src/port.ts | — | new |
| src/question-panel.ts | — | new |
| src/render/live-panels.ts | — | new |
| src/render/live-snapshot.ts | — | new |
| src/restart.ts | — | new（/restart 的进程重启原语：dispose 后重放 process.argv，stdio inherit + POSIX detached 防 SIGHUP/SIGTTIN） |
| src/restore-session.ts | restore-session.ts | modified |
| src/ring-buffer.ts | ring-buffer.ts | modified |
| src/scrollback-transcript.ts | scrollback-transcript.ts | modified |
| src/session-label.ts | — | new（会话 id 显示短标签：剥离 `session-` 前缀后截 8 位，消除空壳 label） |
| src/skill-panel.ts | — | new |
| src/status-panel.ts | — | new |
| src/statusline.ts | statusline.ts | modified（追加工作流投影层 + WorkflowStatusLine） |
| src/stream-window.ts | stream-window.ts | ported |
| src/summary-state.ts | summary-state.ts | modified |
| src/term-caps.ts | term-caps.ts | modified |
| src/theme-custom.ts | theme-custom.ts | modified（自定义主题根路径重指到本包 home） |
| src/theme-detect.ts | theme-detect.ts | modified（pause 对称恢复：仅在进入时为暂停态才 `pause()`） |
| src/theme-palettes.ts | theme-palettes.ts | modified |
| src/format/top-bar.ts | — | new（C4 概念稿顶部栏：cwd + 分支 + 模型，纯渲染） |
| src/theme.ts | theme.ts | ported |
| src/tool-status.ts | tool-status.ts | modified |
| src/truncation-marker.ts | truncation-marker.ts | ported |
| src/turn-summary.ts | turn-summary.ts | modified（上游单文件拆为模型+渲染，此为模型半；渲染半见 src/format/turn-summary.ts） |
| src/ui-glyphs.ts | ui-glyphs.ts | ported |
| src/ui/app.ts | — | new（角色对应上游 engine/app.ts，为面向 dsh cordis 服务的独立装配实现，非逐行移植） |
| src/ui/key-dialog.ts | — | new（API Key 掩码输入对话框：/key·/login 入口与首启引导，探测三分类后落盘；目标供应商参数化） |
| src/ui/key-wizard.ts | — | new（/key 供应商选择步骤纯函数层：引用派生（web deriveKeyRef 同规则镜像）、profile apiKeyEnv 优先解析、picker 条目构建） |
| src/ui/render.ts | — | new |
| src/width.ts | width.ts | modified |
| src/workflow-panel.ts | — | new |

验证命令（映射覆盖护栏，随 tui 包测试执行）：

    pnpm vitest run packages/tui/tui/tests/source-map.spec.ts
