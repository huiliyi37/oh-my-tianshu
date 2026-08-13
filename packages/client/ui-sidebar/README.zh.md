# @deepseek-ai/dsh-client-ui-sidebar

[English](README.md) | 中文

侧边栏插件：真实 Host Workspace 按稳定的 Host 顺序排列；每个 Workspace 按自身顺序包含其 `sessionIds`，并以 `parentId` 嵌套；不属于任何 Workspace 的会话显示在末尾的 `Ungrouped` 分区。搜索、状态点以及折叠到布局拥有的 56px 轨道，都只属于呈现层。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)。

New Session 会启动运行时的页面局部前端 Session Intent；真实 Workspace 的「+」会启动一项以该 Workspace 为目标的 Intent。Workspace 标题栏的「+」打开 ui-workspace 的共享选择器，选择结果同样以一个前端会话为目标。Workspace Intent 不会出现在侧边栏中。

`SidebarRootComponentProps` 组合布局 owner share、全局 `useSessions` 和 `useWorkspaces` 钩子、已声明的 `sidebar.workspace` 与 `sidebar.settings` 子 slot，以及注入的 `startSession`、`open` 和侧边栏切换回调。这里没有插件 store：`deriveGroups` 消费对象层快照与组件局部的展开／搜索状态。

栏内的滚动条是一种指针可供性：只要指针不在栏内，外壳就把 ui-theme 的[滚动条间接层](../ui-theme/README.md)重新绑定为 `transparent`；指针离开后滑块再保留 2 秒，因此没人指向的列表不会带着滚动条。避免行位移的空间预留属于滚动区域本身（[ui-workspace](../ui-workspace/README.md)），所以显示滑块不会引起重排。

页脚承载 `sidebar.settings`：侧边栏只渲染固定在底部的布局 slot，并共享其栏状态（`wide`）；ui-settings 在此注册触发行和设置面板。

`/client` 导出表层只包含插件主体（`apply`／`inject`）及约定类型；SidebarRoot、行组件和树派生仍由 slot 注册封装在包内。

## 模型体验

无。侧边栏渲染浏览器会话列表；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **Session 状态点渲染由 [ui-workspace](../ui-workspace/README.md) 持有**：没有可用的 done/error 通知数据源。
- **分组只支持 Workspace**：Update 和 Status 不是可用策略。
- **「New task completed」未读标记是本地查看状态**：完成时间 > 上次查看时间这一事实永远不会到达宿主。
