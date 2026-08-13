# `@deepseek-ai/dsh-helper`

[English](README.md) | 中文

供 `create-sdk` 与 `dsh-sdk config` 共用的项目领域和基础设施。`SdkProject` 是只读快照；`ProjectEditSession` 是唯一的变更与提交边界。设计理由由 [SDK 架构 Agent Note（agent 决策记录）](../../../.agents/notes/proposed/architecture/2026-07-15-sdk-project-editing-architecture.md) 负责。

该包（package）负责内置的类型化 spec 目录、提供方／应用行为实体、结构化项目文件对象、helper 自有项目模板、共享的类型化 `TextTemplate` 渲染器、包管理器策略、本地插件蓝图、类型化问题，以及 clack 交互提示适配器。它绝不会启动 Cordis 应用。

所有业务验证与文档验证都会在提交写入任何受影响文件前完成。提交会检测编辑会话打开后发生的外部修改，但在开始写入后，有意不提供跨文件回滚。

内置功能包括提供方、bash、app、持久化、HMR（热模块替换）、filesystem、todo、skill（技能）、web、subagent、工作流、压缩（compaction）、钩子、repeat-tool guard 和 timeout policy。目录负责功能选项、必需和非默认 Cordis 插件配置、功能依赖、资源贡献与往返标记；create 与 config 使用同一注册表和配置器。ACP（Agent Client Protocol）应用选项只贡献自动化桥；交互式服务属于宿主组合。

`SdkProject.open()` 只要求根目录下的 `package.json` 和 `cordis.yml` 可读。引用 `@deepseek-ai/dsh-tui`（包根或其子路径）的配置按 embed 运行界面打开；引用 `@deepseek-ai/dsh-acp` 的配置按 acp 界面打开。Cordis 配置项用于锚定功能安装；如果某个包只存在于链接的 NPM 依赖闭包中，则该功能仍视为不存在。一旦所属的 Cordis 配置项存在，资源结构不完整就是 `inconsistent`，无法自动修改。

`.env.example` 跟随当前所选功能。`.env` 仅追加：helper 可以补充缺失且名称不同的变量，但绝不会更新或删除现有内容。

包根明确只导出 `create-sdk` 和 `dsh-scripts` 使用的对象；内部模块不提供 `src/*` 或 package-manifest 子路径导出。

## 模型体验

无。项目领域只编辑文件，绝不会挂载运行中的 agent（智能体），也不会发起模型请求。

#### KV Cache 影响

无；此包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **提交不具备跨文件事务性**：每次写入前都会检测外部修改，但后续失败不会回滚已经写入的文件。
