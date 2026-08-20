# Agent Note: 工具行文件打开失败保持可见

Status: implemented

[English](2026-08-20-tool-row-file-open-failure.md) | 中文

## Problem

工具行的路径点击早已通过 chat view 注入的 `openFile` 调用 `host.openPath`。但注入层吞掉了所有 Host 或 OS 的拒绝，于是桌面打开器缺失、远端或非回环载体、或 Host 无法移交的路径，在读者看来都像打开成功。读者既看不到原因，也没有重试入口。

[file-open-in-OS 决策](../feature/2026-07-28-tool-call-file-open-in-os.md) 仍拥有链接手势与 Host 移交。本笔记只拥有拒绝路径。

## Decision

注入层返回 `workspaces.openPath` 的 promise，不再吞掉其拒绝。chat view 包装这个打开器：拒绝会打开页内 Modal，展示抛出的文本（文本为空时用 unknown-open 兜底文案），并提供以同一路径重试的 Retry；Cancel、Escape、关闭控件与遮罩点击都会关闭它。关闭后迟到的 settle 被忽略，已取消的在途拒绝不会重新弹出对话框——视图持有一个请求代次计数器，保证关闭与重试竞态安全。

对话框挂在拥有 Host 调用的视图上，而不是每个工具行。产物文件 chip 与结尾消息提及共用同一个包装，因为它们本来就共享这个打开器。

Host 消息按抛出原样展示。`WorkspaceRuntime.openPath` 会给线路错误加前缀；对话框不解包该前缀。

## Alternatives considered

- **行内逐行错误。** Host 调用归会话所有，且多个入口共用一个打开器；行内横幅会把同一次拒绝复制到每个点击目标旁边。
- **无重试的 toast。** 产品诉求是原因*加*重试入口。工作区文件夹接纳对话框正是这两者的组合。
- **chat-store 跨重挂持久化。** 打开失败是瞬态视图状态。chat store 在视图重挂后存活，残留的对话框会在标签切换后回来，而那时已无法有意义地重试原始手势。

## Consequences

静默的 Host 拒绝在读者视角不再是成功。无头或远端部署中点击路径现在能看到桌面移交为何没有发生。带专属标题文案的文件夹形打开动作属于未移植的 file-reference 批次；当前所有打开目标统一使用单一 file-open 标题与 unknown-open 兜底。

## Testing

包级测试覆盖注入拒绝上浮（`apply-inject.spec.tsx`）与对话框契约（`chat-view.spec.tsx`）：拒绝加同路径重试、非 Error 拒绝文本、空消息兜底文案、关闭后迟到 settle（resolve 与 reject 两种）被忽略。上游 seeded-history e2e 金样（`file-open-failure.expected.md`）本批次未移植。
