# @deepseek-ai/dsh-client-ui-tool

[English](README.md) | 中文

Client Tool 展示插件。`ui-conversation` 通过 `conversation.chat.node` 的同名 key 分发每个已排序的 `tool-call` Conversation Node；本包渲染其中的 root 及其 Code Dispatch 子调用，并把每个原子调用通过 keyed slot `tool.call.toolview` 分发。没有注册的 Tool 名称使用通用卡片。

业务 UI 包只注册 wire Tool 名称和原子视图，不配对 Session Event、不重建 transcript，也不拥有 root/subcall 拓扑。Runtime 继续负责 call/result 配对、生命周期和递归 `subCalls` 投影；conversation view 继续负责 ChatFlow 位置。

## 渲染约定

`ToolCallTree` 接收一个已经包含递归 `subCalls` 的 root `ToolCallBlock`、selection 状态、会话 `cwd`，以及用于打开文件和检查调用的 Host 回调。它递归遍历标准 call block，让 root 与任意深度的 child 经过同一条原子分发路径，不再订阅独立的 parent-to-children map。

每个 root 和 child wrapper 都保留 `data-chat-anchor-key="call:<id>"` 与 `data-chat-call-id` DOM 约定，供分页和 selection 使用。

本包还通过 `ToolDetails` 填充 `conversation.details.tool`。行 renderer 与详情 renderer 为 `terminal`、`read`、`diff`、`search` 和 `web` render intent 共用同一组纯 card model。本版本不认识的 intent 标签和格式错误的 wire card 数据都会回退为压平的 Tool result 文本。

通用行把已知 Tool 名称归类为 search、read、shell、write、edit、code 或 generic 变体。运行中、成功、失败和中断状态只来自冻结的 call/result slice。只有用户调用 Host 打开文件回调时，文件路径才相对会话 `cwd` 解析；展示代码不读取 Session service。

## 原子 Tool 视图

业务所有方把自己的 wire Tool 名称注册进 `tool.call.toolview`：

```ts ignore-check
ctx.slots.inject('tool.call.toolview', () =>
  ctx.slots.register({
    name: 'tool.call.toolview',
    key: '<wire tool name>',
  }, BusinessToolRow))
```

owner 载荷为 `ToolCallOwnerProps`：`callId`、`toolName`、冻结的 `block`、可选 `cwd`，以及普通的 `openFile`／`inspect` 回调。注册项会收到正常的 Session slot runtime share，但不会收到 React node、Runtime service 或 root/subcall 知识。

本包当前拥有 generic fallback，以及 bash/pwsh、read、write/edit、grep/glob、web、todo、question 和 Code Dispatch 的内置展示。`ui-skill` 展示了业务包如何拥有 `skill` 注册。

各类卡片的上限与 fallback 规则仍由对应的 [terminal](../../../.agents/notes/implemented/feature/2026-07-28-web-terminal-card.md)、[diff](../../../.agents/notes/implemented/feature/2026-07-30-web-diff-card.md)、[read](../../../.agents/notes/implemented/feature/2026-07-30-web-read-card-frontend.md)、[search](../../../.agents/notes/implemented/feature/2026-07-30-web-search-card.md) 和 [web](../../../.agents/notes/implemented/feature/2026-07-30-web-result-card-frontend.md) Note 负责。

## 模型体验

无，因为本包只渲染已经记录的 Tool 调用和结果，不改变模型请求、Tool 执行或 Session Event。

#### KV Cache 影响

无。本包只负责 Client 展示。

## 已知限制与后续工作

- Host 不把 `run_code` 暴露为 Code Mode 程序 binding，因此生产事件目前只能产生一层分发；递归的运行时/UI 约定已为未来的嵌套生产者做好准备。
- 现有第一方 Tool 视图初期仍集中在本包，之后可以通过 keyed slot 独立迁回各自业务包。
- Tool 文案暂时复用 `ui-conversation` locale namespace。
