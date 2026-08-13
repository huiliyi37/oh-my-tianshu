# client/ — web GUI 浏览器半侧

[English](README.md) | 中文

dsh web GUI 的浏览器侧：shell 启动、浏览器与宿主通信、共享 UI 服务和功能插件。编写规则见 [AGENTS.md](AGENTS.md)；宿主半侧是 [`host/`](../host/README.md)。除 `test-runtime` 外，均为命名成 `@deepseek-ai/dsh-client-<name>` 的**产品**包。

| 包 | 目的 |
|---|---|
| [`web/`](web/README.md) | 从客户端条目图启动浏览器 shell。 |
| [`modules/`](modules/README.md) | 加载浏览器侧客户端模块。 |
| [`web-react/`](web-react/README.md) | 连接 shell 运行时与 React 渲染。 |
| [`connection/`](connection/README.md) | 维护浏览器与宿主之间的 RPC 通信和事件传递。 |
| [`runtime/`](runtime/README.md) | 为会话、Workspace 和 UI 组合提供共享客户端服务。 |
| [`hmr/`](hmr/README.md) | 在开发期间刷新客户端插件。 |
| [`locale/`](locale/README.md) | 提供本地化偏好与消息词典。 |
| [`schema-form/`](schema-form/README.md) | 为设置编辑器提供 schema 驱动的草稿处理。 |
| [`test-runtime/`](test-runtime/README.md) | 为客户端功能包提供共享的仓库测试支持。 |
| [`ui-slots/`](ui-slots/README.md) | 定义 UI 功能注册和组合扩展 slot 的方式。 |
| [`ui-theme/`](ui-theme/README.md) | 应用所选颜色主题。 |
| [`ui-primitives/`](ui-primitives/README.md) | 提供共享 React 控件、图标和内容渲染器。 |
| [`ui-layout/`](ui-layout/README.md) | 排列应用的主要区域。 |
| [`ui-sidebar/`](ui-sidebar/README.md) | 展示 Workspace 与会话导航。 |
| [`ui-workspace/`](ui-workspace/README.md) | 提供 Workspace 选择与创建界面。 |
| [`ui-conversation/`](ui-conversation/README.md) | 展示当前会话及其输入界面。 |
| [`ui-tool/`](ui-tool/README.md) | 编排工具调用树和按工具键控的视图。 |
| [`ui-goal/`](ui-goal/README.md) | 展示和管理当前目标。 |
| [`ui-trajectory/`](ui-trajectory/README.md) | 提供 agent（智能体）活动的其他视图。 |
| [`ui-command/`](ui-command/README.md) | 提供会话感知的命令发现与分发。 |
| [`ui-slash/`](ui-slash/README.md) | 协调内联命令和引用建议。 |
| [`ui-skill/`](ui-skill/README.md) | 向内联建议添加 skill（技能）引用。 |
| [`ui-subagent/`](ui-subagent/README.md) | 提供 subagent 导航、子会话记录状态和内联引用。 |
| [`ui-model/`](ui-model/README.md) | 在会话界面中提供模型选择。 |
| [`ui-permission/`](ui-permission/README.md) | 配置默认权限并切换当前会话的访问模式。 |
| [`ui-plan/`](ui-plan/README.md) | 展示生效中的 plan mode 状态及其退出控件。 |
| [`ui-question/`](ui-question/README.md) | 展示 agent 请求的交互式问题。 |
| [`ui-settings/`](ui-settings/README.md) | 承载设置界面及其扩展区域。 |
| [`ui-settings-general/`](ui-settings-general/README.md) | 提供常规设置分区。 |
| [`ui-models/`](ui-models/README.md) | 提供模型提供方配置与 DeepSeek 配置引导。 |

每个子文档负责自身的约定和详细行为。[slot 系统标准](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)与 [Web 客户端架构 Agent Note](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md)负责跨包组合与加载决策。

子系统参考是 [client-modules.md](../../docs/subsystems/client-modules.md)；[slot 系统标准](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)是权威 slot 模型，[web 客户端架构说明](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md)拥有加载链与对象层。
