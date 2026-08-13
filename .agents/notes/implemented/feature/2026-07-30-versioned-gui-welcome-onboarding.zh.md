# Agent Note: 版本化 GUI 欢迎引导

Status: implemented

[English](2026-07-30-versioned-gui-welcome-onboarding.md) | 中文

## 问题

GUI 的凭据引导从 DeepSeek 专用的就绪状态检查开始，但内部测试通知适用于每位用户，即使凭据已经配置，也必须先于提供方设置显示。若把两者作为独立浮层处理，多个对话框可能同时出现；仅存于进程内的关闭标记既无法区分通知已完成确认还是窗口在确认前已关闭，也无法在文案有意修订后重新显示一次通知。

## 决策

**设置外壳协调有序步骤。** `settings.onboarding` 仍是根作用域 list，但 `ui-settings` 会把其中各条目的 id 和顺序投影到一个协调器中，并且只挂载第一个未完成的步骤。当前注册方会收到 `complete()` 和 `openSection(id)`；所有权转移前，不会挂载后续步骤。产品欢迎步骤的顺序为 `-100`，`ui-models` 则只保留顺序为 `0` 的 DeepSeek 条件式就绪状态与凭据跳转步骤。

**不属于单一功能的产品引导由 `ui-settings-general` 持有。** `src/onboarding-copy.ts` 是完整通知、「继续」按钮文案和 `WELCOME_NOTICE_VERSION` 的唯一可编辑来源；GUI 支持的两种 locale 都有意渲染同一份中文所有者文案。运行时 locale 字典从该文件派生欢迎文案，测试也导入同一个所有者，而不重复段落文本。该通知只存在于浏览器 UI：它不会创建会话事件，也不会贡献任何模型可见内容。通知明确以 `DSH_TELEMETRY_DISABLED=1` 作为遥测关闭方式。

**loopback 确认状态按 Harness profile 持久化。** 宿主端在 user-settings seam 中注册 `ui-onboarding` 分节，并存入当前 `$DSH_HOME/settings.yaml`。connection 插件通过 `ctx.connection.isLoopback` 统一发布当前页面是否使用 loopback authority；hostname 判定留在 connection 包内，其他客户端插件只消费服务状态，而不导入其实现。除非 `welcomeNoticeVersion` 与文案所有者文件中的常量精确相等，否则 loopback 浏览器会显示通知。「继续」会以当前版本执行一次路径变更，并且仅在宿主端提交成功后调用 `complete()`；写入失败时通知保持打开，关闭页面或进程则不会写入任何内容。更新该常量会有意要求每个 profile 对修订后的文案重新确认一次。非 loopback 浏览器不能调用仅限 loopback 的 settings API；它仍显示同一通知，但显式点击「继续」只会在当前浏览器进程中完成该步骤，重新加载或新进程会再次显示通知。

**并发 loopback 视图无需陈旧的整体替换即可收敛。** 确认写入有意省略 `expectedRevision`：每个 loopback 标签页都向同一路径写入相同版本，因此该操作是幂等的，并会保留同级字段，而不是重建整个分节。`settings/document-updated` 会转为 `host/settings-changed`；另一个标签页或外部编辑器提交当前版本后，已挂载的 loopback 标签页会重新拉取状态并推进。API Proxy（`@deepseek-ai/dsh-host-apiproxy`）在可配置提供方 namespace 之外，通过封闭的允许列表暴露这一个产品 namespace，同时不会把它的变更视为模型目录失效事件。

**引导流程会暂时接管视口，形成一个连续阶段。** 纯色产品界面通过挂载到 `body` 的 portal 取代完整的应用视图，并将底层应用根节点标记为 inert；严格符合要求的遮罩仍挂载在该界面后方，并保留 `position:absolute`、left/right/bottom 偏移量为零、`top:80px`、`rgba(0, 0, 0, 0.24)` 和 `backdrop-filter: blur(2px)`。欢迎页和按条件显示的凭据设置页在这一阶段中依次呈现，而不是各自作为独立的模态窗口。两个页面都复用 Web UI 的黑色 `BrandWordmark`。欢迎页在 `内测声明` 标题下逐字保留既定的四段文案；所有段落统一采用 16/28 的正文字号与行高，只有最后一段中指定的行动语句使用较为克制的 500 字重。短暂的错落式透明度与纵向位移动画营造出节奏感，但不会阻碍交互，并会在用户启用减少动态效果时禁用。初始焦点落在标题上，「继续」是唯一按钮，且不存在关闭、Escape 或点击遮罩的退出路径。

## 曾考虑的替代方案

**浏览器本地存储**：不予采用，因为确认状态会跟随某个浏览器 profile，而不是 `$DSH_HOME`；全新的 Harness profile 可能错误继承此前的确认状态，外部 profile 编辑也没有权威更新流。因此，非 loopback 的回退保持为进程内状态，而不是浏览器 profile 状态。

**在 `ui-settings-general` 中再增加一个独立模态窗口**：不予采用，因为欢迎通知和凭据就绪状态同时为真时，list 注册方仍会堆叠。声明并渲染该 list 的外壳应当持有有序所有权。

**在渲染或窗口关闭时持久化**：不予采用，因为看见通知不等于确认，窗口关闭事件也无法可靠送达。只有显式提交「继续」才能阻止通知在下次启动时再次显示。

**通用的公开设置暴露标志**：不予采用，因为一个产品 namespace 不足以证明应当扩大每个 settings 注册方的公开配置面。该 API Proxy 保留显式的封闭允许列表。

## 后果

全新 profile 始终会在提供方专用引导之前看到欢迎通知；凭据已经配置时，只会跳过后续 DeepSeek 步骤。在 loopback 上，点击「继续」后重新加载不会再次显示已确认版本，更改文案所有者文件中的版本值会让通知重新出现，而确认前关闭窗口不会改变下次启动。在非 loopback 上，「继续」会在不发起受保护 settings 请求的情况下推进当前进程，重新加载则再次显示通知。针对性的 store 与 React 测试固化了两种持久化模式、精确版本比较、写入失败、单一操作、不可关闭路径、协调器顺序、按条件移交 DeepSeek 步骤和 HMR（热模块替换）清理行为。真实 Chromium 场景会使用隔离的 harness 家目录启动随产品提供的 Web 组合，验证遮罩的精确几何尺寸和计算样式，在确认前后分别重新加载，继续进入凭据缺失设置流程，确认凭据已配置时确认版本不匹配仍会使通知重新出现，并检查浏览器控制台。
