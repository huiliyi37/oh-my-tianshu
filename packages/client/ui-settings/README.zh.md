# @deepseek-ai/dsh-client-ui-settings

[English](README.md) | 中文

设置外壳插件：一个纯组合表层。它以触发控件和模态设置面板占用 `sidebar.settings`，并声明由注册方填充的 slot：`settings.trigger`／`settings.header`／`settings.close`（界面框架内容）、`settings.action`（内容标题栏中的有序操作）、`settings.section`（每项功能一页）和 `settings.onboarding`（由各功能持有、显示在全视口展示层中的有序页面）。外壳不自带文案：所有文本都来自注册方（ui-settings-general 拥有界面框架、「通用」分区和产品声明；各功能拥有各自的操作、分区、行和条件式首次使用引导页面）。导航 label 可以是跟随语言的 thunk，因此导航投影经 `resolveSlotLabel` 解析，并在分区账本更新或 locale revision 变化时重新渲染（`ctx.get('locale')` 可选读取，无硬 locale 依赖）。

外壳将首次使用引导记录按升序投影，每次只挂载一个页面；接管界面框架（body 层级的展示层、遮罩、应用根节点 `inert`）经 ui-primitives 的 `OnboardingSurface` 由步骤自身持有，因此已挂载但仍在判定私有事实的步骤渲染 null 时不绘制也不阻塞任何内容——步骤判定期间外壳不会露出空白展示层。当前注册方会收到该条目的 id、`complete()` 和 `openSection(id)` 回调；完成或跳过当前页面后，所有权转交给下一项。持久化完成状态、能力就绪状态、文案、变更操作以及展示层包装均由注册方持有，因此独立注册的流程无法堆叠，外壳也不会成为第二个配置事实来源。

## 模型体验

无。设置外壳为浏览器 UI 提供组合能力；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **面板仅涵盖浏览器偏好设置**：宿主侧设置表层（权限模式、工具调用模式）尚无 RPC 支撑；其骨架位于 ui-settings-general。
