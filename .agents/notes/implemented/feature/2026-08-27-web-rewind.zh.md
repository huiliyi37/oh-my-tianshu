# Agent Note：Web rewind——session.rewind 代理方法与轨迹栏控制（P2④ 阶段 2）

状态：implemented

[English](2026-08-27-web-rewind.md) | 中文

范围：`packages/host/apiproxy`（`api/sessions.ts`、`api/sessions.schema.ts`、`api/rpc.ts`、`api/rpc-map.ts`、`api/index.ts`、`fetch/handler.ts`、`fetch/client.ts`、`api-proxy.ts`），`packages/bundle/web-app/cordis.patch.yml`，`packages/client/connection`（fixture），`packages/client/ui-trajectory`（新 `RewindControl.tsx` + css、`index.ts`、`TrajectoryToolbar.tsx`、`TrajectoryView.tsx`）

## 问题

TUI 的 `/rewind`（两阶段：检查点 → convo/code/both 回退）在 Web 没有对应物：客户端运行时已认识 `rewind` 上下文起点、轨迹视图已渲染回退分支，但**没有任何东西能发起一次回退**——无 host API、无 UI。

## 决策

Web 镜像落地为一个 unary 方法加一个轨迹栏控制，原样复用 TUI 的 host 原语。

**协议。** `session.rewind` unary：`{ sessionId, atSeq, mode: 'convo' | 'code' | 'both' }` → `{ filesChanged, filesSkipped?, truncatedTo? }`。新增闭集错误码 `rewind-file-history-unavailable`（未装配 fs-snapshot）。映射行经编译器锁定的路由表、客户端 value-schema 表、`IApiClient` 与 fixture/测试替身全线传播——接缝三角色完整。

**Host。** 代理实现镜像 `TuiApp.executeRewind`：`convo` 先持久后内存截断（TUI 的防失序顺序），`code` 收集边界后写工具 callId（`write`/`edit`/`str_replace_editor`——与 fs-snapshot 快照的谓词一致）并经 `fsSnapshot.histories` 的 `rewindToBoundary` 恢复，`both` 两者都做。子代理属主会话与 `session.cancel` 同样拒绝；未挂载会话回答 `session-not-found`。`filesSkipped` 显式上报（会话无快照记录时为 0）。

**装配束。** web host 组合挂载 `dsh-fs-snapshot`（与 TUI 组合相同的 host 行），code/both 在发布 Web 部署中可用；e2e scaffold 经共享 base/web patch 栈自动拾取该行。

**UI。** `RewindControl` 挂在轨迹工具栏新增的 `trailing` 槽：选用户消息检查点（从视图事件节点派生、摘要折叠）、选范围（默认 `both`）、经插件注入的 `rewind` 面执行（inject 闭包持有 connection handle，与 runtime 入口相同的 `ctx.get('connection')` 模式），读出恢复计数或 host 错误文本。one-shot 忙碌锁存覆盖执行按钮。

## 备选方案

### 为什么用 unary 而不是 slash 命令？

回退携带载荷（检查点 seq、范围）与客户端必须渲染的结构化结果；命令是仅准入（`command/run` 的结果走日志事件）。unary 保持请求/响应关联与闭集错误词表。

### 为什么检查点从视图节点派生而不是加 host 列表方法？

客户端已持有会话事件（轨迹视图就在渲染它们）；host 侧检查点列表只是把客户端已有的数据再送一遍，且边界语义（user/message seq）本就是 runtime 词表。未来冷会话的仅持久化检查点列表可以加方法而不必改此控制。

### 为什么控制放在轨迹页而不是会话视图？

轨迹视图是回退后果已然可见的地方（分支边界），工具栏是其既有 chrome；会话视图保留以 composer 为中心的控制。

## 后果

买入：Web 可端到端回退一个 live 会话——截断、文件恢复或两者——审计与恢复语义与 TUI 一致。

成本：session 域又多一个 unary，扩宽每张编译器锁定的表（路由/schema/客户端/替身——由映射键强制）；web host 组合现在快照每次写工具执行（内存按会话有界，镜像 TUI host）；回退仍仅限 live 会话（冷会话回答 `session-not-found`），与 TUI 的活跃会话契约一致。

## 验证

聚焦套件：`api-proxy-rewind.spec.ts`（convo 顺序/持久先行、code 精确恢复边界后写调用、both、幽灵会话、缺 fs-snapshot、空恢复），`RewindControl.spec.tsx`（选择、范围、执行参数、结果/错误文本、忙碌锁存、空态），加上既有 trajectory/connection/runtime 套件。组装组合的 web e2e 泳道走 CI（浏览器 boot 在本地沙箱不可用）。
