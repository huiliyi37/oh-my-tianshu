# @deepseek-ai/dsh-api-remotes

[English](README.md) | 中文

为本应用选定的 Host Remote 能力提供双侧 BFF。Host 入口负责 Agent/Session 身份策略；Client 入口以运行时值形式导入生成的 `/remote` 产物，通过 `ctx.remote.$mount()` 挂载每项贡献，并重新导出对应的声明合并。Client 业务包依赖该外观，而不依赖 Gateway 实现或单独的 Remote 运行时入口。

`createApiRemoteAgentResolver()` 会复用 live Agent、恢复普通冷会话、对并发恢复去重、保留 subagent ownership fence，并为 TypeRT `agent` 和 `session` lookup 配置同一个 resolver。标准 Web API Proxy 提供 Agent 默认值和 scope 设置，再将返回的 resolver 用于旧方法，使已迁移与未迁移方法共用同一份策略实现。

当前 Client 组合仅挂载 Goal Remote 贡献。该组合卸载时，Cordis effect 的所有权机制会撤回所有贡献；`@deepseek-ai/dsh-api-gateway/client` 负责描述符校验、可追踪 namespace Service、直接与作用域方法、调用与取消。Client 入口通过 Cordis 消费共享的 `TypeRTClientRemote` 接口，不导入具体 Gateway。

本包不包含传输逻辑或 Host 服务发现逻辑。Web 或未来的 TUI 只要提供同一份不依赖 React 的 `ctx.remote` 约定，均可复用其 Client face。

## 构建边界

仓库中的普通包只属于一个 TypeScript face：Host 包登记在根 `tsconfig.host.json`，Client 包登记在根 `tsconfig.client.json`。`api-remotes` 是唯一刻意拆分的特例，因为它的 Host 入口要参与 Host TypeRT 图，而 `src/client/index.ts` 必须等 Host tsdown 生成业务包的 `/remote` 声明后才能编译。

本包根 `tsconfig.json` 只是引用 `tsconfig.host.json` 与 `tsconfig.client.json` 的 solution。Host aggregate 和 Host 直接消费方引用前者，Client aggregate 和 Client 直接消费方引用后者；禁止把包根 solution 放进任一 aggregate 的依赖图。两个 project 拥有互不重叠的源码和 `.tsbuildinfo`，但共享 `lib/types` 输出目录。

包内 `clientBundle(..., { hostPhase: true })` 让 Host tsdown 打包 Host 入口，让后续 Client tsdown 只打包 browser 入口。普通 Client 插件仍使用单一 Client project，并在 Client tsdown 阶段一起生成 Node loader 入口和 browser bundle；不得因一个包同时存在 `src/index.ts` 与 `src/client/index.ts` 就复制本包的拆分。

## 模型体验

无，因为该 BFF 只选择 Remote 应用方法和身份策略，不注册任何模型接口。

#### KV Cache 影响

无直接影响；其触发的任何模型可见行为均由已挂载的 Host 能力负责。

## 已知限制与暂缓事项

- 能力集合由构建时显式导入的值固定确定；Client 不会在运行时发现 Host 中已启用的服务或 Remote 定义。
- 若要增加能力，必须显式导入相应的 `/remote` 值并在此组合中挂载。
- 在剩余 BFF 配置迁移到 `api-remotes` 之前，标准 Web Host 仍从旧 API Proxy 提供恢复默认值与 Agent scope 设置。
