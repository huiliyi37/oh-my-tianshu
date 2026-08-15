# Agent Note: TUI 工具卡与 /lsp 面板的 LSP 诊断上屏

Status: implemented

[English](2026-08-16-lsp-diagnostics-in-tui.md) | 中文

## 问题

TUI 是纯展示层：只渲染会话事件、不注册任何模型面。姊妹仓库 `dsh-tui`（以 `dshtui/*` refs 拉取）已长出一套 LSP 诊断栈——工具卡徽标（`⚠ N错 M警`）+ `/lsp` 面板——而本仓库没有。两个仓库无共同 git 祖先且结构分叉（本仓库是 `packages/tui/tui/src/lsp/`），只能按语义移植，不能 cherry-pick。

## 决策

`packages/tui/tui`（`@huiliyi37/dsh-tui`）现携带 LSP 桥作为纯展示能力，自 `dsh-tui` @ `326adb7` 移植：

- `src/lsp/` — `rpc.ts`（stdio JSON-RPC）、`manager.ts`（单 server 客户端，pull 优先 + `publishDiagnostics` 缓存）、`multi-manager.ts`（按扩展名懒路由）、`server-registry.ts`（typescript 经 `npx -y`；pyright/gopls/rust-analyzer/clangd/jdtls 按 PATH 探测）、`lsp-bridge.ts`（懒生命周期、per-file in-flight 合并 + 5s 新鲜度冷却、不支持扩展名一次标记、dispose 失效）。五个文件只依赖 `node:` 内置模块。
- `src/format/lsp-diagnostics.ts` — 展示纯函数（徽标文本、severity 语义色、按文件分组、面板行）。
- `TuiApp` 接线 — 首次触碰文件或 `/lsp` 打开时懒创建桥；`tool/call` 参数路径（嵌套 `tool_uses` 递归）触发拉取；live 工具卡标题追加徽标；`/lsp` 切换面板；dispose kill 全部 server。
- 数据源探测镜像视觉桥模式：`provide('lsp')` 且带 `getDiagnostics` 形状的服务直接消费；官方 `ctx.lsp` seam（`@huiliyi37/dsh-lsp`）经 `query(getDiagnostics)` 操作适配。官方 seam 当前未暴露 `getDiagnostics` 操作（四个操作是 goToDefinition/findReferences/goToImplementation/hover），因此装配官方 seam 时会被探测到但诊断恒空，待官方落地该操作后自动生效。TUI bundle patch 不装配任何 `lsp` 服务，故今天实际生效路径是内置桥（自行 spawn server）。
- 诊断永不进入会话事件或任何模型面；TUI 仍是纯展示层。

测试：`lsp-rpc.spec.ts`（帧编解码/分发）、`lsp-panel.spec.ts`（面板纯函数）、`lsp-bridge.spec.ts`（假 server 集成 16 例）、`app.spec.ts` 黑盒用例（徽标上卡、面板空态、未知扩展名不 spawn、伴生服务路径）——全注入式，不真 spawn。

## Alternatives considered

**直接 cherry-pick 上游提交。** 否决：无共同 merge base；上游文件带 `@deepseek-ai` import 且 lint 基线更宽松（本仓库 `strict` tsconfig 与 oxlint 配置需要适配：RPC notify 路径的 `exactOptionalPropertyTypes`、帧解析器的 `noUncheckedIndexedAccess`、`no-non-null-assertion`、异步 mock 的 `no-misused-promises`、class 实例的 `no-misused-spread`）。

**选中官方 seam 前先运行时探测支持度。** 否决：确认 `getDiagnostics` 支持需要发一次 query，会懒启动 server——违反桥的懒启动契约。保留上游设计（探测 seam、适配、操作落地前恒空），恒空后果记入 README 已知限制。

**同时移植伴生 `lsp/` 包（dsh-tui-lsp）。** 否决：上游已将其迁出为独立仓（`omdsh-dev/dsh-lsp`），且本仓库已自带官方 seam 包（`dsh-lsp` / `lsp-local` / `tool-lsp`）；TUI 以结构类型消费任一形状，无需包依赖。

## Consequences

TUI 获得诊断视图，且无会话事件/模型面足迹：工具卡在诊断缓存就绪后显示 `⚠ N错 M警` 徽标，`/lsp` 按文件分组、severity 着色。语言 server 只为被触碰文件的扩展名启动，dispose 时 kill；未安装的 server 一次标记为不支持、面板渲染空态而非反复 spawn。TUI profile 装配官方 `ctx.lsp` seam 时今日诊断恒空（已文档化），官方未来落地 `getDiagnostics` 后自动激活。移植过程中还暴露了既有 lint 发现（`term-caps.ts`、`app.ts` 的 `tailLines` 行），保持不动。
