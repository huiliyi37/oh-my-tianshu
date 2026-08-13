# Agent Note: 仅凭配置为独立 dsh 接入仓库插件

Status: implemented

[English](2026-07-30-config-only-repository-plugins.md) | 中文

## 问题

独立 `dsh` 用户没有开发者自有的 SDK 项目，无法由其 `package.json`、lockfile 和 `cordis.yml` 承载外部插件依赖。若要求运行安装命令或维护另一份状态文件，「使用这个仓库」就会变成多步骤流程；受信任的 repository 代码仍需要由[repository 包格式](../architecture/2026-08-08-trusted-repository-package-code.md)负责一套锁定精确来源且具事务性的生命周期。长时间运行的 TUI 和 Web 进程还必须在编辑失败时保留仍可使用的插件版本，并向观察者说明候选配置被拒绝的原因。

## 决策

已交付的 TUI 和 Web／无头 `cordis.yml` 配置树包含一个空的 `repository-plugins` 配置项。用户只需修改 `$DSH_HOME/config.yaml`，用 `repositories` 列表替换该配置项的配置。每一项采用 `github:owner/repository#<ref>`，并可追加 `&path:/.../.dsh-plugin`；省略时选择 `/.dsh-plugin`。必须显式指定 ref；路径是仓库内的绝对路径，并以 `.dsh-plugin` 结尾；重复的规范化说明符在安装前即被拒绝。不提供插件市场、发现索引、HTTPS URL 词汇或隐式的最新版本。

`@deepseek-ai/dsh-repository-plugin` 校验并规范化每个源，再通过 vendor 中的通用 [`RepositoryCache`](../architecture/2026-07-30-package-manager-native-repository-cache.md) 解析。默认缓存位于 `$DSH_HOME/cache/repository-plugins`；`cacheDir` 是显式的部署覆盖项。随应用提供的 pnpm 选择已配置的 repository 子包，安装其依赖，运行包所定义的 `prepack`，并原子发布该精确说明符。所选包对 `@deepseek-ai/dsh-repository-plugin` 的直接开发依赖通过包内 `node_modules/.bin` 提供 `dsh-plugin-prepare`；该生命周期会在任何包自有构建完成后调用它。DSH 宿主会导入生成的 `dsh-plugin.mjs` 包装层并将其挂载为子 fiber；该包装层组合静态 skill（技能）与 MCP 所有者，并在声明时组合显式的受信任 Cordis 入口。

## 实时更新与失败

`dsh-app-boot` 通过一个辅助函数挂载根 Include，并保留其确切的 Loader `Entry`。TUI 和 Web 通过 Cordis HMR（热模块替换）注册 `$DSH_HOME/config.yaml`；无头模式在启动时读取同一文件，但不保留监视器。监视器更新会重新构建 Include 补丁列表，先放置不可变的应用自有补丁，再放置新解析的个人补丁。因此，Web 生成的端口、会话根目录、信任和前端值会在每次个人编辑后保留，除非后续个人补丁有意替换相应配置项。

Cordis 会串行处理并合并该确切路径上的变更。Include 与 Loader 以事务方式协调候选配置：成功时提交新源列表；拉取、准备、包装模块导入、格式或子插件失败时拒绝候选配置，并保留或恢复最后一个可用树。HMR 会把捕获的值规范化为 `Error`，记录错误，并广播并行的 `hmr/config-update-failed(filename, error)` 事件；观察者失败不会中断刷新处理。Repository MCP 服务器采用严格启动，因此初始连接、发现或工具注册失败会拒绝候选配置，并构成配置更新失败；非严格的独立 MCP 客户端仍保留其所收束的「插件成功加载但无工具」行为。

相同说明符会永久复用同一个缓存版本。HMR 监视配置，而非已缓存的仓库代码；用户必须改变 ref、路径或源列表，才能选择另一个版本。

## 信任边界

配置仓库即授权该仓库中的包管理器生命周期代码、依赖、显式 `dsh.entry` 和 spawn 的 MCP server 以用户的文件系统权限运行。pnpm 子进程会移除名称中含有 `KEY`、`PASSWORD`、`SECRET` 或 `TOKEN` 的环境变量，但这只会减少凭据暴露，并非沙箱。已准备的包装层会校验组合边界和生命周期状态；当来源不受信任时，它无法让 repository 代码变得可安全运行。

## 考虑过的替代方案

**要求声明 SDK 项目依赖。** 独立应用路径没有可编辑的项目 manifest（元数据清单），因此否决。开发者自有的 SDK 项目仍可使用原生包管理器工作流，这是一项独立能力。

**新增 `dsh plugin install` 命令和安装数据库。** 否决，因为个人 Loader 覆盖层已经负责机器本地组合。第二个变更接口和持久注册表会重复配置身份与回滚机制。

**由 DSH 包直接解析仓库。** 否决，因为 Git 传输、GitHub 子包选择、生命周期执行和内容存储属于 pnpm 与通用 Loader 缓存，而非 DSH 专用适配器。

**监视缓存内容，或自动刷新相同 ref。** 否决，因为一个配置值必须标识一个不可变的已准备版本。后台远端解析会在没有配置差异的情况下改变可执行代码，并使回滚依赖可变的远端状态。

**广播 `unknown` 失败载荷。** 在 HMR 边界否决。JavaScript 内部可以抛出任意值，但公开事件始终接收规范化的 `Error`，从而为观察者提供稳定约定，并在需要时把原始值保留为错误原因。

## 后果

- 添加 `.dsh-plugin/package.json` 的仓库只需一次个人配置编辑即可供独立用户使用，无需改变现有 skill 或 `.mcp.json` 布局。
- 长时间运行的应用无需重启即可新增、替换或移除已配置版本；被拒绝的候选配置会保留最后一个可用运行时，并产生一个通用 Cordis 事件。
- 首次使用可能需要 Git／网络访问和准备时间。后续启动会复用这份精确的已准备缓存；在另行制定缓存管理政策之前，旧版本会持续占用磁盘空间。
- skill 和通用 MCP 定义保留可移植静态适配器，而显式 `dsh.entry` 可以贡献 DSH 原生 Cordis 行为。格式专用的兼容 shim、带 OAuth 的 MCP 定义和插件市场仍有意不提供。

## 测试

仓库包测试固定源规范化、默认和嵌套 `.dsh-plugin` 路径、缓存根解析、重复项拒绝、已准备包装层加载及资源释放。App-boot 测试通过真实 HMR／Include／Loader 路径驱动确切路径的新增、两类失败、恢复、移除、失败事件及生成补丁保留。一个无密钥 PTY 冒烟测试仅通过个人配置启动已交付的 `dsh` 组合，并从预置的不可变缓存版本中调用一个 skill。
